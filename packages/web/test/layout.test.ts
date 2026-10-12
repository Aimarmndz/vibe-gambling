// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  INSIDE_BET_KINDS,
  INSIDE_SIZES,
  betSelectionSchema,
  isValidInside,
  selectionKey,
} from '@vibe-gambling/shared'
import type { BetSelection } from '@vibe-gambling/shared'
import { describe, expect, it } from 'vitest'

import {
  INITIAL_CURSOR,
  LAYOUT_BOUNDS,
  OUTSIDE_ORDER,
  anchorOf,
  cellCenter,
  colOf,
  highlightedNumbers,
  hitTest,
  moveCursor,
  numberAt,
  rowOfNumber,
} from '../src/game/layout.ts'
import type { Direction, Point } from '../src/game/layout.ts'

/** Todas las apuestas interiores válidas del tapete europeo (fuerza bruta contra shared). */
function allInsideSelections(): BetSelection[] {
  const out: BetSelection[] = []
  const combos = (start: number, size: number, acc: number[]) => {
    if (acc.length === size) {
      const kind = INSIDE_BET_KINDS.find(k => INSIDE_SIZES[k] === size)!
      if (isValidInside(kind, acc)) out.push(betSelectionSchema.parse({ kind, numbers: acc }))
      return
    }
    for (let n = start; n <= 36; n++) combos(n + 1, size, [...acc, n])
  }
  for (const size of [1, 2, 3, 4]) combos(0, size, [])
  // Las seisenas son dos transversales seguidas: se generan directamente.
  for (let a = 1; a <= 31; a += 3) {
    out.push(
      betSelectionSchema.parse({ kind: 'line', numbers: [a, a + 1, a + 2, a + 3, a + 4, a + 5] }),
    )
  }
  return out
}

const outside: BetSelection[] = [
  ...OUTSIDE_ORDER.map(kind => ({ kind }) as BetSelection),
  ...([1, 2, 3] as const).map(index => ({ kind: 'dozen', index }) as BetSelection),
  ...([1, 2, 3] as const).map(index => ({ kind: 'column', index }) as BetSelection),
]

describe('geometría del tapete', () => {
  it('numberAt, colOf y rowOfNumber son coherentes para los 36 números', () => {
    for (let n = 1; n <= 36; n++) expect(numberAt(colOf(n), rowOfNumber(n))).toBe(n)
    expect(numberAt(0, 0)).toBe(3)
    expect(numberAt(0, 2)).toBe(1)
    expect(cellCenter(0)).toEqual({ x: -0.5, y: 1.5 })
  })

  it('hay exactamente las apuestas interiores que admite shared', () => {
    const inside = allInsideSelections()
    // 37 plenos, 60 caballos, 14 transversales (12 + 2 tríos), 23 cuadros (22 + cuatro primeros), 11 seisenas.
    const count = (k: string) => inside.filter(s => s.kind === k).length
    expect([
      count('straight'),
      count('split'),
      count('street'),
      count('corner'),
      count('line'),
    ]).toEqual([37, 60, 14, 23, 11])
  })

  it('clicar en el ancla de cualquier apuesta devuelve esa misma apuesta (ida y vuelta)', () => {
    for (const sel of [...allInsideSelections(), ...outside]) {
      const hit = hitTest(anchorOf(sel))
      expect(hit, JSON.stringify(sel)).not.toBeNull()
      expect(selectionKey(hit!)).toBe(selectionKey(sel))
    }
  })

  it('cualquier punto del tapete da una selección válida de shared (o nada fuera)', () => {
    const b = LAYOUT_BOUNDS
    for (let x = b.minX - 0.5; x <= b.maxX + 0.5; x += 0.037) {
      for (let y = b.minY - 0.5; y <= b.maxY + 0.5; y += 0.041) {
        const sel = hitTest({ x, y })
        const inside = x >= b.minX && x < b.maxX && y >= b.minY && y < b.maxY
        if (!inside) {
          expect(sel).toBeNull()
          continue
        }
        if (sel) expect(betSelectionSchema.safeParse(sel).success).toBe(true)
      }
    }
  })

  it('las líneas y cruces apuestan a los números que tocan', () => {
    expect(hitTest({ x: 5.5, y: 1.5 })).toEqual({ kind: 'straight', numbers: [17] })
    expect(hitTest({ x: 6, y: 1.5 })).toEqual({ kind: 'split', numbers: [17, 20] })
    expect(hitTest({ x: 5.5, y: 2 })).toEqual({ kind: 'split', numbers: [16, 17] })
    expect(hitTest({ x: 6, y: 2 })).toEqual({ kind: 'corner', numbers: [16, 17, 19, 20] })
    expect(hitTest({ x: 5.5, y: 2.95 })).toEqual({ kind: 'street', numbers: [16, 17, 18] })
    expect(hitTest({ x: 6, y: 2.95 })).toEqual({ kind: 'line', numbers: [16, 17, 18, 19, 20, 21] })
    expect(hitTest({ x: 0, y: 0.5 })).toEqual({ kind: 'split', numbers: [0, 3] })
    expect(hitTest({ x: 0, y: 1 })).toEqual({ kind: 'street', numbers: [0, 2, 3] })
    expect(hitTest({ x: 0, y: 2 })).toEqual({ kind: 'street', numbers: [0, 1, 2] })
    expect(hitTest({ x: 0, y: 2.95 })).toEqual({ kind: 'corner', numbers: [0, 1, 2, 3] })
    expect(hitTest({ x: -0.5, y: 0.2 })).toEqual({ kind: 'straight', numbers: [0] })
    expect(hitTest({ x: 12.5, y: 0.5 })).toEqual({ kind: 'column', index: 3 })
    expect(hitTest({ x: 12.5, y: 2.5 })).toEqual({ kind: 'column', index: 1 })
    expect(hitTest({ x: 9, y: 3.5 })).toEqual({ kind: 'dozen', index: 3 })
    expect(hitTest({ x: 5, y: 4.5 })).toEqual({ kind: 'red' })
    expect(hitTest({ x: -0.5, y: 4.5 })).toBeNull()
    expect(hitTest({ x: 12.5, y: 3.5 })).toBeNull()
  })

  it('ilumina los números de las apuestas interiores', () => {
    expect(highlightedNumbers({ kind: 'split', numbers: [17, 20] })).toEqual([17, 20])
    expect(highlightedNumbers({ kind: 'red' })).toEqual([])
  })
})

