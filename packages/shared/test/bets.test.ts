// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  betSelectionSchema,
  coveredNumbers,
  INSIDE_BET_KINDS,
  INSIDE_SIZES,
  isValidInside,
  PAYOUTS,
  resolveBets,
  selectionKey,
  selectionWins,
} from '../src/index.ts'
import type { BetSelection, BetSelectionInput, InsideBetKind } from '../src/index.ts'

const parse = (input: BetSelectionInput): BetSelection => betSelectionSchema.parse(input)

/** Todas las combinaciones de números válidas para un tipo de apuesta interior (fuerza bruta). */
function allValid(kind: InsideBetKind): number[][] {
  const size = INSIDE_SIZES[kind]
  const out: number[][] = []
  const pick = (start: number, acc: number[]): void => {
    if (acc.length === size) {
      if (isValidInside(kind, acc)) out.push([...acc])
      return
    }
    for (let n = start; n <= 36; n++) pick(n + 1, [...acc, n])
  }
  if (size <= 4) pick(0, [])
  else {
    for (let a = 0; a <= 31; a++) {
      const six = Array.from({ length: 6 }, (_, i) => a + i)
      if (isValidInside(kind, six)) out.push(six)
    }
  }
  return out
}

/** Todas las selecciones posibles del tapete. */
function everySelection(): BetSelection[] {
  const inside = INSIDE_BET_KINDS.flatMap(kind =>
    allValid(kind).map(numbers => parse({ kind, numbers })),
  )
  const groups = (['dozen', 'column'] as const).flatMap(kind =>
    ([1, 2, 3] as const).map(index => parse({ kind, index })),
  )
  const simple = (['red', 'black', 'even', 'odd', 'low', 'high'] as const).map(kind =>
    parse({ kind }),
  )
  return [...inside, ...groups, ...simple]
}

describe('geometría del tapete', () => {
  it('hay 37 plenos, 60 caballos, 14 transversales, 23 cuadros y 11 seisenas', () => {
    expect(allValid('straight')).toHaveLength(37)
    expect(allValid('split')).toHaveLength(60)
    expect(allValid('street')).toHaveLength(14)
    expect(allValid('corner')).toHaveLength(23)
    expect(allValid('line')).toHaveLength(11)
  })

  it('acepta caballos vecinos y rechaza los que no lo son', () => {
    expect(isValidInside('split', [1, 2])).toBe(true)
    expect(isValidInside('split', [1, 4])).toBe(true)
    expect(isValidInside('split', [0, 3])).toBe(true)
    expect(isValidInside('split', [3, 4])).toBe(false)
    expect(isValidInside('split', [0, 4])).toBe(false)
    expect(isValidInside('split', [1, 1])).toBe(false)
  })

  it('acepta los tríos y los cuatro primeros con el cero', () => {
    expect(isValidInside('street', [0, 1, 2])).toBe(true)
    expect(isValidInside('street', [0, 2, 3])).toBe(true)
    expect(isValidInside('street', [0, 1, 3])).toBe(false)
    expect(isValidInside('street', [2, 3, 4])).toBe(false)
    expect(isValidInside('corner', [0, 1, 2, 3])).toBe(true)
    expect(isValidInside('corner', [3, 4, 6, 7])).toBe(false)
    expect(isValidInside('line', [0, 1, 2, 3, 4, 5])).toBe(false)
    expect(isValidInside('line', [34, 35, 36, 37, 38, 39])).toBe(false)
  })

  it('rechaza tamaños, números fuera de rango y propiedades de más', () => {
    expect(isValidInside('straight', [1, 2])).toBe(false)
    expect(isValidInside('straight', [37])).toBe(false)
    expect(betSelectionSchema.safeParse({ kind: 'split', numbers: [1, 9] }).success).toBe(false)
    expect(betSelectionSchema.safeParse({ kind: 'straight', numbers: [40] }).success).toBe(false)
    expect(betSelectionSchema.safeParse({ kind: 'dozen', index: 4 }).success).toBe(false)
    expect(betSelectionSchema.safeParse({ kind: 'red', numbers: [1] }).success).toBe(false)
    expect(betSelectionSchema.safeParse({ kind: 'jackpot' }).success).toBe(false)
  })

  it('normaliza el orden de los números', () => {
    expect(parse({ kind: 'corner', numbers: [5, 1, 4, 2] })).toEqual({
      kind: 'corner',
      numbers: [1, 2, 4, 5],
    })
  })
})

