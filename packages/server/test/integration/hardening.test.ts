// SPDX-License-Identifier: AGPL-3.0-or-later
// Casos encontrados atacando el servidor: monedas en el cambio de temporada, sesiones que
// caducan con la ventana abierta, usuarios borrados a mitad de una operación y rate limit.
import {
  hallOfRuinResponseSchema,
  serverMessageSchema,
  WS_CLOSE_CODES,
} from '@vibe-gambling/shared'
import type { ServerMessage } from '@vibe-gambling/shared'
import { randomBytes } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import WebSocket from 'ws'

import { hallOfRuin, sessions, users, wallets } from '../../src/db/schema.ts'
import { runMigrations } from '../../src/db/migrate.ts'
import { AppError } from '../../src/lib/errors.ts'
import { createUser, MOD_META, START, startTestApp, turnId } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'
import { withDatabase } from '../helpers/db-url.ts'
import { MIGRATIONS_DIR, TEST_PUBLIC_URL } from '../helpers/env.ts'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp({ listen: true })
})
afterAll(async () => {
  await t.close()
})

async function walletRow(app: TestApp, userId: string, seasonId: string) {
  const [row] = await app.db.db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, seasonId)))
  return row
}

interface Client {
  messages: ServerMessage[]
  closed: Promise<{ code: number }>
  send(data: unknown): void
}

function connect(app: TestApp, cookie: string): Client {
  const ws = new WebSocket(`${app.baseUrl.replace('http', 'ws')}/ws`, {
    origin: TEST_PUBLIC_URL,
    headers: { cookie },
  })
  const messages: ServerMessage[] = []
  ws.on('message', data => messages.push(serverMessageSchema.parse(JSON.parse(String(data)))))
  ws.on('error', () => {})
  return {
    messages,
    closed: new Promise(resolve => ws.on('close', code => resolve({ code }))),
    send: data => ws.send(JSON.stringify(data)),
  }
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`no llegó: ${what}`)
}

describe('cambio de temporada con fichas en el boleto', () => {
  it('las fichas del boleto vuelven al saldo al cerrar: el Salón ve el patrimonio real', async () => {
    const own = await startTestApp()
    try {
      const { user, bearer } = await createUser(own, 'slipper')
      // Una tirada (apuesta por defecto: 10 al rojo; sale el 17, negro) para entrar en el Salón.
      const end = await own.app.inject({
        method: 'POST',
        url: '/api/turn/end',
        headers: bearer,
        payload: {
          v: 1,
          turnId: turnId(),
          durationMs: 1,
          gitPushOk: false,
          testFailed: false,
          ...MOD_META,
        },
      })
      expect(end.statusCode, end.body).toBe(200)
      const bet = await own.app.inject({
        method: 'POST',
        url: '/api/bet',
        headers: bearer,
        payload: { v: 1, amount: 300, target: 'red' },
      })
      expect(bet.statusCode, bet.body).toBe(200)
      expect(await walletRow(own, user.id, '2026-10')).toMatchObject({ balance: 690 })

      own.clock.set('2026-10-31T23:00:00Z')
      expect((await own.services.seasons.tick()).closed).toEqual(['2026-10'])

      // Nadie pierde las 300 monedas apostadas: vuelven al saldo de octubre.
      expect(await walletRow(own, user.id, '2026-10')).toMatchObject({ balance: 990, slip: [] })
      const [hall] = await own.db.db.select().from(hallOfRuin).where(eq(hallOfRuin.userId, user.id))
      expect(hall?.netWorth).toBe(990)
      const res = hallOfRuinResponseSchema.parse(
        (await own.app.inject({ method: 'GET', url: '/api/hall-of-ruin' })).json(),
      )
      expect(res.seasons[0]?.rows[0]).toMatchObject({ login: 'slipper', netWorth: 990 })
    } finally {
      await own.close()
    }
  })

  it('una operación que llega con la temporada ya cerrada no deja monedas en ella', async () => {
    const own = await startTestApp()
    try {
      const { user } = await createUser(own)
      await own.services.game.placeBet(user.id, { kind: 'red' }, 100)
      own.clock.set('2026-10-31T23:00:00Z')
      expect((await own.services.seasons.tick()).closed).toEqual(['2026-10'])
      // Una petición que leyó el reloj justo antes del cambio y llega después del cierre.
      own.clock.set('2026-10-31T22:59:59Z')
      for (const op of [
        () => own.services.game.placeBet(user.id, { kind: 'red' }, 100),
        () => own.services.game.turnStart(user.id, turnId()),
      ]) {
        const error = await op().catch((e: unknown) => e)
        expect(error).toBeInstanceOf(AppError)
        expect((error as AppError).code).toBe('conflict')
      }
      expect(await walletRow(own, user.id, '2026-10')).toMatchObject({ balance: 1000, slip: [] })
    } finally {
      await own.close()
    }
  })
})

