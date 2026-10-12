// SPDX-License-Identifier: AGPL-3.0-or-later
// Una base de datos nueva por archivo de test, clonada de la plantilla migrada.
import { randomBytes } from 'node:crypto'

import postgres from 'postgres'
import { inject } from 'vitest'

import { createDb } from '../../src/db/client.ts'
import type { DbHandle } from '../../src/db/client.ts'
import { withDatabase } from './db-url.ts'

export async function createTestDb(): Promise<DbHandle & { url: string }> {
  const adminUrl = inject('pgAdminUrl')
  const template = inject('pgTemplate')
  const name = `vibe_t_${randomBytes(6).toString('hex')}`
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create database "${name}" template "${template}"`)
  await admin.end()
  const url = withDatabase(adminUrl, name)
  return { ...createDb({ url, poolMax: 20, connectTimeoutSeconds: 10 }), url }
}
