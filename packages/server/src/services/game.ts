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
  minBet,
  netWorth,
  nextStreak,
  queueOutcome,
  resolveBets,
  seasonAt,
  totalStake,
} from '@vibe-gambling/shared'
import type {
  Achievement,
  AchievementRound,
  BetResponse,
  ColorStreak,
  BetSelection,
  GameConfig,
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
import { and, asc, count, desc, eq, max } from 'drizzle-orm'

import type { Database, Executor, Tx } from '../db/client.ts'
import { bets, loans, rounds, seasons, turns, users, wallets } from '../db/schema.ts'
import type { RoundRow, UserRow, WalletRow } from '../db/schema.ts'
import type { Clock } from '../lib/clock.ts'
import { AppError } from '../lib/errors.ts'
import type { Rng } from '../lib/rng.ts'
import type { AchievementService } from './achievements.ts'
import type { Notifier } from './notifier.ts'
import type { Views } from './views.ts'

export interface GameDeps {
  db: Database
  game: GameConfig
  clock: Clock
  rng: Rng
  views: Views
  notifier: Notifier
  achievements: AchievementService
}

export interface GameState {
  user: UserRow
  wallet: Wallet
  slip: Slip
  round: OpenRound | null
  lastRound: ResolvedRound | null
  achievements: Achievement[]
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
  openedAt?: Date
  spendRequestId?: string
}

type TurnOutcome =
  | Resolution
  | { kind: 'no_round'; wallet: WalletRow }
  | {
      kind: 'queued'
      wallet: WalletRow
      dropped: boolean
      fresh: boolean
      /** Logros desbloqueados al guardarla (se anuncian después de `pending`). */
      unlocked: Achievement[]
    }

/** Ronda tirada y liquidada. */
interface Resolution {
  kind: 'resolved'
  round: RoundRow
  wallet: WalletRow
  fresh: boolean
  /** Logros desbloqueados por esta tirada (se anuncian después de `round.resolved`). */
  unlocked: Achievement[]
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
    const settle = (tx: Tx, wallet: WalletRow, round: RoundRow) =>
      attentive
        ? this.#resolve(tx, wallet, round, req, now, { spinMs: this.#d.game.spin.minSpinMs })
        : this.#defer(tx, wallet, round, req, now)

    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await this.#lockWallet(tx, userId, season.id)
      const outcome = await (async (): Promise<TurnOutcome> => {
        const [turn] = await tx
          .select()
          .from(turns)
          .where(and(eq(turns.userId, userId), eq(turns.turnId, req.turnId)))
          .for('update')

        if (!turn) {
          // El `turn/start` no llegó (red, timeout del mod…): el prompt sigue siendo una tirada.
          let round = await this.#freshOpenRound(tx, userId, season.id, now, outbox)
          const reused = round !== null
          // Sin nadie mirando no se anuncia una ronda que no va a girar.
          round ??= await this.#openRound(tx, userId, season.id, now, attentive ? outbox : null)
          await tx.insert(turns).values({
            userId,
            turnId: req.turnId,
            roundId: round.id,
            reused,
            startedAt: now,
            endedAt: now,
          })
          return settle(tx, wallet, round)
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
        return settle(tx, wallet, round)
      })()
      // El contador de pendientes, leído con la cartera aún bloqueada.
      const pending = await this.#pendingCount(tx, userId, outcome.wallet.seasonId)
      return { outcome, pending }
    })

    const { outcome, pending } = result
    const wallet = this.#d.views.wallet(outcome.wallet, outcome.wallet.seasonId, pending)
    if (outcome.kind === 'no_round') {
      this.#flush(outbox)
      return { v: V, status: 'no_round', wallet }
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
    const roundBets = await this.#betsOf(this.#d.db, outcome.round.id)
    const resolved = this.#d.views.resolvedRound(outcome.round, roundBets)
    if (outcome.fresh) {
      outbox.push({ userId, message: { v: V, type: 'round.resolved', round: resolved, wallet } })
      pushUnlocked(outbox, userId, outcome.unlocked)
    }
    this.#flush(outbox)
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
        return { round: done, wallet, fresh: false, pending: await pendingNow(), unlocked: [] }
      }

      if (await this.#freshOpenRound(tx, userId, season.id, now, outbox)) {
        throw new AppError('conflict', 'The wheel is already spinning for a prompt.')
      }
      const [last] = await tx
        .select({ revealAt: max(rounds.revealAt) })
        .from(rounds)
        .where(and(eq(rounds.userId, userId), eq(rounds.status, 'resolved')))
      if (last?.revealAt && last.revealAt.getTime() > now.getTime()) {
        throw new AppError('rate_limited', 'The ball is still rolling. Wait for it.')
      }
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
          openedAt: now,
          spendRequestId: opts.requestId,
        },
      )
      return {
        round: spun.round,
        wallet: spun.wallet,
        fresh: true,
        pending: await pendingNow(),
        unlocked: spun.unlocked,
      }
    })

    const roundBets = await this.#betsOf(this.#d.db, result.round.id)
    const round = this.#d.views.resolvedRound(result.round, roundBets)
    const wallet = this.#d.views.wallet(result.wallet, result.wallet.seasonId, result.pending)
    if (result.fresh) {
      outbox.push({
        userId,
        message: { v: V, type: 'round.started', round: this.#d.views.openRound(result.round) },
      })
      outbox.push({ userId, message: { v: V, type: 'round.resolved', round, wallet } })
      pushUnlocked(outbox, userId, result.unlocked)
    }
    this.#flush(outbox)
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
      }),
      user,
      wallet: this.#d.views.wallet(walletRow, season.id, pending),
      slip: this.#d.views.slip(walletRow?.slip),
      round: open && !this.#isStale(open, season.id, now) ? this.#d.views.openRound(open) : null,
      lastRound: last ? this.#d.views.resolvedRound(last, await this.#betsOf(db, last.id)) : null,
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

  async #lockWallet(tx: Tx, userId: string, seasonId: string): Promise<WalletRow> {
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
        .values({ userId, seasonId, balance: this.#d.game.startingBalance })
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

  /** Tiradas pendientes del usuario en una temporada. */
  async #pendingCount(db: Executor, userId: string, seasonId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(rounds)
      .where(
        and(
          eq(rounds.userId, userId),
          eq(rounds.seasonId, seasonId),
          eq(rounds.status, 'deferred'),
        ),
      )
    return row?.n ?? 0
  }

  /**
   * Nadie mira: la ronda no se tira, se guarda como tirada pendiente con los datos de su turno.
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
    const unlocked = await this.#unlock(tx, wallet, now, {
      event: 'queue',
      round: null,
      pending: dropped ? pending : pending + 1,
      wasBankrupt: wallet.brokeAt !== null,
    })
    return { kind: 'queued', wallet, dropped, fresh: true, unlocked }
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
    const result = this.#d.rng.pocket()
    const multiplier = req.gitPushOk ? cfg.jackpot.gitPushMultiplier : 1
    const outcome = resolveBets(choice.bets, result, multiplier)
    const debt = accrueInterest(wallet.debt, cfg)
    const balance = wallet.balance - choice.charge + outcome.returned
    const streak = nextStreak(wallet.currentStreak, choice.bets.length > 0 ? outcome.net : null)

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
    const revealAt = new Date(Math.max(openedAt.getTime() + opts.spinMs, now.getTime()))
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
      })
      .where(eq(rounds.id, round.id))
      .returning()
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
    )
    const unlocked = await this.#unlock(tx, walletRow, now, {
      event: 'round',
      round: {
        round: {
          result,
          net: outcome.net,
          staked: outcome.staked,
          jackpot: outcome.jackpot,
          testFailed: req.testFailed,
          bets: view.bets,
          spectacle: must(view.spectacle),
        },
        previousColorStreak,
      },
      pending: await this.#pendingCount(tx, wallet.userId, wallet.seasonId),
      wasBankrupt: wallet.brokeAt !== null,
      // Una tirada pendiente se guardó al terminar su turno: "Push el viernes" mira ese día.
      turnAt: round.deferredAt,
    })
    return { kind: 'resolved', round: resolvedRow, wallet: walletRow, fresh: true, unlocked }
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
    return { kind: 'queued', wallet, dropped: false, fresh: false, unlocked: [] }
  if (round.status === 'resolved') {
    return { kind: 'resolved', round, wallet, fresh: false, unlocked: [] }
  }
  // Caducada por este mismo turno: era un prompt descartado por el tope.
  if (round.status === 'expired')
    return { kind: 'queued', wallet, dropped: true, fresh: false, unlocked: [] }
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
