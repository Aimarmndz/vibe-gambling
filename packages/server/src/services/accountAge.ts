// SPDX-License-Identifier: AGPL-3.0-or-later
// Antiabuso: las cuentas de GitHub más nuevas que `leaderboard.minAccountAgeDays` juegan con
// normalidad, pero no salen en los rankings públicos ni en el Salón de la Ruina hasta cumplir esa
// edad. Así no compensa crear cuentas en masa para inflar el ranking.
//
// La edad se cuenta en días de 24 h exactas desde el `created_at` de GitHub, contra el reloj
// inyectado (sin zonas horarias: es un plazo, no una fecha de calendario). Una cuenta sin el dato
// (creada antes de esta regla y que aún no ha vuelto a iniciar sesión) cuenta como antigua.
import { isNull, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { users } from '../db/schema.ts'

/** Milisegundos de un día (unidad, no configuración). */
const DAY_MS = 86_400_000

/** Instante desde el que una cuenta creada en `githubCreatedAt` sale en los rankings. */
export function rankableAt(githubCreatedAt: Date, minAccountAgeDays: number): Date {
  return new Date(githubCreatedAt.getTime() + minAccountAgeDays * DAY_MS)
}

/**
 * Si la cuenta aún no puede salir en los rankings en `now`, el instante desde el que saldrá;
 * `null` si ya sale (o si no hay dato: cuenta antigua).
 */
export function pendingRankedFrom(
  githubCreatedAt: Date | null,
  minAccountAgeDays: number,
  now: Date,
): Date | null {
  // Con la regla desactivada (0 días) nadie espera, ni con un `created_at` en el futuro.
  if (githubCreatedAt === null || minAccountAgeDays === 0) return null
  const at = rankableAt(githubCreatedAt, minAccountAgeDays)
  return at.getTime() > now.getTime() ? at : null
}

/** Condición SQL (sobre `users`): la cuenta tiene edad para salir en los rankings en `now`. */
export function oldEnough(minAccountAgeDays: number, now: Date): SQL {
  if (minAccountAgeDays === 0) return sql`true`
  const cutoff = new Date(now.getTime() - minAccountAgeDays * DAY_MS)
  // `or` solo devuelve `undefined` sin argumentos; con dos siempre hay condición.
  return or(isNull(users.githubCreatedAt), lte(users.githubCreatedAt, cutoff)) as SQL
}
