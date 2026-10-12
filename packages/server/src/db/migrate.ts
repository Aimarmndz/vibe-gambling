// SPDX-License-Identifier: AGPL-3.0-or-later
// Aplica las migraciones versionadas de `drizzle/` bajo un cerrojo consultivo, para que dos
// instancias arrancando a la vez no las apliquen dos veces.
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import { MIGRATION_LOCK_KEY } from './locks.ts'

export interface MigrateOptions {
  url: string
  migrationsFolder: string
  connectTimeoutSeconds: number
}

export async function runMigrations(options: MigrateOptions): Promise<void> {
  // Conexión única: el cerrojo de sesión y las migraciones van por el mismo socket.
  const sql = postgres(options.url, {
    max: 1,
    connect_timeout: options.connectTimeoutSeconds,
    onnotice: () => {},
  })
  try {
    await sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`
    try {
      await migrate(drizzle(sql), { migrationsFolder: options.migrationsFolder })
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`
    }
  } finally {
    await sql.end()
  }
}
