// SPDX-License-Identifier: AGPL-3.0-or-later
// Status line con el saldo y toast con el resultado, que llega cuando la ventana ya lo ha
// enseñado (`revealAt`): nunca se destripa la tirada antes de tiempo.
import { describe, expect, test } from 'claude-code/testing'

import { phrasesEn } from '../hooks/generated/phrases.en.ts'
import { phrasesEs } from '../hooks/generated/phrases.es.ts'
import { formatCoins, phraseCategory, pickFilledPhrase, resultToast } from '../hooks/lib/format.ts'
import { MESSAGES, localeFromEnv } from '../hooks/lib/messages.ts'
import {
  LOGGED_IN,
  TEST_OPTIONS,
  happyCasino,
  meReply,
  playTurn,
  resolvedReply,
  startSession,
  wallet,
  world,
} from './support/harness.ts'

test(
  'session start puts the balance in the status line',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/me': meReply({ wallet: wallet({ balance: 4321, debt: 1000 }) }) },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect(w.lastStatus()).toBe('🎰 4,321 🪙 · debt 1,000')
  },
)

test(
  'the result toast waits for the reveal, then shows number, colour, net and a phrase',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
    await startSession($, w)
    const before = w.lastStatus()
    await playTurn($, w)
    // revealAt - resolvedAt = 4 s: nada antes.
    expect(w.toasts).toEqual([])
    expect(w.lastStatus()).toBe(before)
    await w.clock.advance(3_999)
    expect(w.toasts).toEqual([])
    await w.clock.advance(1)
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]).toStartWith('🎰 17 ⚫ black · +100 🪙 · “')
    expect(phrasesEn.win.some(phrase => w.toasts[0]!.includes(phrase))).toBe(true)
    expect(w.lastStatus()).toBe('🎰 1,100 🪙')
  },
)

test(
  'the reveal delay is capped by revealMaxDelayMs',
  { options: { ...TEST_OPTIONS, revealMaxDelayMs: 1000 } },
  async ($, on) => {
    const w = world(on, {
      routes: {
        ...happyCasino(true),
        '/api/turn/end': resolvedReply({ revealAt: '2026-10-13T00:00:00.000Z' }),
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await playTurn($, w)
    await w.clock.advance(1000)
    expect(w.toasts).toHaveLength(1)
  },
)

test('jackpot and Spanish', { options: { ...TEST_OPTIONS, language: 'es' } }, async ($, on) => {
  const w = world(on, {
    routes: {
      ...happyCasino(true),
      '/api/turn/end': resolvedReply(
        { result: 3, color: 'red', net: 3400, jackpot: true, gitPushOk: true },
        { balance: 4500 },
      ),
    },
    store: LOGGED_IN,
  })
  await startSession($, w)
  await playTurn($, w)
  await w.clock.advance(4_000)
  expect(w.toasts[0]).toStartWith('🎰 3 🔴 rojo · +3.400 🪙 · 🚀 JACKPOT · “')
  expect(w.lastStatus()).toBe('🎰 4.500 🪙')
})

test('no round to resolve: only the status changes', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, {
    routes: {
      ...happyCasino(true),
      '/api/turn/end': { json: { v: 1, status: 'no_round', wallet: wallet({ balance: 77 }) } },
    },
    store: LOGGED_IN,
  })
  await startSession($, w)
  await playTurn($, w)
  await w.clock.advance(10_000)
  expect(w.toasts).toEqual([])
  expect(w.lastStatus()).toBe('🎰 77 🪙')
})

describe('formatting', () => {
  const round = {
    result: 0,
    color: 'green' as const,
    net: -100,
    staked: 100,
    jackpot: false,
    testFailed: false,
    source: 'slip',
    bets: [{ selection: { kind: 'red' }, won: false }],
    resolvedAt: '2026-10-12T20:00:02.000Z',
    revealAt: '2026-10-12T20:00:06.000Z',
  }
  const w = { balance: 900, debt: 0, netWorth: 900, spins: 1 }

  test('coins', () => {
    expect(formatCoins(1234567, 'en')).toBe('1,234,567')
    expect(formatCoins(-1234, 'es')).toBe('−1.234')
    expect(formatCoins(50, 'en', true)).toBe('+50')
    expect(formatCoins(0, 'en', true)).toBe('0')
  })

  test('phrase categories', () => {
    expect(phraseCategory(round, w)).toBe('zero')
    expect(phraseCategory({ ...round, result: 5, color: 'red' }, w)).toBe('lose')
    expect(phraseCategory({ ...round, testFailed: true }, w)).toBe('testFailed')
    expect(phraseCategory({ ...round, source: 'none', staked: 0, net: 0 }, w)).toBe('noBet')
    expect(phraseCategory({ ...round, result: 5 }, { ...w, balance: 0, netWorth: -500 })).toBe(
      'broke',
    )
    expect(phraseCategory({ ...round, result: 5 }, { ...w, balance: 0, netWorth: 0 })).toBe(
      'bigLoss',
    )
    expect(
      phraseCategory(
        { ...round, net: 3500, bets: [{ selection: { kind: 'straight' }, won: true }] },
        w,
      ),
    ).toBe('bigWin')
    expect(phraseCategory({ ...round, net: 0, source: 'slip' }, w)).toBeNull()
  })

  test('templates with markers the mod cannot fill are skipped', () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickFilledPhrase(phrasesEs, 'broke', { color: 'rojo' }, null, Math.random)
      expect(picked?.text).not.toContain('{')
    }
    expect(pickFilledPhrase(phrasesEn, 'streakWarning', {}, null)).toBeNull()
  })

  test('the phrase never repeats twice in a row', () => {
    let previous: string | null = null
    for (let i = 0; i < 100; i++) {
      const shown = resultToast(round, w, 'en', MESSAGES.en, previous)
      expect(shown.phrase).not.toBe(previous)
      previous = shown.phrase
    }
  })

  test('locale from the system', () => {
    expect(localeFromEnv([undefined, undefined, 'es_ES.UTF-8'])).toBe('es')
    expect(localeFromEnv(['es', undefined])).toBe('es')
    expect(localeFromEnv(['C', 'es_AR'])).toBe('es')
    expect(localeFromEnv(['en_GB.UTF-8', 'es_ES'])).toBe('en')
    expect(localeFromEnv(['estonian?'])).toBe('en')
    expect(localeFromEnv([])).toBe('en')
  })
})
