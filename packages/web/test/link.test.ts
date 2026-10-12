// SPDX-License-Identifier: AGPL-3.0-or-later
import { WS_CLOSE_CODES } from '@vibe-gambling/shared'
import type { ServerMessage } from '@vibe-gambling/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WsLink, withVersion } from '../src/net/link.ts'
import type { LinkStatus } from '../src/net/link.ts'

/** WebSocket de mentira: registra lo enviado y deja disparar eventos desde el test. */
class FakeSocket {
  static readonly OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  sent: unknown[] = []
  closed: { code: number; reason: string } | null = null
  private readonly listeners = new Map<string, ((e: unknown) => void)[]>()
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  emit(type: string, event: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(event)
  }
  open() {
    this.readyState = FakeSocket.OPEN
    this.emit('open')
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code = 1000, reason = '') {
    this.closed = { code, reason }
    this.readyState = 3
    this.emit('close', { code })
  }
}

const cfg = {
  pingIntervalMs: 1000,
  pongTimeoutMs: 300,
  reconnect: { baseMs: 100, maxMs: 400, jitter: 0 },
}

describe('cliente WebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function connect() {
    const link = new WsLink('ws://test.invalid/ws', cfg)
    const statuses: LinkStatus[] = []
    const messages: ServerMessage[] = []
    link.onStatus(s => statuses.push(s))
    link.onMessage(m => messages.push(m))
    link.start()
    link.start()
    return { link, statuses, messages }
  }

  it('conecta, valida mensajes, hace ping y reconecta con backoff y sync', () => {
    const { link, statuses, messages } = connect()
    expect(FakeSocket.instances).toHaveLength(1)
    expect(link.send(withVersion({ type: 'sync' }))).toBe(false)
    const first = FakeSocket.instances[0]!
    first.open()
    expect(statuses).toEqual(['connecting', 'open'])
    first.emit('message', { data: JSON.stringify({ v: 1, type: 'pong', t: 1 }) })
    first.emit('message', { data: '{"v":1,"type":"desconocido"}' })
    expect(messages).toEqual([{ v: 1, type: 'pong', t: 1 }])
    // Ping de aplicación cada pingIntervalMs.
    vi.advanceTimersByTime(1000)
    expect(first.sent).toContainEqual(expect.objectContaining({ type: 'ping' }))
    // Sin respuesta: se cierra y se reintenta tras el backoff.
    vi.advanceTimersByTime(300)
    expect(first.closed?.code).toBe(4000)
    expect(statuses.at(-1)).toBe('reconnecting')
    vi.advanceTimersByTime(100)
    const second = FakeSocket.instances[1]!
    second.open()
    // Al reconectar se pide el estado completo.
    expect(second.sent[0]).toEqual({ v: 1, type: 'sync' })
    // Mensajes fuera de contrato no salen.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(link.send({ v: 1, type: 'bet.place' } as never)).toBe(false)
    expect(link.send(withVersion({ type: 'bet.clear' }))).toBe(true)
    link.stop()
    expect(second.closed?.code).toBe(1000)
  })

  it('con la red muerta (el close no llega), el ping sin respuesta reconecta igual', () => {
    const { statuses } = connect()
    const first = FakeSocket.instances[0]!
    // Un socket "colgado": close() no dispara el evento (como con la red caída).
    first.close = (code = 1000, reason = '') => {
      first.closed = { code, reason }
    }
    first.open()
    vi.advanceTimersByTime(1000 + 300)
    expect(first.closed?.code).toBe(4000)
    expect(statuses.at(-1)).toBe('reconnecting')
    vi.advanceTimersByTime(100)
    const second = FakeSocket.instances[1]!
    second.open()
    expect(second.sent[0]).toEqual({ v: 1, type: 'sync' })
    // El close tardío del socket viejo no rompe la conexión nueva (ni sus pings).
    first.emit('close', { code: 1006 })
    expect(statuses.at(-1)).toBe('open')
    vi.advanceTimersByTime(1000)
    expect(second.sent).toContainEqual(expect.objectContaining({ type: 'ping' }))
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('sin sesión, origen prohibido o sesión terminada: no reintenta', () => {
    for (const [code, expected] of [
      [WS_CLOSE_CODES.unauthorized, 'unauthorized'],
      [WS_CLOSE_CODES.forbiddenOrigin, 'refused'],
      [WS_CLOSE_CODES.tooManyConnections, 'refused'],
      [WS_CLOSE_CODES.sessionEnded, 'ended'],
    ] as const) {
      FakeSocket.instances = []
      const { statuses } = connect()
      FakeSocket.instances[0]!.emit('close', { code })
      vi.advanceTimersByTime(10_000)
      expect(statuses.at(-1)).toBe(expected)
      expect(FakeSocket.instances).toHaveLength(1)
    }
  })

  it('tras un "bye" de logout no vuelve a conectar; tras un apagado, sí', () => {
    const { statuses } = connect()
    const s = FakeSocket.instances[0]!
    s.open()
    s.emit('message', { data: JSON.stringify({ v: 1, type: 'bye', reason: 'logout' }) })
    s.emit('close', { code: 1000 })
    expect(statuses.at(-1)).toBe('ended')

    FakeSocket.instances = []
    connect()
    const t = FakeSocket.instances[0]!
    t.open()
    t.emit('message', { data: JSON.stringify({ v: 1, type: 'bye', reason: 'shutdown' }) })
    t.emit('close', { code: 1001 })
    vi.advanceTimersByTime(100)
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('si el constructor del WebSocket falla, reintenta', () => {
    let fail = true
    vi.stubGlobal(
      'WebSocket',
      class extends FakeSocket {
        constructor(url: string) {
          if (fail) {
            fail = false
            throw new Error('boom')
          }
          super(url)
        }
      },
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    connect()
    vi.advanceTimersByTime(100)
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
