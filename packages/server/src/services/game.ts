// SPDX-License-Identifier: AGPL-3.0-or-later
// Lógica del juego con base de datos: turnos, rondas, boleto, préstamos y estado de la cartera.
//
// Toda operación que toca dinero va en una transacción que empieza bloqueando la fila de la
// cartera de la temporada (`SELECT … FOR UPDATE`). Ese cerrojo serializa todo lo que hace un
// mismo usuario: con cien apuestas simultáneas, cada una ve el saldo que dejó la anterior.
// Los mensajes del WebSocket se mandan solo después del COMMIT.
import {
  accrueInterest,
  addToSlip,
  bestStreak,
  canRequestLoan,
  applyLoan,
  chooseRoundBets,
  colorStreak,
  dayAt,
  minBet,
  netWorth,
  planItems,
  queueOutcome,
  resolveBets,
  seasonAt,
  settleItems,
  totalStake,
} from '@vibe-gambling/shared'
import type {
  Achievement,
  AchievementRound,
  BetResponse,
  ColorStreak,
  BetSelection,
  GameConfig,
  Inventory,
  ItemId,
  OpenRound,
  ResolvedRound,
  SeasonBounds,
  ServerMessage,
  Slip,
  TurnEndRequest,
  TurnEndResponse,
  TurnStartResponse,
  Wallet,
} from '@vibe-gambling/shared'
import { and, asc, count, desc, eq, gte, isNull, lt, max } from 'drizzle-orm'

import type { Database, Executor, Tx } from '../db/client.ts'
import {
  bets,
  loans,
  roundItemEffects,
  rounds,
  seasons,
  turns,
  users,
  wallets,
} from '../db/schema.ts'
import type { RoundRow, UserRow, WalletRow } from '../db/schema.ts'
import type { Clock } from '../lib/clock.ts'
import { AppError } from '../lib/errors.ts'
import type { Rng } from '../lib/rng.ts'
import type { AchievementService } from './achievements.ts'
import type { ItemService } from './items.ts'
import type { Notifier } from './notifier.ts'
import type { Views } from './views.ts'

/** Lo que el juego necesita del log (el de Fastify vale). */
export interface GameLogger {
  warn(obj: object, msg: string): void
}

export interface GameDeps {
  db: Database
  game: GameConfig
  clock: Clock
  rng: Rng
  views: Views
  notifier: Notifier
  achievements: AchievementService
  /** TIENDA: el bolsillo que se lee y se gasta dentro de la tirada. */
  items: ItemService
  logger: GameLogger
  /**
   * Después de cada tirada nueva (ya confirmada y anunciada): el programa de afiliados mira si el
   * jugador acaba de activarse como invitado. Nunca rompe la tirada (sus errores se registran).
   */
  afterSpin?: (userId: string) => Promise<void>
}

export interface GameState {
  user: UserRow
  wallet: Wallet
  slip: Slip
  round: OpenRound | null
  lastRound: ResolvedRound | null
  achievements: Achievement[]
  /** Bolsillo y armario de la TIENDA. */
  inventory: Inventory
}

type Outbox = Array<{ userId: string; message: ServerMessage }>

/** Lo que hace falta de un turno para tirar su ronda (en directo o al gastar una pendiente). */
interface SpinInput {
  turnId: string
  gitPushOk: boolean
  testFailed: boolean
  durationMs: number
}

/** Cómo se tira: giro mínimo y, al gastar una pendiente, el instante en que empieza a girar. */
interface SpinOptions {
  spinMs: number
  /** Caída de la bola tras resolver: `revealAt` nunca queda antes de ahora + esto. */
  landingMs: number
  openedAt?: Date
  spendRequestId?: string
}

type TurnOutcome =
  | Resolution
  | { kind: 'no_round'; wallet: WalletRow }
  /** Tope diario: no se tira ni se guarda. `fresh` false en un reintento (no se avisa otra vez). */
  | { kind: 'daily_limit'; wallet: WalletRow; reopensAt: Date; fresh: boolean }
  | {
      kind: 'queued'
      wallet: WalletRow
      dropped: boolean
      fresh: boolean
      /** Logros desbloqueados al guardarla (se anuncian después de `pending`). */
      unlocked: Achievement[]
      /** Tiradas pendientes después de guardarla (null en un reintento: se cuentan aparte). */
      pending: number | null
    }

/** Ronda tirada y liquidada. */
interface Resolution {
  kind: 'resolved'
  round: RoundRow
  wallet: WalletRow
  fresh: boolean
  /** Logros desbloqueados por esta tirada (se anuncian después de `round.resolved`). */
  unlocked: Achievement[]
  /** Si se gastó alguna carga de la TIENDA (se anuncia `inventory` tras `round.resolved`). */
  consumed: boolean
  /** Tiradas pendientes después de tirarla (null en un reintento: se cuentan aparte). */
  pending: number | null
  /** La ronda ya vista por el protocolo (null en un reintento: se lee de la base de datos). */
  view: ResolvedRound | null
}

/** Resultado de gastar una tirada pendiente. */
export interface SpendResult {
  round: ResolvedRound
  wallet: Wallet
  /** false si era un reintento de un GIRAR ya hecho (no se ha tirado otra vez). */
  fresh: boolean
}

const V = 1 as const

export class GameService {
  readonly #d: GameDeps

  constructor(deps: GameDeps) {
    this.#d = deps
  }

  /** Instante actual según el reloj inyectado (el mismo de `openedAt` y `revealAt`). */
  now(): Date {
    return this.#d.clock.now()
  }

  /** Temporada en curso según el reloj y `config/game.json`. */
  currentSeason(now: Date = this.#d.clock.now()): SeasonBounds {
    const { timeZone, startDay } = this.#d.game.season
    return seasonAt(now, timeZone, startDay)
  }

