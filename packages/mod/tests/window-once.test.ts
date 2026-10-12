// SPDX-License-Identifier: AGPL-3.0-or-later
// Abrir la ventana una sola vez: si no hay ventana conectada se abre, pero no se abre otra
// mientras la primera aún está conectando; `/roulette` sí fuerza otra.
import { expect, test } from 'claude-code/testing'

import {
  LOGGED_IN,
  SERVER,
  TEST_OPTIONS,
  happyCasino,
  playTurn,
  startSession,
  world,
  command,
} from './support/harness.ts'

const CHROME = '/usr/bin/google-chrome-stable'
const launches = (runs: string[][]) => runs.filter(argv => argv[0] !== 'uname')

test(
  'opens the window on the first prompt when none is connected',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(false), store: LOGGED_IN, files: [CHROME] })
    await startSession($, w)
    await playTurn($, w)

    expect(w.to('/api/turn/start')).toHaveLength(1)
    expect(w.to('/api/auth/link')).toHaveLength(1)
    expect(launches(w.runs)).toEqual([
      [
        'sh',
        '-c',
        '"$@" </dev/null >/dev/null 2>&1 &',
        'vibe-gambling',
        CHROME,
        `--app=${SERVER}/play?code=${'C'.repeat(43)}`,
        '--window-size=800,600',
      ],
    ])
  },
)

test(
  'does not open a second window while the first one is still connecting',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(false), store: LOGGED_IN, files: [CHROME] })
    await startSession($, w)
    await playTurn($, w)
    await w.clock.advance(5_000)
    await playTurn($, w)
    await w.clock.advance(5_000)
    await playTurn($, w)

    expect(w.to('/api/turn/start')).toHaveLength(3)
    expect(w.to('/api/auth/link')).toHaveLength(1)
    expect(launches(w.runs)).toHaveLength(1)
  },
)

test(
  'tries again once the cooldown has passed and the window never connected',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(false), store: LOGGED_IN, files: [CHROME] })
    await startSession($, w)
    await playTurn($, w)
    await w.clock.advance(TEST_OPTIONS.windowReopenCooldownMs + 1)
    await playTurn($, w)

    expect(launches(w.runs)).toHaveLength(2)
  },
)

test(
  'never opens a window when one is already connected',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN, files: [CHROME] })
    await startSession($, w)
    await playTurn($, w)
    await playTurn($, w)

    expect(w.to('/api/auth/link')).toHaveLength(0)
    expect(launches(w.runs)).toHaveLength(0)
  },
)

test(
  'autoOpen off: the turn is played but no window is opened',
  { options: { ...TEST_OPTIONS, autoOpen: false } },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(false), store: LOGGED_IN, files: [CHROME] })
    await startSession($, w)
    await playTurn($, w)

    expect(w.to('/api/turn/end')).toHaveLength(1)
    expect(launches(w.runs)).toHaveLength(0)
  },
)

test(
  '/roulette forces a new window even inside the cooldown',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(false), store: LOGGED_IN, files: [CHROME] })
    await startSession($, w)
    await playTurn($, w)
    const { text } = await command($, 'roulette')

    expect(text).toContain('Opening the table')
    expect(launches(w.runs)).toHaveLength(2)
  },
)

test(
  'refuses to open a link that does not belong to the configured server',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        ...happyCasino(false),
        '/api/auth/link': { json: { v: 1, url: 'https://evil.test/play?code=x', expiresIn: 60 } },
      },
      store: LOGGED_IN,
      files: [CHROME],
    })
    await startSession($, w)
    await playTurn($, w)

    expect(launches(w.runs)).toHaveLength(0)
    expect(w.logs.some(line => line.includes('no es de su origen'))).toBe(true)
  },
)
