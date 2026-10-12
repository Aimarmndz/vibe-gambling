// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest'

import { clientConfig } from '../src/config.ts'
import {
  ApiError,
  fetchHallOfRuin,
  fetchLeaderboard,
  fetchMe,
  redeemCode,
  takeCodeFromUrl,
} from '../src/net/api.ts'
import { backoffDelay, parseServerMessage, withVersion, wsUrl } from '../src/net/link.ts'

const reconnect = { baseMs: 100, maxMs: 1000, jitter: 0.5 }

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('WebSocket', () => {
  it('el backoff dobla y tiene tope, con jitter acotado', () => {
    expect(backoffDelay(0, reconnect, () => 0.5)).toBe(100)
    expect(backoffDelay(1, reconnect, () => 0.5)).toBe(200)
    expect(backoffDelay(10, reconnect, () => 0.5)).toBe(1000)
    expect(backoffDelay(0, reconnect, () => 0)).toBe(50)
    expect(backoffDelay(0, reconnect, () => 0.999)).toBeLessThanOrEqual(150)
    expect(backoffDelay(99, clientConfig.ws.reconnect)).toBeLessThanOrEqual(
      clientConfig.ws.reconnect.maxMs * (1 + clientConfig.ws.reconnect.jitter),
    )
  })

  it('valida lo que llega y descarta lo que no cumple el contrato', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseServerMessage(JSON.stringify({ v: 1, type: 'pong', t: 5 }))).toEqual({
      v: 1,
      type: 'pong',
      t: 5,
    })
    expect(parseServerMessage('{no json')).toBeNull()
    expect(parseServerMessage(JSON.stringify({ v: 2, type: 'pong', t: 5 }))).toBeNull()
    expect(parseServerMessage(JSON.stringify({ v: 1, type: 'hack' }))).toBeNull()
    expect(parseServerMessage(new ArrayBuffer(2))).toBeNull()
    expect(warn).toHaveBeenCalledTimes(4)
    warn.mockRestore()
  })

  it('usa el mismo dominio (ws/wss) y pone la versión del protocolo', () => {
    expect(wsUrl({ protocol: 'https:', host: 'vibe.example' })).toBe('wss://vibe.example/ws')
    expect(wsUrl({ protocol: 'http:', host: 'localhost:8787' })).toBe('ws://localhost:8787/ws')
    expect(withVersion({ type: 'sync' })).toEqual({ v: 1, type: 'sync' })
  })
})

describe('API HTTP', () => {
  it('canjea el código y valida la respuesta', async () => {
    const user = {
      login: 'a',
      avatarUrl: 'https://x.invalid/a',
      profileUrl: 'https://x.invalid/a',
      hidden: false,
      locale: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    }
    const fetchImpl = vi.fn(async () => jsonResponse(200, { v: 1, user }))
    await expect(redeemCode('x'.repeat(43), fetchImpl)).resolves.toEqual({ v: 1, user })
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/api/auth/redeem')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ v: 1, code: 'x'.repeat(43) })
  })

  it('convierte los errores del servidor en ApiError con su código', async () => {
    const fail = async () => jsonResponse(410, { v: 1, error: 'not_found', message: 'gone' })
    await expect(redeemCode('c', fail)).rejects.toMatchObject({ status: 410, code: 'not_found' })
    const html = async () => new Response('<html>', { status: 502 })
    await expect(fetchMe(html)).rejects.toMatchObject({ status: 502, code: null })
    const off = async () => {
      throw new TypeError('offline')
    }
    await expect(fetchHallOfRuin(off)).rejects.toBeInstanceOf(ApiError)
    const weird = async () => jsonResponse(200, { nope: true })
    await expect(fetchLeaderboard({ board: 'broke', limit: 5 }, weird)).rejects.toThrow(/contrato/)
  })

  it('pide el ranking con su temporada y su límite', async () => {
    const body = {
      v: 1,
      season: '2026-10',
      board: 'rich',
      seasons: ['2026-10'],
      rows: [],
      players: 0,
    }
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL) => jsonResponse(200, body))
    await fetchLeaderboard({ board: 'rich', season: '2026-09', limit: 7 }, fetchImpl)
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/leaderboard?board=rich&limit=7&season=2026-09')
  })

  it('quita el código de la URL sin recargar', () => {
    const replace = vi.fn()
    const loc = { href: 'http://x.invalid/play?code=abc&demo#top' } as Location
    const hist = { state: null, replaceState: replace } as unknown as History
    expect(takeCodeFromUrl(loc, hist)).toBe('abc')
    expect(replace).toHaveBeenCalledWith(null, '', '/play?demo=#top')
    expect(takeCodeFromUrl({ href: 'http://x.invalid/play' } as Location, hist)).toBeNull()
  })
})

describe('URLs del servidor', () => {
  it('solo deja pasar http y https', async () => {
    const { webUrl } = await import('../src/net/urls.ts')
    expect(webUrl('https://avatars.githubusercontent.com/u/1?v=4')).toBe(
      'https://avatars.githubusercontent.com/u/1?v=4',
    )
    expect(webUrl('http://localhost:8788/avatars/1.svg')).toBe(
      'http://localhost:8788/avatars/1.svg',
    )
    for (const bad of [
      'javascript:alert(1)',
      'javascript://example.com/%0Aalert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript://x',
      'no es una url',
      '',
    ]) {
      expect(webUrl(bad), bad).toBeNull()
    }
  })
})