describe('sesión que deja de valer con la ventana abierta', () => {
  it('sesión caducada: la ventana no puede seguir apostando y se cierra con 4401', async () => {
    const { user } = await createUser(t)
    const token = await t.services.auth.createSession(user.id, 'web')
    const client = connect(t, `test_session=${token}`)
    await until(() => client.messages.some(m => m.type === 'hello'), 'hello')
    try {
      t.clock.advance(Number(t.config.env.WEB_SESSION_TTL_SECONDS) * 1000 + 1000)
      client.send({ v: 1, type: 'bet.place', selection: { kind: 'red' }, amount: 10 })
      expect((await client.closed).code).toBe(WS_CLOSE_CODES.unauthorized)
      expect(client.messages.some(m => m.type === 'slip')).toBe(false)
      expect(await walletRow(t, user.id, '2026-10')).toBeUndefined()
    } finally {
      t.clock.set(START)
    }
  })

  it('sesión revocada o purgada sin pasar por el hub: igual', async () => {
    const { user } = await createUser(t)
    const token = await t.services.auth.createSession(user.id, 'web')
    const client = connect(t, `test_session=${token}`)
    await until(() => client.messages.some(m => m.type === 'hello'), 'hello')
    await t.db.db.delete(sessions).where(eq(sessions.userId, user.id))
    client.send({ v: 1, type: 'loan.request' })
    expect((await client.closed).code).toBe(WS_CLOSE_CODES.unauthorized)
    expect(await walletRow(t, user.id, '2026-10')).toBeUndefined()
  })
})

describe('reloj', () => {
  it('el serverTime del hello sale del mismo reloj que openedAt y revealAt', async () => {
    const { user } = await createUser(t)
    const token = await t.services.auth.createSession(user.id, 'web')
    const client = connect(t, `test_session=${token}`)
    await until(() => client.messages.some(m => m.type === 'hello'), 'hello')
    const hello = client.messages.find(m => m.type === 'hello')
    expect(hello?.type === 'hello' && hello.serverTime).toBe(new Date(START).toISOString())
  })
})

describe('usuario borrado a mitad de una operación', () => {
  it('las operaciones de dinero responden 401, no un 500 por la clave foránea', async () => {
    const { user } = await createUser(t)
    await t.db.db.delete(users).where(eq(users.id, user.id))
    for (const op of [
      () => t.services.game.placeBet(user.id, { kind: 'red' }, 10),
      () => t.services.game.clearSlip(user.id),
      () => t.services.game.requestLoan(user.id),
      () => t.services.game.turnStart(user.id, turnId()),
    ]) {
      const error = await op().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('unauthorized')
    }
  })
})

