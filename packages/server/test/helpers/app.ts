// SPDX-License-Identifier: AGPL-3.0-or-later
// Arranca la aplicación completa contra una base de datos de test, con reloj y azar controlados.
import type { AddressInfo } from 'node:net'

import type { ServerMessage } from '@vibe-gambling/shared'
import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'

import { buildApp } from '../../src/app.ts'
import type { Config } from '../../src/config.ts'
import type { DbHandle } from '../../src/db/client.ts'
import { users } from '../../src/db/schema.ts'
import { ManualClock } from '../../src/lib/clock.ts'
import { sequenceRng } from '../../src/lib/rng.ts'
import type { Services } from '../../src/services/index.ts'
import type { Connection, Hub } from '../../src/ws/hub.ts'
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

/**
 * Ventana de mentira registrada en el hub: cuenta como conectada y guarda lo que le llega.
 * Sirve para los tests que solo usan HTTP: con una ventana visible, los turnos se juegan en
 * directo; sin ninguna (o con todas ocultas), se guardan como tiradas pendientes.
 */
export function attachWindow(t: TestApp, userId: string, visible = true) {
  const received: ServerMessage[] = []
  const socket = {
    OPEN: 1,
    readyState: 1,
    send: (data: string) => received.push(JSON.parse(data) as ServerMessage),
    close: () => {},
    terminate: () => {},
    ping: () => {},
  }
  const connection: Connection = {
    socket: socket as unknown as WebSocket,
    userId,
    sessionId: 'fake-window',
    alive: true,
    pending: null,
    visible,
  }
  t.hub.add(connection)
  return {
    received,
    setVisible: (value: boolean) => t.hub.setVisible(connection, value),
    detach: () => t.hub.remove(connection),
  }
}

/** Qué ventana tiene abierta el usuario recién creado. */
export type WindowMode = 'none' | 'visible' | 'hidden'

/**
 * Crea un usuario directamente en la base de datos (sin pasar por GitHub). Con `window`, además
 * le abre una ventana de mentira (visible: los turnos se juegan en directo).
 */
export async function createUser(
  t: TestApp,
  login = `user${githubIds}`,
  options: { window?: WindowMode } = {},
) {
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
  const mode = options.window ?? 'none'
  const window = mode === 'none' ? null : attachWindow(t, user.id, mode === 'visible')
  return { user, modToken, bearer: { authorization: `Bearer ${modToken}` }, window }
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

/**
 * Adelanta el reloj hasta que la bola de la última tirada en directo haya caído. Una tirada por
 * bola: mientras su `revealAt` no llegue, el siguiente `turn/end` se guarda como pendiente en vez
 * de tirarse. `revealAt` nunca pasa de `max(openedAt + minSpinMs, ahora + landingMs)`, y
 * `openedAt` nunca es posterior a ahora, así que basta con el mayor de los dos.
 */
export function afterBall(t: TestApp): void {
  const { minSpinMs, landingMs } = t.config.game.spin
  t.clock.advance(Math.max(minSpinMs, landingMs))
}

/**
 * Adelanta el reloj la duración mínima de un turno (`turn.minDurationMs`). Un `turn/end` que llega
 * antes no da tirada: el servidor mide el turno con su propio reloj desde el `turn/start`.
 */
export function afterMinTurn(t: TestApp): void {
  t.clock.advance(t.config.game.turn.minDurationMs)
}

/**
 * El principio de un prompt como lo hace el mod: `turn/start` (idempotente: si el turno ya empezó,
 * no cambia nada) y la duración mínima de un turno, para que su `turn/end` cuente.
 */
export async function beginTurn(t: TestApp, headers: Record<string, string>, id: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/turn/start',
    headers,
    payload: { v: 1, turnId: id, ...MOD_META },
  })
  if (res.statusCode !== 200) throw new Error(`turn/start: ${res.statusCode} ${res.body}`)
  afterMinTurn(t)
}

/** Lo mismo que `beginTurn`, llamando al servicio directamente (sin HTTP). */
export async function beginServiceTurn(t: TestApp, userId: string, id: string): Promise<void> {
  await t.services.game.turnStart(userId, id)
  afterMinTurn(t)
}

/** Usuario con la ventana abierta y visible: sus turnos se juegan en directo. */
export function createWatchingUser(t: TestApp, login?: string) {
  return createUser(t, login, { window: 'visible' })
}
