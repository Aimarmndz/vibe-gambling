// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import {
  EMPTY_SLIP,
  INITIAL_STATE,
  dismissResult,
  localRevealAt,
  reduce,
  reveal,
} from '../src/game/state.ts'
import type { GameState } from '../src/game/state.ts'
import { ROUND_ID, ROUND_ID_2, msg, resolved, user, wallet } from './fixtures.ts'

const NOW = Date.parse('2026-10-12T10:00:00.000Z')
const open = { roundId: ROUND_ID, openedAt: '2026-10-12T10:00:00.000Z' }
const slip = { bets: [{ selection: { kind: 'red' }, amount: 25 }], total: 25 }

function hello(patch: Record<string, unknown> = {}): GameState {
  return reduce(
    INITIAL_STATE,
    msg({
      type: 'hello',
      user,
      wallet: wallet(),
      slip: EMPTY_SLIP,
      round: null,
      lastRound: null,
      serverTime: '2026-10-12T10:00:01.000Z',
      ...patch,
    }),
    NOW,
  ).state
}

describe('estado de la ventana', () => {
  it('hello carga todo y calcula el desfase del reloj', () => {
    const step = reduce(
      INITIAL_STATE,
      msg({
        type: 'hello',
        user,
        wallet: wallet(),
        slip: EMPTY_SLIP,
        round: null,
        lastRound: null,
        serverTime: '2026-10-12T10:00:01.000Z',
      }),
      NOW,
    )
    expect(step.effects).toEqual([{ type: 'connected', first: true }])
    expect(step.state.clockOffsetMs).toBe(1000)
    expect(step.state.phase).toBe('idle')
    expect(step.state.shown?.balance).toBe(500)
    expect(localRevealAt(step.state, resolved())).toBe(Date.parse('2026-10-12T10:00:03.000Z'))
  })

  it('hello con ronda abierta empieza girando', () => {
    const s = reduce(
      INITIAL_STATE,
      msg({
        type: 'hello',
        user,
        wallet: wallet(),
        slip: EMPTY_SLIP,
        round: open,
        lastRound: resolved({ roundId: ROUND_ID_2 }),
        serverTime: '2026-10-12T10:00:00.000Z',
      }),
      NOW,
    )
    expect(s.state.phase).toBe('spinning')
    expect(s.effects.map(e => e.type)).toEqual(['connected', 'spin'])
    expect(s.state.lastRound?.roundId).toBe(ROUND_ID_2)
  })

  it('ronda completa: gira, cae con el saldo congelado, se enseña y se cierra', () => {
    let s = hello()
    let step = reduce(s, msg({ type: 'slip', slip, wallet: wallet({ balance: 475 }) }), NOW)
    s = step.state
    expect(s.shown?.balance).toBe(475)
    step = reduce(s, msg({ type: 'round.started', round: open }), NOW)
    expect(step.effects).toEqual([{ type: 'spin' }])
    s = step.state
    expect(reduce(s, msg({ type: 'round.started', round: open }), NOW).effects).toEqual([])
    step = reduce(
      s,
      msg({
        type: 'round.resolved',
        round: resolved(),
        wallet: wallet({ balance: 1375, spins: 1 }),
      }),
      NOW,
    )
    s = step.state
    expect(step.effects[0]?.type).toBe('land')
    expect(s.phase).toBe('landing')
    expect(s.round).toBeNull()
    expect(s.slip).toEqual(EMPTY_SLIP)
    // El HUD no destripa el resultado: la cartera que se enseña sigue siendo la de antes.
    expect(s.shown?.balance).toBe(475)
    expect(s.wallet?.balance).toBe(1375)
    // Mientras cae la bola, otros avisos de cartera tampoco la cambian.
    s = reduce(s, msg({ type: 'wallet', wallet: wallet({ balance: 1375, spins: 1 }) }), NOW).state
    expect(s.shown?.balance).toBe(475)
    s = reveal(s)
    expect(s.phase).toBe('result')
    expect(s.shown?.balance).toBe(1375)
    expect(s.lastRound?.result).toBe(17)
    expect(reveal(s)).toBe(s)
    s = dismissResult(s)
    expect(s.phase).toBe('idle')
    expect(dismissResult(s)).toBe(s)
  })

  it('una ronda nueva durante la caída espera a que se enseñe el resultado', () => {
    let s = hello({ round: open })
    s = reduce(s, msg({ type: 'round.resolved', round: resolved(), wallet: wallet() }), NOW).state
    const step = reduce(
      s,
      msg({ type: 'round.started', round: { ...open, roundId: ROUND_ID_2 } }),
      NOW,
    )
    expect(step.effects).toEqual([])
    s = reveal(step.state)
    s = dismissResult(s)
    expect(s.phase).toBe('spinning')
    // Y si llega con el resultado en pantalla, se pasa a girar.
    const r = reduce(
      { ...s, phase: 'result', round: null },
      msg({ type: 'round.started', round: open }),
      NOW,
    )
    expect(r.state.phase).toBe('spinning')
  })

  it('ignora resultados duplicados', () => {
    let s = hello({ round: open })
    s = reduce(s, msg({ type: 'round.resolved', round: resolved(), wallet: wallet() }), NOW).state
    const dup = reduce(
      s,
      msg({ type: 'round.resolved', round: resolved(), wallet: wallet({ balance: 9 }) }),
      NOW,
    )
    expect(dup.effects).toEqual([])
    expect(dup.state.pending?.roundId).toBe(ROUND_ID)
  })

  it('hello al reconectar en plena caída deja terminar la animación', () => {
    let s = hello({ round: open })
    s = reduce(
      s,
      msg({ type: 'round.resolved', round: resolved(), wallet: wallet({ balance: 1 }) }),
      NOW,
    ).state
    const step = reduce(
      s,
      msg({
        type: 'hello',
        user,
        wallet: wallet({ balance: 2 }),
        slip: EMPTY_SLIP,
        round: null,
        lastRound: resolved(),
        serverTime: '2026-10-12T10:00:00.000Z',
      }),
      NOW,
    )
    expect(step.state.phase).toBe('landing')
    expect(step.state.shown?.balance).toBe(500)
    expect(step.effects).toEqual([{ type: 'connected', first: false }])
  })

  it('servidor reiniciado a mitad de ronda: la ronda resuelta sin conexión no se destripa', () => {
    // Se estaba girando; se cae la conexión; el turno termina; al volver, hello trae la ronda ya
    // resuelta con revealAt en el futuro (resolved() lo pone 4 s después de NOW).
    const before = hello({ round: open })
    const step = reduce(
      before,
      msg({
        type: 'hello',
        user,
        wallet: wallet({ balance: 1400 }),
        slip: EMPTY_SLIP,
        round: null,
        lastRound: resolved(),
        serverTime: '2026-10-12T10:00:00.000Z',
      }),
      NOW,
    )
    expect(step.state.phase).toBe('landing')
    expect(step.state.pending?.roundId).toBe(ROUND_ID)
    expect(step.state.lastRound).toBeNull()
    // Ni el saldo nuevo ni el número se enseñan antes de que caiga la bola.
    expect(step.state.shown?.balance).toBe(500)
    expect(step.effects).toEqual([
      { type: 'connected', first: false },
      { type: 'land', round: resolved() },
    ])
    const shown = reveal(step.state)
    expect(shown.phase).toBe('result')
    expect(shown.shown?.balance).toBe(1400)
    expect(shown.lastRound?.result).toBe(17)
  })

  it('ventana abierta a mitad de la caída: primera conexión sin saldo destripado', () => {
    const step = reduce(
      INITIAL_STATE,
      msg({
        type: 'hello',
        user,
        wallet: wallet({ balance: 1400 }),
        slip: EMPTY_SLIP,
        round: null,
        lastRound: resolved(),
        serverTime: '2026-10-12T10:00:00.000Z',
      }),
      NOW,
    )
    expect(step.state.phase).toBe('landing')
    expect(step.state.shown).toBeNull()
    expect(step.effects.map(e => e.type)).toEqual(['connected', 'land'])
  })

  it('si el revealAt de la ronda ya pasó, hello la da por vista (sin repetir la caída)', () => {
    const step = reduce(
      hello(),
      msg({
        type: 'hello',
        user,
        wallet: wallet({ balance: 1400 }),
        slip: EMPTY_SLIP,
        round: null,
        lastRound: resolved({ revealAt: '2026-10-12T09:59:00.000Z' }),
        serverTime: '2026-10-12T10:00:00.000Z',
      }),
      NOW,
    )
    expect(step.state.phase).toBe('idle')
    expect(step.state.lastRound?.roundId).toBe(ROUND_ID)
    expect(step.effects).toEqual([{ type: 'connected', first: false }])
  })

  it('ronda caducada, préstamo, temporada, ajustes, errores y despedida', () => {
    let s = hello({ round: open })
    expect(reduce(s, msg({ type: 'round.expired', roundId: ROUND_ID_2 }), NOW).effects).toEqual([])
    const exp = reduce(s, msg({ type: 'round.expired', roundId: ROUND_ID }), NOW)
    expect(exp.state.phase).toBe('idle')
    expect(exp.effects).toEqual([{ type: 'expired' }])
    s = exp.state
    const loan = reduce(
      s,
      msg({ type: 'loan.granted', amount: 300, wallet: wallet({ balance: 300, debt: 300 }) }),
      NOW,
    )
    expect(loan.effects).toEqual([{ type: 'loan', amount: 300 }])
    expect(loan.state.shown?.debt).toBe(300)
    expect(
      reduce(
        s,
        msg({
          type: 'season.changed',
          seasonId: '2026-11',
          wallet: wallet({ seasonId: '2026-11' }),
        }),
        NOW,
      ).effects,
    ).toEqual([{ type: 'season', seasonId: '2026-11' }])
    const settings = reduce(s, msg({ type: 'settings', user: { ...user, hidden: true } }), NOW)
    expect(settings.state.user?.hidden).toBe(true)
    expect(
      reduce(s, msg({ type: 'bet.rejected', error: 'insufficient_funds', message: 'no' }), NOW)
        .effects[0],
    ).toEqual({
      type: 'rejected',
      error: 'insufficient_funds',
      message: 'no',
    })
    expect(
      reduce(s, msg({ type: 'error', error: 'internal', message: 'x' }), NOW).effects[0]?.type,
    ).toBe('error')
    expect(reduce(s, msg({ type: 'pong', t: 1 }), NOW).effects).toEqual([])
    expect(reduce(s, msg({ type: 'bye', reason: 'logout' }), NOW).effects).toEqual([
      { type: 'bye', reason: 'logout' },
    ])
  })
})
