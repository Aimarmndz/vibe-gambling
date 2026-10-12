// SPDX-License-Identifier: AGPL-3.0-or-later
// Punto de entrada del servidor: configuración → migraciones → aplicación → escuchar.
// Apagado ordenado con SIGTERM/SIGINT: deja de aceptar conexiones, despide a las ventanas,
// espera a las peticiones (y sus transacciones) en curso y cierra la base de datos.
import { buildApp } from './app.ts'
import { ConfigError, loadConfig } from './config.ts'
import { createDb } from './db/client.ts'
import { runMigrations } from './db/migrate.ts'

async function main(): Promise<void> {
  const config = loadConfig()
  const { env } = config

  if (env.MIGRATE_ON_START) {
    await runMigrations({
      url: env.DATABASE_URL,
      migrationsFolder: env.MIGRATIONS_DIR,
      connectTimeoutSeconds: env.DB_CONNECT_TIMEOUT_SECONDS,
    })
  }

  const db = createDb({
    url: env.DATABASE_URL,
    poolMax: env.DB_POOL_MAX,
    connectTimeoutSeconds: env.DB_CONNECT_TIMEOUT_SECONDS,
  })
  const { app, services } = await buildApp({ config, db: db.db })
  if (env.MIGRATE_ON_START) app.log.info('migraciones aplicadas')

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    app.log.info({ signal }, 'apagando')
    const killer = setTimeout(() => {
      app.log.error('el apagado tarda demasiado: salida forzada')
      process.exit(1)
    }, env.SHUTDOWN_TIMEOUT_MS)
    killer.unref()
    try {
      await services.seasons.stop()
      await app.close()
      await db.close(Math.ceil(env.SHUTDOWN_TIMEOUT_MS / 1000))
      app.log.info('apagado limpio')
      process.exit(0)
    } catch (error) {
      app.log.error({ err: error }, 'error al apagar')
      process.exit(1)
    }
  }
  process.on('SIGTERM', signal => void shutdown(signal))
  process.on('SIGINT', signal => void shutdown(signal))

  await app.listen({ host: env.HOST, port: env.PORT })
  services.seasons.start()
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`\n${error.message}\n`)
  } else {
    console.error('El servidor no ha podido arrancar:', error)
  }
  process.exit(1)
})
