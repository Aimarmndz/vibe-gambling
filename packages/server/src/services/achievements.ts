// SPDX-License-Identifier: AGPL-3.0-or-later
// Logros de broma con base de datos. Las condiciones son las de `shared` (lógica pura); aquí solo
// se reúne el contexto, se guardan los nuevos y se leen para el `hello` y `/api/me`.
//
// Se evalúan dentro de la transacción del evento (tirada, préstamo o tirada guardada), con la
// cartera ya bloqueada. El `INSERT … ON CONFLICT DO NOTHING RETURNING` hace que cada logro se
// desbloquee y se anuncie una sola vez aunque dos transacciones lo intenten a la vez (p. ej. en
// dos temporadas, que tienen cerrojos distintos).
import {
  ACHIEVEMENTS,
  achievementDef,
  achievementParams,
  achievementProgress,
  evaluateAchievements,
  localClock,
} from '@vibe-gambling/shared'
import type {
  Achievement,
  AchievementContext,
  AchievementId,
  AchievementRules,
  GameConfig,
  ProgressSnapshot,
} from '@vibe-gambling/shared'
import { and, count, eq, gt } from 'drizzle-orm'

import type { Executor, Tx } from '../db/client.ts'
import { achievements, referrals, rounds } from '../db/schema.ts'
import type { AchievementRow, WalletRow } from '../db/schema.ts'

export function achievementRules(game: GameConfig): AchievementRules {
  return {
    achievements: game.achievements,
    pendingSpins: game.pendingSpins,
    loan: game.loan,
    bigWin: game.bigWin,
    streak: { onFireAt: game.streak.onFireAt, colorWarningAt: game.streak.colorWarningAt },
    referral: { maxCommissionsPerSeason: game.referral.maxCommissionsPerSeason },
  }
}

/** Comisiones de afiliado cobradas (con monedas, sin las del tope) por un usuario en una temporada. */
export async function paidCommissions(
  db: Executor,
  referrerId: string,
  seasonId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(referrals)
    .where(
      and(
        eq(referrals.referrerId, referrerId),
        eq(referrals.paidSeasonId, seasonId),
        gt(referrals.commission, 0),
      ),
    )
  return row?.n ?? 0
}

/** Contexto de un evento menos lo que se calcula aquí (la hora local). */
export type EventContext = Omit<AchievementContext, 'local'>

export class AchievementService {
  readonly #game: GameConfig
  readonly #rules: AchievementRules

  constructor(game: GameConfig) {
    this.#game = game
    this.#rules = achievementRules(game)
  }

  /** Veces que le ha salido el 0 al usuario (todas las temporadas). */
  async lifetimeZeros(db: Executor, userId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(rounds)
      .where(and(eq(rounds.userId, userId), eq(rounds.status, 'resolved'), eq(rounds.result, 0)))
    return row?.n ?? 0
  }

  /**
   * Evalúa los logros de un evento y guarda los nuevos. Devuelve solo los que ha insertado esta
   * transacción, en el orden del catálogo, listos para `achievement.unlocked`.
   */
  async unlock(
    tx: Tx,
    args: {
      userId: string
      seasonId: string
      now: Date
      /** Cuándo terminó el turno, si no es ahora (tirada pendiente gastada más tarde). */
      turnAt?: Date | null
      ctx: EventContext
    },
  ): Promise<Achievement[]> {
    const have = await tx
      .select({ id: achievements.achievementId })
      .from(achievements)
      .where(eq(achievements.userId, args.userId))
    const tz = this.#game.season.timeZone
    const local = localClock(args.now, tz)
    const turnLocal = args.turnAt ? localClock(args.turnAt, tz) : local
    const fresh = evaluateAchievements(
      { ...args.ctx, local, turnLocal },
      this.#rules,
      new Set(have.map(h => h.id)),
    )
    if (fresh.length === 0) return []
    const inserted = await tx
      .insert(achievements)
      .values(
        fresh.map(achievementId => ({
          userId: args.userId,
          achievementId,
          seasonId: args.seasonId,
          unlockedAt: args.now,
        })),
      )
      .onConflictDoNothing()
      .returning()
    const byId = new Map(inserted.map(row => [row.achievementId, row]))
    return fresh.flatMap(id => {
      const row = byId.get(id)
      return row ? [this.#view(id, row, null)] : []
    })
  }

  /** Catálogo completo con lo conseguido y el progreso (temporada en curso). */
  async list(
    db: Executor,
    userId: string,
    wallet: { row: WalletRow | undefined; pendingSpins: number; seasonId: string },
  ): Promise<Achievement[]> {
    const rows = await db.select().from(achievements).where(eq(achievements.userId, userId))
    const byId = new Map(rows.map(row => [row.achievementId, row]))
    const snap: ProgressSnapshot = {
      loans: wallet.row?.loans ?? 0,
      debt: wallet.row?.debt ?? 0,
      spins: wallet.row?.spins ?? 0,
      bestStreak: wallet.row?.bestStreak ?? 0,
      pendingSpins: wallet.pendingSpins,
      // Solo hace falta mientras se enseña su barra de progreso.
      lifetimeZeros: byId.has('zero_collector') ? 0 : await this.lifetimeZeros(db, userId),
      referralCommissions: byId.has('pyramid_boss')
        ? 0
        : await paidCommissions(db, userId, wallet.seasonId),
    }
    return ACHIEVEMENTS.map(a => {
      const row = byId.get(a.id)
      return this.#view(a.id, row, row ? null : achievementProgress(a.id, snap, this.#rules, false))
    })
  }

  #view(
    id: AchievementId,
    row: AchievementRow | undefined,
    progress: Achievement['progress'],
  ): Achievement {
    return {
      id,
      hidden: achievementDef(id).hidden,
      params: achievementParams(id, this.#rules),
      unlockedAt: row ? row.unlockedAt.toISOString() : null,
      seasonId: row ? row.seasonId : null,
      progress,
    }
  }
}
