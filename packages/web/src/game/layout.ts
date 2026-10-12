// SPDX-License-Identifier: AGPL-3.0-or-later
// Geometría del tapete europeo en "unidades de casilla" y su traducción a selecciones de shared.
//
//   x: -1 … 0   el cero (ocupa las tres filas)
//       0 … 12  doce columnas de números (1-2-3, 4-5-6, …)
//      12 … 13  apuestas a columna ("2:1")
//   y:  0 … 3   filas de números (arriba la del 3, 6, 9…; abajo la del 1, 4, 7…)
//       3 … 4   docenas
//       4 … 5   sencillas: 1-18, par, rojo, negro, impar, 19-36
//
// Las fichas que caen sobre una línea (o un cruce) apuestan a los números que la tocan,
// como en una mesa de verdad. Todo es lógica pura y se prueba con todas las selecciones posibles.
import { betSelectionSchema } from '@vibe-gambling/shared'
import type { BetSelection, SimpleBetKind } from '@vibe-gambling/shared'

export interface Point {
  x: number
  y: number
}

export type Direction = 'left' | 'right' | 'up' | 'down'

/** Margen alrededor de una línea dentro del cual una ficha "pisa" la línea. */
export const EDGE = 0.2

/** Altura a la que se pintan las fichas de transversal y seisena (sobre el borde inferior). */
export const STREET_Y = 3 - EDGE / 2

/** Rectángulo que ocupa todo el tapete (con el cero y las columnas). */
export const LAYOUT_BOUNDS = Object.freeze({ minX: -1, maxX: 13, minY: 0, maxY: 5 })

/** Orden de las sencillas en la última fila (cada una ocupa dos columnas). */
export const OUTSIDE_ORDER: readonly SimpleBetKind[] = Object.freeze([
  'low',
  'even',
  'red',
  'black',
  'odd',
  'high',
])

/** Número que hay en la columna `col` (0–11) y la fila `row` (0 arriba – 2 abajo). */
export function numberAt(col: number, row: number): number {
  return 3 * col + (3 - row)
}

/** Columna (0–11) de un número del 1 al 36. */
export function colOf(n: number): number {
  return Math.floor((n - 1) / 3)
}

/** Fila (0 arriba – 2 abajo) de un número del 1 al 36. */
export function rowOfNumber(n: number): number {
  return 2 - ((n - 1) % 3)
}

/** Centro de la casilla de un número (el 0 incluido). */
export function cellCenter(n: number): Point {
  if (n === 0) return { x: -0.5, y: 1.5 }
  return { x: colOf(n) + 0.5, y: rowOfNumber(n) + 0.5 }
}

function inside(kind: 'straight' | 'split' | 'street' | 'corner' | 'line', numbers: number[]) {
  // Se valida con el esquema de shared: si la geometría estuviera mal, saltaría aquí y en los tests.
  return betSelectionSchema.parse({ kind, numbers })
}

/**
 * Selección del tapete en un punto (unidades de casilla), o `null` si ahí no hay apuesta.
 */
export function hitTest(p: Point, edge: number = EDGE): BetSelection | null {
  const { x, y } = p
  const b = LAYOUT_BOUNDS
  if (!(x >= b.minX && x < b.maxX && y >= b.minY && y < b.maxY)) return null

  // Sencillas.
  if (y >= 4) {
    if (x < 0 || x >= 12) return null
    return { kind: OUTSIDE_ORDER[Math.floor(x / 2)]! }
  }
  // Docenas.
  if (y >= 3) {
    if (x < 0 || x >= 12) return null
    return { kind: 'dozen', index: (Math.floor(x / 4) + 1) as 1 | 2 | 3 }
  }
  // Columnas ("2:1"): la de arriba es la del 3, 6, 9…
  if (x >= 12) return { kind: 'column', index: (3 - Math.floor(y)) as 1 | 2 | 3 }
  // El cero, salvo su borde con la primera columna.
  if (x < -edge) return inside('straight', [0])

  const col = Math.min(11, Math.max(0, Math.floor(x)))
  const row = Math.min(2, Math.floor(y))
  const lineX = Math.round(x)
  const lineY = Math.round(y)
  const nearV = Math.abs(x - lineX) < edge && lineX <= 11
  const nearH = Math.abs(y - lineY) < edge && lineY >= 1
  // Borde inferior (con las docenas): transversales y seisenas. Solo por dentro de la fila.
  const onBottom = nearH && lineY === 3

  if (nearV && lineX === 0) {
    if (onBottom) return inside('corner', [0, 1, 2, 3])
    if (nearH) return inside('street', lineY === 1 ? [0, 2, 3] : [0, 1, 2])
    return inside('split', [0, numberAt(0, row)])
  }
  if (nearV) {
    const left = lineX - 1
    if (onBottom) return inside('line', range(3 * left + 1, 6))
    if (nearH) {
      return inside('corner', [
        numberAt(left, lineY - 1),
        numberAt(left, lineY),
        numberAt(lineX, lineY - 1),
        numberAt(lineX, lineY),
      ])
    }
    return inside('split', [numberAt(left, row), numberAt(lineX, row)])
  }
  if (onBottom) return inside('street', range(3 * col + 1, 3))
  if (nearH) return inside('split', [numberAt(col, lineY - 1), numberAt(col, lineY)])
  return inside('straight', [numberAt(col, row)])
}

