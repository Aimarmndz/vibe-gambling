// SPDX-License-Identifier: AGPL-3.0-or-later
// Traduce lo que escribe la gente en `/bet <cantidad> <casilla>` a una selección del tapete.
import { betSelectionSchema, INSIDE_BET_KINDS, INSIDE_SIZES } from './bets.ts'
import type { BetSelection, InsideBetKind } from './bets.ts'

/** Alias (inglés y español) de las apuestas sencillas, docenas y columnas. */
const ALIASES: Readonly<Record<string, BetSelection>> = Object.freeze({
  red: { kind: 'red' },
  rojo: { kind: 'red' },
  black: { kind: 'black' },
  negro: { kind: 'black' },
  even: { kind: 'even' },
  par: { kind: 'even' },
  odd: { kind: 'odd' },
  impar: { kind: 'odd' },
  low: { kind: 'low' },
  falta: { kind: 'low' },
  '1-18': { kind: 'low' },
  high: { kind: 'high' },
  pasa: { kind: 'high' },
  '19-36': { kind: 'high' },
  '1st12': { kind: 'dozen', index: 1 },
  '2nd12': { kind: 'dozen', index: 2 },
  '3rd12': { kind: 'dozen', index: 3 },
  '1a12': { kind: 'dozen', index: 1 },
  '2a12': { kind: 'dozen', index: 2 },
  '3a12': { kind: 'dozen', index: 3 },
  dozen1: { kind: 'dozen', index: 1 },
  dozen2: { kind: 'dozen', index: 2 },
  dozen3: { kind: 'dozen', index: 3 },
  docena1: { kind: 'dozen', index: 1 },
  docena2: { kind: 'dozen', index: 2 },
  docena3: { kind: 'dozen', index: 3 },
  col1: { kind: 'column', index: 1 },
  col2: { kind: 'column', index: 2 },
  col3: { kind: 'column', index: 3 },
  column1: { kind: 'column', index: 1 },
  column2: { kind: 'column', index: 2 },
  column3: { kind: 'column', index: 3 },
  columna1: { kind: 'column', index: 1 },
  columna2: { kind: 'column', index: 2 },
  columna3: { kind: 'column', index: 3 },
})

const KIND_BY_SIZE: ReadonlyMap<number, InsideBetKind> = new Map(
  INSIDE_BET_KINDS.map(kind => [INSIDE_SIZES[kind], kind]),
)

/**
 * Convierte un texto como `red`, `rojo`, `17`, `1st12`, `col2` o `8-9-11-12`
 * en una selección válida. Devuelve `null` si no existe en el tapete.
 */
export function parseBetTarget(raw: string): BetSelection | null {
  const text = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ºª]/g, 'a')
    .replace(/\s+/g, '')
  if (text.length === 0 || text.length > 32) return null
  const alias = ALIASES[text]
  if (alias) return alias
  if (!/^\d{1,2}([-,/]\d{1,2}){0,5}$/.test(text)) return null
  const numbers = text.split(/[-,/]/).map(Number)
  const kind = KIND_BY_SIZE.get(numbers.length)
  if (!kind) return null
  const parsed = betSelectionSchema.safeParse({ kind, numbers })
  return parsed.success ? parsed.data : null
}

/** Cantidad de `/bet`: un entero positivo o "all-in" (todo el saldo). */
export type BetAmount = number | 'all-in'

/** Interpreta la cantidad de `/bet`. Devuelve `null` si no es válida. */
export function parseBetAmount(raw: string): BetAmount | null {
  const text = raw
    .trim()
    .toLowerCase()
    .replace(/[\s._]/g, '')
  if (['all', 'allin', 'all-in', 'todo', 'todoalrojo'].includes(text)) return 'all-in'
  if (!/^\d{1,15}$/.test(text)) return null
  const n = Number(text)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
