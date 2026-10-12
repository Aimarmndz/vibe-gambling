// SPDX-License-Identifier: AGPL-3.0-or-later
// Nunca ralentizar ni romper un turno: con el servidor caído o colgado, los hooks vuelven sin
// esperar, el usuario solo ve "offline" en la status line y el error va al log de depuración.
import { expect, test } from 'claude-code/testing'

import {
  LOGGED_IN,
  TEST_OPTIONS,
  happyCasino,
  playTurn,
  turnStartReply as turnStartReplyOf,
  startSession,
  world,
  command,
} from './support/harness.ts'

const hangingCasino = {
  '/api/me': { hang: true },
  '/api/turn/start': { hang: true },
  '/api/turn/end': { hang: true },
  '/api/auth/link': { hang: true },
}

test(
  'a hanging server never holds the turn and ends as "offline"',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: hangingCasino, store: LOGGED_IN })
    await startSession($, w)

    // Sin mover el reloj: si algún hook esperase al servidor, esto no volvería nunca.
    const started = await $.turn.start({ text: 'refactor everything', turnId: 'hang-1' })
    expect(started.turnId).toBe('hang-1')
    const completed = await $.turn.complete({
      answer: 'done',
      durationMs: 900,
      isAborted: false,
      turnId: 'hang-1',
      reason: 'answer',
    })
    expect(completed.text).toBe('done')

    await w.clock.advance(TEST_OPTIONS.turnTimeoutMs)
    expect(w.lastStatus()).toBe('🎰 offline')
    expect(w.logs.some(line => line.includes('/api/turn/start: sin respuesta en 1500 ms'))).toBe(
      true,
    )
    // Sin ronda abierta no se manda turn/end.
    expect(w.to('/api/turn/end')).toHaveLength(0)
    expect(w.toasts).toEqual([])
  },
)

test(
  'a server that refuses connections is "offline", never an error',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/me': { fail: true }, '/api/turn/start': { fail: true } },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect(w.lastStatus()).toBe('🎰 offline')
    await playTurn($, w)
    expect(w.lastStatus()).toBe('🎰 offline')
    expect(w.toasts).toEqual([])
  },
)

test(
  'a slow server is cut at the configured timeout',
  { options: { ...TEST_OPTIONS, turnTimeoutMs: 300 } },
  async ($, on) => {
    const w = world(on, {
      routes: { ...happyCasino(true), '/api/turn/start': { delayMs: 1000, json: {} } },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await $.turn.start({ text: 'hello', turnId: 'slow-1' })
    await w.clock.advance(299)
    expect(w.lastStatus()).not.toBe('🎰 offline')
    await w.clock.advance(1)
    expect(w.lastStatus()).toBe('🎰 offline')
  },
)

test(
  'headless (`claude -p`): turn.complete waits for turn/end, bounded by the timeout',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { ...happyCasino(true), '/api/turn/end': { hang: true } },
      store: LOGGED_IN,
    })
    await startSession($, w, { interactive: false })
    await $.turn.start({ text: 'say hi', turnId: 'p-1' })
    await w.clock.settle()

    let done = false
    const completing = $.turn
      .complete({ answer: 'hi', durationMs: 10, isAborted: false, turnId: 'p-1', reason: 'answer' })
      .then(result => {
        done = true
        return result
      })
    await w.clock.settle()
    expect(w.to('/api/turn/end')).toHaveLength(1)
    expect(done).toBe(false)
    await w.clock.advance(TEST_OPTIONS.turnTimeoutMs)
    expect((await completing).text).toBe('hi')
    expect(done).toBe(true)
  },
)

test(
  'malformed answers from the server are treated as offline',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/me': { json: { nonsense: true } }, '/api/turn/start': { json: [] } },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.lastStatus()).toBe('🎰 offline')
    expect(w.logs.some(line => line.includes('no tiene la forma esperada'))).toBe(true)
  },
)

test(
  'a revoked session is forgotten and the status asks to log in again',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/me': { status: 401, json: { v: 1, error: 'unauthorized', message: 'nope' } },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect(w.lastStatus()).toBe('🎰 /vibe-login')
    const { text } = await command($, 'balance')
    expect(text).toBe("You're not logged in. Run /vibe-login first.")
  },
)

test(
  'headless (`claude -p`): no window is opened and a hanging launcher cannot hold turn.complete',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: happyCasino(false),
      store: LOGGED_IN,
      files: ['/usr/bin/chromium'],
      launchHang: true,
    })
    await startSession($, w, { interactive: false })
    await $.turn.start({ text: 'say hi', turnId: 'p-2' })
    await w.clock.settle()

    let done = false
    const completing = $.turn
      .complete({ answer: 'hi', durationMs: 10, isAborted: false, turnId: 'p-2', reason: 'answer' })
      .then(result => {
        done = true
        return result
      })
    // Sin mover el reloj: turn/end sale y el hook vuelve sin esperar a ningún navegador.
    await w.clock.settle()
    expect(w.to('/api/turn/end')).toHaveLength(1)
    expect(done).toBe(true)
    expect((await completing).text).toBe('hi')
    // En `claude -p` no hay nadie mirando: ni enlace ni navegador.
    expect(w.to('/api/auth/link')).toHaveLength(0)
    expect(w.runs.filter(argv => argv[0] !== 'uname')).toEqual([])
  },
)

test(
  'interactive: a slow browser launcher never delays turn/end',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: happyCasino(false),
      store: LOGGED_IN,
      files: ['/usr/bin/chromium'],
      launchHang: true,
    })
    await startSession($, w)
    await playTurn($, w)
    // La ventana se está abriendo (el lanzador sigue colgado), pero la ronda ya se ha cerrado.
    expect(w.runs.some(argv => argv.includes('/usr/bin/chromium'))).toBe(true)
    expect(w.to('/api/turn/end')).toHaveLength(1)
  },
)

test(
  'a hanging `uname` is cut at the turn timeout, not the browser launch timeout',
  { options: { ...TEST_OPTIONS, turnTimeoutMs: 300, launchTimeoutMs: 20_000 } },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN, unameHang: true })
    await startSession($, w, { interactive: false })
    await $.turn.start({ text: 'say hi', turnId: 'p-3' })
    await w.clock.advance(300)
    expect(w.to('/api/turn/start')[0]?.body).toMatchObject({ os: 'other' })
  },
)

test(
  'headless (`claude -p`): turn.complete never waits more than one turn timeout in total',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        ...happyCasino(true),
        '/api/turn/start': { ...turnStartReplyOf(true), delayMs: 1000 },
        '/api/turn/end': { hang: true },
      },
      store: LOGGED_IN,
    })
    await startSession($, w, { interactive: false })
    // Un turno muy corto: turn/start sigue en vuelo cuando el turno ya ha acabado.
    await $.turn.start({ text: 'say hi', turnId: 'p-4' })
    let done = false
    const completing = $.turn
      .complete({ answer: 'hi', durationMs: 10, isAborted: false, turnId: 'p-4', reason: 'answer' })
      .then(result => {
        done = true
        return result
      })
    await w.clock.advance(TEST_OPTIONS.turnTimeoutMs - 1)
    expect(done).toBe(false)
    await w.clock.advance(1)
    expect(done).toBe(true)
    expect((await completing).text).toBe('hi')
  },
)