  // ---------------------------------------------------------------- turnos

  async turnStart(userId: string, turnId: string): Promise<TurnStartResponse> {
    const now = this.#d.clock.now()
    const season = this.currentSeason(now)
    const outbox: Outbox = []
    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      await this.#lockWallet(tx, userId, season.id)

      // Reintento del mismo turno: misma respuesta, nada nuevo.
      const [existing] = await tx
        .select({ turn: turns, round: rounds })
        .from(turns)
        .innerJoin(rounds, eq(rounds.id, turns.roundId))
        .where(and(eq(turns.userId, userId), eq(turns.turnId, turnId)))
      if (existing) return { round: existing.round, reused: existing.turn.reused }

      const open = await this.#freshOpenRound(tx, userId, season.id, now, outbox)
      if (open) {
        await tx
          .insert(turns)
          .values({ userId, turnId, roundId: open.id, reused: true, startedAt: now })
        return { round: open, reused: true }
      }
      const round = await this.#openRound(tx, userId, season.id, now, outbox)
      await tx
        .insert(turns)
        .values({ userId, turnId, roundId: round.id, reused: false, startedAt: now })
      return { round, reused: false }
    })
    this.#flush(outbox)
    return {
      v: V,
      round: this.#d.views.openRound(result.round),
      reused: result.reused,
      windowConnected: this.#d.notifier.isConnected(userId),
    }
  }

  async turnEnd(userId: string, req: TurnEndRequest): Promise<TurnEndResponse> {
    const now = this.#d.clock.now()
    const season = this.currentSeason(now)
    const outbox: Outbox = []
    // ¿Hay alguien mirando? Con alguna ventana visible se juega en directo; si no, se guarda.
    const attentive = this.#d.notifier.isAttentive(userId)

    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await this.#lockWallet(tx, userId, season.id)
      // Una tirada por bola: mientras la bola de la anterior siga cayendo (`revealAt` en el
      // futuro), este turno no se tira en directo sino que se guarda como pendiente. Se mira con
      // la cartera ya bloqueada: dos `turn/end` simultáneos se serializan aquí, y el segundo ve el
      // `revealAt` que dejó el primero.
      const live = attentive && !(await this.#ballRolling(tx, userId, now))
      const settle = (wallet: WalletRow, round: RoundRow) =>
        live
          ? this.#resolve(tx, wallet, round, req, now, {
              spinMs: this.#d.game.spin.minSpinMs,
              landingMs: this.#d.game.spin.landingMs,
            })
          : this.#defer(tx, wallet, round, req, now)
      const outcome = await (async (): Promise<TurnOutcome> => {
        const [turn] = await tx
          .select()
          .from(turns)
          .where(and(eq(turns.userId, userId), eq(turns.turnId, req.turnId)))
          .for('update')

        // Sin `turn/start` no hay duración que medir, así que no hay tirada (ver más abajo). El
        // mod nunca manda un `turn/end` si su `turn/start` falló: esto solo lo hace un script.
        if (!turn) {
          this.#tooShort(null)
          return { kind: 'no_round', wallet }
        }

        const [round] = await tx
          .select()
          .from(rounds)
          .where(eq(rounds.id, turn.roundId))
          .for('update')
        if (!round) throw new Error(`turno ${turn.turnId} sin ronda`)

        // Reintento de un `turn/end` ya procesado: la misma respuesta, sin tirar ni guardar nada.
        if (turn.endedAt !== null) return replayTurnEnd(round, req.turnId, wallet)

        await tx
          .update(turns)
          .set({ endedAt: now })
          .where(and(eq(turns.userId, userId), eq(turns.turnId, req.turnId)))
        if (round.status !== 'open') return { kind: 'no_round', wallet }
        if (this.#isStale(round, season.id, now)) {
          await this.#expire(tx, round, now, outbox)
          return { kind: 'no_round', wallet }
        }
        // Duración mínima del turno, con el reloj del servidor (nunca la `durationMs` del mod):
        // un turno más corto no da tirada ni pendiente. Si ningún otro turno abierto comparte la
        // ronda, se cierra sin tirar; si no, la sigue esperando ese otro turno.
        const elapsedMs = now.getTime() - turn.startedAt.getTime()
        if (elapsedMs < this.#d.game.turn.minDurationMs) {
          this.#tooShort(elapsedMs)
          if (!(await this.#shared(tx, round))) await this.#expire(tx, round, now, outbox)
          return { kind: 'no_round', wallet }
        }
        // Tope diario: con la cartera bloqueada, así dos turnos a la vez no pasan los dos del
        // tope. Ni se tira ni se guarda; la ventana deja de ver girar la ronda con `daily_limit`.
        const closed = await this.#dailyLimit(tx, userId, now)
        if (closed) {
          if (!(await this.#shared(tx, round))) {
            await tx
              .update(rounds)
              .set({ status: 'expired', expiredAt: now })
              .where(eq(rounds.id, round.id))
          }
          return { kind: 'daily_limit', wallet, reopensAt: closed, fresh: true }
        }
        return settle(wallet, round)
      })()
      // Un reintento que no tiró (`no_round`) con la mesa cerrada repite el aviso del tope: la
      // ronda no recuerda por qué no tiró, y es lo que el mod tiene que enseñar.
      if (outcome.kind === 'no_round') {
        const closed = await this.#dailyLimit(tx, userId, now)
        if (closed) {
          const pending = await this.#pendingCount(tx, userId, outcome.wallet.seasonId)
          return {
            outcome: { kind: 'daily_limit', wallet, reopensAt: closed, fresh: false } as const,
            pending,
          }
        }
      }
      // El contador de pendientes, con la cartera aún bloqueada (si no lo trae ya el desenlace).
      const known =
        outcome.kind === 'no_round' || outcome.kind === 'daily_limit' ? null : outcome.pending
      const pending = known ?? (await this.#pendingCount(tx, userId, outcome.wallet.seasonId))
      return { outcome, pending }
    })

    const { outcome, pending } = result
    const wallet = this.#d.views.wallet(outcome.wallet, outcome.wallet.seasonId, pending)
    if (outcome.kind === 'no_round') {
      this.#flush(outbox)
      return { v: V, status: 'no_round', wallet }
    }
    if (outcome.kind === 'daily_limit') {
      const reopensAt = outcome.reopensAt.toISOString()
      const limit = this.#d.game.dailySpinLimit
      if (outcome.fresh) {
        outbox.push({ userId, message: { v: V, type: 'daily_limit', limit, reopensAt, wallet } })
      }
      this.#flush(outbox)
      return { v: V, status: 'daily_limit', limit, reopensAt, wallet }
    }
    if (outcome.kind === 'queued') {
      if (outcome.fresh) {
        const event = outcome.dropped ? 'dropped' : 'queued'
        outbox.push({ userId, message: { v: V, type: 'pending', event, wallet } })
        pushUnlocked(outbox, userId, outcome.unlocked)
      }
      this.#flush(outbox)
      return { v: V, status: 'queued', dropped: outcome.dropped, wallet }
    }
    const resolved = outcome.view ?? (await this.#roundView(this.#d.db, outcome.round))
    if (outcome.fresh) {
      outbox.push({ userId, message: { v: V, type: 'round.resolved', round: resolved, wallet } })
      await this.#pushConsumed(outbox, userId, outcome.consumed, wallet)
      pushUnlocked(outbox, userId, outcome.unlocked)
    }
    this.#flush(outbox)
    if (outcome.fresh) await this.#afterSpin(userId)
    return { v: V, status: 'resolved', round: resolved, wallet }
  }

  // ---------------------------------------------------------------- tiradas pendientes

  /**
   * GIRAR: gasta la tirada pendiente más antigua de la temporada. Tira en este momento, con el
   * RNG y las reglas de siempre, y con el `git push` y los tests del turno que la guardó. El
   * ritmo lo marca la animación: hasta que no se haya enseñado la tirada anterior (`revealAt`),
   * no se puede gastar otra. Un reintento con el mismo `requestId` no tira dos veces.
   */
  async spendPending(
    userId: string,
    opts: { quick: boolean; requestId: string },
  ): Promise<SpendResult> {
    const now = this.#d.clock.now()
    const season = this.currentSeason(now)
    const cfg = this.#d.game
    const outbox: Outbox = []
    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await this.#lockWallet(tx, userId, season.id)
      const pendingNow = () => this.#pendingCount(tx, userId, season.id)

      const [done] = await tx
        .select()
        .from(rounds)
        .where(and(eq(rounds.userId, userId), eq(rounds.spendRequestId, opts.requestId)))
      if (done) {
        return {
          closed: null,
          round: done,
          view: null,
          wallet,
          fresh: false,
          pending: await pendingNow(),
          unlocked: [],
          consumed: false,
        }
      }

      if (await this.#freshOpenRound(tx, userId, season.id, now, outbox)) {
        throw new AppError('conflict', 'The wheel is already spinning for a prompt.')
      }
      if (await this.#ballRolling(tx, userId, now)) {
        throw new AppError('rate_limited', 'The ball is still rolling. Wait for it.')
      }
      // Tope diario: las pendientes gastadas también cuentan. Con la cartera bloqueada.
      const closed = await this.#dailyLimit(tx, userId, now)
      if (closed) return { closed, wallet, pending: await pendingNow() }
      const [next] = await tx
        .select()
        .from(rounds)
        .where(
          and(
            eq(rounds.userId, userId),
            eq(rounds.seasonId, season.id),
            eq(rounds.status, 'deferred'),
          ),
        )
        .orderBy(asc(rounds.deferredAt), asc(rounds.id))
        .limit(1)
        .for('update')
      if (!next) throw new AppError('not_found', 'No pending spins left.')

      const spun = await this.#resolve(
        tx,
        wallet,
        next,
        {
          turnId: must(next.resolvedByTurnId ?? undefined),
          gitPushOk: next.gitPushOk ?? false,
          testFailed: next.testFailed ?? false,
          durationMs: next.durationMs ?? 0,
        },
        now,
        {
          spinMs: opts.quick ? cfg.pendingSpins.quickSpinMs : cfg.spin.minSpinMs,
          landingMs: opts.quick ? cfg.pendingSpins.quickLandingMs : cfg.spin.landingMs,
          openedAt: now,
          spendRequestId: opts.requestId,
        },
      )
      return {
        closed: null,
        round: spun.round,
        view: spun.view,
        wallet: spun.wallet,
        fresh: true,
        pending: spun.pending ?? (await pendingNow()),
        unlocked: spun.unlocked,
        consumed: spun.consumed,
      }
    })

    if (result.closed) {
      // Todas las ventanas enseñan el aviso; quien pidió el GIRAR recibe además el error.
      const reopensAt = result.closed.toISOString()
      const wallet = this.#d.views.wallet(result.wallet, result.wallet.seasonId, result.pending)
      const limit = cfg.dailySpinLimit
      this.#d.notifier.send(userId, { v: V, type: 'daily_limit', limit, reopensAt, wallet })
      throw new AppError(
        'daily_limit',
        `Daily spin limit reached. The table reopens at ${reopensAt}.`,
      )
    }
    const round = result.view ?? (await this.#roundView(this.#d.db, result.round))
    const wallet = this.#d.views.wallet(result.wallet, result.wallet.seasonId, result.pending)
    if (result.fresh) {
      outbox.push({
        userId,
        message: { v: V, type: 'round.started', round: this.#d.views.openRound(result.round) },
      })
      outbox.push({
        userId,
        message: { v: V, type: 'round.resolved', round, wallet, requestId: opts.requestId },
      })
      await this.#pushConsumed(outbox, userId, result.consumed, wallet)
      pushUnlocked(outbox, userId, result.unlocked)
    }
    this.#flush(outbox)
    if (result.fresh) await this.#afterSpin(userId)
    return { round, wallet, fresh: result.fresh }
  }

  // ---------------------------------------------------------------- boleto y préstamo

  async placeBet(
    userId: string,
    selection: BetSelection,
    amount: number | 'all-in',
  ): Promise<Omit<BetResponse, 'v'>> {
    const now = this.#d.clock.now()
    const season = this.currentSeason(now)
    const cfg = this.#d.game
    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await this.#lockWallet(tx, userId, season.id)
      let stake: number
      if (amount === 'all-in') {
        if (!cfg.allIn) throw new AppError('invalid_bet', 'All-in is disabled on this table.')
        stake = wallet.balance
      } else {
        if (amount < minBet(cfg)) {
          throw new AppError('invalid_bet', `The minimum bet is ${minBet(cfg)}.`)
        }
        stake = amount
      }
      if (stake <= 0 || stake > wallet.balance) {
        throw new AppError('insufficient_funds', 'Not enough coins for that bet.')
      }
      const slip = addToSlip(wallet.slip, { selection, amount: stake }, cfg)
      if (!slip) {
        throw new AppError(
          'too_many_bets',
          `At most ${cfg.maxBetsPerRound} different bets per round.`,
        )
      }
      const [updated] = await tx
        .update(wallets)
        .set({ balance: wallet.balance - stake, slip, updatedAt: now })
        .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, season.id)))
        .returning()
      const [open] = await tx
        .select({ id: rounds.id, openedAt: rounds.openedAt, seasonId: rounds.seasonId })
        .from(rounds)
        .where(and(eq(rounds.userId, userId), eq(rounds.status, 'open')))
      const current = open !== undefined && !this.#isStale(open, season.id, now)
      const pending = await this.#pendingCount(tx, userId, season.id)
      return { wallet: must(updated), current, pending }
    })
    const slip = this.#d.views.slip(result.wallet.slip)
    const wallet = this.#d.views.wallet(result.wallet, season.id, result.pending)
    this.#d.notifier.send(userId, { v: V, type: 'slip', slip, wallet })
    return { slip, wallet, forRound: result.current ? 'current' : 'next' }
  }

  /** Retira todas las fichas del boleto y las devuelve al saldo. */
  async clearSlip(userId: string): Promise<{ slip: Slip; wallet: Wallet }> {
    const now = this.#d.clock.now()
    const season = this.currentSeason(now)
    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await this.#lockWallet(tx, userId, season.id)
      const refund = totalStake(wallet.slip)
      const [updated] = await tx
        .update(wallets)
        .set({ balance: wallet.balance + refund, slip: [], updatedAt: now })
        .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, season.id)))
        .returning()
      return { row: must(updated), pending: await this.#pendingCount(tx, userId, season.id) }
    })
    const slip = this.#d.views.slip(result.row.slip)
    const wallet = this.#d.views.wallet(result.row, season.id, result.pending)
    this.#d.notifier.send(userId, { v: V, type: 'slip', slip, wallet })
    return { slip, wallet }
  }

  /** "Ludo-Crédito Express": solo si el saldo (contando el boleto) no llega a la ficha mínima. */
  async requestLoan(userId: string): Promise<{ amount: number; wallet: Wallet }> {
    const now = this.#d.clock.now()
    const season = this.currentSeason(now)
    const cfg = this.#d.game
    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await this.#lockWallet(tx, userId, season.id)
      // Las fichas del boleto cuentan: si no, bastaría con apostarlo todo, pedir y retirar.
      if (!canRequestLoan(wallet.balance + totalStake(wallet.slip), cfg, wallet.debt)) {
        throw new AppError(
          'loan_not_allowed',
          'You still have coins. The bank only lends to the truly broke.',
        )
      }
      const next = applyLoan(wallet.balance, wallet.debt, cfg)
      const [updated] = await tx
        .update(wallets)
        .set({ balance: next.balance, debt: next.debt, loans: wallet.loans + 1, updatedAt: now })
        .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, season.id)))
        .returning()
      await tx.insert(loans).values({
        userId,
        seasonId: season.id,
        amount: cfg.loan.amount,
        interestPerSpin: cfg.loan.interestPerSpin,
        afterSpin: wallet.spins,
        createdAt: now,
      })
      const row = must(updated)
      const pending = await this.#pendingCount(tx, userId, season.id)
      const unlocked = await this.#unlock(tx, row, now, {
        event: 'loan',
        round: null,
        pending,
        wasBankrupt: wallet.brokeAt !== null,
      })
      return { row, pending, unlocked }
    })
    const wallet = this.#d.views.wallet(result.row, season.id, result.pending)
    const outbox: Outbox = [
      { userId, message: { v: V, type: 'loan.granted', amount: cfg.loan.amount, wallet } },
    ]
    pushUnlocked(outbox, userId, result.unlocked)
    this.#flush(outbox)
    return { amount: cfg.loan.amount, wallet }
  }

  // ---------------------------------------------------------------- lectura

  /** Estado completo del usuario (para `/api/me` y el `hello` del WebSocket). Solo lee. */
  async state(userId: string): Promise<GameState> {
    const now = this.#d.clock.now()
    const season = this.currentSeason(now)
    const db = this.#d.db
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    if (!user) throw new AppError('unauthorized', 'This account no longer exists.')
    const [walletRow] = await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, season.id)))
    const [open] = await db
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, userId), eq(rounds.status, 'open')))
    const [last] = await db
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, userId), eq(rounds.status, 'resolved')))
      .orderBy(desc(rounds.resolvedAt))
      .limit(1)
    const pending = await this.#pendingCount(db, userId, season.id)
    return {
      achievements: await this.#d.achievements.list(db, userId, {
        row: walletRow,
        pendingSpins: pending,
        seasonId: season.id,
      }),
      user,
      wallet: this.#d.views.wallet(walletRow, season.id, pending),
      slip: this.#d.views.slip(walletRow?.slip),
      round: open && !this.#isStale(open, season.id, now) ? this.#d.views.openRound(open) : null,
      lastRound: last ? await this.#roundView(db, last) : null,
      inventory: await this.#d.items.inventoryView(db, userId, season.id),
    }
  }

  /** Cartera de la temporada en curso (vista; no crea la fila). */
  async walletOf(userId: string, seasonId = this.currentSeason().id): Promise<Wallet> {
    const [row] = await this.#d.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, seasonId)))
    return this.#d.views.wallet(
      row,
      seasonId,
      await this.#pendingCount(this.#d.db, userId, seasonId),
    )
  }

  // ---------------------------------------------------------------- internos

  /**
   * Deja constancia de un turno demasiado corto (o sin `turn/start`, `elapsedMs` null) para la
   * futura detección de abusos. Sin datos personales: ni usuario, ni sesión, ni turno; solo el
   * hecho y la duración medida.
   */
  #tooShort(elapsedMs: number | null): void {
    this.#d.logger.warn(
      { event: 'turn_too_short', elapsedMs, minDurationMs: this.#d.game.turn.minDurationMs },
      'turno sin tirada: demasiado corto',
    )
  }

  async #lockWallet(tx: Tx, userId: string, seasonId: string): Promise<WalletRow> {
    return lockWallet(tx, this.#d.game.startingBalance, userId, seasonId)
  }

  /** Lo que haya que hacer tras una tirada nueva (afiliados). Sus fallos no tocan la tirada. */
  async #afterSpin(userId: string): Promise<void> {
    if (!this.#d.afterSpin) return
    try {
      await this.#d.afterSpin(userId)
    } catch (error) {
      this.#d.logger.warn(
        { err: error },
        'tras la tirada: no se pudo revisar el programa de afiliados',
      )
    }
  }

  #isStale(round: Pick<RoundRow, 'openedAt' | 'seasonId'>, seasonId: string, now: Date): boolean {
    return (
      round.seasonId !== seasonId ||
      now.getTime() - round.openedAt.getTime() > this.#d.game.round.staleAfterMs
    )
  }

  /** Ronda abierta y vigente del usuario; caduca la que lleve demasiado tiempo abierta. */
  async #freshOpenRound(
    tx: Tx,
    userId: string,
    seasonId: string,
    now: Date,
    outbox: Outbox,
  ): Promise<RoundRow | null> {
    const [open] = await tx
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, userId), eq(rounds.status, 'open')))
      .for('update')
    if (!open) return null
    if (this.#isStale(open, seasonId, now)) {
      await this.#expire(tx, open, now, outbox)
      return null
    }
    return open
  }

  async #expire(tx: Tx, round: RoundRow, now: Date, outbox: Outbox): Promise<void> {
    await tx
      .update(rounds)
      .set({ status: 'expired', expiredAt: now })
      .where(eq(rounds.id, round.id))
    outbox.push({
      userId: round.userId,
      message: { v: V, type: 'round.expired', roundId: round.id },
    })
  }

  /** Abre una ronda. Con `outbox` null no se anuncia (nadie la ve girar). */
  async #openRound(
    tx: Tx,
    userId: string,
    seasonId: string,
    now: Date,
    outbox: Outbox | null,
  ): Promise<RoundRow> {
    const [round] = await tx
      .insert(rounds)
      .values({ userId, seasonId, status: 'open', openedAt: now })
      .returning()
    const created = must(round)
    outbox?.push({
      userId,
      message: { v: V, type: 'round.started', round: this.#d.views.openRound(created) },
    })
    return created
  }

  /** ¿Hay otro turno aún abierto que comparte esta ronda? (Entonces no se cierra: es suya.) */
  async #shared(tx: Tx, round: RoundRow): Promise<boolean> {
    const [sharing] = await tx
      .select({ turnId: turns.turnId })
      .from(turns)
      .where(and(eq(turns.roundId, round.id), isNull(turns.endedAt)))
      .limit(1)
    return sharing !== undefined
  }

  /**
   * Tope diario (`dailySpinLimit`): tiradas jugadas hoy (en directo y pendientes gastadas; el día
   * va de 00:00 a 00:00 en la zona horaria de la temporada). Devuelve cuándo reabre la mesa si ya
   * se ha llegado, o null. Se llama con la cartera bloqueada.
   */
  async #dailyLimit(tx: Tx, userId: string, now: Date): Promise<Date | null> {
    const day = dayAt(now, this.#d.game.season.timeZone)
    const [row] = await tx
      .select({ n: count() })
      .from(rounds)
      .where(
        and(
          eq(rounds.userId, userId),
          eq(rounds.status, 'resolved'),
          gte(rounds.resolvedAt, day.startsAt),
          lt(rounds.resolvedAt, day.endsAt),
        ),
      )
    return (row?.n ?? 0) >= this.#d.game.dailySpinLimit ? day.endsAt : null
  }

  /**
   * ¿Sigue cayendo la bola de la última tirada del usuario? (su `revealAt`, el más reciente, aún
   * no ha llegado). Es el ritmo de todo: ni GIRAR ni un turno en directo tiran otra antes.
   * Se llama con la cartera ya bloqueada, para que la respuesta no cambie hasta el COMMIT.
   */
  async #ballRolling(tx: Tx, userId: string, now: Date): Promise<boolean> {
    const [last] = await tx
      .select({ revealAt: max(rounds.revealAt) })
      .from(rounds)
      .where(and(eq(rounds.userId, userId), eq(rounds.status, 'resolved')))
    const revealAt = last?.revealAt
    return revealAt ? revealAt.getTime() > now.getTime() : false
  }

  /** Tiradas pendientes del usuario en una temporada. */
  async #pendingCount(db: Executor, userId: string, seasonId: string): Promise<number> {
    return pendingCount(db, userId, seasonId)
  }

  /**
   * Nadie mira (o la bola de la anterior aún cae): la ronda no se tira, se guarda como tirada
   * pendiente con los datos de su turno.
   * En el tope, el prompt se descarta (la ronda caduca sin tirada). Cartera ya bloqueada.
   */
  async #defer(
    tx: Tx,
    wallet: WalletRow,
    round: RoundRow,
    req: SpinInput,
    now: Date,
  ): Promise<TurnOutcome> {
    const pending = await this.#pendingCount(tx, wallet.userId, wallet.seasonId)
    const dropped = queueOutcome(pending, this.#d.game.pendingSpins) === 'dropped'
    const turnData = {
      resolvedByTurnId: req.turnId,
      gitPushOk: req.gitPushOk,
      testFailed: req.testFailed,
      durationMs: req.durationMs,
    }
    await tx
      .update(rounds)
      .set(
        dropped
          ? { status: 'expired', expiredAt: now, ...turnData }
          : { status: 'deferred', deferredAt: now, ...turnData },
      )
      .where(eq(rounds.id, round.id))
    const after = dropped ? pending : pending + 1
    const unlocked = await this.#unlock(tx, wallet, now, {
      event: 'queue',
      round: null,
      pending: after,
      wasBankrupt: wallet.brokeAt !== null,
    })
    return { kind: 'queued', wallet, dropped, fresh: true, unlocked, pending: after }
  }

  /** Evalúa y guarda los logros de un evento (con la cartera ya bloqueada). */
  async #unlock(
    tx: Tx,
    wallet: WalletRow,
    now: Date,
    ev: {
      event: 'round' | 'loan' | 'queue'
      round: AchievementRoundInput | null
      pending: number
      wasBankrupt: boolean
      /** Cuándo terminó el turno de la tirada si no es ahora (tirada pendiente). */
      turnAt?: Date | null
      /** La racha ganadora lleva asterisco (la salvó el Casco de Racha). */
      streakAsterisk?: boolean
    },
  ): Promise<Achievement[]> {
    const ach = this.#d.achievements
    const zero = ev.round?.round.result === 0
    return ach.unlock(tx, {
      userId: wallet.userId,
      seasonId: wallet.seasonId,
      now,
      turnAt: ev.turnAt ?? null,
      ctx: {
        event: ev.event,
        round: ev.round?.round ?? null,
        wallet: {
          netWorth: netWorth(wallet.balance, wallet.debt),
          debt: wallet.debt,
          loans: wallet.loans,
          spins: wallet.spins,
          bestStreak: wallet.bestStreak,
          pendingSpins: ev.pending,
        },
        wasBankrupt: ev.wasBankrupt,
        previousColorStreak: ev.round?.previousColorStreak ?? null,
        // Solo se cuenta cuando sale un 0 (el único momento en que puede cambiar el logro).
        lifetimeZeros: zero ? await ach.lifetimeZeros(tx, wallet.userId) : 0,
        streakAsterisk: ev.streakAsterisk ?? wallet.streakAsterisk,
      },
    })
  }

  /** Tira la bola y liquida la ronda. Se llama con la cartera ya bloqueada. */
  async #resolve(
    tx: Tx,
    wallet: WalletRow,
    round: RoundRow,
    req: SpinInput,
    now: Date,
    opts: SpinOptions,
  ): Promise<Resolution> {
    const cfg = this.#d.game
    const [user] = await tx
      .select({ lastBets: users.lastBets })
      .from(users)
      .where(eq(users.id, wallet.userId))
    if (!user) throw new AppError('unauthorized', 'This account no longer exists.')

    const choice = chooseRoundBets({
      slip: wallet.slip,
      lastBets: user.lastBets,
      balance: wallet.balance,
      cfg,
    })
    const multiplier = req.gitPushOk ? cfg.jackpot.gitPushMultiplier : 1
    // TIENDA, antes del número: qué objetos armados actúan (y gastan carga) se decide aquí, con el
    // boleto final y el jackpot ya sabidos. El bolsillo se lee con la cartera ya bloqueada.
    const inventory = cfg.items.enabled
      ? await this.#d.items.entries(tx, wallet.userId, wallet.seasonId, true)
      : []
    const plan = planItems(inventory, choice.bets, multiplier, cfg.items)
    // El oráculo "predice" con otra tirada independiente, justo antes de la del resultado. Las 37
    // casillas siguen siendo uniformes: el número de verdad sale de su propia `pocket()`.
    const prediction = plan.oracle ? this.#d.rng.pocket() : null
    const result = this.#d.rng.pocket()
    const outcome = resolveBets(choice.bets, result, multiplier)
    // Después del número: lo que pagan los objetos (aparte de la ruleta), la racha con el casco y
    // las cargas gastadas.
    const settled = settleItems(
      {
        plan,
        outcome,
        jackpotMultiplier: multiplier,
        prediction,
        current: wallet.currentStreak,
        asterisk: wallet.streakAsterisk,
      },
      cfg.items,
    )
    const debt = accrueInterest(wallet.debt, cfg)
    const balance = wallet.balance - choice.charge + outcome.returned + settled.itemNet
    const streak = settled.streak

    // Racha de color sobre las últimas tiradas del propio usuario (de la más antigua a la última).
    const history = await tx
      .select({ result: rounds.result })
      .from(rounds)
      .where(and(eq(rounds.userId, wallet.userId), eq(rounds.status, 'resolved')))
      .orderBy(desc(rounds.resolvedAt))
      .limit(cfg.streak.historySize - 1)
    const results = history
      .map(h => h.result)
      .filter((n): n is number => n !== null)
      .reverse()
    const previousColorStreak = colorStreak(results)
    const colors = colorStreak([...results, result])
    // BANCARROTA: la primera vez en la temporada que el patrimonio cae a 0 o menos.
    const worth = netWorth(balance, debt)
    const wentBroke = wallet.brokeAt === null && worth <= 0

    const openedAt = opts.openedAt ?? round.openedAt
    // Ni antes del giro mínimo ni antes de que la bola termine de caer en la ventana: si Claude
    // tarda más que el giro, el resultado no se puede enseñar (ni el mod destriparlo) hasta entonces.
    const revealAt = new Date(
      Math.max(openedAt.getTime() + opts.spinMs, now.getTime() + opts.landingMs),
    )
    const [resolved] = await tx
      .update(rounds)
      .set({
        status: 'resolved',
        openedAt,
        spendRequestId: opts.spendRequestId ?? null,
        resolvedAt: now,
        revealAt,
        resolvedByTurnId: req.turnId,
        result,
        source: choice.source,
        staked: outcome.staked,
        returned: outcome.returned,
        net: outcome.net,
        jackpot: outcome.jackpot,
        gitPushOk: req.gitPushOk,
        testFailed: req.testFailed,
        durationMs: req.durationMs,
        interestCharged: debt - wallet.debt,
        colorStreakColor: colors?.color ?? null,
        colorStreakCount: colors?.count ?? null,
        spinNumber: wallet.spins + 1,
        streakAfter: streak,
        netWorthAfter: worth,
        wentBroke,
        itemNet: settled.itemNet,
      })
      .where(eq(rounds.id, round.id))
      .returning()
    if (settled.effects.length > 0) {
      await tx.insert(roundItemEffects).values(
        settled.effects.map(e => ({
          roundId: round.id,
          itemId: e.itemId,
          kind: e.kind,
          amount: e.amount,
          detail: e.prediction === undefined ? null : { prediction: e.prediction, hit: e.hit },
        })),
      )
    }
    await this.#d.items.spend(tx, wallet.userId, wallet.seasonId, settled.spent, now)
    if (outcome.outcomes.length > 0) {
      await tx.insert(bets).values(
        outcome.outcomes.map((o, position) => ({
          roundId: round.id,
          position,
          kind: o.bet.selection.kind,
          selection: o.bet.selection,
          amount: o.bet.amount,
          won: o.won,
          payout: o.payout,
        })),
      )
      await tx.update(users).set({ lastBets: choice.bets }).where(eq(users.id, wallet.userId))
    }
    const [updated] = await tx
      .update(wallets)
      .set({
        balance,
        debt,
        spins: wallet.spins + 1,
        currentStreak: streak,
        bestStreak: bestStreak(wallet.bestStreak, streak),
        streakAsterisk: settled.streakAsterisk,
        slip: choice.source === 'slip' ? [] : wallet.slip,
        brokeAt: wentBroke ? now : wallet.brokeAt,
        updatedAt: now,
      })
      .where(and(eq(wallets.userId, wallet.userId), eq(wallets.seasonId, wallet.seasonId)))
      .returning()
    const resolvedRow = must(resolved)
    const walletRow = must(updated)

    // Logros: el espectáculo es el mismo que verá la ventana (sale de la misma vista).
    const view = this.#d.views.resolvedRound(
      resolvedRow,
      outcome.outcomes.map(o => ({
        selection: o.bet.selection,
        amount: o.bet.amount,
        won: o.won,
        payout: o.payout,
      })),
      settled.effects,
    )
    const pending = await this.#pendingCount(tx, wallet.userId, wallet.seasonId)
    const unlocked = await this.#unlock(tx, walletRow, now, {
      event: 'round',
      round: {
        round: {
          result,
          // Lo que siente el jugador: la ruleta más lo que pagan los objetos.
          net: outcome.net + settled.itemNet,
          staked: outcome.staked,
          jackpot: outcome.jackpot,
          testFailed: req.testFailed,
          bets: view.bets,
          spectacle: must(view.spectacle),
          items: settled.effects,
        },
        previousColorStreak,
      },
      streakAsterisk: settled.streakAsterisk,
      pending,
      wasBankrupt: wallet.brokeAt !== null,
      // Una tirada pendiente se guardó al terminar su turno: "Push el viernes" mira ese día.
      turnAt: round.deferredAt,
    })
    return {
      kind: 'resolved',
      round: resolvedRow,
      wallet: walletRow,
      fresh: true,
      unlocked,
      consumed: settled.spent.length > 0,
      pending,
      view,
    }
  }

  /** Ronda resuelta leída de la base de datos, con sus fichas y lo que hicieron los objetos. */
  async #roundView(db: Executor, round: RoundRow): Promise<ResolvedRound> {
    const effects = await db
      .select()
      .from(roundItemEffects)
      .where(eq(roundItemEffects.roundId, round.id))
    return this.#d.views.resolvedRound(
      round,
      await this.#betsOf(db, round.id),
      effects.map(e => ({
        itemId: e.itemId as ItemId,
        kind: e.kind,
        amount: e.amount,
        ...(e.detail?.prediction === undefined
          ? {}
          : { prediction: e.detail.prediction, hit: e.detail.hit === true }),
      })),
    )
  }

  /**
   * Tras una ronda que gastó cargas de la TIENDA, el bolsillo nuevo a todas las ventanas: va
   * justo después de `round.resolved` y antes de los logros.
   */
  async #pushConsumed(
    outbox: Outbox,
    userId: string,
    consumed: boolean,
    wallet: Wallet,
  ): Promise<void> {
    if (!consumed) return
    const inventory = await this.#d.items.inventoryView(this.#d.db, userId, wallet.seasonId)
    outbox.push({
      userId,
      message: { v: V, type: 'inventory', event: 'consumed', inventory, wallet },
    })
  }

  async #betsOf(db: Executor, roundId: string) {
    return db
      .select({
        selection: bets.selection,
        amount: bets.amount,
        won: bets.won,
        payout: bets.payout,
      })
      .from(bets)
      .where(eq(bets.roundId, roundId))
      .orderBy(asc(bets.position))
  }

  #flush(outbox: Outbox): void {
    for (const { userId, message } of outbox) this.#d.notifier.send(userId, message)
  }
}

