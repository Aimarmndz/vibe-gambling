// SPDX-License-Identifier: AGPL-3.0-or-later
// `/vibe-invite` (`/vibe-invitar`) y `/vibe-redeem` (`/vibe-canjear`): el Programa de Afiliados
// Piramidal (legalmente distinto).
import { expect, test } from 'claude-code/testing'

import {
  LOGGED_IN,
  SERVER,
  TEST_OPTIONS,
  TOKEN,
  command,
  startSession,
  wallet,
  world,
} from './support/harness.ts'
import type { SentRequest } from './support/harness.ts'

function referralReply(overrides: Record<string, unknown> = {}) {
  return {
    json: {
      v: 1,
      referral: {
        code: 'ABCD2345',
        url: `${SERVER}/r/ABCD2345`,
        invited: 4,
        activated: 2,
        waiting: 2,
        earned: 2000,
        season: { seasonId: '2026-10', commissions: 2, cap: 10 },
        invitedBy: null,
        canRedeem: true,
        redeemUntil: '2026-10-20T12:00:00.000Z',
        rules: {
          welcomeBonus: 500,
          commission: 1000,
          activationSpins: 50,
          redeemWindowDays: 7,
          redeemMaxSpins: 100,
          maxCommissionsPerSeason: 10,
          minAccountAgeDays: 30,
        },
        ...overrides,
      },
    },
  }
}

test(
  '/vibe-invite shows the link, the code, the pyramid stats and the rules',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: { '/api/referral': referralReply() }, store: LOGGED_IN })
    await startSession($, w)
    const { text } = await command($, 'vibe-invite')
    expect(text.split('\n')).toEqual([
      '🔺 Pyramid Affiliate Program (legally distinct)',
      `Your link: ${SERVER}/r/ABCD2345 · code ABCD2345`,
      'Invited 4 · activated 2 · waiting 2 · earned 2,000 🪙 · this season 2/10 commissions',
      'Your friend gets 500 🪙 by redeeming it with /vibe-redeem ABCD2345; you get 1,000 🪙 once they play 50 spins and their GitHub account is 30 days old. Invite 3 friends and stop having them.',
      'Did someone invite you? /vibe-redeem <code> before Oct 20, 2026 and get 500 🪙.',
    ])
    const [request] = w.to('/api/referral')
    expect(request?.method).toBe('GET')
    expect(request?.rawBody).toBeUndefined()
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`)
  },
)

test(
  '/vibe-invitar en español; sin regla de edad y ya canjeado',
  { options: { ...TEST_OPTIONS, language: 'auto' } },
  async ($, on) => {
    const reply = referralReply({
      canRedeem: false,
      invitedBy: { redeemedAt: '2026-10-10T12:00:00.000Z', bonus: 500, activated: false },
    })
    const rules = (reply.json.referral as { rules: object }).rules
    reply.json.referral = { ...reply.json.referral, rules: { ...rules, minAccountAgeDays: 0 } }
    const w = world(on, {
      routes: { '/api/referral': reply },
      store: LOGGED_IN,
      env: { LANG: 'es_ES.UTF-8' },
    })
    await startSession($, w)
    const lines = (await command($, 'vibe-invitar')).text.split('\n')
    expect(lines[0]).toBe('🔺 Programa de Afiliados Piramidal (legalmente distinto)')
    expect(lines[3]).toBe(
      'Tu amigo cobra 500 🪙 al canjearlo con /vibe-redeem ABCD2345; tú, 1.000 🪙 cuando juegue 50 tiradas. Invita a 3 amigos y deja de tenerlos.',
    )
    expect(lines[4]).toBe('Entraste por invitación: +500 🪙 de bienvenida.')
  },
)

test(
  '/vibe-invite never prints terminal escapes from a hostile server, and a bad reply is "offline"',
  { options: TEST_OPTIONS },
  async ($, on) => {
    let evil = true
    const w = world(on, {
      routes: {
        '/api/referral': () =>
          evil
            ? referralReply({ url: `${SERVER}/r/\u001b]52;c;cHduZWQ=\u0007ABCD2345` })
            : { json: { v: 1, referral: { code: 'x' } } },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    const { text } = await command($, 'vibe-invite')
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/)
    evil = false
    expect((await command($, 'vibe-invite')).text).toContain('casino is unreachable')
  },
)

test('/vibe-invite without a session asks to log in', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on)
  await startSession($, w)
  expect((await command($, 'vibe-invite')).text).toContain('/vibe-login')
  expect(w.requests).toHaveLength(0)
})

test(
  '/vibe-redeem normalizes the code (lowercase, dashes, the whole link) and shows the bonus',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/referral/redeem': {
          json: {
            v: 1,
            status: 'redeemed',
            bonus: 500,
            wallet: wallet({ balance: 1500, netWorth: 1500 }),
            inviter: {
              login: 'pyramid-boss',
              avatarUrl: 'https://avatars.test/p.png',
              profileUrl: 'https://github.test/pyramid-boss',
            },
          },
        },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    for (const raw of ['abcd-2345', `${SERVER}/r/abcd2345`]) {
      const { text } = await command($, 'vibe-redeem', raw)
      expect(text).toBe(
        "🔺 Code redeemed: +500 🪙 welcome bonus. Balance: 1,500. Welcome to @pyramid-boss's pyramid.",
      )
    }
    expect(w.to('/api/referral/redeem').map(r => r.body)).toEqual([
      { v: 1, code: 'ABCD2345' },
      { v: 1, code: 'ABCD2345' },
    ])
    expect(w.lastStatus()).toBe('🎰 1,500 🪙')
  },
)

test(
  '/vibe-redeem: usage, bad codes never reach the server, and every rejection has its text',
  { options: TEST_OPTIONS },
  async ($, on) => {
    let reason = 'not_found'
    const w = world(on, {
      routes: {
        '/api/referral/redeem': () => ({ json: { v: 1, status: 'rejected', reason } }),
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect((await command($, 'vibe-redeem')).text).toMatch(/^Usage: \/vibe-redeem <code>/)
    expect((await command($, 'vibe-redeem', 'OLIO1234')).text).toBe(
      '"OLIO1234" is not an affiliate code (8 letters and digits, no 0, 1, I, L, O or U).',
    )
    expect(w.to('/api/referral/redeem')).toHaveLength(0)
    const texts = new Map<string, string>()
    for (const r of [
      'not_found',
      'own_code',
      'already_redeemed',
      'cycle',
      'too_late',
      'too_many_spins',
    ]) {
      reason = r
      texts.set(r, (await command($, 'vibe-canjear', 'ZZZZ9999')).text)
    }
    expect(texts.get('own_code')).toContain('your own code')
    expect(texts.get('cycle')).toContain('joined with your code')
    expect(new Set(texts.values()).size).toBe(6)
  },
)

test(
  '/vibe-redeem with the inviter hidden does not name them; an expired session is cleared',
  { options: TEST_OPTIONS },
  async ($, on) => {
    let expired = false
    const w = world(on, {
      routes: {
        '/api/referral/redeem': (_request: SentRequest) =>
          expired
            ? { status: 401, json: { v: 1, error: 'unauthorized', message: 'no' } }
            : {
                json: {
                  v: 1,
                  status: 'redeemed',
                  bonus: 500,
                  wallet: wallet({ balance: 1500 }),
                  inviter: null,
                },
              },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect((await command($, 'vibe-redeem', 'ABCD2345')).text).toContain(
      'its top prefers to stay anonymous',
    )
    expired = true
    expect((await command($, 'vibe-redeem', 'ABCD2345')).text).toContain('/vibe-login')
  },
)
