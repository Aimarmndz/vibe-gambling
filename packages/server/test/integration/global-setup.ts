// SPDX-License-Identifier: AGPL-3.0-or-later
// Prepara Postgres para los tests de integración: usa TEST_DATABASE_URL (CI) o levanta un
// contenedor efímero de Postgres 17 con testcontainers, y deja migrada una base de datos
// plantilla que cada archivo de test clona.
import { randomBytes } from 'node:crypto'

import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import type { TestProject } from 'vitest/node'

import { runMigrations } from '../../src/db/migrate.ts'
import { withDatabase } from '../helpers/db-url.ts'
import { MIGRATIONS_DIR } from '../helpers/env.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL de administración (para crear y borrar bases de datos). */
    pgAdminUrl: string
    /** Nombre de la base de datos plantilla ya migrada. */
    pgTemplate: string
  }
}

export default async function setup(project: TestProject) {
  let container: StartedPostgreSqlContainer | null = null
  let adminUrl = process.env.TEST_DATABASE_URL
  if (!adminUrl) {
    container = await new PostgreSqlContainer('postgres:17-alpine').start()
    adminUrl = container.getConnectionUri()
  }
  const template = `vibe_tpl_${randomBytes(4).toString('hex')}`
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create database "${template}"`)
  await runMigrations({
    url: withDatabase(adminUrl, template),
    migrationsFolder: MIGRATIONS_DIR,
    connectTimeoutSeconds: 10,
  })
  // Dos veces seguidas: las migraciones tienen que ser idempotentes.
  await runMigrations({
    url: withDatabase(adminUrl, template),
    migrationsFolder: MIGRATIONS_DIR,
    connectTimeoutSeconds: 10,
  })
  await admin.end()

  project.provide('pgAdminUrl', adminUrl)
  project.provide('pgTemplate', template)

  return async () => {
    if (container) {
      await container.stop()
      return
    }
    // Postgres compartido (CI): se borran las bases de datos de esta ejecución.
    const cleanup = postgres(adminUrl, { max: 1, onnotice: () => {} })
    const dbs = await cleanup<{ datname: string }[]>`
      select datname from pg_database where datname like ${'vibe_t%'}`
    for (const { datname } of dbs) {
      await cleanup.unsafe(`drop database if exists "${datname}" with (force)`)
    }
    await cleanup.end()
  }
}
