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
  nextStreak,
  resolveBets,
  seasonAt,
  totalStake,
} from '@vibe-gambling/shared'
import type {
  BetResponse,
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
import { and, asc, desc, eq } from 'drizzle-orm'

import type { Database, Executor, Tx } from '../db/client.ts'
import { bets, loans, rounds, seasons, turns, users, wallets } from '../db/schema.ts'
import type { RoundRow, UserRow, WalletRow } from '../db/schema.ts'
import type { Clock } from '../lib/clock.ts'
import { AppError } from '../lib/errors.ts'
import type { Rng } from '../lib/rng.ts'
import type { Notifier } from './notifier.ts'
import type { Views } from './views.ts'

export interface GameDeps {
  db: Database
  game: GameConfig
  clock: Clock
  rng: Rng
  views: Views
  notifier: Notifier
}

export interface GameState {
  user: UserRow
  wallet: Wallet
  slip: Slip
  round: OpenRound | null
  lastRound: ResolvedRound | null
}

type Outbox = Array<{ userId: string; message: ServerMessage }>

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
    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await this.#lockWallet(tx, userId, season.id)

      const [turn] = await tx
        .select()
        .from(turns)
        .where(and(eq(turns.userId, userId), eq(turns.turnId, req.turnId)))
        .for('update')

      if (!turn) {
        // El `turn/start` no llegó (red, timeout del mod…): el prompt sigue siendo una tirada.
        let round = await this.#freshOpenRound(tx, userId, season.id, now, outbox)
        const reused = round !== null
        round ??= await this.#openRound(tx, userId, season.id, now, outbox)
        await tx.insert(turns).values({
          userId,
          turnId: req.turnId,
          roundId: round.id,
          reused,
          startedAt: now,
          endedAt: now,
        })
        return this.#resolve(tx, wallet, round, req, now)
      }

      const [round] = await tx
        .select()
        .from(rounds)
        .where(eq(rounds.id, turn.roundId))
        .for('update')
      if (!round) throw new Error(`turno ${turn.turnId} sin ronda`)

      if (turn.endedAt !== null) {
        // Reintento de un `turn/end` ya procesado.
        if (round.status === 'resolved' && round.resolvedByTurnId === req.turnId) {
          return { kind: 'resolved' as const, round, wallet, fresh: false }
        }
        return { kind: 'no_round' as const, wallet }
      }

      await tx
        .update(turns)
        .set({ endedAt: now })
        .where(and(eq(turns.userId, userId), eq(turns.turnId, req.turnId)))
      if (round.status !== 'open') return { kind: 'no_round' as const, wallet }
      if (this.#isStale(round, season.id, now)) {
        await this.#expire(tx, round, now, outbox)
        return { kind: 'no_round' as const, wallet }
      }
      return this.#resolve(tx, wallet, round, req, now)
    })

    if (result.kind === 'no_round') {
      const wallet = this.#d.views.wallet(result.wallet, season.id)
      this.#flush(outbox)
      return { v: V, status: 'no_round', wallet }
    }
    const roundBets = await this.#betsOf(this.#d.db, result.round.id)
    const resolved = this.#d.views.resolvedRound(result.round, roundBets)
    const wallet = this.#d.views.wallet(result.wallet, result.wallet.seasonId)
    if (result.fresh)
      outbox.push({ userId, message: { v: V, type: 'round.resolved', round: resolved, wallet } })
    this.#flush(outbox)
    return { v: V, status: 'resolved', round: resolved, wallet }
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
      return { wallet: must(updated), current }
    })
    const slip = this.#d.views.slip(result.wallet.slip)
    const wallet = this.#d.views.wallet(result.wallet, season.id)
    this.#d.notifier.send(userId, { v: V, type: 'slip', slip, wallet })
    return { slip, wallet, forRound: result.current ? 'current' : 'next' }
  }

  /** Retira todas las fichas del boleto y las devuelve al saldo. */
  async clearSlip(userId: string): Promise<{ slip: Slip; wallet: Wallet }> {
    const now = this.#d.clock.now()
    const season = this.currentSeason(now)
    const row = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await this.#lockWallet(tx, userId, season.id)
      const refund = totalStake(wallet.slip)
      const [updated] = await tx
        .update(wallets)
        .set({ balance: wallet.balance + refund, slip: [], updatedAt: now })
        .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, season.id)))
        .returning()
      return must(updated)
    })
    const slip = this.#d.views.slip(row.slip)
    const wallet = this.#d.views.wallet(row, season.id)
    this.#d.notifier.send(userId, { v: V, type: 'slip', slip, wallet })
    return { slip, wallet }
  }

  /** "Ludo-Crédito Express": solo si el saldo (contando el boleto) no llega a la ficha mínima. */
  async requestLoan(userId: string): Promise<{ amount: number; wallet: Wallet }> {
    const now = this.#d.clock.now()
    const season = this.currentSeason(now)
    const cfg = this.#d.game
    const row = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await this.#lockWallet(tx, userId, season.id)
      // Las fichas del boleto cuentan: si no, bastaría con apostarlo todo, pedir y retirar.
      if (!canRequestLoan(wallet.balance + totalStake(wallet.slip), cfg)) {
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
        createdAt: now,
      })
      return must(updated)
    })
    const wallet = this.#d.views.wallet(row, season.id)
    this.#d.notifier.send(userId, { v: V, type: 'loan.granted', amount: cfg.loan.amount, wallet })
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
    return {
      user,
      wallet: this.#d.views.wallet(walletRow, season.id),
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
    return this.#d.views.wallet(row, seasonId)
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

  async #openRound(
    tx: Tx,
    userId: string,
    seasonId: string,
    now: Date,
    outbox: Outbox,
  ): Promise<RoundRow> {
    const [round] = await tx
      .insert(rounds)
      .values({ userId, seasonId, status: 'open', openedAt: now })
      .returning()
    const created = must(round)
    outbox.push({
      userId,
      message: { v: V, type: 'round.started', round: this.#d.views.openRound(created) },
    })
    return created
  }

  /** Tira la bola y liquida la ronda. Se llama con la cartera ya bloqueada. */
  async #resolve(
    tx: Tx,
    wallet: WalletRow,
    round: RoundRow,
    req: TurnEndRequest,
    now: Date,
  ): Promise<{ kind: 'resolved'; round: RoundRow; wallet: WalletRow; fresh: boolean }> {
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
    const colors = colorStreak([...results, result])

    const revealAt = new Date(
      Math.max(round.openedAt.getTime() + cfg.spin.minSpinMs, now.getTime()),
    )
    const [resolved] = await tx
      .update(rounds)
      .set({
        status: 'resolved',
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
        updatedAt: now,
      })
      .where(and(eq(wallets.userId, wallet.userId), eq(wallets.seasonId, wallet.seasonId)))
      .returning()
    return { kind: 'resolved', round: must(resolved), wallet: must(updated), fresh: true }
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
