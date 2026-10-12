// SPDX-License-Identifier: AGPL-3.0-or-later
// Configuración: `serverUrl` y el resto salen de las opciones del plugin; si no valen, el mod
// lo dice y no hace nada (nunca se inventa un valor).
import { describe, expect, test } from 'claude-code/testing'

import { normalizeServerUrl, parseConfig } from '../hooks/lib/config.ts'
import {
  TEST_OPTIONS,
  happyCasino,
  playTurn,
  startSession,
  world,
  command,
} from './support/harness.ts'

describe('parseConfig', () => {
  test('accepts the test options', () => {
    const parsed = parseConfig(TEST_OPTIONS)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.config.windowSize).toEqual({ width: 800, height: 600 })
  })

  test('the turn timeout can never exceed 1.5 s', () => {
    const parsed = parseConfig({ ...TEST_OPTIONS, turnTimeoutMs: 5000 })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join()).toContain('turnTimeoutMs')
  })

  test('reports every bad or missing field', () => {
    const parsed = parseConfig({ serverUrl: 'gopher://x', windowSize: 'big', language: 'fr' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      const text = parsed.errors.join('\n')
      for (const field of ['serverUrl', 'autoOpen', 'windowSize', 'language', 'commandTimeoutMs']) {
        expect(text).toContain(field)
      }
    }
  })

  test('normalizes server URLs', () => {
    expect(normalizeServerUrl(' https://Vibe.Example.test/ ')).toBe('https://vibe.example.test')
    expect(normalizeServerUrl('http://localhost:8787')).toBe('http://localhost:8787')
    expect(normalizeServerUrl('https://example.test/casino/')).toBe('https://example.test/casino')
    expect(normalizeServerUrl('https://user:pw@example.test')).toBeNull()
    expect(normalizeServerUrl('https://example.test/#x')).toBeNull()
    expect(normalizeServerUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeServerUrl('not a url')).toBeNull()
  })

  test('plain http only for loopback addresses', () => {
    expect(normalizeServerUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
    expect(normalizeServerUrl('http://[::1]:8787')).toBe('http://[::1]:8787')
    expect(normalizeServerUrl('http://dev.localhost')).toBe('http://dev.localhost')
    expect(normalizeServerUrl('http://vibe.example.test')).toBeNull()
    expect(normalizeServerUrl('http://localhost.evil.test')).toBeNull()
    expect(normalizeServerUrl('http://192.168.1.2')).toBeNull()
    const parsed = parseConfig({ ...TEST_OPTIONS, serverUrl: 'http://vibe.example.test' })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join()).toContain('https')
  })
})

test(
  'every request goes to the configured serverUrl',
  { options: { ...TEST_OPTIONS, serverUrl: 'http://localhost:8787/' } },
  async ($, on) => {
    const w = world(on, {
      routes: happyCasino(true),
      store: { 'session:http://localhost:8787': { token: 'L'.repeat(43), login: 'local' } },
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.requests.length).toBeGreaterThan(0)
    for (const request of w.requests) expect(request.url).toStartWith('http://localhost:8787/api/')
    expect(w.to('/api/turn/start')[0]?.headers.authorization).toBe(`Bearer ${'L'.repeat(43)}`)
  },
)

test(
  'sessions are per server: another server starts logged out',
  { options: { ...TEST_OPTIONS, serverUrl: 'https://other.test' } },
  async ($, on) => {
    const w = world(on, {
      routes: happyCasino(true),
      store: { 'session:https://casino.test': { token: 'T'.repeat(43), login: 'octocat' } },
    })
    await startSession($, w)
    expect(w.lastStatus()).toBe('🎰 /vibe-login')
    await playTurn($, w)
    expect(w.requests).toHaveLength(0)
  },
)

test(
  'an invalid configuration keeps the mod quiet and says why',
  { options: { ...TEST_OPTIONS, serverUrl: 'nope' } },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(true) })
    await startSession($, w)
    expect(w.lastStatus()).toBe('🎰 bad config')
    await playTurn($, w)
    expect(w.requests).toHaveLength(0)
    const { text } = await command($, 'balance')
    expect(text).toContain('vibe-gambling is misconfigured: serverUrl')
    expect(w.registered).toHaveLength(13)
  },
)
