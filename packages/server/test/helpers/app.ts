// SPDX-License-Identifier: AGPL-3.0-or-later
// Arranca la aplicación completa contra una base de datos de test, con reloj y azar controlados.
import type { AddressInfo } from 'node:net'

import type { FastifyInstance } from 'fastify'

import { buildApp } from '../../src/app.ts'
import type { Config } from '../../src/config.ts'
import type { DbHandle } from '../../src/db/client.ts'
import { users } from '../../src/db/schema.ts'
import { ManualClock } from '../../src/lib/clock.ts'
import { sequenceRng } from '../../src/lib/rng.ts'
import type { Services } from '../../src/services/index.ts'
import type { Hub } from '../../src/ws/hub.ts'
import { createTestDb } from './db.ts'
import { testConfig } from './env.ts'

export const START = '2026-10-15T12:00:00Z'

export interface TestApp {
  app: FastifyInstance
  services: Services
  hub: Hub
  config: Config
  db: DbHandle
  clock: ManualClock
  rng: ReturnType<typeof sequenceRng>
  /** Origen HTTP si se arrancó con `listen: true`. */
  baseUrl: string
  close(): Promise<void>
}

export async function startTestApp(
  options: { env?: Record<string, string>; listen?: boolean; db?: DbHandle } = {},
): Promise<TestApp> {
  const db = options.db ?? (await createTestDb())
  const config = testConfig(options.env)
  const clock = new ManualClock(START)
  const rng = sequenceRng([17])
  const { app, services, hub } = await buildApp({ config, db: db.db, clock, rng, logger: false })
  let baseUrl = ''
  if (options.listen) {
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  } else {
    await app.ready()
  }
  return {
    app,
    services,
    hub,
    config,
    db,
    clock,
    rng,
    baseUrl,
    close: async () => {
      await app.close()
      if (!options.db) await db.close(5)
    },
  }
}

let githubIds = 1000

/** Crea un usuario directamente en la base de datos (sin pasar por GitHub). */
export async function createUser(t: TestApp, login = `user${githubIds}`) {
  const [user] = await t.db.db
    .insert(users)
    .values({
      githubId: githubIds++,
      login,
      avatarUrl: `https://avatars.test/${login}.png`,
    })
    .returning()
  if (!user) throw new Error('no se creó el usuario')
  const modToken = await t.services.auth.createSession(user.id, 'mod')
  return { user, modToken, bearer: { authorization: `Bearer ${modToken}` } }
}

/** Sesión web (cookie) para un usuario, como si hubiera canjeado un enlace. */
export async function webCookie(t: TestApp, userId: string): Promise<string> {
  const token = await t.services.auth.createSession(userId, 'web')
  return `${t.config.env.SESSION_COOKIE_NAME}=${token}`
}

let turnCounter = 0
export function turnId(): string {
  return `turn-${Date.now().toString(36)}-${(turnCounter++).toString(36)}`
}

export const MOD_META = { pluginVersion: '0.1.0', os: 'linux' } as const
