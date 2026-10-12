// SPDX-License-Identifier: AGPL-3.0-or-later
// Crea la base de datos del E2E si no existe, antes de arrancar el servidor (que aplica las
// migraciones al arrancar). En local es `vibe_e2e` en el Postgres de la pila de desarrollo, para
// que los usuarios `e2e-*` no acaben en el ranking de la base de desarrollo; en el CI la base del
// service ya existe y esto no hace nada.
//
// Lo ejecuta playwright.config.ts (webServer) con DATABASE_URL y E2E_ADMIN_DATABASE en el entorno.
import postgres from 'postgres'
import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Base a la que conectarse para crear la del E2E (la de mantenimiento de Postgres). */
  E2E_ADMIN_DATABASE: z.string().regex(/^[A-Za-z0-9_]{1,63}$/),
})

/** Códigos de Postgres: "la base de datos no existe" y "ya existe" (otra ejecución a la vez). */
const INVALID_CATALOG_NAME = '3D000'
const DUPLICATE_DATABASE = '42P04'

/** Opciones comunes: una sola conexión, sin avisos NOTICE por la salida. */
const options = { max: 1, onnotice: () => {} }

function isMissingDatabase(error: unknown): boolean {
  return error instanceof postgres.PostgresError && error.code === INVALID_CATALOG_NAME
}

async function databaseExists(url: string): Promise<boolean> {
  const sql = postgres(url, options)
  try {
    await sql`select 1`
    return true
  } catch (error) {
    if (isMissingDatabase(error)) return false
    throw error
  } finally {
    await sql.end()
  }
}

async function main(): Promise<void> {
  const env = envSchema.parse(process.env)
  const target = new URL(env.DATABASE_URL)
  const name = decodeURIComponent(target.pathname.slice(1))
  if (!/^[A-Za-z0-9_]{1,63}$/.test(name)) {
    throw new Error(`Nombre de base de datos del E2E no válido: "${name}"`)
  }
  if (await databaseExists(env.DATABASE_URL)) return
  const admin = new URL(env.DATABASE_URL)
  admin.pathname = `/${env.E2E_ADMIN_DATABASE}`
  const sql = postgres(admin.toString(), options)
  try {
    // El nombre ya está validado arriba; los identificadores no van como parámetros.
    await sql.unsafe(`create database "${name}"`)
    console.log(`[e2e] base de datos ${name} creada`)
  } catch (error) {
    if (!(error instanceof postgres.PostgresError && error.code === DUPLICATE_DATABASE)) throw error
  } finally {
    await sql.end()
  }
}

main().catch((error: unknown) => {
  console.error('[e2e] no se pudo preparar la base de datos del E2E:', error)
  process.exit(1)
})
