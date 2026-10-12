// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
// Tiradas pendientes en la ventana: el reductor con el contador, el bucle de GIRAR TODAS (que se
// para en premio gordo, verde, bancarrota u ○), la presencia en `visibilitychange` y el contador
// que bota.
import { describe, expect, it, vi } from 'vitest'

import { isVisible, watchPresence } from '../src/app/presence.ts'
import type { VisibilitySource } from '../src/app/presence.ts'
import { SpinAllLoop } from '../src/game/spinAll.ts'
import {
  EMPTY_SLIP,
  INITIAL_STATE,
  canSpinPending,
  dismissResult,
  pendingSpins,
  reduce,
  reveal,
} from '../src/game/state.ts'
import type { GameState } from '../src/game/state.ts'
import { BumpCounter } from '../src/ui/counter.ts'
import { ROUND_ID, ROUND_ID_2, msg, resolved, testWebConfig, user, wallet } from './fixtures.ts'

const NOW = Date.parse('2026-10-12T10:00:00.000Z')
const RULES = testWebConfig.game

function hello(pending: number, patch: Record<string, unknown> = {}): GameState {
  return reduce(
    INITIAL_STATE,
    msg({
      type: 'hello',
      user,
      wallet: wallet({ pendingSpins: pending }),
      slip: EMPTY_SLIP,
      round: null,
      lastRound: null,
      serverTime: '2026-10-12T10:00:00.000Z',
      ...patch,
    }),
    NOW,
  ).state
}

/** Una tirada pendiente gastada: llega como cualquier ronda y se enseña. */
function spend(state: GameState, round = resolved(), left = pendingSpins(state) - 1): GameState {
  const w = wallet({ balance: 500 + round.net, pendingSpins: left })
  let next = reduce(
    state,
    msg({ type: 'round.started', round: { roundId: round.roundId, openedAt: round.openedAt } }),
    NOW,
  ).state
  next = reduce(next, msg({ type: 'round.resolved', round, wallet: w }), NOW).state
  return dismissResult(reveal(next))
}

const lose = (roundId = ROUND_ID) =>
  resolved({
    roundId,
    result: 2,
    color: 'black',
    bets: [{ selection: { kind: 'red' }, amount: 5, won: false, payout: 0 }],
    source: 'repeat',
    staked: 5,
    returned: 0,
    net: -5,
  })

describe('reductor con tiradas pendientes', () => {
  it('hello trae el contador y se puede girar con la mesa quieta', () => {
    const state = hello(20)
    expect(pendingSpins(state)).toBe(20)
    expect(canSpinPending(state)).toBe(true)
    expect(canSpinPending(hello(0))).toBe(false)
    expect(canSpinPending(INITIAL_STATE)).toBe(false)
  })

  it('no se puede girar mientras gira una ronda en directo', () => {
    const spinning = hello(3, {
      round: { roundId: ROUND_ID, openedAt: '2026-10-12T09:59:59.000Z' },
    })
    expect(spinning.phase).toBe('spinning')
    expect(canSpinPending(spinning)).toBe(false)
  })

  it('pending queued: sube el contador, cierra la ronda que giraba y avisa', () => {
    const spinning = hello(3, {
      round: { roundId: ROUND_ID, openedAt: '2026-10-12T09:59:59.000Z' },
    })
    const step = reduce(
      spinning,
      msg({ type: 'pending', event: 'queued', wallet: wallet({ pendingSpins: 4 }) }),
      NOW,
    )
    expect(step.state.round).toBeNull()
    expect(step.state.phase).toBe('idle')
    expect(pendingSpins(step.state)).toBe(4)
    expect(step.state.shown?.pendingSpins).toBe(4)
    expect(step.effects).toEqual([{ type: 'pending', event: 'queued', count: 4 }])
  })

  it('pending dropped con la bola cayendo: no la interrumpe ni destripa el saldo', () => {
    let state = hello(50)
    const round = resolved()
    state = reduce(
      state,
      msg({ type: 'round.resolved', round, wallet: wallet({ balance: 1375, pendingSpins: 49 }) }),
      NOW,
    ).state
    expect(state.phase).toBe('landing')
    const step = reduce(
      state,
      msg({
        type: 'pending',
        event: 'dropped',
        wallet: wallet({ balance: 1375, pendingSpins: 49 }),
      }),
      NOW,
    )
    expect(step.state.phase).toBe('landing')
    expect(step.state.shown?.balance).toBe(500)
    expect(step.effects).toEqual([{ type: 'pending', event: 'dropped', count: 49 }])
  })

  it('al gastar una, el contador baja ya con round.resolved (no espera a la caída)', () => {
    let state = hello(2)
    state = reduce(
      state,
      msg({
        type: 'round.resolved',
        round: resolved(),
        wallet: wallet({ balance: 1375, pendingSpins: 1 }),
      }),
      NOW,
    ).state
    expect(state.phase).toBe('landing')
    expect(pendingSpins(state)).toBe(1)
    // El saldo que se enseña sigue congelado hasta que cae la bola.
    expect(state.shown?.balance).toBe(500)
  })
})

