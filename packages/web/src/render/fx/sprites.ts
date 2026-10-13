// SPDX-License-Identifier: AGPL-3.0-or-later
// Sprites pixel art de las animaciones (docs/DISENO-V2.md): el cohete de PUSH TO PROD con su llama,
// el humo, el banquero del Ludo-Crédito, la llama pequeña de ON FIRE y la pluma de la firma.
// Rejillas de caracteres: cada letra es un color de la paleta y '.' es transparente.
import { PALETTE } from '../../ui/palette.ts'

export type SpriteRows = readonly string[]
export type SpriteColors = Readonly<Record<string, string>>

/** Cohete de 9×13 (R = rojo, C = crema, B = azul de ficha, G = acero). */
export const ROCKET: SpriteRows = [
  '....R....',
  '...RRR...',
  '...CCC...',
  '..CCCCC..',
  '..CCBCC..',
  '..CBBBC..',
  '..CCBCC..',
  '..CCCCC..',
  '..CCCCC..',
  '.RCCCCCR.',
  'RRCCCCCRR',
  'RR.GGG.RR',
  'R..GGG..R',
]

export const ROCKET_COLORS: SpriteColors = {
  R: PALETTE.red,
  C: PALETTE.cream,
  B: PALETTE.chipBlue,
  G: PALETTE.steel,
}

/** Llama del cohete: dos fotogramas que se alternan (O = fuego 1, Y = fuego 2). */
export const ROCKET_FLAME: readonly SpriteRows[] = [
  ['...O.O...', '..OYOYO..', '...OYO...', '....O....'],
  ['..O...O..', '...OYO...', '..OYYYO..', '...OYO...', '....O....'],
]

export const FLAME_COLORS: SpriteColors = { O: PALETTE.fire1, Y: PALETTE.fire2 }

/** Llama fija de 8×8 (ON FIRE con movimiento reducido). */
export const FLAME_ICON: SpriteRows = [
  '...O....',
  '...OO...',
  '..OYO...',
  '..OYYO..',
  '.OYHYO..',
  '.OYHHYO.',
  '.OYHHYO.',
  '..OOOO..',
]

export const FLAME_ICON_COLORS: SpriteColors = {
  O: PALETTE.fire1,
  Y: PALETTE.fire2,
  H: PALETTE.goldHi,
}

/** Pinta una rejilla a escala entera con la esquina superior izquierda en (x, y). */
export function drawSprite(
  g: CanvasRenderingContext2D,
  rows: SpriteRows,
  colors: SpriteColors,
  x: number,
  y: number,
  scale = 1,
): void {
  const ox = Math.round(x)
  const oy = Math.round(y)
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const color = colors[row[i]!]
      if (!color) continue
      g.fillStyle = color
      g.fillRect(ox + i * scale, oy + j * scale, scale, scale)
    }
  })
}

/** Bocanada de humo: círculos grises a escalones que crecen y se apagan (k = 0–1). */
export function drawSmoke(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  k: number,
  seed: number,
) {
  const puffs = 7
  for (let i = 0; i < puffs; i++) {
    const a = ((i * 137.5 + seed * 53) % 360) * (Math.PI / 180)
    const spread = 4 + k * 16
    const x = Math.round(cx + Math.cos(a) * spread * (0.6 + (i % 3) * 0.25))
    const y = Math.round(cy + Math.abs(Math.sin(a)) * spread * 0.45)
    const r = Math.max(1, Math.round(3 + k * 4 - (i % 2)))
    g.fillStyle = i % 3 === 0 ? PALETTE.frame : PALETTE.muted
    g.globalAlpha = Math.max(0, 1 - k * 0.8)
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy))
      g.fillRect(x - half, y + dy, half * 2 + 1, 1)
    }
  }
  g.globalAlpha = 1
}

/**
 * El banquero del Ludo-Crédito, "low-poly" en 2D: cabeza de caja con dos caras de distinto tono,
 * chistera con banda roja, monóculo oro, bigote, traje negro, camisa y corbata roja. 28×56 px con
 * la esquina superior izquierda en (x, y). `blink` cierra los ojos.
 */
export function drawBanker(g: CanvasRenderingContext2D, x: number, y: number, blink: boolean) {
  const r = (dx: number, dy: number, w: number, h: number, color: string) => {
    g.fillStyle = color
    g.fillRect(Math.round(x + dx), Math.round(y + dy), w, h)
  }
  // Chistera: copa, banda roja y ala.
  r(7, 0, 14, 12, PALETTE.black)
  r(8, 0, 4, 12, '#2c2a36')
  r(7, 8, 14, 3, PALETTE.red)
  r(4, 12, 20, 2, PALETTE.black)
  // Cabeza de caja: cara frontal y cara lateral más oscura (sombreado plano por cara).
  r(6, 14, 16, 16, PALETTE.skin)
  r(18, 14, 4, 16, '#b07c5a')
  r(6, 14, 16, 1, '#e8b996')
  // Ojos (o párpados) y monóculo.
  if (blink) {
    r(9, 20, 3, 1, PALETTE.ink)
    r(15, 20, 3, 1, PALETTE.ink)
  } else {
    r(10, 19, 2, 2, PALETTE.ink)
    r(15, 19, 2, 2, PALETTE.ink)
  }
  g.fillStyle = PALETTE.gold
  g.fillRect(Math.round(x + 14), Math.round(y + 17), 5, 1)
  g.fillRect(Math.round(x + 14), Math.round(y + 22), 5, 1)
  g.fillRect(Math.round(x + 13), Math.round(y + 18), 1, 4)
  g.fillRect(Math.round(x + 19), Math.round(y + 18), 1, 4)
  r(19, 22, 1, 6, PALETTE.goldDark)
  // Bigote y boca.
  r(9, 24, 10, 2, '#4a2a1a')
  r(12, 27, 4, 1, '#8a4a3a')
  // Cuello, traje, camisa en V y corbata.
  r(10, 30, 8, 2, '#b07c5a')
  r(1, 32, 26, 24, PALETTE.black)
  r(1, 32, 4, 24, '#2c2a36')
  r(10, 32, 8, 10, PALETTE.cream)
  r(11, 42, 6, 3, PALETTE.cream)
  r(13, 32, 2, 3, PALETTE.red)
  r(12, 35, 4, 9, PALETTE.red)
  r(13, 44, 2, 2, PALETTE.red)
  // Solapas.
  r(8, 32, 2, 12, '#2c2a36')
  r(18, 32, 2, 12, '#2c2a36')
}

/** Pluma de la firma (8×10): la punta en (x, y). */
export function drawPen(g: CanvasRenderingContext2D, x: number, y: number): void {
  const px = Math.round(x)
  const py = Math.round(y)
  g.fillStyle = PALETTE.ink
  g.fillRect(px, py, 1, 1)
  g.fillStyle = PALETTE.goldDark
  g.fillRect(px + 1, py - 2, 1, 2)
  g.fillRect(px + 2, py - 3, 1, 1)
  g.fillStyle = PALETTE.red
  for (let i = 0; i < 6; i++) g.fillRect(px + 2 + i, py - 4 - i, 2, 1)
  g.fillStyle = PALETTE.cream
  g.fillRect(px + 7, py - 10, 2, 2)
}