/** Punto donde se apila la ficha de una selección (el inverso de `hitTest`). */
export function anchorOf(sel: BetSelection): Point {
  switch (sel.kind) {
    case 'straight':
      return cellCenter(sel.numbers[0]!)
    case 'split': {
      const [a, b] = sel.numbers as [number, number]
      if (a === 0) return { x: 0, y: rowOfNumber(b) + 0.5 }
      if (b === a + 3) return { x: colOf(b), y: rowOfNumber(a) + 0.5 }
      return { x: colOf(a) + 0.5, y: rowOfNumber(a) }
    }
    case 'street': {
      const [a, b] = sel.numbers as [number, number, number]
      if (a === 0) return { x: 0, y: b === 1 ? 2 : 1 }
      return { x: colOf(a) + 0.5, y: STREET_Y }
    }
    case 'corner': {
      const a = sel.numbers[0]!
      if (a === 0) return { x: 0, y: STREET_Y }
      return { x: colOf(a) + 1, y: rowOfNumber(a) }
    }
    case 'line':
      return { x: colOf(sel.numbers[0]!) + 1, y: STREET_Y }
    case 'dozen':
      return { x: 4 * (sel.index - 1) + 2, y: 3.5 }
    case 'column':
      return { x: 12.5, y: 3 - sel.index + 0.5 }
    default:
      return { x: 2 * OUTSIDE_ORDER.indexOf(sel.kind) + 1, y: 4.5 }
  }
}

/** Números que se iluminan en el tapete al pasar por una selección. */
export function highlightedNumbers(sel: BetSelection): number[] {
  if ('numbers' in sel) return [...sel.numbers]
  return []
}

type Region = 'zero' | 'grid' | 'column' | 'dozen' | 'outside'

function regionOf(p: Point): Region {
  if (p.y >= 4) return 'outside'
  if (p.y >= 3) return 'dozen'
  if (p.x >= 12) return 'column'
  if (p.x < 0) return 'zero'
  return 'grid'
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Posición inicial del cursor: el pleno del 17, el clásico. */
export const INITIAL_CURSOR: Point = Object.freeze(cellCenter(17))

/**
 * Mueve el cursor del mando. En modo normal salta de casilla en casilla; en modo fino
 * (`fine`, con Mayús) avanza media casilla para poder pisar líneas y cruces.
 */
export function moveCursor(p: Point, dir: Direction, fine = false): Point {
  const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0
  const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0
  const region = regionOf(p)

  if (region === 'grid' && fine) {
    const baseY = p.y >= 3 - EDGE ? 3 : p.y
    const x = p.x + dx / 2
    const y = baseY + dy / 2
    if (y > 3) return { x: 4 * Math.floor(clamp(p.x, 0, 11.99) / 4) + 2, y: 3.5 }
    if (x < 0) return cellCenter(0)
    if (x > 11.5) return { x: 12.5, y: Math.floor(clamp(y, 0.5, 2.5)) + 0.5 }
    return { x, y: y >= 3 ? STREET_Y : Math.max(0.5, y) }
  }

  switch (region) {
    case 'grid': {
      const col = clamp(Math.floor(p.x), 0, 11)
      const row = clamp(Math.floor(p.y), 0, 2)
      if (dx < 0 && col === 0) return cellCenter(0)
      if (dx > 0 && col === 11) return { x: 12.5, y: row + 0.5 }
      if (dy > 0 && row === 2) return { x: 4 * Math.floor(col / 4) + 2, y: 3.5 }
      return { x: col + dx + 0.5, y: clamp(row + dy, 0, 2) + 0.5 }
    }
    case 'zero':
      if (dx > 0) return { x: 0.5, y: 1.5 }
      if (dy > 0) return { x: 2, y: 3.5 }
      return cellCenter(0)
    case 'column': {
      const row = clamp(Math.floor(p.y), 0, 2)
      if (dx < 0) return { x: 11.5, y: row + 0.5 }
      if (dy > 0 && row === 2) return { x: 10, y: 3.5 }
      return { x: 12.5, y: clamp(row + dy, 0, 2) + 0.5 }
    }
    case 'dozen': {
      const i = clamp(Math.floor(p.x / 4), 0, 2)
      if (dy < 0) return { x: 4 * i + 1.5, y: 2.5 }
      if (dy > 0) return { x: 4 * i + 1, y: 4.5 }
      return { x: 4 * clamp(i + dx, 0, 2) + 2, y: 3.5 }
    }
    case 'outside': {
      const i = clamp(Math.floor(p.x / 2), 0, 5)
      if (dy < 0) return { x: 4 * Math.floor(i / 2) + 2, y: 3.5 }
      return { x: 2 * clamp(i + dx, 0, 5) + 1, y: 4.5 }
    }
  }
}

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i)
}
