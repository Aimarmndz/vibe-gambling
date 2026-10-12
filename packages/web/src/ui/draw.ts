// SPDX-License-Identifier: AGPL-3.0-or-later
// Primitivas de la interfaz a 320×240: ventanas de menú biseladas con degradado, círculos y
// rectángulos píxel a píxel, iconos pequeños y el registro de zonas clicables.
import { drawText } from '../font/bitmap.ts'
import { PALETTE } from './palette.ts'

/** Zona clicable registrada al pintar (se usa en el siguiente evento del ratón). */
export interface Hit {
  x: number
  y: number
  w: number
  h: number
  id: string
  onClick: () => void
}

export class Hits {
  private list: Hit[] = []

  clear(): void {
    this.list = []
  }

  add(hit: Hit): void {
    this.list.push(hit)
  }

  /** La zona más alta (la última pintada) bajo el punto. */
  at(x: number, y: number): Hit | null {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i]!
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h
    }
    return null
  }
}

/** Ventana de menú: degradado vertical azul, marco claro biselado y sombra dura. */
export function drawWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { shadow?: boolean; top?: string; bottom?: string } = {},
): void {
  x = Math.round(x)
  y = Math.round(y)
  if (opts.shadow !== false) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(x + 3, y + 3, w, h)
  }
  const grad = ctx.createLinearGradient(0, y, 0, y + h)
  grad.addColorStop(0, opts.top ?? PALETTE.menuTop)
  grad.addColorStop(1, opts.bottom ?? PALETTE.menuBottom)
  ctx.fillStyle = grad
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = PALETTE.frame
  ctx.fillRect(x, y, w, 1)
  ctx.fillRect(x, y + h - 1, w, 1)
  ctx.fillRect(x, y, 1, h)
  ctx.fillRect(x + w - 1, y, 1, h)
  ctx.fillStyle = PALETTE.frameInner
  ctx.fillRect(x + 1, y + 1, w - 2, 1)
  ctx.fillRect(x + 1, y + h - 2, w - 2, 1)
  ctx.fillRect(x + 1, y + 1, 1, h - 2)
  ctx.fillRect(x + w - 2, y + 1, 1, h - 2)
}

/** Círculo relleno sin antialias (píxeles enteros). */
export function fillCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = color
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.35)
    ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1)
  }
}

/** Barra inferior opaca con la ayuda del mando (tapa la de la mesa). */
export function drawHelpBar(ctx: CanvasRenderingContext2D, text: string, color: string): void {
  ctx.fillStyle = 'rgba(8,7,13,0.92)'
  ctx.fillRect(0, 222, ctx.canvas.width, 18)
  ctx.fillStyle = PALETTE.frameInner
  ctx.fillRect(0, 222, ctx.canvas.width, 1)
  drawText(ctx, text, ctx.canvas.width / 2, 228, { color, align: 'center' })
}

/** Oscurece toda la pantalla (detrás de un diálogo). */
export function dim(ctx: CanvasRenderingContext2D, alpha: number): void {
  ctx.fillStyle = `rgba(8,7,13,${alpha})`
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
}

/** Ficha de casino en miniatura (para el selector de fichas). */
export function drawChipIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  selected: boolean,
): void {
  fillCircle(ctx, cx, cy, 6, selected ? PALETTE.gold : PALETTE.ink)
  fillCircle(ctx, cx, cy, 5, color)
  ctx.fillStyle = PALETTE.cream
  ctx.fillRect(cx - 1, cy - 5, 2, 2)
  ctx.fillRect(cx - 1, cy + 4, 2, 2)
  ctx.fillRect(cx - 5, cy - 1, 2, 2)
  ctx.fillRect(cx + 4, cy - 1, 2, 2)
  fillCircle(ctx, cx, cy, 2, color)
}

/** Icono de memory card de 12×14 (genérico: una tarjeta con muescas y etiqueta). */
export function drawMemoryCardIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  blink: boolean,
): void {
  ctx.fillStyle = PALETTE.frame
  ctx.fillRect(x, y + 2, 12, 12)
  ctx.fillRect(x + 2, y, 8, 2)
  ctx.fillStyle = PALETTE.ink
  ctx.fillRect(x + 3, y + 1, 1, 1)
  ctx.fillRect(x + 5, y + 1, 1, 1)
  ctx.fillRect(x + 7, y + 1, 1, 1)
  ctx.fillStyle = blink ? PALETTE.gold : PALETTE.goldDark
  ctx.fillRect(x + 2, y + 5, 8, 6)
  ctx.fillStyle = PALETTE.ink
  ctx.fillRect(x + 3, y + 7, 6, 1)
}

/** Gema de la consola POLYGONE en 2D (para iconos de guardado). */
export function drawGemIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  phase: number,
): void {
  const w = Math.max(1, Math.round(size * Math.abs(Math.cos(phase))))
  for (let dy = -size; dy <= size; dy++) {
    const half = Math.round(((size - Math.abs(dy)) / size) * w)
    ctx.fillStyle = dy < 0 ? PALETTE.gold : PALETTE.goldDark
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1)
  }
}
