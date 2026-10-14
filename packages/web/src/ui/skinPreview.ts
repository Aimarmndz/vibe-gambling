// SPDX-License-Identifier: AGPL-3.0-or-later
// Vista previa de un tapete y un juego de fichas (ARMARIO): un trozo de mesa en miniatura con su
// paño, sus líneas de tiza, unas casillas y tres pilas de fichas.
import type { FeltSkin, ChipSkin } from '../render/skins.ts'
import { chipColor } from '../render/skins.ts'
import { fillCircle } from './draw.ts'
import { PALETTE } from './palette.ts'

/** Números de la miniatura (fila de arriba del tapete: 3, 6, 9, 12…). */
const CELLS = [
  { n: 3, color: PALETTE.red },
  { n: 6, color: PALETTE.black },
  { n: 9, color: PALETTE.red },
  { n: 12, color: PALETTE.red },
  { n: 15, color: PALETTE.black },
] as const

export function drawSkinPreview(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  felt: FeltSkin,
  chips: ChipSkin,
  drawNumber: (text: string, cx: number, cy: number) => void,
): void {
  // Paño con un poco de grano a cuadros.
  g.fillStyle = felt.felt
  g.fillRect(x, y, w, h)
  g.fillStyle = felt.feltDark
  for (let j = 0; j < h; j += 3) {
    for (let i = (j / 3) % 2; i < w; i += 4) g.fillRect(x + i, y + j, 1, 1)
  }
  // Fila de casillas con su tiza, y la franja de las sencillas debajo.
  const cw = Math.floor((w - 12) / CELLS.length)
  const cx0 = x + 6
  const cy0 = y + 6
  const ch = 14
  CELLS.forEach((cell, i) => {
    const cx = cx0 + i * cw
    g.fillStyle = cell.color
    g.fillRect(cx, cy0, cw, ch)
    drawNumber(String(cell.n), cx + cw / 2, cy0 + 4)
  })
  g.fillStyle = felt.chalk
  g.fillRect(cx0, cy0, cw * CELLS.length + 1, 1)
  g.fillRect(cx0, cy0 + ch, cw * CELLS.length + 1, 1)
  g.fillRect(cx0, cy0 + ch + 12, cw * CELLS.length + 1, 1)
  for (let i = 0; i <= CELLS.length; i++) g.fillRect(cx0 + i * cw, cy0, 1, ch + 13)
  // Tres pilas de fichas encima: la menor, la del medio y la mayor del juego.
  const stacks = [0, 2, 4]
  stacks.forEach((index, i) => {
    const sx = cx0 + cw / 2 + i * cw * 2
    const color = chipColor(chips, index)
    for (let k = 0; k < 3 - i; k++) {
      const sy = y + h - 10 - k * 3
      fillCircle(g, sx, sy + 1, 6, PALETTE.ink)
      fillCircle(g, sx, sy, 6, color)
      drawChipMark(g, chips, sx, sy)
    }
  })
}

/** El dibujo de la cara de cada estilo, en pequeño. */
function drawChipMark(g: CanvasRenderingContext2D, chips: ChipSkin, x: number, y: number): void {
  switch (chips.style) {
    case 'classic':
      g.fillStyle = PALETTE.cream
      g.fillRect(x - 6, y, 2, 1)
      g.fillRect(x + 4, y, 2, 1)
      g.fillRect(x, y - 6, 1, 2)
      g.fillRect(x, y + 4, 1, 2)
      return
    case 'floppy':
      g.fillStyle = PALETTE.steel
      g.fillRect(x - 3, y - 4, 6, 3)
      g.fillStyle = PALETTE.cream
      g.fillRect(x - 3, y + 1, 6, 3)
      return
    case 'coin':
      g.fillStyle = 'rgba(8,7,13,0.35)'
      g.fillRect(x - 1, y - 2, 2, 4)
      return
    case 'cap':
      g.fillStyle = 'rgba(8,7,13,0.45)'
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2
        g.fillRect(Math.round(x + Math.cos(a) * 5), Math.round(y + Math.sin(a) * 5), 1, 1)
      }
      return
  }
}
