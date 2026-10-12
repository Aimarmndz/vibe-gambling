// SPDX-License-Identifier: AGPL-3.0-or-later
// Ciclo del turno: cada prompt del bucle principal es una tirada; los subagentes y las
// continuaciones sin prompt no. Y los comandos se registran con sus alias.
import { expect, test } from 'claude-code/testing'

import {
  LOGGED_IN,
  TEST_OPTIONS,
  happyCasino,
  playTurn,
  startSession,
  world,
} from './support/harness.ts'

test('registers every command with its Spanish alias', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on)
  await startSession($, w)
  expect([...w.registered].sort()).toEqual(
    [
      'all-in',
      'apostar',
      'balance',
      'bet',
      'roulette',
      'ruleta',
      'saldo',
      'vibe-delete-account',
      'vibe-hide',
      'vibe-login',
      'vibe-logout',
      'vibe-server',
      'vibe-show',
    ].sort(),
  )
})

test(
  'one prompt, one spin: turn/start then turn/end with the same id',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
    await startSession($, w)
    await playTurn($, w, { durationMs: 2500 })
    const paths = w.requests
      .map(request => request.path)
      .filter(path => path.startsWith('/api/turn'))
    expect(paths).toEqual(['/api/turn/start', '/api/turn/end'])
    const [start, end] = [w.to('/api/turn/start')[0], w.to('/api/turn/end')[0]]
    expect((end?.body as { turnId: string }).turnId).toBe(
      (start?.body as { turnId: string }).turnId,
    )
    expect(end?.body).toMatchObject({ durationMs: 2500 })
  },
)

test('a subagent finishing is not a spin', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
  await startSession($, w)
  await $.turn.start({ text: 'use a subagent', turnId: 'main-1' })
  await w.clock.settle()
  await $.turn.complete({
    answer: 'sub report',
    durationMs: 100,
    isAborted: false,
    turnId: 'sub-1',
    agentId: 'agent-7',
    reason: 'answer',
  })
  await w.clock.settle()
  expect(w.to('/api/turn/end')).toHaveLength(0)
  await $.turn.complete({
    answer: 'ok',
    durationMs: 900,
    isAborted: false,
    turnId: 'main-1',
    reason: 'answer',
  })
  await w.clock.settle()
  expect(w.to('/api/turn/start')).toHaveLength(1)
  expect(w.to('/api/turn/end')).toHaveLength(1)
})

test('a continuation without a prompt is not a spin', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
  await startSession($, w)
  await playTurn($, w, { prompt: '' })
  expect(w.to('/api/turn/start')).toHaveLength(0)
  expect(w.to('/api/turn/end')).toHaveLength(0)
})

test('an interrupted turn still resolves its spin', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
  await startSession($, w)
  await $.turn.start({ text: 'long task', turnId: 'abort-1' })
  await w.clock.settle()
  await $.turn.complete({
    answer: '',
    durationMs: 50,
    isAborted: true,
    turnId: 'abort-1',
    reason: 'aborted',
  })
  await w.clock.settle()
  expect(w.to('/api/turn/end')).toHaveLength(1)
})

test(
  'turn/end waits for turn/start even if it is slow',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        ...happyCasino(true),
        '/api/turn/start': { ...happyCasino(true)['/api/turn/start'], delayMs: 800 } as never,
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await $.turn.start({ text: 'quick', turnId: 'q-1' })
    await $.turn.complete({
      answer: 'x',
      durationMs: 5,
      isAborted: false,
      turnId: 'q-1',
      reason: 'answer',
    })
    await w.clock.settle()
    expect(w.to('/api/turn/end')).toHaveLength(0)
    await w.clock.advance(800)
    expect(w.requests.map(r => r.path).filter(p => p.startsWith('/api/turn'))).toEqual([
      '/api/turn/start',
      '/api/turn/end',
    ])
  },
)

test(
  'a command the engine refuses to register does not take the others (or the status) down',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: happyCasino(true),
      store: LOGGED_IN,
      registerDeny: ['roulette', 'balance'],
    })
    await startSession($, w)
    expect(w.registered).toHaveLength(11)
    expect(w.registered).toContain('saldo')
    expect(w.registered).toContain('vibe-delete-account')
    expect(w.lastStatus()).toBe('🎰 1,000 🪙')
    expect(w.logs.some(line => line.includes('/roulette'))).toBe(true)
  },
)
