// SPDX-License-Identifier: AGPL-3.0-or-later
// Hub de WebSockets con sockets falsos: orden de los mensajes, hello primero y despedidas.
import { EventEmitter } from 'node:events'

import { WS_CLOSE_CODES } from '@vibe-gambling/shared'
import type { ServerMessage } from '@vibe-gambling/shared'
import { describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'

import { Hub } from '../../src/ws/hub.ts'
import type { Connection } from '../../src/ws/hub.ts'

class FakeSocket extends EventEmitter {
  readonly OPEN = 1
  readyState = 1
  sent: ServerMessage[] = []
  closedWith: number | null = null
  pings = 0
  terminated = false
  send(data: string) {
    this.sent.push(JSON.parse(data) as ServerMessage)
  }
  close(code: number) {
    this.closedWith = code
    this.readyState = 3
  }
  ping() {
    this.pings++
  }
  terminate() {
    this.terminated = true
  }
}

const logger = { warn: vi.fn(), error: vi.fn() }
const ROUND = '00000000-0000-4000-8000-000000000001'
const OPENED = '2026-10-15T12:00:00.000Z'

function conn(userId = 'u1', sessionId = 's1', ready = true) {
  const socket = new FakeSocket()
  const c: Connection = {
    socket: socket as unknown as WebSocket,
    userId,
    sessionId,
    alive: true,
    pending: ready ? null : [],
  }
  return { socket, c }
}

const started: ServerMessage = {
  v: 1,
  type: 'round.started',
  round: { roundId: ROUND, openedAt: OPENED },
}
const resolved = {
  v: 1,
  type: 'round.resolved',
  round: {
    roundId: ROUND,
    openedAt: OPENED,
    resolvedAt: OPENED,
    result: 0,
    color: 'green',
    bets: [],
    source: 'none',
    staked: 0,
    returned: 0,
    net: 0,
    jackpot: false,
    gitPushOk: false,
    testFailed: false,
    interestCharged: 0,
    colorStreak: null,
    revealAt: OPENED,
  },
  wallet: {
    seasonId: '2026-10',
    balance: 1,
    debt: 0,
    netWorth: 1,
    spins: 1,
    loans: 0,
    currentStreak: 0,
    bestStreak: 0,
  },
} satisfies ServerMessage

describe('Hub', () => {
  it('difunde a todas las ventanas del usuario y sabe quién está conectado', () => {
    const hub = new Hub(logger)
    const a = conn('u1')
    const b = conn('u1', 's2')
    const other = conn('u2')
    for (const x of [a, b, other]) hub.add(x.c)
    expect(hub.isConnected('u1')).toBe(true)
    expect(hub.count('u1')).toBe(2)
    expect(hub.connectedUsers().sort()).toEqual(['u1', 'u2'])
    hub.send('u1', started)
    expect(a.socket.sent).toEqual([started])
    expect(b.socket.sent).toEqual([started])
    expect(other.socket.sent).toEqual([])
    hub.remove(a.c)
    hub.remove(b.c)
    expect(hub.isConnected('u1')).toBe(false)
    expect(hub.size).toBe(1)
  })

  it('hasta el hello, los avisos esperan; luego salen en orden', () => {
    const hub = new Hub(logger)
    const { socket, c } = conn('u1', 's1', false)
    hub.add(c)
    hub.send('u1', started)
    expect(socket.sent).toEqual([])
    hub.sendTo(c, { v: 1, type: 'pong', t: 1 })
    hub.ready(c)
    expect(socket.sent.map(m => m.type)).toEqual(['round.started', 'pong'])
  })

  it('descarta un round.started que llega después de su round.resolved', () => {
    const hub = new Hub(logger)
    const { socket, c } = conn()
    hub.add(c)
    hub.send('u1', resolved)
    hub.send('u1', started)
    expect(socket.sent.map(m => m.type)).toEqual(['round.resolved'])
  })

  it('no manda mensajes que no cumplen el protocolo', () => {
    const hub = new Hub(logger)
    const { socket, c } = conn()
    hub.add(c)
    hub.send('u1', { v: 1, type: 'pong', t: -5 })
    expect(socket.sent).toEqual([])
    expect(logger.error).toHaveBeenCalled()
  })

  it('cierra por sesión o por usuario con bye y 4410', () => {
    const hub = new Hub(logger)
    const a = conn('u1', 's1')
    const b = conn('u1', 's2')
    hub.add(a.c)
    hub.add(b.c)
    hub.closeSession('s1', 'logout')
    expect(a.socket.sent).toEqual([{ v: 1, type: 'bye', reason: 'logout' }])
    expect(a.socket.closedWith).toBe(WS_CLOSE_CODES.sessionEnded)
    expect(b.socket.closedWith).toBeNull()
    hub.closeUser('u1', 'account_deleted')
    expect(b.socket.sent.at(-1)).toEqual({ v: 1, type: 'bye', reason: 'account_deleted' })
    expect(hub.isConnected('u1')).toBe(false)
  })

  it('ping periódico: termina las conexiones que no contestan', () => {
    vi.useFakeTimers()
    try {
      const hub = new Hub(logger)
      const { socket, c } = conn()
      hub.add(c)
      hub.startPing(1000)
      vi.advanceTimersByTime(1000)
      expect(socket.pings).toBe(1)
      expect(c.alive).toBe(false)
      vi.advanceTimersByTime(1000)
      expect(socket.terminated).toBe(true)
      hub.shutdown()
    } finally {
      vi.useRealTimers()
    }
  })

  it('el apagado despide a todos con bye shutdown y 1001', () => {
    const hub = new Hub(logger)
    const { socket, c } = conn()
    hub.add(c)
    hub.shutdown()
    expect(socket.sent).toEqual([{ v: 1, type: 'bye', reason: 'shutdown' }])
    expect(socket.closedWith).toBe(1001)
    expect(hub.size).toBe(0)
  })
})
