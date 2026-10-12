// SPDX-License-Identifier: AGPL-3.0-or-later
// Conexión a Postgres (postgres.js + Drizzle).
import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema.ts'

export type Database = PostgresJsDatabase<typeof schema>
/** Transacción de Drizzle (mismo API que la base de datos). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
export type Executor = Database | Tx

export interface DbHandle {
  db: Database
  sql: postgres.Sql
  close(timeoutSeconds?: number): Promise<void>
}

export interface DbOptions {
  url: string
  poolMax: number
  connectTimeoutSeconds: number
}

export function createDb(options: DbOptions): DbHandle {
  const sql = postgres(options.url, {
    max: options.poolMax,
    connect_timeout: options.connectTimeoutSeconds,
    // Sin avisos NOTICE en los logs (p. ej. "relation already exists, skipping").
    onnotice: () => {},
  })
  const db = drizzle(sql, { schema })
  return {
    db,
    sql,
    close: async timeoutSeconds => {
      await sql.end({ timeout: timeoutSeconds })
    },
  }
}
