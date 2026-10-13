// SPDX-License-Identifier: AGPL-3.0-or-later
// Plantilla común de las pantallas del menú v2 (docs/DISENO-V2.md, "Menús"): fondo con la trama de
// palos, cabecera, pozos, selección con esquinas oro que respiran, ayuda inferior con los símbolos
// del mando en oro y rótulos con degradado de 4 bandas. Todo se pinta en el canvas de 320×240.
import { CAP_HEIGHT, CAP_TOP, drawText, measure } from '../../font/bitmap.ts'
import type { Align } from '../../font/bitmap.ts'
import { HELP_BAR_TOP } from '../draw.ts'
import { PALETTE, mixHex } from '../palette.ts'

export const SCREEN_W = 320
export const SCREEN_H = 240
/** Alto de la cabecera (la línea de marco va en y = 21). */
export const HEADER_H = 22
/** Dónde va el icono 3D de la cabecera y a qué tamaño (unidades de malla → px). */
export const HEADER_ICON = Object.freeze({ x: 12, y: 11, size: 7 })

/** Degradados de rótulo: 4 bandas horizontales, de arriba abajo, sobre la altura de las mayúsculas. */
export const GRADIENTS = Object.freeze({
  gold: [PALETTE.goldHi, PALETTE.gold, PALETTE.gold, PALETTE.goldDark],
  fire: [PALETTE.goldHi, PALETTE.fire2, PALETTE.fire1, PALETTE.red],
  green: ['#c8f7d8', PALETTE.win, PALETTE.green, PALETTE.moneyTop],
  red: ['#ff9aa4', PALETTE.loss, PALETTE.red, PALETTE.jackpotBottom],
} as const)
export type GradientName = keyof typeof GRADIENTS

const SUITS = ['♠', '♥', '♦', '♣'] as const
const PATTERN_W = 24
const PATTERN_H = 22

/**
 * Desplazamiento de la trama de palos en el instante `t` (s): se desliza en diagonal a `pxPerS`
 * y vuelve a empezar cada rejilla (el patrón se repite cada 2 filas por el desfase alterno).
 */
export function patternOffset(t: number, pxPerS: number): { x: number; y: number } {
  const d = Math.floor(t * pxPerS)
  return { x: d % PATTERN_W, y: d % (PATTERN_H * 2) }
}

/** Fondo de todas las pantallas del menú: degradado `deepTop` → tinta y la trama de palos. */
export function drawMenuBackground(
  g: CanvasRenderingContext2D,
  t: number,
  pxPerS: number,
  still: boolean,
): void {
  const grad = g.createLinearGradient(0, 0, 0, SCREEN_H)
  grad.addColorStop(0, PALETTE.deepTop)
  grad.addColorStop(1, PALETTE.ink)
  g.fillStyle = grad
  g.fillRect(0, 0, SCREEN_W, SCREEN_H)
  const off = still ? { x: 0, y: 0 } : patternOffset(t, pxPerS)
  for (let row = -2; row * PATTERN_H < SCREEN_H + PATTERN_H; row++) {
    const y = row * PATTERN_H + off.y
    const shift = (((row % 2) + 2) % 2) * (PATTERN_W / 2)
    for (let col = -2; col * PATTERN_W < SCREEN_W + PATTERN_W; col++) {
      const x = col * PATTERN_W + shift + off.x
      const suit = SUITS[(((row + col) % 4) + 4) % 4]!
      drawText(g, suit, x, y, { color: PALETTE.patternInk })
    }
  }
}

/** Cabecera: banda de menú, título oro (deja sitio al icono 3D) y dato de contexto a la derecha. */
export function drawHeader(g: CanvasRenderingContext2D, title: string, right?: string): void {
  g.fillStyle = 'rgba(8,7,13,0.55)'
  g.fillRect(0, 0, SCREEN_W, HEADER_H)
  const grad = g.createLinearGradient(0, 0, 0, HEADER_H)
  grad.addColorStop(0, PALETTE.menuTop)
  grad.addColorStop(1, PALETTE.menuBottom)
  g.globalAlpha = 0.92
  g.fillStyle = grad
  g.fillRect(0, 0, SCREEN_W, HEADER_H - 2)
  g.globalAlpha = 1
  g.fillStyle = PALETTE.frameInner
  g.fillRect(0, 20, SCREEN_W, 1)
  g.fillStyle = PALETTE.frame
  g.fillRect(0, 21, SCREEN_W, 1)
  drawText(g, title, 24, 7, { color: PALETTE.gold, shadow: PALETTE.ink })
  if (right)
    drawText(g, right, 314, 7, { color: PALETTE.cream, align: 'right', shadow: PALETTE.ink })
}

