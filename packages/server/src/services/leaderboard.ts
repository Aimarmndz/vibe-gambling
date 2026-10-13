// SPDX-License-Identifier: AGPL-3.0-or-later
// Rankings de la temporada y Salón de la Ruina. Los usuarios ocultos no salen nunca, y las cuentas
// de GitHub demasiado nuevas (`leaderboard.minAccountAgeDays`) tampoco hasta cumplir la edad.
import type {
  HallOfRuinResponse,
  LeaderboardBoard,
  LeaderboardResponse,
} from '@vibe-gambling/shared'
import { and, asc, desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Database } from '../db/client.ts'
import { hallOfRuin, seasons, users, wallets } from '../db/schema.ts'
import type { Clock } from '../lib/clock.ts'
import { AppError } from '../lib/errors.ts'
import { oldEnough } from './accountAge.ts'
import type { Views } from './views.ts'

const V = 1 as const

/**
 * Orden de cada tabla. Los empates se rompen siempre igual (más tiradas primero y, al final,
 * el id) para que el puesto de cada uno sea estable entre peticiones.
 */
export function boardOrder(board: LeaderboardBoard): SQL[] {
  switch (board) {
    case 'broke':
      return [asc(wallets.netWorth), desc(wallets.spins), asc(wallets.userId)]
    case 'rich':
      return [desc(wallets.netWorth), desc(wallets.spins), asc(wallets.userId)]
    case 'spins':
      return [desc(wallets.spins), asc(wallets.netWorth), asc(wallets.userId)]
  }
}

/**
 * Quién aparece en el ranking de una temporada en `now`: visibles, con al menos una tirada y con
 * una cuenta de GitHub con edad suficiente. La usan los rankings, el puesto propio y el cierre de
 * temporada (Salón de la Ruina), para que los tres cuenten lo mismo.
 */
export function ranked(seasonId: string, minAccountAgeDays: number, now: Date): SQL | undefined {
  return and(
    eq(wallets.seasonId, seasonId),
    eq(users.hidden, false),
    gt(wallets.spins, 0),
    oldEnough(minAccountAgeDays, now),
  )
}

export interface LeaderboardDeps {
  db: Database
  views: Views
  clock: Clock
  minAccountAgeDays: number
}

export class LeaderboardService {
  readonly #db: Database
  readonly #views: Views
  readonly #clock: Clock
  readonly #minAccountAgeDays: number

  constructor(deps: LeaderboardDeps) {
    this.#db = deps.db
    this.#views = deps.views
    this.#clock = deps.clock
    this.#minAccountAgeDays = deps.minAccountAgeDays
  }

  #ranked(seasonId: string): SQL | undefined {
    return ranked(seasonId, this.#minAccountAgeDays, this.#clock.now())
  }

  async seasonIds(): Promise<string[]> {
    const rows = await this.#db.select({ id: seasons.id }).from(seasons).orderBy(desc(seasons.id))
    return rows.map(r => r.id)
  }

  async leaderboard(args: {
    season: string
    currentSeason: string
    board: LeaderboardBoard
    limit: number
  }): Promise<LeaderboardResponse> {
    const seasonList = await this.seasonIds()
    if (!seasonList.includes(args.season) && args.season !== args.currentSeason) {
      throw new AppError('not_found', 'That season never happened.')
    }
    if (!seasonList.includes(args.currentSeason)) seasonList.unshift(args.currentSeason)
    // Mismo instante para las filas y el recuento.
    const where = this.#ranked(args.season)
    const rows = await this.#db
      .select({ wallet: wallets, login: users.login, avatarUrl: users.avatarUrl })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(where)
      .orderBy(...boardOrder(args.board))
      .limit(args.limit)
    const [count] = await this.#db
      .select({ n: sql<number>`count(*)::int` })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(where)
    return {
      v: V,
      season: args.season,
      board: args.board,
      seasons: seasonList,
      players: count?.n ?? 0,
      rows: rows.map((r, i) => ({
        ...this.#views.publicUser(r),
        rank: i + 1,
        netWorth: r.wallet.netWorth,
        balance: r.wallet.balance,
        debt: r.wallet.debt,
        spins: r.wallet.spins,
        currentStreak: r.wallet.currentStreak,
        bestStreak: r.wallet.bestStreak,
      })),
    }
  }

  /**
   * Puesto en el ranking de arruinados (null si está oculto, aún no ha tirado o su cuenta de
   * GitHub es demasiado nueva: nunca un puesto que no se ve en el ranking).
   */
  async brokeRank(userId: string, seasonId: string): Promise<number | null> {
    const ordered = this.#db
      .select({
        userId: wallets.userId,
        rank: sql<number>`row_number() over (order by ${sql.join(boardOrder('broke'), sql`, `)})::int`.as(
          'rank',
        ),
      })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(this.#ranked(seasonId))
      .as('ordered')
    const [row] = await this.#db
      .select({ rank: ordered.rank })
      .from(ordered)
      .where(eq(ordered.userId, userId))
    return row?.rank ?? null
  }

  /**
   * Salón de la Ruina de todas las temporadas cerradas (de la más reciente a la más antigua).
   * Quien se oculta desaparece también de aquí, y los puestos se renumeran sin huecos. Al cerrar
   * la temporada ya no entran las cuentas demasiado nuevas; aquí se vuelve a mirar (contra el
   * reloj de ahora) por las que no tenían fecha al cerrar y al volver a entrar resultaron nuevas.
   */
  async hallOfRuin(): Promise<HallOfRuinResponse> {
    const rows = await this.#db
      .select({
        seasonId: hallOfRuin.seasonId,
        rank: hallOfRuin.rank,
        netWorth: hallOfRuin.netWorth,
        spins: hallOfRuin.spins,
        login: users.login,
        avatarUrl: users.avatarUrl,
      })
      .from(hallOfRuin)
      .innerJoin(users, eq(users.id, hallOfRuin.userId))
      .innerJoin(seasons, eq(seasons.id, hallOfRuin.seasonId))
      .where(
        and(
          eq(users.hidden, false),
          isNotNull(seasons.closedAt),
          oldEnough(this.#minAccountAgeDays, this.#clock.now()),
        ),
      )
      .orderBy(desc(hallOfRuin.seasonId), asc(hallOfRuin.rank))
    const bySeason = new Map<string, HallOfRuinResponse['seasons'][number]>()
    for (const r of rows) {
      let entry = bySeason.get(r.seasonId)
      if (!entry) {
        entry = { seasonId: r.seasonId, rows: [] }
        bySeason.set(r.seasonId, entry)
      }
      entry.rows.push({
        ...this.#views.publicUser(r),
        rank: entry.rows.length + 1,
        netWorth: r.netWorth,
        spins: r.spins,
      })
    }
    return { v: V, seasons: [...bySeason.values()] }
  }
}