describe('GIRAR TODAS', () => {
  it('pide de una en una, solo con la mesa quieta, y acaba cuando no quedan', () => {
    const loop = new SpinAllLoop(RULES, 400)
    let state = hello(2)
    expect(loop.start(state)).toBe(true)
    expect(loop.start(state)).toBe(false)
    expect(loop.next(state, NOW)).toEqual({ spin: true, ended: null })
    // En vuelo: no pide otra.
    expect(loop.next(state, NOW)).toEqual({ spin: false, ended: null })
    loop.resolved()
    state = spend(state, lose())
    expect(loop.revealed(lose(), wallet({ balance: 495 }))).toBeNull()
    expect(loop.next(state, NOW)).toEqual({ spin: true, ended: null })
    loop.resolved()
    state = spend(state, lose(ROUND_ID_2))
    expect(loop.revealed(lose(ROUND_ID_2), wallet({ balance: 490 }))).toBeNull()
    expect(pendingSpins(state)).toBe(0)
    expect(loop.next(state, NOW)).toEqual({ spin: false, ended: 'empty' })
    expect(loop.status()).toEqual({ running: false, spun: 2, ended: 'empty' })
  })

  it('no empieza sin pendientes', () => {
    expect(new SpinAllLoop(RULES, 400).start(hello(0))).toBe(false)
  })

  it('se para sola en un premio gordo', () => {
    const loop = new SpinAllLoop(RULES, 400)
    loop.start(hello(5))
    loop.next(hello(5), NOW)
    loop.resolved()
    // Pleno al 17 (fixture): premio gordo.
    expect(loop.revealed(resolved(), wallet({ balance: 1375 }))).toBe('bigWin')
    expect(loop.status()).toMatchObject({ running: false, ended: 'bigWin' })
    expect(loop.next(hello(4), NOW).spin).toBe(false)
  })

  it('se para sola cuando sale el verde', () => {
    const loop = new SpinAllLoop(RULES, 400)
    loop.start(hello(5))
    const zero = resolved({ ...lose(), result: 0, color: 'green' })
    expect(loop.revealed(zero, wallet({ balance: 495 }))).toBe('green')
  })

  it('se para sola en bancarrota (había fichas y ya no llega a la mínima)', () => {
    const loop = new SpinAllLoop(RULES, 400)
    loop.start(hello(5))
    expect(loop.revealed(lose(), wallet({ balance: 4 }))).toBe('broke')
  })

  it('las tiradas sin fichas no la paran', () => {
    const loop = new SpinAllLoop(RULES, 400)
    loop.start(hello(5))
    const none = resolved({
      ...lose(),
      bets: [],
      source: 'none',
      staked: 0,
      returned: 0,
      net: 0,
    })
    expect(loop.revealed(none, wallet({ balance: 0 }))).toBeNull()
    expect(loop.active).toBe(true)
  })

  it('se para con ○ (stop del usuario) y no hace nada si ya estaba parada', () => {
    const loop = new SpinAllLoop(RULES, 400)
    loop.start(hello(5))
    expect(loop.stop('user')).toBe('user')
    expect(loop.stop('user')).toBeNull()
    expect(loop.status().ended).toBe('user')
    expect(loop.revealed(resolved(), wallet())).toBeNull()
    expect(loop.failed('conflict', NOW)).toBeNull()
  })

  it('rate_limited solo retrasa la siguiente; otros errores la paran', () => {
    const loop = new SpinAllLoop(RULES, 400)
    const state = hello(5)
    loop.start(state)
    loop.next(state, NOW)
    expect(loop.failed('rate_limited', NOW)).toBeNull()
    expect(loop.next(state, NOW + 399).spin).toBe(false)
    expect(loop.next(state, NOW + 400).spin).toBe(true)
    expect(loop.failed('not_found', NOW)).toBe('empty')

    loop.start(state)
    loop.next(state, NOW)
    expect(loop.failed('conflict', NOW)).toBe('error')
  })
})

describe('presencia', () => {
  function fakeDoc(initial: DocumentVisibilityState) {
    let listener: (() => void) | null = null
    const doc: VisibilitySource & { visibilityState: DocumentVisibilityState } = {
      visibilityState: initial,
      addEventListener: (_type, l) => {
        listener = l
      },
      removeEventListener: (_type, l) => {
        if (listener === l) listener = null
      },
    }
    return {
      doc,
      set(state: DocumentVisibilityState) {
        doc.visibilityState = state
        listener?.()
      },
      listening: () => listener !== null,
    }
  }

  it('manda la visibilidad en cada visibilitychange, sin repetir', () => {
    const fake = fakeDoc('visible')
    const send = vi.fn()
    const stop = watchPresence(fake.doc, send)
    expect(isVisible(fake.doc)).toBe(true)
    fake.set('hidden')
    fake.set('hidden')
    fake.set('visible')
    expect(send.mock.calls).toEqual([[false], [true]])
    stop()
    expect(fake.listening()).toBe(false)
    fake.set('hidden')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('funciona con el document de verdad (happy-dom)', () => {
    const send = vi.fn()
    const stop = watchPresence(document, send)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(send).toHaveBeenLastCalledWith(false)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(send).toHaveBeenLastCalledWith(true)
    stop()
  })
})

describe('contador que bota', () => {
  it('bota y enseña +1 al sumar, −1 al gastar, y se calma', () => {
    const c = new BumpCounter(500, false)
    c.see(3, 0)
    expect(c.look(0.1)).toEqual({ dy: 0, flash: false, delta: null, deltaRise: 0 })
    c.see(4, 1)
    const up = c.look(1.25)
    expect(up.delta).toBe('+1')
    expect(up.dy).toBeLessThan(0)
    expect(c.look(1.5).delta).toBeNull()
    c.see(1, 2)
    expect(c.look(2.1).delta).toBe('−3')
  })

  it('con movimiento reducido solo parpadea', () => {
    const c = new BumpCounter(500, true)
    c.see(1, 0)
    c.see(2, 1)
    expect(c.look(1)).toEqual({ dy: 0, flash: true, delta: null, deltaRise: 0 })
  })
})
