// SPDX-License-Identifier: AGPL-3.0-or-later
// Aviso de mesa cerrada (tope diario de tiradas): "MESA CERRADA" en un letrero de neón que
// parpadea como uno de bar a la hora de cerrar (quieto con `prefers-reduced-motion`), cuántas
// tiradas lleva hoy, una frase de broma, a qué hora reabre y, discreta, la línea de ayuda de verdad
// del idioma. ✕ u ○ lo cierran; con ayuda, △ (o pulsar su línea) la abre en otra pestaña.
import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, measure, wrap } from '../../font/bitmap.ts'
import type { DailyLimitNotice } from '../../game/dailyLimit.ts'
import { dim, drawWindow } from '../draw.ts'
import { GRADIENTS, drawGradientText } from '../menu/kit.ts'
import { PALETTE } from '../palette.ts'

/** Ventana del aviso, en píxeles del framebuffer de 320×240. */
const BOX = { x: 24, y: 36, w: 272, h: 168 } as const
const TEXT_W = BOX.w - 24

/** Brillo del neón en el instante `t` (s): casi siempre encendido, con algún parpadeo corto. */
export function neonOn(t: number, still: boolean): boolean {
  if (still) return true
  // Un ciclo de 3,2 s con dos apagones breves, como un tubo cansado.
  const phase = t % 3.2
  return !((phase > 2.6 && phase < 2.68) || (phase > 2.78 && phase < 2.84))
}

export class DailyLimitScreen implements Screen {
  readonly id = 'dailyLimit'
  private readonly ctx: AppContext
  private notice: DailyLimitNotice
  /** Zona de la línea de ayuda (para pulsarla), si se ha pintado. */
  private helpRow: { top: number; bottom: number } | null = null

  constructor(ctx: AppContext, notice: DailyLimitNotice) {
    this.ctx = ctx
    this.notice = notice
  }

  /** Otro aviso con la mesa aún cerrada (otro prompt, otro GIRAR): se actualiza sin apilarse. */
  replace(notice: DailyLimitNotice): void {
    this.notice = notice
  }

  action(e: ActionEvent): void {
    if (e.action === 'clear' && this.notice.help) {
      this.ctx.openLink(this.notice.help.link.url)
      return
    }
    if (e.action === 'accept' || e.action === 'back' || e.action === 'start') {
      this.ctx.sfx.play('back')
      this.ctx.pop(this)
    }
  }

  pointer(kind: 'move' | 'down' | 'leave', _x: number, y: number): boolean {
    if (kind !== 'down') return true
    const row = this.helpRow
    if (row && this.notice.help && y >= row.top && y <= row.bottom) {
      this.ctx.openLink(this.notice.help.link.url)
      return true
    }
    this.action({ action: 'accept', fine: false })
    return true
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const n = this.notice
    dim(g, 0.6)
    drawWindow(g, BOX.x, BOX.y, BOX.w, BOX.h, { top: PALETTE.alertTop, bottom: PALETTE.ink })

    // Letrero: oro encendido; apagado, el mismo texto en tinta tenue.
    let y = BOX.y + 14
    for (const line of wrap(n.title, TEXT_W, 2)) {
      const lit = neonOn(t, this.ctx.reducedMotion)
      const x = Math.round(160 - measure(line, 2) / 2)
      if (lit) {
        drawGradientText(g, line, x, y, GRADIENTS.gold, { scale: 2, shadow: PALETTE.ink })
      } else {
        drawText(g, line, x, y, { color: PALETTE.goldDark, scale: 2 })
      }
      y += 22
    }
    for (const line of wrap(n.count, TEXT_W)) {
      drawText(g, line, 160, y, { color: PALETTE.cream, align: 'center', shadow: PALETTE.ink })
      y += 11
    }
    y += 6
    for (const line of wrap(`“${n.phrase}”`, TEXT_W)) {
      drawText(g, line, 160, y, { color: PALETTE.goldHi, align: 'center', shadow: PALETTE.ink })
      y += 11
    }
    y += 6
    drawText(g, n.reopens, 160, y, { color: PALETTE.gold, align: 'center', shadow: PALETTE.ink })
    y += 16

    // La ayuda, pequeña y en gris: está, pero no grita.
    this.helpRow = null
    if (n.help) {
      const top = y - 2
      for (const line of wrap(n.help.text, TEXT_W)) {
        drawText(g, line, 160, y, { color: PALETTE.muted, align: 'center' })
        y += 11
      }
      this.helpRow = { top, bottom: y }
    }

    // Pie: ✕ VALE (y △ la ayuda, si hay).
    const b = this.ctx.buttons()
    const parts: [string, string][] = [[b.x, tr.t('dailyLimit.ok')]]
    if (n.help) parts.push([b.tri, n.help.link.label])
    const gap = 16
    const width = parts.reduce(
      (acc, [key, label], i) => acc + (i > 0 ? gap : 0) + measure(key) + 4 + measure(label),
      0,
    )
    let x = Math.round(160 - width / 2)
    const footY = BOX.y + BOX.h - 14
    parts.forEach(([key, label], i) => {
      if (i > 0) x += gap
      x += drawText(g, key, x, footY, { color: PALETTE.gold, shadow: PALETTE.ink }) + 4
      x += drawText(g, label, x, footY, { color: PALETTE.cream, shadow: PALETTE.ink })
    })
  }
}
