// SPDX-License-Identifier: AGPL-3.0-or-later
// Claves de los cerrojos consultivos de Postgres (`pg_advisory_lock`). Son identificadores
// internos, no configuración: solo tienen que ser distintos entre sí y estables.

/** Aplicar migraciones (una sola instancia a la vez). */
export const MIGRATION_LOCK_KEY = 7_256_001
/** Cambio de temporada y limpieza periódica. */
export const SEASON_JOB_LOCK_KEY = 7_256_002
