// SPDX-License-Identifier: AGPL-3.0-or-later
// `/balance` (`/saldo`): saldo, deuda, patrimonio y puesto.
import { expect, test } from 'claude-code/testing'

import {
  LOGGED_IN,
  TEST_OPTIONS,
  meReply,
  startSession,
  wallet,
  world,
  command,
} from './support/harness.ts'

test(
  '/balance shows balance, debt, net worth and rank',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/me': meReply({
          wallet: wallet({ balance: 250, debt: 2040, netWorth: -1790 }),
          brokeRank: 7,
        }),
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    const { text } = await command($, 'balance')
    expect(text).toBe('🎰 Balance 250 · Debt 2,040 · Net worth −1,790 · #7')
    expect(w.lastStatus()).toBe('🎰 250 🪙 · debt 2,040')
  },
)

test(
  '/saldo speaks Spanish when the system does',
  { options: { ...TEST_OPTIONS, language: 'auto' } },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/me': meReply({ wallet: wallet({ balance: 12345 }), brokeRank: null }) },
      store: LOGGED_IN,
      env: { LANG: 'es_ES.UTF-8' },
    })
    await startSession($, w)
    const { text } = await command($, 'saldo')
    expect(text).toBe('🎰 Saldo 12.345 · Deuda 0 · Patrimonio 1.000 · aún sin puesto')
  },
)

test(
  '/balance speaks French with LANG=fr_FR.UTF-8 (narrow no-break space between thousands)',
  { options: { ...TEST_OPTIONS, language: 'auto' } },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/me': meReply({
          wallet: wallet({ balance: 12345, debt: 2040, netWorth: -1790 }),
          brokeRank: null,
        }),
      },
      store: LOGGED_IN,
      env: { LANG: 'fr_FR.UTF-8' },
    })
    await startSession($, w)
    const { text } = await command($, 'balance')
    expect(text).toBe(
      '🎰 Solde 12\u202f345 · Dette 2\u202f040 · Patrimoine −1\u202f790 · pas encore classé',
    )
    expect(w.lastStatus()).toBe('🎰 12\u202f345 🪙 · dette 2\u202f040')
  },
)

test(
  '/balance speaks German with LANG=de_DE.UTF-8',
  { options: { ...TEST_OPTIONS, language: 'auto' } },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/me': meReply({ wallet: wallet({ balance: 12345 }), brokeRank: 3 }) },
      store: LOGGED_IN,
      env: { LANG: 'de_DE.UTF-8' },
    })
    await startSession($, w)
    const { text } = await command($, 'balance')
    expect(text).toBe('🎰 Kontostand 12.345 · Schulden 0 · Vermögen 1.000 · #3')
  },
)

test(
  'an explicit language option wins over the system one',
  { options: { ...TEST_OPTIONS, language: 'de' } },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/me': meReply({ wallet: wallet({ balance: 5 }), brokeRank: null }) },
      store: LOGGED_IN,
      env: { LANG: 'fr_FR.UTF-8' },
    })
    await startSession($, w)
    expect((await command($, 'balance')).text).toContain('Kontostand 5')
  },
)

test(
  '/balance says when you are hidden from the leaderboard',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const hidden = meReply()
    const json = hidden.json as { user: Record<string, unknown> }
    const w = world(on, {
      routes: { '/api/me': { json: { ...json, user: { ...json.user, hidden: true } } } },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect((await command($, 'balance')).text).toContain('hidden from the leaderboard')
  },
)

test('/balance offline and logged out', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: { '/api/me': { fail: true } }, store: LOGGED_IN })
  await startSession($, w)
  expect((await command($, 'balance')).text).toContain('casino is unreachable')
})
