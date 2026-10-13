// SPDX-License-Identifier: AGPL-3.0-or-later
// Barrido entre pantallas del menú: bloques de 16×16 que se tapan en diagonal (34 diagonales en
// 320×240), se cambia de pantalla en tinta y se destapan en el mismo sentido. La primera mitad de
// `wipeMs` tapa y la segunda destapa. Con movimiento reducido no hay barrido: corte seco.
import { PALETTE } from '../palette.ts'

export const BLOCK = 16
export const COLS = 320 / BLOCK
export const ROWS = 240 / BLOCK
/** Número de diagonales (col + fila va de 0 a COLS + ROWS − 2). */
export const DIAGONALS = COLS + ROWS - 1

export interface WipeFrame {
  /** `cover`: tapando; `reveal`: destapando; `done`: terminado. */
  phase: 'cover' | 'reveal' | 'done'
  /**
   * En `cover`, las diagonales < frontier están tapadas y la `frontier` es el borde; en `reveal`,
   * las diagonales < frontier ya están destapadas.
   */
  frontier: number
}

/** Fotograma del barrido a los `elapsedMs` de empezar. */
export function wipeFrame(elapsedMs: number, wipeMs: number): WipeFrame {
  const half = wipeMs / 2
  if (elapsedMs >= wipeMs || wipeMs <= 0) return { phase: 'done', frontier: DIAGONALS }
  if (elapsedMs < half) {
    return { phase: 'cover', frontier: Math.floor((elapsedMs / half) * (DIAGONALS + 1)) }
  }
  return { phase: 'reveal', frontier: Math.floor(((elapsedMs - half) / half) * (DIAGONALS + 1)) }
}

/** ¿Está tapado el bloque (col, fila) en este fotograma? */
export function blockCovered(frame: WipeFrame, col: number, row: number): boolean {
  const d = col + row
  if (frame.phase === 'cover') return d <= frame.frontier
  if (frame.phase === 'reveal') return d >= frame.frontier
  return false
}

/** ¿Está tapado el punto (x, y)? (para esconder los iconos 3D, que van por encima de la UI). */
export function pointCovered(frame: WipeFrame, x: number, y: number): boolean {
  return blockCovered(frame, Math.floor(x / BLOCK), Math.floor(y / BLOCK))
}

export function drawWipe(g: CanvasRenderingContext2D, frame: WipeFrame): void {
  if (frame.phase === 'done') return
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!blockCovered(frame, col, row)) continue
      const edge = frame.phase === 'cover' && col + row === frame.frontier
      g.globalAlpha = edge ? 0.85 : 1
      g.fillStyle = edge ? PALETTE.menuTop : PALETTE.ink
      g.fillRect(col * BLOCK, row * BLOCK, BLOCK, BLOCK)
      g.globalAlpha = 1
    }
  }
}
