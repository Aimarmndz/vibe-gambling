// SPDX-License-Identifier: AGPL-3.0-or-later
// "Cómo se juega": sale una vez en la primera apertura (tras el arranque) y desde el menú. Explica
// lo que la mesa no puede enseñar con un botón: la ruleta gira con cada prompt de Claude Code.
import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, wrap } from '../../font/bitmap.ts'
import { dim, drawHelpBar, drawWindow } from '../draw.ts'
import { PALETTE } from '../palette.ts'

const WIDTH = 272
const TEXT_W = WIDTH - 24

export class TipScreen implements Screen {
  readonly id = 'tip'
  private readonly ctx: AppContext
  private readonly onClose: () => void
  private closed = false

  constructor(ctx: AppContext, onClose: () => void = () => undefined) {
    this.ctx = ctx
    this.onClose = onClose
  }

  /** Las líneas del aviso en el idioma actual (también para la región aria-live). */
  lines(): string[] {
    const { tr, demo } = this.ctx
    return [
      tr.t('tip.1', { ...this.ctx.buttons() }),
      demo ? tr.t('tip.2demo', { ...this.ctx.buttons() }) : tr.t('tip.2'),
      tr.t('tip.3'),
    ]
  }

  private close(): void {
    if (this.closed) return
    this.closed = true
    this.ctx.sfx.play('accept')
    this.ctx.pop(this)
    this.onClose()
  }

  action(e: ActionEvent): void {
    if (e.action === 'accept' || e.action === 'back' || e.action === 'start') this.close()
  }

  pointer(kind: 'move' | 'down' | 'leave'): boolean {
    if (kind === 'down') this.close()
    return true
  }

  draw(g: CanvasRenderingContext2D): void {
    const { tr } = this.ctx
    const paragraphs = this.lines().map(line => wrap(line, TEXT_W))
    const rows = paragraphs.reduce((n, p) => n + p.length, 0)
    const h = 34 + rows * 11 + (paragraphs.length - 1) * 5
    const x = 160 - WIDTH / 2
    const y = Math.max(8, Math.round(112 - h / 2))
    dim(g, 0.55)
    drawWindow(g, x, y, WIDTH, h)
    drawText(g, tr.t('tip.title'), 160, y + 8, {
      color: PALETTE.gold,
      align: 'center',
      shadow: PALETTE.ink,
    })
    let ty = y + 26
    for (const p of paragraphs) {
      for (const line of p) {
        drawText(g, line, x + 12, ty, { color: PALETTE.cream, shadow: PALETTE.ink })
        ty += 11
      }
      ty += 5
    }
    drawHelpBar(g, tr.t('tip.ok', { ...this.ctx.buttons() }), PALETTE.gold)
  }
}
