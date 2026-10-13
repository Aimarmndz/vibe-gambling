// SPDX-License-Identifier: AGPL-3.0-or-later
// Claves de los cerrojos consultivos de Postgres (`pg_advisory_lock`). Son identificadores
// internos, no configuración: solo tienen que ser distintos entre sí y estables.

/** Aplicar migraciones (una sola instancia a la vez). */
export const MIGRATION_LOCK_KEY = 7_256_001
/** Cambio de temporada y limpieza periódica. */
export const SEASON_JOB_LOCK_KEY = 7_256_002
/**
 * Espacio de los cerrojos de pareja del programa de afiliados (forma de dos claves: este número y
 * un hash de la pareja). Dos canjes cruzados (A con el código de B y B con el de A) se esperan.
 */
export const REFERRAL_PAIR_LOCK_SPACE = 7_256_003
