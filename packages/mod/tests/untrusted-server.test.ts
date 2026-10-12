// SPDX-License-Identifier: AGPL-3.0-or-later
// Un servidor (self-host) comprometido o roto no manda en el terminal ni en el login: el texto
// que llega de él se limpia antes de enseñarlo (sin secuencias de escape ni caracteres de
// control) y un login que el servidor rechaza para siempre no se queda consultando en silencio.
import { expect, test } from 'claude-code/testing'

import {
  LOGGED_IN,
  SERVER,
  SESSION_KEY,
  TEST_OPTIONS,
  command,
  meReply,
  startSession,
  world,
} from './support/harness.ts'

const ESC = '\u001b'
const BEL = '\u0007'
/** OSC 52 (escribir en el portapapeles), borrar la pantalla y un override bidi. */
const NASTY = `${ESC}]52;c;cm0gLXJmIH4=${BEL}${ESC}[2J\u202e\u0000`
const POLL_ID = 'P'.repeat(43)

/** ¿Queda algún carácter de control o de formato bidi en lo que se enseña? */
function hasControl(text: string | undefined): boolean {
  return /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(text ?? '')
}

const user = (meReply().json as { user: Record<string, unknown> }).user

test(
  'escape sequences in the device code, URL and login never reach the terminal',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/auth/device/start': {
          json: {
            v: 1,
            pollId: POLL_ID,
            userCode: `WDJB${NASTY}`,
            verificationUri: `https://github.test/login/device${NASTY}`,
            expiresIn: 900,
            interval: 5,
          },
        },
        '/api/auth/device/poll': {
          json: {
            v: 1,
            status: 'ok',
            token: 'N'.repeat(43),
            user: { ...user, login: `octo${NASTY}cat` },
            isNew: true,
          },
        },
        '/api/me': meReply(),
      },
    })
    await startSession($, w)
    const { text } = await command($, 'vibe-login')
    expect(hasControl(text), JSON.stringify(text)).toBe(false)
    expect(text).toContain('WDJB')
    expect(text).toContain('https://github.test/login/device')
    await w.clock.advance(5_000)
    for (const toast of w.toasts) expect(hasControl(toast), JSON.stringify(toast)).toBe(false)
    const saved = w.store.get(SESSION_KEY) as { login: string }
    expect(hasControl(saved.login)).toBe(false)
    expect(hasControl((await command($, 'vibe-login')).text)).toBe(false)
  },
)

test(
  'a verification URL that is not http(s) is refused, never shown',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/auth/device/start': {
          json: {
            v: 1,
            pollId: POLL_ID,
            userCode: 'WDJB-MJHT',
            verificationUri: 'javascript:alert(1)',
            expiresIn: 900,
            interval: 5,
          },
        },
      },
    })
    await startSession($, w)
    const { text } = await command($, 'vibe-login')
    expect(text).not.toContain('javascript:')
    expect(text).toContain('casino is unreachable')
    expect(w.to('/api/auth/device/poll')).toHaveLength(0)
  },
)

test(
  'the server name and its error messages are cleaned too',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      store: LOGGED_IN,
      routes: {
        '/api/meta': {
          json: {
            v: 1,
            protocol: 1,
            name: `Evil${NASTY}Casino`,
            isOfficial: false,
            serverVersion: '1',
            publicUrl: SERVER,
          },
        },
        '/api/me/settings': {
          status: 500,
          json: { v: 1, error: 'internal', message: `boom${NASTY}` },
        },
      },
    })
    await startSession($, w)
    const server = await command($, 'vibe-server')
    expect(hasControl(server.text), JSON.stringify(server.text)).toBe(false)
    expect(server.text).toContain('EvilCasino')
    const hide = await command($, 'vibe-hide')
    expect(hasControl(hide.text), JSON.stringify(hide.text)).toBe(false)
    expect(hide.text).toContain('boom')
  },
)

test(
  'a poll the server keeps refusing ends the login and says why',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/auth/device/start': {
          json: {
            v: 1,
            pollId: POLL_ID,
            userCode: 'WDJB-MJHT',
            verificationUri: 'https://github.test/login/device',
            expiresIn: 900,
            interval: 5,
          },
        },
        '/api/auth/device/poll': {
          status: 400,
          json: { v: 1, error: 'protocol_mismatch', message: 'update the mod' },
        },
      },
    })
    await startSession($, w)
    await command($, 'vibe-login')
    await w.clock.advance(5_000)
    expect(w.toasts.at(-1)).toContain('update the mod')
    await w.clock.advance(900_000)
    expect(w.to('/api/auth/device/poll')).toHaveLength(1)
  },
)

test(
  'rate limiting (429) is not fatal: polling goes on at the next interval',
  { options: TEST_OPTIONS },
  async ($, on) => {
    let calls = 0
    const w = world(on, {
      routes: {
        '/api/auth/device/start': {
          json: {
            v: 1,
            pollId: POLL_ID,
            userCode: 'WDJB-MJHT',
            verificationUri: 'https://github.test/login/device',
            expiresIn: 900,
            interval: 5,
          },
        },
        '/api/auth/device/poll': () =>
          ++calls === 1
            ? { status: 429, json: { v: 1, error: 'rate_limited', message: 'slow down' } }
            : { json: { v: 1, status: 'pending', interval: 5 } },
      },
    })
    await startSession($, w)
    await command($, 'vibe-login')
    await w.clock.advance(10_000)
    expect(w.to('/api/auth/device/poll')).toHaveLength(2)
    expect(w.toasts).toEqual([])
  },
)

test(
  'an absurd poll interval never outlives the code: expiry is announced on time',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/auth/device/start': {
          json: {
            v: 1,
            pollId: POLL_ID,
            userCode: 'WDJB-MJHT',
            verificationUri: 'https://github.test/login/device',
            expiresIn: 60,
            interval: 1_000_000_000,
          },
        },
      },
    })
    await startSession($, w)
    await command($, 'vibe-login')
    await w.clock.advance(60_000)
    expect(w.toasts.at(-1)).toBe('The login code expired. Run /vibe-login to get a new one.')
    expect(w.to('/api/auth/device/poll')).toHaveLength(0)
  },
)