/** Pozo: lo no seleccionado (tinta al 55 % y borde de 1 px `line`). */
export function drawWell(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.fillStyle = 'rgba(8,7,13,0.55)'
  g.fillRect(x, y, w, h)
  g.fillStyle = PALETTE.line
  g.fillRect(x, y, w, 1)
  g.fillRect(x, y + h - 1, w, 1)
  g.fillRect(x, y, 1, h)
  g.fillRect(x + w - 1, y, 1, h)
}

/** Banda de la fila seleccionada. */
export function drawBand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.fillStyle = PALETTE.menuTop
  g.fillRect(x, y, w, h)
}

/** Separación de las esquinas (px por fuera de la caja) en el paso `step` de la respiración. */
const BREATH = [2, 3, 4, 3] as const

/** Cuánto se separan las esquinas en el instante `t` (s): a saltos, un paso cada `stepMs`. */
export function cornerGap(t: number, stepMs: number, still: boolean): number {
  if (still) return BREATH[0]
  return BREATH[Math.floor((t * 1000) / stepMs) % BREATH.length]!
}

/**
 * Esquinas oro alrededor de una caja (la única selección de cada pantalla): brazos de `arm` px y
 * `thick` de grosor, a `gap` px por fuera.
 */
export function drawCorners(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  gap: number,
  arm = 6,
  thick = 2,
): void {
  g.fillStyle = PALETTE.gold
  const l = x - gap - thick
  const r = x + w + gap
  const top = y - gap - thick
  const bottom = y + h + gap
  for (const [cx, cy, sx, sy] of [
    [l, top, 1, 1],
    [r, top, -1, 1],
    [l, bottom, 1, -1],
    [r, bottom, -1, -1],
  ] as const) {
    // Brazo horizontal y vertical, hacia dentro de la caja.
    g.fillRect(sx > 0 ? cx : cx + thick - arm, cy, arm, thick)
    g.fillRect(cx, sy > 0 ? cy : cy + thick - arm, thick, arm)
  }
}

/** Separación entre el símbolo y su etiqueta (con teclas, "X ABRIR" no puede leerse "XABRIR"). */
const KEY_GAP = 4

export interface HelpItem {
  /** Símbolo del mando o de la tecla (✕, X, ←→…): va en oro. */
  key: string
  /** Etiqueta: va en apagado. */
  label: string
}

/** Ancho total de la ayuda inferior (símbolo + 2 px + etiqueta, separados 10 px). */
export function helpWidth(items: readonly HelpItem[]): number {
  return items.reduce(
    (w, item, i) => w + measure(item.key) + KEY_GAP + measure(item.label) + (i > 0 ? 10 : 0),
    0,
  )
}

/** Barra inferior (222–239): símbolos en oro y etiquetas en apagado, centrados. */
export function drawHelp(g: CanvasRenderingContext2D, items: readonly HelpItem[]): void {
  g.fillStyle = 'rgba(8,7,13,0.92)'
  g.fillRect(0, HELP_BAR_TOP, SCREEN_W, SCREEN_H - HELP_BAR_TOP)
  g.fillStyle = PALETTE.frameInner
  g.fillRect(0, HELP_BAR_TOP, SCREEN_W, 1)
  let x = Math.round((SCREEN_W - helpWidth(items)) / 2)
  items.forEach((item, i) => {
    if (i > 0) x += 10
    x += drawText(g, item.key, x, 228, { color: PALETTE.gold }) + KEY_GAP
    x += drawText(g, item.label, x, 228, { color: PALETTE.muted })
  })
}

