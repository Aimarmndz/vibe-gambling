// SPDX-License-Identifier: AGPL-3.0-or-later
// Cambio de temporada. Un job interno comprueba cada N ms si alguna temporada ha vencido; si es
// así, caduca sus rondas abiertas, guarda el Salón de la Ruina, la cierra y abre la siguiente.
// Corre bajo `pg_try_advisory_xact_lock`: si hubiera dos instancias, solo una hace el trabajo.
// Las carteras de la temporada nueva se crean de forma perezosa con la primera tirada.
import type { GameConfig, SeasonBounds } from '@vibe-gambling/shared'
import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm'

import type { Database } from '../db/client.ts'
import { SEASON_JOB_LOCK_KEY } from '../db/locks.ts'
import { hallOfRuin, rounds, seasons, users, wallets } from '../db/schema.ts'
import type { Clock } from '../lib/clock.ts'
import type { AuthService } from './auth.ts'
import type { GameService } from './game.ts'
import { boardOrder } from './leaderboard.ts'
import type { Notifier } from './notifier.ts'
import { ensureSeason } from './game.ts'

export interface SeasonJobLogger {
  info(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

export interface SeasonDeps {
  db: Database
  game: GameConfig
  clock: Clock
  notifier: Notifier
  gameService: GameService
  auth: AuthService
  logger: SeasonJobLogger
  intervalMs: number
}

export interface TickResult {
  /** false si otra instancia tenía el cerrojo. */
  ran: boolean
  closed: string[]
  current: string
}

/**
 * Temporadas a cerrar en un instante: las abiertas cuyo fin ya ha pasado, en orden.
 * Función pura (la usa el job y la prueban los tests unitarios con un reloj falso).
 */
export function seasonsToClose<T extends { id: string; endsAt: Date; closedAt: Date | null }>(
  list: readonly T[],
  now: Date,
): T[] {
  return list
    .filter(s => s.closedAt === null && s.endsAt.getTime() <= now.getTime())
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime())
}

const V = 1 as const

export class SeasonService {
  readonly #d: SeasonDeps
  #timer: NodeJS.Timeout | null = null
  #running: Promise<unknown> | null = null

  constructor(deps: SeasonDeps) {
    this.#d = deps
  }

  current(): SeasonBounds {
    return this.#d.gameService.currentSeason(this.#d.clock.now())
  }

  /** Una pasada del job. Se puede llamar a mano (los tests lo hacen con un reloj falso). */
  async tick(): Promise<TickResult> {
    const now = this.#d.clock.now()
    const current = this.#d.gameService.currentSeason(now)
    const expired: Array<{ userId: string; roundId: string }> = []

    const outcome = await this.#d.db.transaction(async tx => {
      const [lock] = await tx.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(${SEASON_JOB_LOCK_KEY}) as locked`,
      )
      if (!lock?.locked) return { ran: false, closed: [] as string[] }

      await ensureSeason(tx, current)
      const open = await tx
        .select()
        .from(seasons)
        .where(and(isNull(seasons.closedAt), lte(seasons.endsAt, now)))
        .orderBy(asc(seasons.endsAt))
      const closed: string[] = []
      for (const season of seasonsToClose(open, now)) {
        // Las rondas a medias de la temporada vencida no se resuelven: caducan sin tirada.
        const gone = await tx
          .update(rounds)
          .set({ status: 'expired', expiredAt: now })
          .where(and(eq(rounds.seasonId, season.id), eq(rounds.status, 'open')))
          .returning({ userId: rounds.userId, roundId: rounds.id })
        expired.push(...gone)

        const top = await tx
          .select({ userId: wallets.userId, netWorth: wallets.netWorth, spins: wallets.spins })
          .from(wallets)
          .innerJoin(users, eq(users.id, wallets.userId))
          .where(
            and(eq(wallets.seasonId, season.id), eq(users.hidden, false), gt(wallets.spins, 0)),
          )
          .orderBy(...boardOrder('broke'))
          .limit(this.#d.game.hallOfRuinSize)
        if (top.length > 0) {
          await tx
            .insert(hallOfRuin)
            .values(top.map((row, i) => ({ seasonId: season.id, rank: i + 1, ...row })))
            .onConflictDoNothing()
        }
        await tx.update(seasons).set({ closedAt: now }).where(eq(seasons.id, season.id))
        closed.push(season.id)
      }
      return { ran: true, closed }
    })

    if (outcome.ran) await this.#d.auth.purgeExpired()

    for (const { userId, roundId } of expired) {
      this.#d.notifier.send(userId, { v: V, type: 'round.expired', roundId })
    }
    if (outcome.closed.length > 0) {
      this.#d.logger.info({ closed: outcome.closed, current: current.id }, 'temporada cerrada')
      for (const userId of this.#d.notifier.connectedUsers()) {
        const wallet = await this.#d.gameService.walletOf(userId, current.id)
        this.#d.notifier.send(userId, {
          v: V,
          type: 'season.changed',
          seasonId: current.id,
          wallet,
        })
      }
    }
    return { ...outcome, current: current.id }
  }

  start(): void {
    if (this.#timer) return
    const run = () => {
      // Nunca dos pasadas a la vez en el mismo proceso.
      if (this.#running) return
      this.#running = this.tick()
        .catch((error: unknown) => {
          this.#d.logger.error({ err: error }, 'fallo en el job de temporadas')
        })
        .finally(() => {
          this.#running = null
        })
    }
    run()
    this.#timer = setInterval(run, this.#d.intervalMs)
    this.#timer.unref()
  }

  /** Para el job y espera a que termine la pasada en curso. */
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    await this.#running
  }
}
