// SPDX-License-Identifier: AGPL-3.0-or-later
// `/vibe-logout`, `/vibe-hide`, `/vibe-show` y `/vibe-delete-account` (con confirmación).
import { expect, test } from 'claude-code/testing'

import {
  LOGGED_IN,
  LOGIN,
  SESSION_KEY,
  TEST_OPTIONS,
  TOKEN,
  meReply,
  startSession,
  world,
  command,
} from './support/harness.ts'
import type { SentRequest } from './support/harness.ts'

const settingsReply = (request: SentRequest) => {
  const user = (meReply().json as { user: Record<string, unknown> }).user
  return { json: { v: 1, user: { ...user, hidden: (request.body as { hidden: boolean }).hidden } } }
}

test(
  '/vibe-hide and /vibe-show change the leaderboard setting',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: { '/api/me/settings': settingsReply }, store: LOGGED_IN })
    await startSession($, w)
    expect((await command($, 'vibe-hide')).text).toContain("You're hidden")
    expect((await command($, 'vibe-show')).text).toContain('back on the leaderboard')
    expect(w.to('/api/me/settings').map(request => request.body)).toEqual([
      { v: 1, hidden: true },
      { v: 1, hidden: false },
    ])
    expect(w.to('/api/me/settings')[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
  },
)

test('/vibe-hide without a session asks to log in', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on)
  await startSession($, w)
  expect((await command($, 'vibe-hide')).text).toContain('/vibe-login')
  expect(w.requests).toHaveLength(0)
})

test(
  '/vibe-logout forgets the token even if the server is down',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: { '/api/auth/logout': { fail: true } }, store: LOGGED_IN })
    await startSession($, w)
    expect((await command($, 'vibe-logout')).text).toContain('Logged out')
    expect(w.to('/api/auth/logout')).toHaveLength(1)
    expect(w.store.get(SESSION_KEY)).toBeUndefined()
    expect(w.lastStatus()).toBe('🎰 /vibe-login')
    expect((await command($, 'vibe-logout')).text).toContain("weren't logged in")
  },
)

test(
  '/vibe-delete-account asks to repeat the login before deleting',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/me/delete': { json: { v: 1, ok: true } } },
      store: LOGGED_IN,
    })
    await startSession($, w)

    const asked = await command($, 'vibe-delete-account')
    expect(asked.text).toContain(`/vibe-delete-account ${LOGIN}`)
    const wrong = await command($, 'vibe-delete-account', 'someone-else')
    expect(wrong.text).toBe("That's not your login. Nothing was deleted.")
    expect(w.to('/api/me/delete')).toHaveLength(0)

    const done = await command($, 'vibe-delete-account', `@${LOGIN.toUpperCase()}`)
    expect(done.text).toContain('Account deleted')
    expect(w.to('/api/me/delete').map(request => request.body)).toEqual([{ v: 1, confirm: LOGIN }])
    expect(w.store.get(SESSION_KEY)).toBeUndefined()
  },
)

test(
  '/vibe-delete-account keeps the session if the server says no',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/me/delete': { status: 500, json: { v: 1, error: 'internal', message: 'boom' } },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    const { text } = await command($, 'vibe-delete-account', LOGIN)
    expect(text).toBe('The server said no: boom')
    expect(w.store.get(SESSION_KEY)).toEqual({ token: TOKEN, login: LOGIN })
  },
)

const UNAUTHORIZED = { status: 401, json: { v: 1, error: 'unauthorized', message: 'nope' } }

for (const [name, args] of [
  ['roulette', ''],
  ['bet', '50 red'],
  ['all-in', ''],
  ['balance', ''],
  ['vibe-hide', ''],
  ['vibe-show', ''],
  ['vibe-delete-account', LOGIN],
] as const) {
  test(
    `/${name} with a revoked session says so clearly and forgets the token`,
    { options: TEST_OPTIONS },
    async ($, on) => {
      const w = world(on, {
        routes: {
          '/api/auth/link': UNAUTHORIZED,
          '/api/bet': UNAUTHORIZED,
          '/api/me': UNAUTHORIZED,
          '/api/me/settings': UNAUTHORIZED,
          '/api/me/delete': UNAUTHORIZED,
          '/api/turn/start': UNAUTHORIZED,
        },
        store: LOGGED_IN,
        files: ['/usr/bin/chromium'],
      })
      // La sesión arranca sin pedir `/api/me` válido: el 401 llega con el comando.
      await startSession($, w)
      w.store.set(SESSION_KEY, { token: TOKEN, login: LOGIN })
      const { text } = await command($, name, args)
      expect(text).toBe('Your session expired. Run /vibe-login again.')
      expect(w.store.has(SESSION_KEY)).toBe(false)
      expect(w.lastStatus()).toBe('🎰 /vibe-login')
    },
  )
}

test(
  '/roulette with the server down says the casino is unreachable, not "no browser"',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/auth/link': { fail: true } },
      store: LOGGED_IN,
      files: ['/usr/bin/chromium'],
    })
    await startSession($, w)
    const { text } = await command($, 'roulette')
    expect(text).toContain('casino is unreachable')
    expect(w.runs.filter(argv => argv[0] !== 'uname')).toEqual([])
  },
)
