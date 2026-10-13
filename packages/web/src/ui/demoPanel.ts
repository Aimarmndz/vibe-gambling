// SPDX-License-Identifier: AGPL-3.0-or-later
// Mandos de la demo bajo el panel de racha y tiradas: AUTO/PAUSA (tecla A, L1 en el mando) y GIRAR
// (G, SELECT). Se pintan como el resto del HUD y son clicables o tocables fila a fila.
import type { AppContext } from '../app/context.ts'
import { drawText, measure } from '../font/bitmap.ts'
import { drawWindow } from './draw.ts'
import { PALETTE } from './palette.ts'

/** Ventana de los mandos (misma columna que el panel de racha). */
export const DEMO_PANEL = Object.freeze({ x: 222, w: 94, h: 29, row: 11 })

/** ¿Se puede GIRAR ya? Sin bola en juego (girando o cayendo) ni GIRAR TODAS en marcha. */
export function demoSpinReady(ctx: AppContext): boolean {
  const phase = ctx.state().phase
  return (
    ctx.connection() === 'open' &&
    (phase === 'idle' || phase === 'result') &&
    !ctx.spinAll().running
  )
}

/** Icono de pausa: dos barras de 2×7 con sombra (la fuente no tiene "‖"). */
function drawPauseIcon(g: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  g.fillStyle = PALETTE.ink
  g.fillRect(x + 1, y + 4, 2, 7)
  g.fillRect(x + 5, y + 4, 2, 7)
  g.fillStyle = color
  g.fillRect(x, y + 3, 2, 7)
  g.fillRect(x + 4, y + 3, 2, 7)
}

/** Pinta los mandos con su borde superior en `y`. */
export function drawDemoPanel(
  g: CanvasRenderingContext2D,
  ctx: AppContext,
  y: number,
  auto: boolean,
): void {
  const { tr } = ctx
  const b = ctx.buttons()
  const { x, w, h, row } = DEMO_PANEL
  const hover = ctx.hoverId()
  drawWindow(g, x, y, w, h)
  const ready = demoSpinReady(ctx)
  const rows = [
    { id: 'demo:auto', key: b.auto, y: y + 6, onClick: () => ctx.toggleDemoAuto() },
    { id: 'demo:spin', key: b.sel, y: y + 6 + row, onClick: () => void ctx.demoSpin() },
  ]
  for (const r of rows) {
    const over = hover === r.id
    // Fila bajo el ratón: un velo crema suave, como el destello del contador de pendientes.
    if (over) {
      g.fillStyle = 'rgba(243,234,214,0.15)'
      g.fillRect(x + 2, r.y - 2, w - 4, row)
    }
    drawText(g, r.key, x + 6, r.y, { color: PALETTE.gold, shadow: PALETTE.ink })
    ctx.hits.add({ x, y: r.y - 3, w, h: row, id: r.id, onClick: r.onClick })
  }
  // AUTO en verde con ►; PAUSA en oro con sus dos barras.
  const right = x + w - 6
  const modeY = rows[0]!.y
  if (auto) {
    const label = `► ${tr.t('demo.auto')}`
    drawText(g, label, right, modeY, { color: PALETTE.win, align: 'right', shadow: PALETTE.ink })
  } else {
    const label = tr.t('demo.paused')
    const lw = drawText(g, label, right, modeY, {
      color: PALETTE.gold,
      align: 'right',
      shadow: PALETTE.ink,
    })
    drawPauseIcon(g, right - lw - 10, modeY, PALETTE.gold)
  }
  const spinColor = !ready ? PALETTE.muted : hover === 'demo:spin' ? PALETTE.gold : PALETTE.cream
  drawText(g, tr.t('demo.spin'), right, rows[1]!.y, {
    color: spinColor,
    align: 'right',
    shadow: PALETTE.ink,
  })
}

/** Ancho que ocupa cada fila (para comprobar que cabe en todos los idiomas). */
export function demoPanelRowWidths(ctx: AppContext): number[] {
  const { tr } = ctx
  const b = ctx.buttons()
  return [
    measure(b.auto) +
      4 +
      Math.max(measure(`► ${tr.t('demo.auto')}`), measure(tr.t('demo.paused')) + 10),
    measure(b.sel) + 4 + measure(tr.t('demo.spin')),
  ]
}
