// SPDX-License-Identifier: AGPL-3.0-or-later
// Rankings de la temporada y Salón de la Ruina. Los usuarios ocultos no salen nunca.
import type {
  HallOfRuinResponse,
  LeaderboardBoard,
  LeaderboardResponse,
} from '@vibe-gambling/shared'
import { and, asc, desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Database } from '../db/client.ts'
import { hallOfRuin, seasons, users, wallets } from '../db/schema.ts'
import { AppError } from '../lib/errors.ts'
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

/** Quién aparece en el ranking de una temporada: visibles y con al menos una tirada. */
function ranked(seasonId: string): SQL | undefined {
  return and(eq(wallets.seasonId, seasonId), eq(users.hidden, false), gt(wallets.spins, 0))
}

export class LeaderboardService {
  readonly #db: Database
  readonly #views: Views

  constructor(db: Database, views: Views) {
    this.#db = db
    this.#views = views
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
    const rows = await this.#db
      .select({ wallet: wallets, login: users.login, avatarUrl: users.avatarUrl })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(ranked(args.season))
      .orderBy(...boardOrder(args.board))
      .limit(args.limit)
    const [count] = await this.#db
      .select({ n: sql<number>`count(*)::int` })
      .from(wallets)
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(ranked(args.season))
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

  /** Puesto en el ranking de arruinados (null si está oculto o aún no ha tirado). */
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
      .where(ranked(seasonId))
      .as('ordered')
    const [row] = await this.#db
      .select({ rank: ordered.rank })
      .from(ordered)
      .where(eq(ordered.userId, userId))
    return row?.rank ?? null
  }

  /**
   * Salón de la Ruina de todas las temporadas cerradas (de la más reciente a la más antigua).
   * Quien se oculta desaparece también de aquí, y los puestos se renumeran sin huecos.
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
      .where(and(eq(users.hidden, false), isNotNull(seasons.closedAt)))
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
