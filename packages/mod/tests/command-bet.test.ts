// SPDX-License-Identifier: AGPL-3.0-or-later
// `/bet` (`/apostar`) y `/all-in`: validan la entrada y mandan la casilla como texto.
import { describe, expect, test } from 'claude-code/testing'

import { parseBetAmount } from '../hooks/lib/payloads.ts'
import { LOGGED_IN, TEST_OPTIONS, startSession, wallet, world, command } from './support/harness.ts'
import type { SentRequest } from './support/harness.ts'

const betReply = (request: SentRequest) => {
  const body = request.body as { amount: number | 'all-in' }
  const staked = body.amount === 'all-in' ? 1000 : body.amount
  return {
    json: {
      v: 1,
      slip: { bets: [], total: staked },
      wallet: wallet({ balance: 1000 - staked, netWorth: 1000 - staked }),
      forRound: 'next',
    },
  }
}

describe('parseBetAmount', () => {
  test('accepts whole positive amounts and all-in words', () => {
    expect(parseBetAmount('200')).toBe(200)
    expect(parseBetAmount('1_000')).toBe(1000)
    expect(parseBetAmount('ALL-IN')).toBe('all-in')
    expect(parseBetAmount('todo')).toBe('all-in')
  })
  test('thousands separators only in groups of three, never as a decimal point', () => {
    expect(parseBetAmount('1.000')).toBe(1000)
    expect(parseBetAmount('1,000,000')).toBe(1_000_000)
    expect(parseBetAmount('10_000')).toBe(10_000)
    // "1.5" no son 15 monedas: es un decimal, y aquí solo hay monedas enteras.
    for (const raw of ['1.5', '0.5', '1,5', '12.34', '1.00.0', '1..000', '.100', '100.', '1_0']) {
      expect(parseBetAmount(raw), raw).toBeNull()
    }
  })
  test('rejects the rest', () => {
    for (const raw of ['0', '-5', '1.5e3', 'abc', '', '9999999999999999', '12abc']) {
      expect(parseBetAmount(raw), raw).toBeNull()
    }
  })
})

test('/bet sends the amount and the square as typed', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: { '/api/bet': betReply }, store: LOGGED_IN })
  await startSession($, w)
  const { text } = await command($, 'bet', '200 red')

  expect(text).toBe('🎰 200 🪙 on red (next spin). Balance: 800.')
  expect(w.to('/api/bet').map(request => request.body)).toEqual([
    { v: 1, amount: 200, target: 'red' },
  ])
  expect(w.lastStatus()).toBe('🎰 800 🪙')
})

test(
  '/apostar is the Spanish alias and keeps multi-number squares',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: { '/api/bet': betReply }, store: LOGGED_IN })
    await startSession($, w)
    await command($, 'apostar', '50 8 9 11 12')
    expect(w.to('/api/bet')[0]?.body).toEqual({ v: 1, amount: 50, target: '8 9 11 12' })
  },
)

test(
  '/bet rejects bad input without calling the server',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: { '/api/bet': betReply }, store: LOGGED_IN })
    await startSession($, w)
    expect((await command($, 'bet')).text).toContain('Usage: /bet <amount> <square>')
    expect((await command($, 'bet', '200')).text).toContain('Usage')
    expect((await command($, 'bet', 'lots red')).text).toBe(
      '"lots" is not an amount. Whole fake coins only (or "all-in"). Fractional ruin is not supported.',
    )
    expect((await command($, 'bet', `10 ${'x'.repeat(40)}`)).text).toContain(
      'too long to be a square',
    )
    expect(w.to('/api/bet')).toHaveLength(0)
  },
)

test('/bet explains what the server refused', { options: TEST_OPTIONS }, async ($, on) => {
  const refusal = (error: string) => ({ status: 400, json: { v: 1, error, message: 'no' } })
  let next = 'insufficient_funds'
  const w = world(on, { routes: { '/api/bet': () => refusal(next) }, store: LOGGED_IN })
  await startSession($, w)
  expect((await command($, 'bet', '5000 red')).text).toContain('Not enough fake coins')
  next = 'invalid_bet'
  expect((await command($, 'bet', '10 purple')).text).toBe(
    '"purple" is not a square on this table. Try a number, a colour or a dozen.',
  )
  next = 'too_many_bets'
  expect((await command($, 'bet', '10 red')).text).toContain('Too many chips')
})

test('/bet needs a session', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on)
  await startSession($, w)
  expect((await command($, 'bet', '10 red')).text).toBe(
    "You're not logged in. Run /vibe-login first. No seat, no spin.",
  )
  expect(w.requests).toHaveLength(0)
})

test(
  '/all-in bets everything on red by default, or on the given square',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: { '/api/bet': betReply }, store: LOGGED_IN })
    await startSession($, w)
    const { text } = await command($, 'all-in')
    expect(text).toBe('🎰 ALL-IN on red (next spin). Balance: 0.')
    await command($, 'all-in', 'black')
    expect(w.to('/api/bet').map(request => request.body)).toEqual([
      { v: 1, amount: 'all-in', target: 'red' },
      { v: 1, amount: 'all-in', target: 'black' },
    ])
  },
)
