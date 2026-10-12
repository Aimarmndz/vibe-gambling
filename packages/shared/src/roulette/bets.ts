// SPDX-License-Identifier: AGPL-3.0-or-later
// Tipos de apuesta, geometría del tapete y pagos oficiales de la ruleta europea.
import { z } from 'zod'

import { colorOf, isPocket, MAX_NUMBER } from './wheel.ts'

export const INSIDE_BET_KINDS = ['straight', 'split', 'street', 'corner', 'line'] as const
export const SIMPLE_BET_KINDS = ['red', 'black', 'even', 'odd', 'low', 'high'] as const
export const GROUP_BET_KINDS = ['dozen', 'column'] as const
export const BET_KINDS = [...INSIDE_BET_KINDS, ...GROUP_BET_KINDS, ...SIMPLE_BET_KINDS] as const

export type InsideBetKind = (typeof INSIDE_BET_KINDS)[number]
export type SimpleBetKind = (typeof SIMPLE_BET_KINDS)[number]
export type GroupBetKind = (typeof GROUP_BET_KINDS)[number]
export type BetKind = (typeof BET_KINDS)[number]

/**
 * Pagos oficiales "x a 1" (sin contar la devolución de la apuesta).
 * Con el 0 pierden todas las apuestas sencillas: no se aplica la regla "la partage".
 */
export const PAYOUTS: Readonly<Record<BetKind, number>> = Object.freeze({
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  line: 5,
  dozen: 2,
  column: 2,
  red: 1,
  black: 1,
  even: 1,
  odd: 1,
  low: 1,
  high: 1,
})

/** Cuántos números cubre cada apuesta interior. */
export const INSIDE_SIZES: Readonly<Record<InsideBetKind, number>> = Object.freeze({
  straight: 1,
  split: 2,
  street: 3,
  corner: 4,
  line: 6,
})

const pocketSchema = z.number().int().min(0).max(MAX_NUMBER)

/** Comprueba la geometría de una apuesta interior con números ya ordenados. */
export function isValidInside(kind: InsideBetKind, sorted: readonly number[]): boolean {
  if (sorted.length !== INSIDE_SIZES[kind]) return false
  if (!sorted.every(isPocket)) return false
  if (new Set(sorted).size !== sorted.length) return false
  const [a = -1, b = -1, c = -1, d = -1] = sorted
  switch (kind) {
    case 'straight':
      return true
    case 'split':
      if (a === 0) return b >= 1 && b <= 3
      // Vecinos en horizontal (misma fila) o en vertical (misma columna).
      return (b === a + 1 && a % 3 !== 0) || b === a + 3
    case 'street':
      // Fila de tres o los tríos con el cero (0-1-2 y 0-2-3).
      if (a === 0) return (b === 1 && c === 2) || (b === 2 && c === 3)
      return a % 3 === 1 && b === a + 1 && c === a + 2
    case 'corner':
      // Cuadro de cuatro o los "cuatro primeros" (0-1-2-3).
      if (a === 0) return b === 1 && c === 2 && d === 3
      return a % 3 !== 0 && b === a + 1 && c === a + 3 && d === a + 4
    case 'line':
      return a !== 0 && a % 3 === 1 && sorted.every((n, i) => n === a + i)
  }
}

const insideSelectionSchema = z
  .object({
    kind: z.enum(INSIDE_BET_KINDS),
    numbers: z.array(pocketSchema).min(1).max(6),
  })
  .strict()
  .transform(sel => ({ ...sel, numbers: [...sel.numbers].sort((x, y) => x - y) }))
  .refine(sel => isValidInside(sel.kind, sel.numbers), {
    message: 'Esa combinación de números no existe en el tapete',
  })

const groupSelectionSchema = z
  .object({
    kind: z.enum(GROUP_BET_KINDS),
    index: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict()

const simpleSelectionSchema = z.object({ kind: z.enum(SIMPLE_BET_KINDS) }).strict()

/** Dónde se colocan las fichas: el "qué" de una apuesta, sin la cantidad. */
export const betSelectionSchema = z.union([
  insideSelectionSchema,
  groupSelectionSchema,
  simpleSelectionSchema,
])
export type BetSelection = z.output<typeof betSelectionSchema>
export type BetSelectionInput = z.input<typeof betSelectionSchema>

/** Una apuesta concreta: selección + cantidad de monedas (entero positivo). */
export const betSchema = z
  .object({
    selection: betSelectionSchema,
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
export type Bet = z.output<typeof betSchema>

/** Números que cubre una selección. */
export function coveredNumbers(sel: BetSelection): number[] {
  switch (sel.kind) {
    case 'straight':
    case 'split':
    case 'street':
    case 'corner':
    case 'line':
      return [...sel.numbers]
    case 'dozen':
      return range(1 + (sel.index - 1) * 12, 12)
    case 'column':
      return range(1, MAX_NUMBER).filter(n => ((n - 1) % 3) + 1 === sel.index)
    case 'red':
    case 'black':
      return range(1, MAX_NUMBER).filter(n => colorOf(n) === sel.kind)
    case 'even':
      return range(1, MAX_NUMBER).filter(n => n % 2 === 0)
    case 'odd':
      return range(1, MAX_NUMBER).filter(n => n % 2 === 1)
    case 'low':
      return range(1, 18)
    case 'high':
      return range(19, 18)
  }
}

/** ¿Gana la selección si sale `result`? */
export function selectionWins(sel: BetSelection, result: number): boolean {
  if (!isPocket(result)) throw new RangeError(`casilla inexistente: ${result}`)
  return coveredNumbers(sel).includes(result)
}

/** Clave estable de una selección, para agrupar fichas en la misma casilla. */
export function selectionKey(sel: BetSelection): string {
  if ('numbers' in sel) return `${sel.kind}:${sel.numbers.join('-')}`
  if ('index' in sel) return `${sel.kind}:${sel.index}`
  return sel.kind
}

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i)
}
