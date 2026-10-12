// SPDX-License-Identifier: AGPL-3.0-or-later
// WebSocket `/ws`: autenticación, origen, orden de los mensajes y límites.
import { serverMessageSchema, WS_CLOSE_CODES } from '@vibe-gambling/shared'
import type { ServerMessage } from '@vibe-gambling/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { createUser, MOD_META, startTestApp, turnId, webCookie } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'
import { TEST_PUBLIC_URL } from '../helpers/env.ts'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp({ listen: true })
})
afterAll(async () => {
  await t.close()
})

interface Client {
  ws: WebSocket
  messages: ServerMessage[]
  /** Espera al siguiente mensaje de ese tipo (o lo devuelve si ya llegó y no se ha consumido). */
  next<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>>
  closed: Promise<{ code: number; reason: string }>
  send(data: unknown): void
}

function connect(options: { cookie?: string; origin?: string } = {}): Client {
  const ws = new WebSocket(`${t.baseUrl.replace('http', 'ws')}/ws`, {
    origin: options.origin ?? TEST_PUBLIC_URL,
    headers: options.cookie ? { cookie: options.cookie } : {},
  })
  const messages: ServerMessage[] = []
  const consumed = new Set<number>()
  const waiters: Array<() => void> = []
  ws.on('message', data => {
    messages.push(serverMessageSchema.parse(JSON.parse(String(data))))
    for (const w of waiters.splice(0)) w()
  })
  const closed = new Promise<{ code: number; reason: string }>(resolve => {
    ws.on('close', (code, reason) => resolve({ code, reason: String(reason) }))
  })
  ws.on('error', () => {})
  const next = <T extends ServerMessage['type']>(type: T) =>
    new Promise<Extract<ServerMessage, { type: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no llegó ${type}`)), 5000)
      const check = () => {
        const i = messages.findIndex((m, idx) => m.type === type && !consumed.has(idx))
        if (i >= 0) {
          consumed.add(i)
          clearTimeout(timer)
          resolve(messages[i] as Extract<ServerMessage, { type: T }>)
          return
        }
        waiters.push(check)
      }
      check()
    })
  const send = (data: unknown) => {
    const go = () => ws.send(typeof data === 'string' ? data : JSON.stringify(data))
    if (ws.readyState === WebSocket.OPEN) go()
    else ws.once('open', go)
  }
  return { ws, messages, next, closed, send }
}

describe('WebSocket', () => {
  it('sin cookie → 4401; cookie de sesión del mod → 4401', async () => {
    expect((await connect().closed).code).toBe(WS_CLOSE_CODES.unauthorized)
    const { modToken } = await createUser(t)
    const asMod = connect({ cookie: `test_session=${modToken}` })
    expect((await asMod.closed).code).toBe(WS_CLOSE_CODES.unauthorized)
  })

  it('origen distinto de PUBLIC_URL → 4403', async () => {
    const { user } = await createUser(t)
    const cookie = await webCookie(t, user.id)
    const client = connect({ cookie, origin: 'https://evil.test' })
    expect((await client.closed).code).toBe(WS_CLOSE_CODES.forbiddenOrigin)
  })

  it('hello primero; round.started antes de round.resolved; windowConnected', async () => {
    const { user, bearer } = await createUser(t, 'wsuser')
    const client = connect({ cookie: await webCookie(t, user.id) })
    const hello = await client.next('hello')
    expect(client.messages[0]?.type).toBe('hello')
    expect(hello.user.login).toBe('wsuser')
    expect(hello.wallet.balance).toBe(1000)
    expect(hello.round).toBeNull()
    expect(hello.lastRound).toBeNull()

    const id = turnId()
    const start = await t.app.inject({
      method: 'POST',
      url: '/api/turn/start',
      headers: bearer,
      payload: { v: 1, turnId: id, ...MOD_META },
    })
    expect(start.json().windowConnected).toBe(true)
    await t.app.inject({
      method: 'POST',
      url: '/api/turn/end',
      headers: bearer,
      payload: {
        v: 1,
        turnId: id,
        durationMs: 9,
        gitPushOk: false,
        testFailed: false,
        ...MOD_META,
      },
    })
    const started = await client.next('round.started')
    const resolved = await client.next('round.resolved')
    expect(resolved.round.roundId).toBe(started.round.roundId)
    const types = client.messages.map(m => m.type)
    expect(types.indexOf('round.started')).toBeLessThan(types.indexOf('round.resolved'))

    // `sync` devuelve el estado completo con la última ronda.
    client.send({ v: 1, type: 'sync' })
    const again = await client.next('hello')
    expect(again.lastRound?.roundId).toBe(resolved.round.roundId)
    client.ws.close()
  })

  it('una turn/end sin turn/start manda igualmente round.started y luego round.resolved', async () => {
    const { user, bearer } = await createUser(t)
    const client = connect({ cookie: await webCookie(t, user.id) })
    await client.next('hello')
    await t.app.inject({
      method: 'POST',
      url: '/api/turn/end',
      headers: bearer,
      payload: {
        v: 1,
        turnId: turnId(),
        durationMs: 9,
        gitPushOk: false,
        testFailed: false,
        ...MOD_META,
      },
    })
    await client.next('round.resolved')
    expect(client.messages.map(m => m.type)).toEqual(['hello', 'round.started', 'round.resolved'])
    client.ws.close()
  })

  it('apuestas, préstamo, ajustes y ping desde la ventana; se difunde a todas sus ventanas', async () => {
    const { user } = await createUser(t)
    const cookie = await webCookie(t, user.id)
    const a = connect({ cookie })
    const b = connect({ cookie })
    await a.next('hello')
    await b.next('hello')

    a.send({
      v: 1,
      type: 'bet.place',
      selection: { kind: 'split', numbers: [2, 1] },
      amount: 'all-in',
    })
    const slipA = await a.next('slip')
    const slipB = await b.next('slip')
    expect(slipA.slip.bets[0]).toEqual({
      selection: { kind: 'split', numbers: [1, 2] },
      amount: 1000,
    })
    expect(slipB.wallet.balance).toBe(0)

    a.send({ v: 1, type: 'bet.place', selection: { kind: 'red' }, amount: 10 })
    expect((await a.next('bet.rejected')).error).toBe('insufficient_funds')

    a.send({ v: 1, type: 'loan.request' })
    expect((await a.next('error')).error).toBe('loan_not_allowed')

    a.send({ v: 1, type: 'bet.clear' })
    expect((await b.next('slip')).wallet.balance).toBe(1000)

    a.send({ v: 1, type: 'settings.update', locale: 'es' })
    expect((await b.next('settings')).user.locale).toBe('es')

    a.send({ v: 1, type: 'ping', t: 42 })
    expect(await a.next('pong')).toEqual({ v: 1, type: 'pong', t: 42 })

    a.send('{esto no es json')
    expect((await a.next('error')).error).toBe('invalid_request')
    a.send({ v: 1, type: 'bet.place', selection: { kind: 'split', numbers: [1, 5] }, amount: 10 })
    expect((await a.next('error')).error).toBe('invalid_request')
    a.send({ v: 2, type: 'sync' })
    expect((await a.next('error')).error).toBe('protocol_mismatch')
    a.ws.close()
    b.ws.close()
  })

  it('máximo de conexiones por usuario → 4429', async () => {
    const { user } = await createUser(t)
    const cookie = await webCookie(t, user.id)
    const max = Number(t.config.env.WS_MAX_CONNECTIONS_PER_USER)
    const clients = Array.from({ length: max }, () => connect({ cookie }))
    await Promise.all(clients.map(c => c.next('hello')))
    const extra = connect({ cookie })
    expect((await extra.closed).code).toBe(WS_CLOSE_CODES.tooManyConnections)
    for (const c of clients) c.ws.close()
  })

  it('mensajes demasiado grandes → cierre 1009', async () => {
    const { user } = await createUser(t)
    const client = connect({ cookie: await webCookie(t, user.id) })
    await client.next('hello')
    client.send({ v: 1, type: 'ping', t: 1, pad: 'x'.repeat(5000) })
    expect((await client.closed).code).toBe(1009)
  })

  it('logout y borrado de cuenta despiden a la ventana con bye', async () => {
    const { user, bearer } = await createUser(t, 'byebye')
    const webToken = await t.services.auth.createSession(user.id, 'web')
    const client = connect({ cookie: `test_session=${webToken}` })
    await client.next('hello')
    await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `test_session=${webToken}`, origin: TEST_PUBLIC_URL },
      payload: { v: 1 },
    })
    expect((await client.next('bye')).reason).toBe('logout')
    expect((await client.closed).code).toBe(WS_CLOSE_CODES.sessionEnded)

    const other = connect({ cookie: await webCookie(t, user.id) })
    await other.next('hello')
    await t.app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer,
      payload: { v: 1, confirm: 'byebye' },
    })
    expect((await other.next('bye')).reason).toBe('account_deleted')
    expect((await other.closed).code).toBe(WS_CLOSE_CODES.sessionEnded)
  })

  it('al cambiar de temporada avisa con season.changed', async () => {
    const { user } = await createUser(t)
    const client = connect({ cookie: await webCookie(t, user.id) })
    await client.next('hello')
    t.clock.set('2026-11-01T00:00:00+01:00')
    try {
      await t.services.seasons.tick()
      const msg = await client.next('season.changed')
      expect(msg.seasonId).toBe('2026-11')
      expect(msg.wallet).toMatchObject({ seasonId: '2026-11', balance: 1000 })
    } finally {
      t.clock.set('2026-10-15T12:00:00Z')
      client.ws.close()
    }
  })

  it('límite de mensajes por ventana: los que sobran reciben rate_limited', async () => {
    const own = await startTestApp({ listen: true, db: t.db, env: { WS_RATE_LIMIT_MAX: '2' } })
    try {
      const { user } = await createUser(own)
      const ws = new WebSocket(`${own.baseUrl.replace('http', 'ws')}/ws`, {
        origin: TEST_PUBLIC_URL,
        headers: { cookie: await webCookie(own, user.id) },
      })
      const got: ServerMessage[] = []
      ws.on('message', d => got.push(serverMessageSchema.parse(JSON.parse(String(d)))))
      await new Promise(resolve => ws.once('message', resolve))
      for (let i = 0; i < 4; i++) ws.send(JSON.stringify({ v: 1, type: 'ping', t: i }))
      await new Promise(resolve => setTimeout(resolve, 300))
      expect(got.filter(m => m.type === 'pong')).toHaveLength(2)
      expect(got.filter(m => m.type === 'error' && m.error === 'rate_limited')).toHaveLength(2)
      ws.close()
    } finally {
      await own.close()
    }
  })

  it('el apagado manda bye shutdown y cierra con 1001', async () => {
    const own = await startTestApp({ listen: true, db: t.db })
    const { user } = await createUser(own)
    const ws = new WebSocket(`${own.baseUrl.replace('http', 'ws')}/ws`, {
      origin: TEST_PUBLIC_URL,
      headers: { cookie: await webCookie(own, user.id) },
    })
    const got: string[] = []
    const closed = new Promise<number>(resolve => ws.on('close', code => resolve(code)))
    ws.on('message', d => got.push(JSON.parse(String(d)).type))
    await new Promise(resolve => ws.once('message', resolve))
    await own.app.close()
    expect(await closed).toBe(1001)
    expect(got).toEqual(['hello', 'bye'])
  })
})