describe('números cubiertos', () => {
  it('docenas, columnas y sencillas cubren lo que deben', () => {
    expect(coveredNumbers(parse({ kind: 'dozen', index: 2 }))).toEqual(
      Array.from({ length: 12 }, (_, i) => 13 + i),
    )
    expect(coveredNumbers(parse({ kind: 'column', index: 1 }))).toEqual([
      1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34,
    ])
    expect(coveredNumbers(parse({ kind: 'low' }))).toHaveLength(18)
    expect(coveredNumbers(parse({ kind: 'high' }))[0]).toBe(19)
    expect(coveredNumbers(parse({ kind: 'even' })).every(n => n % 2 === 0 && n > 0)).toBe(true)
    expect(coveredNumbers(parse({ kind: 'odd' })).every(n => n % 2 === 1)).toBe(true)
    expect(coveredNumbers(parse({ kind: 'black' }))).toHaveLength(18)
  })

  it('el 0 no lo cubre ninguna apuesta exterior (sin "la partage")', () => {
    for (const sel of everySelection()) {
      if (!('numbers' in sel)) expect(selectionWins(sel, 0)).toBe(false)
    }
  })

  it('rechaza resultados imposibles', () => {
    expect(() => selectionWins(parse({ kind: 'red' }), 37)).toThrow(RangeError)
  })

  it('genera claves estables y distintas', () => {
    const keys = everySelection().map(selectionKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(selectionKey(parse({ kind: 'split', numbers: [2, 1] }))).toBe('split:1-2')
    expect(selectionKey(parse({ kind: 'dozen', index: 3 }))).toBe('dozen:3')
    expect(selectionKey(parse({ kind: 'odd' }))).toBe('odd')
  })
})

describe('pagos', () => {
  const cases: [BetSelectionInput, number, number][] = [
    [{ kind: 'straight', numbers: [17] }, 17, 35],
    [{ kind: 'split', numbers: [17, 20] }, 20, 17],
    [{ kind: 'street', numbers: [16, 17, 18] }, 16, 11],
    [{ kind: 'corner', numbers: [17, 18, 20, 21] }, 21, 8],
    [{ kind: 'line', numbers: [16, 17, 18, 19, 20, 21] }, 19, 5],
    [{ kind: 'dozen', index: 2 }, 17, 2],
    [{ kind: 'column', index: 2 }, 17, 2],
    [{ kind: 'black' }, 17, 1],
    [{ kind: 'red' }, 18, 1],
    [{ kind: 'odd' }, 17, 1],
    [{ kind: 'even' }, 18, 1],
    [{ kind: 'low' }, 18, 1],
    [{ kind: 'high' }, 19, 1],
  ]

  it.each(cases)('%o con el %i paga %i:1', (input, result, odds) => {
    const sel = parse(input)
    expect(PAYOUTS[sel.kind]).toBe(odds)
    const out = resolveBets([{ selection: sel, amount: 10 }], result)
    expect(out.outcomes[0]).toMatchObject({ won: true, payout: 10 + 10 * odds })
    expect(out.net).toBe(10 * odds)
  })

  it('una apuesta perdida devuelve 0', () => {
    const out = resolveBets([{ selection: parse({ kind: 'red' }), amount: 50 }], 0)
    expect(out).toMatchObject({ staked: 50, returned: 0, net: -50, jackpot: false })
  })

  it('resuelve varias apuestas a la vez', () => {
    const out = resolveBets(
      [
        { selection: parse({ kind: 'straight', numbers: [7] }), amount: 10 },
        { selection: parse({ kind: 'red' }), amount: 100 },
        { selection: parse({ kind: 'even' }), amount: 40 },
      ],
      7,
    )
    expect(out.staked).toBe(150)
    expect(out.returned).toBe(360 + 200)
    expect(out.net).toBe(410)
  })

  it('el jackpot dev multiplica la ganancia, no la devolución', () => {
    const out = resolveBets([{ selection: parse({ kind: 'red' }), amount: 100 }], 1, 2)
    expect(out.outcomes[0]?.payout).toBe(100 + 200)
    expect(out.jackpot).toBe(true)
    const lost = resolveBets([{ selection: parse({ kind: 'red' }), amount: 100 }], 2, 2)
    expect(lost.jackpot).toBe(false)
    expect(lost.returned).toBe(0)
  })

  it('rechaza resultados y multiplicadores imposibles', () => {
    expect(() => resolveBets([], 37)).toThrow(RangeError)
    expect(() => resolveBets([], 1, 0.5)).toThrow(RangeError)
  })

  it('cada apuesta devuelve exactamente 36× lo apostado sumando las 37 casillas (ventaja 1/37)', () => {
    for (const sel of everySelection()) {
      let total = 0
      for (let n = 0; n <= 36; n++)
        total += resolveBets([{ selection: sel, amount: 1 }], n).returned
      expect(total, selectionKey(sel)).toBe(36)
    }
  })

  it('propiedad: los pagos nunca son negativos y son 0 o apuesta×(1+pago×mult)', () => {
    const selections = everySelection()
    fc.assert(
      fc.property(
        fc.constantFrom(...selections),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 36 }),
        fc.constantFrom(1, 2, 3),
        (selection, amount, result, mult) => {
          const out = resolveBets([{ selection, amount }], result, mult)
          const payout = out.outcomes[0]?.payout ?? -1
          expect(payout).toBeGreaterThanOrEqual(0)
          const expected = amount + amount * PAYOUTS[selection.kind] * mult
          expect([0, expected]).toContain(payout)
          expect(out.net).toBe(out.returned - out.staked)
        },
      ),
    )
  })
})
