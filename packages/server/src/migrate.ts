// SPDX-License-Identifier: AGPL-3.0-or-later
// `db:migrate`: aplica las migraciones pendientes y termina. Solo necesita DATABASE_URL,
// DB_CONNECT_TIMEOUT_SECONDS, MIGRATIONS_DIR y LOG_LEVEL.
import { ConfigError, loadDbEnv } from './config.ts'
import { runMigrations } from './db/migrate.ts'

try {
  const env = loadDbEnv()
  await runMigrations({
    url: env.DATABASE_URL,
    migrationsFolder: env.MIGRATIONS_DIR,
    connectTimeoutSeconds: env.DB_CONNECT_TIMEOUT_SECONDS,
  })
  if (env.LOG_LEVEL !== 'silent') console.log('Migraciones aplicadas.')
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error)
  process.exit(1)
}