export interface GradientTextOptions {
  scale: number
  align?: Align
  /** Contorno de tinta (px). 0 = sin contorno. */
  outline?: number
  /** Color de la sombra dura (desplazada `max(2, escala/2)` px). */
  shadow?: string
}

/** Filas (relativas a la parte de arriba de las mayúsculas) donde empieza cada banda. */
export function bandRows(scale: number): number[] {
  const cap = CAP_HEIGHT * scale
  return [0, 1, 2, 3].map(i => Math.round((cap * i) / 4))
}

/**
 * Rótulo grande con degradado de 4 bandas a escalones, contorno de tinta y sombra dura.
 * `y` es la parte de arriba de las mayúsculas, como en `drawText`. Devuelve el ancho.
 */
export function drawGradientText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bands: readonly string[],
  opts: GradientTextOptions,
): number {
  const { scale } = opts
  const align = opts.align ?? 'left'
  const outline = opts.outline ?? 1
  const width = measure(text, scale)
  const left = Math.round(align === 'center' ? x - width / 2 : align === 'right' ? x - width : x)
  const base = { scale, align: 'left' as const }
  if (opts.shadow) {
    const d = Math.max(2, Math.floor(scale / 2))
    drawText(g, text, left + d, y + d, { ...base, color: opts.shadow })
  }
  for (let ox = -outline; ox <= outline; ox++) {
    for (let oy = -outline; oy <= outline; oy++) {
      if (ox === 0 && oy === 0) continue
      drawText(g, text, left + ox, y + oy, { ...base, color: PALETTE.ink })
    }
  }
  // Cada banda se pinta recortada a sus filas; lo que sobresale (acentos, descendentes) se queda
  // con la banda de arriba o la de abajo.
  const rows = bandRows(scale)
  const top = Math.round(y)
  const glyphTop = top - CAP_TOP * scale
  const glyphBottom = glyphTop + 12 * scale
  bands.forEach((color, i) => {
    const from = i === 0 ? glyphTop : top + rows[i]!
    const to = i === bands.length - 1 ? glyphBottom : top + rows[i + 1]!
    g.save()
    g.beginPath()
    g.rect(left - 1, from, width + 2, to - from)
    g.clip()
    drawText(g, text, left, y, { ...base, color })
    g.restore()
  })
  return width
}

/** Barra de progreso de 1 color sobre un pozo (logros, tiradas pendientes). */
export function drawBar(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fraction: number,
  color: string = PALETTE.gold,
): void {
  g.fillStyle = PALETTE.ink
  g.fillRect(x, y, w, h)
  g.fillStyle = PALETTE.frameInner
  g.fillRect(x, y, w, 1)
  g.fillRect(x, y + h - 1, w, 1)
  g.fillRect(x, y, 1, h)
  g.fillRect(x + w - 1, y, 1, h)
  const inner = Math.round((w - 2) * Math.max(0, Math.min(1, fraction)))
  if (inner > 0) {
    g.fillStyle = color
    g.fillRect(x + 1, y + 1, inner, h - 2)
  }
}

/** Texto recortado con "…" para que quepa en `maxWidth`. */
export function fit(text: string, maxWidth: number, scale = 1): string {
  if (measure(text, scale) <= maxWidth) return text
  let out = text
  while (out.length > 1 && measure(`${out}…`, scale) > maxWidth) out = out.slice(0, -1)
  return `${out}…`
}

/** Color del número dentro de una casilla: crema sobre rojo y negro, tinta sobre el verde. */
export function pocketText(color: 'red' | 'black' | 'green'): string {
  return color === 'green' ? PALETTE.ink : PALETTE.cream
}

/**
 * Color del fondo de una ventana (`drawWindow`, degradado vertical) en la fila `y`: para comprobar
 * el contraste del texto según dónde cae.
 */
export function windowColorAt(
  top: number,
  height: number,
  y: number,
  from: string = PALETTE.menuTop,
  to: string = PALETTE.menuBottom,
): string {
  return mixHex(from, to, Math.max(0, Math.min(1, (y - top) / height)))
}

/** Texto secundario dentro de ventanas: apagado solo donde el fondo ya es oscuro (≥ 4,5:1). */
export const SECONDARY = PALETTE.creamLo
