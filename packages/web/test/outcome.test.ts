// SPDX-License-Identifier: AGPL-3.0-or-later
import { PHRASES } from '@vibe-gambling/shared/i18n'
import { describe, expect, it } from 'vitest'

import { PhraseMemory, describeOutcome, mainCategory } from '../src/game/outcome.ts'
import { createTranslator } from '../src/i18n/index.ts'
import { resolved, testWebConfig, wallet } from './fixtures.ts'

const game = testWebConfig.game
const lost = (patch = {}) =>
  resolved({
    result: 4,
    color: 'black',
    bets: [{ selection: { kind: 'red' }, amount: 25, won: false, payout: 0 }],
    returned: 0,
    net: -25,
    ...patch,
  })

describe('pantalla de resultado', () => {
  it('elige la categoría de la frase según lo que pasó', () => {
    expect(mainCategory(resolved(), wallet(), 5)).toBe('bigWin')
    expect(
      mainCategory(
        resolved({
          bets: [{ selection: { kind: 'red' }, amount: 5, won: true, payout: 10 }],
          net: 5,
        }),
        wallet(),
        5,
      ),
    ).toBe('win')
    expect(mainCategory(resolved({ net: 0 }), wallet(), 5)).toBe('win')
    expect(mainCategory(lost(), wallet({ balance: 475 }), 5)).toBe('lose')
    expect(mainCategory(lost({ result: 0, color: 'green' }), wallet({ balance: 475 }), 5)).toBe(
      'zero',
    )
    expect(mainCategory(lost({ net: -400, staked: 400 }), wallet({ balance: 100 }), 5)).toBe(
      'bigLoss',
    )
    expect(
      mainCategory(
        lost({ source: 'none', bets: [], net: 0, staked: 0 }),
        wallet({ balance: 2 }),
        5,
      ),
    ).toBe('broke')
    expect(
      mainCategory(
        lost({ source: 'none', bets: [], net: 0, staked: 0 }),
        wallet({ balance: 200 }),
        5,
      ),
    ).toBe('noBet')
  })

  it('compone frase y extras: jackpot, tests fallidos, apuesta repetida, racha de color y ruina', () => {
    const tr = createTranslator('es')
    const view = describeOutcome({
      round: lost({
        jackpot: true,
        testFailed: true,
        source: 'repeat',
        colorStreak: { color: 'black', count: 7 },
        interestCharged: 30,
      }),
      wallet: wallet({ balance: 0 }),
      game,
      tr,
      memory: new PhraseMemory(),
      random: () => 0,
    })
    expect(view.verdict).toBe('lose')
    expect(view.extras).toHaveLength(3)
    expect(PHRASES.es.jackpot.map(p => p.replace(/\{\w+\}/g, ''))).toContain(
      view.extras[0]!.replace(/\d+|rojo|negro|verde/g, ''),
    )
    expect(view.interest).toBe(30)
    const streak = describeOutcome({
      round: lost({ colorStreak: { color: 'red', count: 5 } }),
      wallet: wallet(),
      game,
      tr,
      memory: new PhraseMemory(),
      random: () => 0,
    })
    expect(streak.extras[0]).toContain('5')
    expect(streak.extras[0]).toContain('rojos')
    expect(streak.extras[0]).toContain('NEGRO')
    expect(streak.extras[0]).not.toMatch(/\{\w+\}/)
  })

  it('nunca repite seguida la misma frase', () => {
    const tr = createTranslator('en')
    const memory = new PhraseMemory()
    let previous = ''
    for (let i = 0; i < 50; i++) {
      const v = describeOutcome({
        round: lost(),
        wallet: wallet({ balance: 475 }),
        game,
        tr,
        memory,
        random: () => 0,
      })
      expect(v.phrase).not.toBe(previous)
      previous = v.phrase
    }
  })

  it('sin fichas en la mesa el veredicto lo dice', () => {
    const view = describeOutcome({
      round: lost({ source: 'none', bets: [], net: 0, staked: 0, returned: 0 }),
      wallet: wallet({ balance: 1 }),
      game,
      tr: createTranslator('en'),
      memory: new PhraseMemory(),
    })
    expect(view.verdict).toBe('noBet')
    expect(view.extras).toEqual([])
  })
})
