// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import {
  colorOf,
  columnOf,
  isPocket,
  POCKET_COUNT,
  RED_NUMBERS,
  rowOf,
  WHEEL_ORDER,
  wheelIndexOf,
} from '../src/index.ts'

describe('cilindro europeo', () => {
  it('tiene 37 casillas distintas del 0 al 36', () => {
    expect(WHEEL_ORDER).toHaveLength(POCKET_COUNT)
    expect(new Set(WHEEL_ORDER).size).toBe(POCKET_COUNT)
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i))
  })

  it('empieza por 0-32-15 y acaba en 3-26 como el cilindro real', () => {
    expect(WHEEL_ORDER.slice(0, 3)).toEqual([0, 32, 15])
    expect(WHEEL_ORDER.slice(-2)).toEqual([3, 26])
  })

  it('alterna rojo y negro alrededor del cilindro (salvo el 0)', () => {
    const colors = WHEEL_ORDER.slice(1).map(colorOf)
    colors.forEach((c, i) => {
      if (i > 0) expect(c).not.toBe(colors[i - 1])
    })
  })

  it('tiene 18 rojos, 18 negros y un verde', () => {
    expect(RED_NUMBERS.size).toBe(18)
    const all = WHEEL_ORDER.map(colorOf)
    expect(all.filter(c => c === 'black')).toHaveLength(18)
    expect(all.filter(c => c === 'green')).toEqual(['green'])
    expect(colorOf(0)).toBe('green')
    expect(colorOf(1)).toBe('red')
    expect(colorOf(2)).toBe('black')
    expect(colorOf(36)).toBe('red')
  })

  it('rechaza casillas inexistentes', () => {
    expect(isPocket(-1)).toBe(false)
    expect(isPocket(37)).toBe(false)
    expect(isPocket(1.5)).toBe(false)
    expect(() => colorOf(37)).toThrow(RangeError)
    expect(() => wheelIndexOf(-1)).toThrow(RangeError)
    expect(() => columnOf(0)).toThrow(RangeError)
    expect(() => rowOf(0)).toThrow(RangeError)
  })

  it('sitúa los números en el tapete', () => {
    expect(wheelIndexOf(0)).toBe(0)
    expect(wheelIndexOf(26)).toBe(36)
    expect(columnOf(1)).toBe(1)
    expect(columnOf(35)).toBe(2)
    expect(columnOf(36)).toBe(3)
    expect(rowOf(1)).toBe(1)
    expect(rowOf(36)).toBe(12)
  })
})
