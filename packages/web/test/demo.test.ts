// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ServerMessage } from '@vibe-gambling/shared'
import { serverMessageSchema } from '@vibe-gambling/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DemoLink, demoGameConfig } from '../src/net/demo.ts'
import { withVersion } from '../src/net/link.ts'
import { testGame, testWebConfig } from './fixtures.ts'

const demoCfg = {
  thinkMs: 1000,
  pauseMs: 2000,
  login: 'demo-tester',
  stats: { recentRounds: 4, seriesPoints: 6, loanMarks: 3, bankHistory: 3 },
  showcase: { seed: 3, spins: 40, pending: 7 },
  achievements: testGame.achievements,
}

describe('modo demo', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(auto = false) {
    const link = new DemoLink(testWebConfig.game, demoCfg, auto, testWebConfig.publicUrl)
    const got: ServerMessage[] = []
    const status: string[] = []
    link.onMessage(m => got.push(serverMessageSchema.parse(m)))
    link.onStatus(s => status.push(s))
    link.start()
    link.start()
    vi.advanceTimersByTime(1)
    return { link, got, status }
  }

  it('saluda, acepta apuestas, las retira y rechaza lo imposible', async () => {
    const { link, got, status } = setup()
    expect(status).toEqual(['open'])
    expect(got[0]?.type).toBe('hello')
    link.send(withVersion({ type: 'bet.place', selection: { kind: 'red' }, amount: 25 }))
    await vi.advanceTimersByTimeAsync(50)
    const slip = got.at(-1)
    expect(slip?.type === 'slip' && slip.wallet.balance).toBe(475)
    link.send(withVersion({ type: 'bet.place', selection: { kind: 'red' }, amount: 999 }))
    await vi.advanceTimersByTimeAsync(50)
    expect(got.at(-1)?.type).toBe('bet.rejected')
    link.send(withVersion({ type: 'bet.place', selection: { kind: 'black' }, amount: 5 }))
    link.send(withVersion({ type: 'bet.place', selection: { kind: 'odd' }, amount: 5 }))
    link.send(withVersion({ type: 'bet.place', selection: { kind: 'even' }, amount: 5 }))
    await vi.advanceTimersByTimeAsync(50)
    const tooMany = got.at(-1)
    expect(tooMany?.type === 'bet.rejected' && tooMany.error).toBe('too_many_bets')
    link.send(withVersion({ type: 'bet.clear' }))
    await vi.advanceTimersByTimeAsync(50)
    const cleared = got.at(-1)
    expect(cleared?.type === 'slip' && cleared.wallet.balance).toBe(500)
    link.send(withVersion({ type: 'loan.request' }))
    await vi.advanceTimersByTimeAsync(50)
    expect(got.at(-1)?.type).toBe('bet.rejected')
    expect(link.send({ v: 1, type: 'nope' } as never)).toBe(false)
  })

  it('juega turnos con resultado forzado, jackpot, intereses y préstamo', async () => {
    const { link, got } = setup()
    link.send(
      withVersion({
        type: 'bet.place',
        selection: { kind: 'straight', numbers: [17] },
        amount: 'all-in',
      }),
    )
    await vi.advanceTimersByTimeAsync(50)
    const turn = link.controls.turn({ result: 5, thinkMs: 100 })
    await vi.advanceTimersByTimeAsync(150)
    await turn
    const lost = got.find(m => m.type === 'round.resolved')
    expect(lost?.type === 'round.resolved' && lost.wallet.balance).toBe(0)
    link.send(withVersion({ type: 'loan.request' }))
    await vi.advanceTimersByTimeAsync(50)
    const loan = got.at(-1)
    expect(loan?.type === 'loan.granted' && loan.wallet.debt).toBe(300)
    // Sin apuesta: repite la última (todo al 17, que ya no puede pagar) → gira sin él.
    link.send(
      withVersion({
        type: 'bet.place',
        selection: { kind: 'straight', numbers: [17] },
        amount: 25,
      }),
    )
    await vi.advanceTimersByTimeAsync(50)
    const p = link.controls.turn({ result: 17, gitPushOk: true, testFailed: true, thinkMs: 10 })
    await vi.advanceTimersByTimeAsync(20)
    await p
    const won = got.filter(m => m.type === 'round.resolved').at(-1)
    if (won?.type !== 'round.resolved') throw new Error('sin ronda')
    expect(won.round.jackpot).toBe(true)
    expect(won.round.net).toBe(25 * 35 * 3)
    expect(won.round.interestCharged).toBe(30)
    expect(won.round.testFailed).toBe(true)
    link.controls.setWallet(1, 2)
    expect(got.at(-1)?.type).toBe('wallet')
    link.send(withVersion({ type: 'settings.update', hidden: false, locale: 'es' }))
    link.send(withVersion({ type: 'sync' }))
    link.send(withVersion({ type: 'ping', t: 3 }))
    await vi.advanceTimersByTimeAsync(50)
    expect(got.slice(-3).map(m => m.type)).toEqual(['settings', 'hello', 'pong'])
    link.stop()
  })

  it('en automático juega turnos solo', async () => {
    const { link, got } = setup(true)
    await vi.advanceTimersByTimeAsync(demoCfg.pauseMs + demoCfg.thinkMs + 10)
    expect(got.map(m => m.type)).toContain('round.started')
    expect(got.map(m => m.type)).toContain('round.resolved')
    link.stop()
  })

  it('GIRAR en la demo responde como el servidor: requestId en la tirada y re en el error', async () => {
    const { link, got } = setup()
    link.send(withVersion({ type: 'spin.pending', quick: true, requestId: 'spin-demo-0001' }))
    await vi.advanceTimersByTimeAsync(50)
    expect(got.at(-1)).toMatchObject({ type: 'error', error: 'not_found', re: 'spin.pending' })
    link.controls.showcase()
    await vi.advanceTimersByTimeAsync(10_000)
    link.send(withVersion({ type: 'spin.pending', quick: true, requestId: 'spin-demo-0002' }))
    await vi.advanceTimersByTimeAsync(10_000)
    const resolved = got.filter(m => m.type === 'round.resolved').at(-1)
    expect(resolved).toMatchObject({ requestId: 'spin-demo-0002' })
  })

  it('completa la configuración que la web no ve con valores de demo', () => {
    const cfg = demoGameConfig(testWebConfig.game)
    expect(cfg.defaultBet.amount).toBe(5)
    expect(cfg.season.startDay).toBe(1)
  })
})
