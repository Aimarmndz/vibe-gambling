// SPDX-License-Identifier: AGPL-3.0-or-later
// La marca de vibe-gambling (ficha con el prompt ">_") pintada píxel a píxel en el canvas de
// 320×240. La fuente de verdad son los SVG de docs/brand/ (1 rect = 1 píxel): aquí solo se leen.
import mark16 from '../../../../docs/brand/logo-mark-16.svg?raw'
import mark32 from '../../../../docs/brand/logo-mark.svg?raw'

import { PALETTE } from './palette.ts'

export interface MarkPixel {
  x: number
  y: number
  w: number
  h: number
  color: string
  /** Parte del "_" del prompt (parpadea en el icono de guardado). */
  cursor: boolean
}

export interface BrandMark {
  size: number
  pixels: readonly MarkPixel[]
}

const RECT = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(#[0-9a-fA-F]{6})"\/>/g
const GOLD = '#f2c14e'

/**
 * Lee los `rect` de un SVG de la marca. El "_" del prompt son los píxeles oro de la fila baja del
 * centro (entre el 50 % y el 70 % de ancho y el 55 % y el 65 % de alto).
 */
export function parseMark(svg: string, size: number): BrandMark {
  const pixels: MarkPixel[] = []
  for (const m of svg.matchAll(RECT)) {
    const [x, y, w, h] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number]
    const color = m[5]!.toLowerCase()
    const cursor =
      color === GOLD &&
      x >= size * 0.5 &&
      x + w <= size * 0.7 &&
      y >= size * 0.55 &&
      y < size * 0.65
    pixels.push({ x, y, w, h, color, cursor })
  }
  if (pixels.length === 0) throw new Error('la marca no tiene píxeles')
  return { size, pixels }
}

let cache: { small: BrandMark; large: BrandMark } | null = null

/** Las dos marcas: la de 16×16 (redibujada a mano) y la de 32×32. */
export function brandMarks(): { small: BrandMark; large: BrandMark } {
  cache ??= { small: parseMark(mark16, 16), large: parseMark(mark32, 32) }
  return cache
}

/** Pinta la marca a escala entera con su esquina superior izquierda en (x, y). */
export function drawMark(
  g: CanvasRenderingContext2D,
  mark: BrandMark,
  x: number,
  y: number,
  scale: number,
  cursorOn = true,
): void {
  for (const p of mark.pixels) {
    // El "_" apagado deja ver el centro de tinta de la ficha.
    g.fillStyle = p.cursor && !cursorOn ? PALETTE.ink : p.color
    g.fillRect(x + p.x * scale, y + p.y * scale, p.w * scale, p.h * scale)
  }
}
