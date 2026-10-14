// SPDX-License-Identifier: AGPL-3.0-or-later
// Panel BOLSILLO del HUD (columna de la derecha, bajo la racha y los mandos de la demo): los
// objetos armados para la próxima ronda con sus cargas y, con la Pata de Conejo™ armada, el
// "+∞% SUERTE" parpadeando (fijo con movimiento reducido). Sin nada armado, no se pinta.
import type { AppContext } from '../app/context.ts'
import { drawText, measure } from '../font/bitmap.ts'
import { drawWindow } from './draw.ts'
import { ICON_SIZE, drawItemIcon } from './itemIcons.ts'
import { PALETTE } from './palette.ts'

/** Ventana del panel (misma columna que el de la racha). */
export const POCKET_PANEL = Object.freeze({ x: 222, w: 94, row: 11 })

/** Lo armado que se enseña (con el bolsillo congelado mientras cae la bola). */
export function armedForHud(ctx: AppContext): { id: string; charges: number }[] {
  const inv = ctx.state().shownInventory
  return (inv?.items ?? []).filter(i => i.armed && i.charges > 0)
}

/** Pinta el panel con su borde superior en `y`. Devuelve su alto (0 si no hay nada armado). */
export function drawPocketPanel(
  g: CanvasRenderingContext2D,
  ctx: AppContext,
  y: number,
  t: number,
): number {
  const armed = armedForHud(ctx)
  if (armed.length === 0) return 0
  const { x, w, row } = POCKET_PANEL
  const luck = armed.some(i => i.id === 'rabbit_foot')
  const h = 6 + row + (luck ? row : 0)
  drawWindow(g, x, y, w, h)
  // Iconos con sus cargas; si no caben las cifras, solo los iconos.
  const items = armed.map(i => ({ id: i.id, count: ctx.tr.n(i.charges) }))
  const full = items.reduce((acc, i) => acc + ICON_SIZE + 2 + measure(i.count) + 5, 0)
  const withCounts = full <= w - 8
  let cx = x + 5
  for (const item of items) {
    drawItemIcon(g, item.id as Parameters<typeof drawItemIcon>[1], cx, y + 4)
    cx += ICON_SIZE + 2
    if (withCounts) {
      cx += drawText(g, item.count, cx, y + 5, { color: PALETTE.cream, shadow: PALETTE.ink }) + 5
    } else cx += 3
  }
  if (luck) {
    const on = ctx.reducedMotion || Math.floor(t * 3) % 2 === 0
    drawText(g, ctx.tr.t('hud.luck'), x + w - 6, y + 5 + row, {
      color: on ? PALETTE.gold : PALETTE.cream,
      align: 'right',
      shadow: PALETTE.ink,
    })
  }
  return h
}