/**
 * Respuesta a un `turn/end` repetido (el mod reintentó): la de la primera vez, sin tirar ni
 * guardar nada. La ronda recuerda qué turno la cerró y cómo.
 */
export function replayTurnEnd(round: RoundRow, turnId: string, wallet: WalletRow): TurnOutcome {
  if (round.resolvedByTurnId !== turnId) return { kind: 'no_round', wallet }
  // Se guardó como pendiente (aunque después se haya gastado o haya caducado con la temporada).
  if (round.deferredAt !== null)
    return { kind: 'queued', wallet, dropped: false, fresh: false, unlocked: [], pending: null }
  if (round.status === 'resolved') {
    return {
      kind: 'resolved',
      round,
      wallet,
      fresh: false,
      unlocked: [],
      consumed: false,
      pending: null,
      view: null,
    }
  }
  // Caducada por este mismo turno: era un prompt descartado por el tope.
  if (round.status === 'expired')
    return { kind: 'queued', wallet, dropped: true, fresh: false, unlocked: [], pending: null }
  return { kind: 'no_round', wallet }
}

/** Ronda recién tirada vista por los logros, con la racha de color que había antes. */
interface AchievementRoundInput {
  round: AchievementRound
  previousColorStreak: ColorStreak | null
}

/** Encola un `achievement.unlocked` por logro, detrás del mensaje del evento. */
function pushUnlocked(outbox: Outbox, userId: string, unlocked: readonly Achievement[]): void {
  for (const achievement of unlocked) {
    outbox.push({ userId, message: { v: V, type: 'achievement.unlocked', achievement } })
  }
}

