// SPDX-License-Identifier: AGPL-3.0-or-later
// Device Flow desde el mod: código en pantalla y consulta en segundo plano respetando
// `interval` y `slow_down` (pending → slow_down → ok), sin bloquear la sesión.
import { expect, test } from 'claude-code/testing'

import {
  LOGIN,
  SESSION_KEY,
  TEST_OPTIONS,
  meReply,
  startSession,
  world,
  command,
} from './support/harness.ts'
import type { Reply } from './support/harness.ts'

const POLL_ID = 'P'.repeat(43)
const NEW_TOKEN = 'N'.repeat(43)

const deviceStart: Reply = {
  json: {
    v: 1,
    pollId: POLL_ID,
    userCode: 'WDJB-MJHT',
    verificationUri: 'https://github.test/login/device',
    expiresIn: 900,
    interval: 5,
  },
}

const user = (meReply().json as { user: unknown }).user

function pollScript(answers: Reply[]) {
  return () => answers.shift() ?? { json: { v: 1, status: 'pending', interval: 5 } }
}

test(
  'pending → slow_down → ok, honouring each interval',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/auth/device/start': deviceStart,
        '/api/auth/device/poll': pollScript([
          { json: { v: 1, status: 'pending', interval: 5 } },
          { json: { v: 1, status: 'slow_down', interval: 10 } },
          { json: { v: 1, status: 'ok', token: NEW_TOKEN, user, isNew: true } },
        ]),
        '/api/me': meReply(),
      },
    })
    await startSession($, w)

    const { text } = await command($, 'vibe-login')
    expect(text).toBe(
      "🎰 Go to https://github.test/login/device and enter WDJB-MJHT. You have 15 min; I'll keep checking in the background.",
    )
    const polls = () => w.to('/api/auth/device/poll').length
    expect(polls()).toBe(0)

    await w.clock.advance(4_999)
    expect(polls()).toBe(0)
    await w.clock.advance(1) // t = 5 s → pending (interval 5)
    expect(polls()).toBe(1)
    await w.clock.advance(5_000) // t = 10 s → slow_down (interval 10)
    expect(polls()).toBe(2)
    await w.clock.advance(9_999)
    expect(polls()).toBe(2)
    await w.clock.advance(1) // t = 20 s → ok
    expect(polls()).toBe(3)

    expect(w.to('/api/auth/device/poll').map(request => request.body)).toEqual([
      { v: 1, pollId: POLL_ID },
      { v: 1, pollId: POLL_ID },
      { v: 1, pollId: POLL_ID },
    ])
    expect(w.store.get(SESSION_KEY)).toEqual({ token: NEW_TOKEN, login: LOGIN })
    expect(w.toasts.at(-1)).toContain(`Welcome to the table, @${LOGIN}`)
    expect(w.toasts.at(-1)).toContain('public leaderboard')
    expect(w.toasts.at(-1)).toContain('/vibe-hide')
    expect(w.lastStatus()).toBe('🎰 1,000 🪙')

    // Ya no se consulta más.
    await w.clock.advance(60_000)
    expect(polls()).toBe(3)
  },
)

test(
  'a network hiccup does not end the login; expiry does',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/auth/device/start': { json: { ...(deviceStart.json as object), expiresIn: 12 } },
        '/api/auth/device/poll': pollScript([{ fail: true }]),
      },
    })
    await startSession($, w)
    await command($, 'vibe-login')
    await w.clock.advance(5_000)
    await w.clock.advance(5_000)
    expect(w.to('/api/auth/device/poll')).toHaveLength(2)
    await w.clock.advance(5_000)
    expect(w.toasts.at(-1)).toBe('The login code expired. Run /vibe-login to get a new one.')
    await w.clock.advance(60_000)
    expect(w.to('/api/auth/device/poll')).toHaveLength(2)
  },
)

test('denied and expired answers stop the polling', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, {
    routes: {
      '/api/auth/device/start': deviceStart,
      '/api/auth/device/poll': pollScript([{ json: { v: 1, status: 'denied' } }]),
    },
  })
  await startSession($, w)
  await command($, 'vibe-login')
  await w.clock.advance(5_000)
  expect(w.toasts.at(-1)).toBe('GitHub login was cancelled. The table will wait.')
  await w.clock.advance(60_000)
  expect(w.to('/api/auth/device/poll')).toHaveLength(1)
})

test(
  'asking again while waiting shows the same code; logged in, it says so',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/auth/device/start': deviceStart,
        '/api/auth/device/poll': pollScript([
          { json: { v: 1, status: 'ok', token: NEW_TOKEN, user, isNew: false } },
        ]),
        '/api/me': meReply(),
      },
    })
    await startSession($, w)
    await command($, 'vibe-login')
    expect((await command($, 'vibe-login')).text).toBe(
      'Still waiting: go to https://github.test/login/device and enter WDJB-MJHT.',
    )
    expect(w.to('/api/auth/device/start')).toHaveLength(1)
    await w.clock.advance(5_000)
    expect((await command($, 'vibe-login')).text).toBe(
      `You're already logged in as @${LOGIN}. /vibe-logout first to switch.`,
    )
  },
)

test(
  'the first prompt without a session explains how to log in, once',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on)
    await startSession($, w)
    expect(w.lastStatus()).toBe('🎰 /vibe-login')
    await $.turn.start({ text: 'hello', turnId: 'a' })
    await w.clock.settle()
    await $.turn.start({ text: 'hello again', turnId: 'b' })
    await w.clock.settle()
    expect(w.toasts).toEqual([
      '🎰 Every prompt is a spin. Run /vibe-login to take a seat at the table.',
    ])
    expect(w.requests).toHaveLength(0)
  },
)

test('/vibe-login with the server down says so', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: { '/api/auth/device/start': { fail: true } } })
  await startSession($, w)
  expect((await command($, 'vibe-login')).text).toContain('casino is unreachable')
})

test(
  'two /vibe-login at once ask for a single code (the one being polled)',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/auth/device/start': { ...deviceStart, delayMs: 200 } },
    })
    await startSession($, w)
    const first = command($, 'vibe-login')
    const second = command($, 'vibe-login')
    await w.clock.advance(200)
    const texts = [(await first).text, (await second).text]
    expect(w.to('/api/auth/device/start')).toHaveLength(1)
    for (const text of texts) expect(text).toContain('WDJB-MJHT')
  },
)
