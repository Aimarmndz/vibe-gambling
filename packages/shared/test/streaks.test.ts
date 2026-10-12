// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import { bestStreak, colorStreak, gamblersFallacyPick, nextStreak } from '../src/index.ts'

describe('racha del jugador', () => {
  it('cuenta ganadas en positivo y perdidas en negativo', () => {
    expect(nextStreak(0, 10)).toBe(1)
    expect(nextStreak(3, 10)).toBe(4)
    expect(nextStreak(3, -10)).toBe(-1)
    expect(nextStreak(-2, -10)).toBe(-3)
    expect(nextStreak(-2, 5)).toBe(1)
  })

  it('una ronda sin apuesta o empatada no la rompe', () => {
    expect(nextStreak(4, null)).toBe(4)
    expect(nextStreak(-4, 0)).toBe(-4)
  })

  it('guarda la mejor racha ganadora', () => {
    expect(bestStreak(3, 5)).toBe(5)
    expect(bestStreak(3, -8)).toBe(3)
  })
})

describe('racha de color', () => {
  it('cuenta el color repetido al final', () => {
    expect(colorStreak([])).toBeNull()
    expect(colorStreak([2, 1, 3, 5])).toEqual({ color: 'red', count: 3 })
    expect(colorStreak([1, 2])).toEqual({ color: 'black', count: 1 })
    expect(colorStreak([0, 0])).toEqual({ color: 'green', count: 2 })
  })

  it('la falacia del jugador siempre apuesta al contrario', () => {
    expect(gamblersFallacyPick({ color: 'red', count: 7 })).toBe('black')
    expect(gamblersFallacyPick({ color: 'black', count: 7 })).toBe('red')
    expect(gamblersFallacyPick({ color: 'green', count: 2 })).toBe('red')
  })
})