describe('rate limit', () => {
  it('IPv6: cambiar de dirección dentro del mismo /64 no da cupo nuevo', async () => {
    const own = await startTestApp({
      db: t.db,
      env: {
        RATE_LIMIT_IP_MAX: '2',
        TRUST_PROXY_CIDRS: '127.0.0.0/8',
        RATE_LIMIT_IPV6_PREFIX: '64',
      },
    })
    try {
      const call = (ip: string) =>
        own.app
          .inject({ method: 'GET', url: '/api/meta', headers: { 'cf-connecting-ip': ip } })
          .then(r => r.statusCode)
      expect([
        await call('2001:db8::1'),
        await call('2001:db8::2'),
        await call('2001:db8::3:4:5'),
        await call('2001:db8:0:1::1'),
      ]).toEqual([200, 200, 429, 200])
    } finally {
      await own.close()
    }
  })

  it('los intentos de abrir el WebSocket también cuentan por IP', async () => {
    const own = await startTestApp({ listen: true, db: t.db, env: { RATE_LIMIT_IP_MAX: '2' } })
    try {
      const codes = []
      for (let i = 0; i < 3; i++) codes.push((await connect(own, 'test_session=nope').closed).code)
      expect(codes).toEqual([
        WS_CLOSE_CODES.unauthorized,
        WS_CLOSE_CODES.unauthorized,
        WS_CLOSE_CODES.tooManyConnections,
      ])
    } finally {
      await own.close()
    }
  })
})

describe('carreras que ya aguantaban (regresión)', () => {
  it('20 turn/end simultáneos con el mismo turnId: una sola tirada', async () => {
    const { user, bearer } = await createUser(t)
    const id = turnId()
    const payload = {
      v: 1,
      turnId: id,
      durationMs: 1,
      gitPushOk: false,
      testFailed: false,
      ...MOD_META,
    }
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        t.app.inject({ method: 'POST', url: '/api/turn/end', headers: bearer, payload }),
      ),
    )
    const rounds = new Set(
      responses.map(r => {
        expect(r.statusCode, r.body).toBe(200)
        return (r.json() as { round: { roundId: string } }).round.roundId
      }),
    )
    expect(rounds.size).toBe(1)
    expect(await walletRow(t, user.id, '2026-10')).toMatchObject({ spins: 1, balance: 990 })

    // El mismo turnId de otro usuario es otro turno.
    const other = await createUser(t)
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/turn/end',
      headers: other.bearer,
      payload,
    })
    expect((res.json() as { round: { roundId: string } }).round.roundId).not.toBe([...rounds][0])
  })

  it('dos canjes simultáneos del mismo enlace: solo uno recibe cookie', async () => {
    const { bearer } = await createUser(t)
    const link = await t.app.inject({
      method: 'POST',
      url: '/api/auth/link',
      headers: bearer,
      payload: { v: 1 },
    })
    const code = new URL((link.json() as { url: string }).url).searchParams.get('code')
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        t.app.inject({ method: 'POST', url: '/api/auth/redeem', payload: { v: 1, code } }),
      ),
    )
    expect(results.filter(r => r.statusCode === 200)).toHaveLength(1)
    expect(results.filter(r => r.statusCode === 401)).toHaveLength(9)
  })

  it('dos instancias migrando a la vez sobre una base de datos vacía', async () => {
    const adminUrl = inject('pgAdminUrl')
    const name = `vibe_t_mig_${randomBytes(4).toString('hex')}`
    const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
    await admin.unsafe(`create database "${name}"`)
    try {
      const options = {
        url: withDatabase(adminUrl, name),
        migrationsFolder: MIGRATIONS_DIR,
        connectTimeoutSeconds: 10,
      }
      await Promise.all([runMigrations(options), runMigrations(options), runMigrations(options)])
      const check = postgres(options.url, { max: 1, onnotice: () => {} })
      const [row] = await check<{ n: number }[]>`
        select count(*)::int as n from drizzle.__drizzle_migrations`
      await check.end()
      expect(row?.n).toBeGreaterThan(0)
    } finally {
      await admin.unsafe(`drop database if exists "${name}" with (force)`)
      await admin.end()
    }
  })
})