/**
 * Bloquea (`FOR UPDATE`) la cartera de un usuario en una temporada y la crea con el saldo inicial
 * si aún no existe. Es el cerrojo de todo lo que toca su dinero.
 */
export async function lockWallet(
  tx: Tx,
  startingBalance: number,
  userId: string,
  seasonId: string,
): Promise<WalletRow> {
  // Una petición que leyó el reloj justo antes del cambio de mes puede llegar con la temporada
  // ya cerrada: sus monedas se quedarían en una temporada que ya no se juega. El cerrojo
  // compartido sobre la fila de la temporada espera a que termine un cierre en curso (que la
  // bloquea en exclusiva) y luego ve su `closed_at`.
  const [season] = await tx
    .select({ closedAt: seasons.closedAt })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .for('key share')
  if (season?.closedAt) {
    throw new AppError('conflict', 'The season just ended. Try again.')
  }
  try {
    await tx
      .insert(wallets)
      .values({ userId, seasonId, balance: startingBalance })
      .onConflictDoNothing()
  } catch (error) {
    // La cuenta se ha borrado entre la autenticación y esta transacción.
    if (isForeignKeyViolation(error)) {
      throw new AppError('unauthorized', 'This account no longer exists.', { cause: error })
    }
    throw error
  }
  const [row] = await tx
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, seasonId)))
    .for('update')
  if (!row) throw new AppError('unauthorized', 'This account no longer exists.')
  return row
}

/** Tiradas pendientes de un usuario en una temporada. */
export async function pendingCount(
  db: Executor,
  userId: string,
  seasonId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(rounds)
    .where(
      and(eq(rounds.userId, userId), eq(rounds.seasonId, seasonId), eq(rounds.status, 'deferred')),
    )
  return row?.n ?? 0
}

/** Crea la fila de la temporada si aún no existe (el job la cerrará al vencer). */
export async function ensureSeason(tx: Executor, season: SeasonBounds): Promise<void> {
  await tx
    .insert(seasons)
    .values({ id: season.id, startsAt: season.startsAt, endsAt: season.endsAt })
    .onConflictDoNothing()
}

/** SQLSTATE 23503: la fila a la que apunta la clave foránea ya no existe. */
const FOREIGN_KEY_VIOLATION = '23503'

function isForeignKeyViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as Error & { code?: unknown }).code === FOREIGN_KEY_VIOLATION) return true
  }
  return false
}

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('la base de datos no devolvió la fila esperada')
  return value
}