describe('cursor del mando', () => {
  const dirs: Direction[] = ['up', 'down', 'left', 'right']

  it('desde cualquier sitio, cualquier movimiento acaba en una apuesta válida', () => {
    let points: Point[] = [INITIAL_CURSOR]
    const seen = new Set<string>()
    // Recorrido en anchura con movimientos normales y finos.
    for (let depth = 0; depth < 40 && points.length > 0; depth++) {
      const next: Point[] = []
      for (const p of points) {
        for (const d of dirs) {
          for (const fine of [false, true]) {
            const q = moveCursor(p, d, fine)
            const key = `${q.x.toFixed(3)},${q.y.toFixed(3)}`
            expect(hitTest(q), key).not.toBeNull()
            if (!seen.has(key)) {
              seen.add(key)
              next.push(q)
            }
          }
        }
      }
      points = next
    }
    // Con el cursor se llega a todas las apuestas posibles del tapete.
    const reached = new Set(
      [...seen].map(k => selectionKey(hitTest({ x: +k.split(',')[0]!, y: +k.split(',')[1]! })!)),
    )
    const all = [...allInsideSelections(), ...outside].map(selectionKey)
    expect(all.filter(k => !reached.has(k))).toEqual([])
  })

  it('se mueve por casillas como en un mando', () => {
    expect(hitTest(moveCursor(cellCenter(17), 'right'))).toEqual({
      kind: 'straight',
      numbers: [20],
    })
    expect(hitTest(moveCursor(cellCenter(17), 'up'))).toEqual({ kind: 'straight', numbers: [18] })
    expect(hitTest(moveCursor(cellCenter(1), 'left'))).toEqual({ kind: 'straight', numbers: [0] })
    expect(hitTest(moveCursor(cellCenter(34), 'right'))).toEqual({ kind: 'column', index: 1 })
    expect(hitTest(moveCursor(cellCenter(16), 'down'))).toEqual({ kind: 'dozen', index: 2 })
    expect(hitTest(moveCursor(cellCenter(17), 'right', true))).toEqual({
      kind: 'split',
      numbers: [17, 20],
    })
    expect(hitTest(moveCursor(cellCenter(16), 'down', true))).toEqual({
      kind: 'street',
      numbers: [16, 17, 18],
    })
    expect(hitTest(moveCursor({ x: 2, y: 3.5 }, 'down'))).toEqual({ kind: 'low' })
    expect(hitTest(moveCursor({ x: 3, y: 4.5 }, 'up'))).toEqual({ kind: 'dozen', index: 1 })
    expect(hitTest(moveCursor({ x: 11, y: 4.5 }, 'right'))).toEqual({ kind: 'high' })
    expect(hitTest(moveCursor(cellCenter(0), 'right'))).toEqual({ kind: 'straight', numbers: [2] })
    expect(hitTest(moveCursor(cellCenter(0), 'down'))).toEqual({ kind: 'dozen', index: 1 })
    expect(hitTest(moveCursor(cellCenter(0), 'up'))).toEqual({ kind: 'straight', numbers: [0] })
    expect(hitTest(moveCursor({ x: 12.5, y: 2.5 }, 'down'))).toEqual({ kind: 'dozen', index: 3 })
    expect(hitTest(moveCursor({ x: 12.5, y: 0.5 }, 'left'))).toEqual({
      kind: 'straight',
      numbers: [36],
    })
    expect(hitTest(moveCursor({ x: 12.5, y: 0.5 }, 'down'))).toEqual({ kind: 'column', index: 2 })
  })
})
