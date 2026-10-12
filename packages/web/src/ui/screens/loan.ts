// SPDX-License-Identifier: AGPL-3.0-or-later
// "Ludo-Crédito Express": el diálogo del préstamo, con su TAE absurdo (de la configuración) y su
// letra pequeña ridícula. Aceptar solo manda `loan.request`; el dinero llega con `loan.granted`.
import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, wrap } from '../../font/bitmap.ts'
import { dim, drawWindow } from '../draw.ts'
import { ListMenu } from '../listMenu.ts'
import { PALETTE } from '../palette.ts'

export class LoanScreen implements Screen {
  readonly id = 'loan'
  private readonly ctx: AppContext
  private readonly menu: ListMenu
  private pending = false

  constructor(ctx: AppContext) {
    this.ctx = ctx
    this.menu = new ListMenu(ctx, 'loan', [
      {
        label: () => ctx.tr.t('loan.accept'),
        accept: () => {
          if (this.pending) return
          this.pending = ctx.send({ type: 'loan.request' })
          if (!this.pending) ctx.sfx.play('error')
        },
      },
      { label: () => ctx.tr.t('loan.decline'), accept: () => this.close() },
    ])
  }

  /** El servidor concedió el préstamo (o lo rechazó): el diálogo se cierra. */
  close(): void {
    this.ctx.pop(this)
  }

  action(e: ActionEvent): void {
    if (this.menu.action(e)) return
    if (e.action === 'back') {
      this.ctx.sfx.play('back')
      this.close()
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr, web } = this.ctx
    const loan = web.game.loan
    dim(g, 0.55)
    drawWindow(g, 18, 26, 284, 188)
    drawText(g, tr.t('loan.title'), 160, 36, {
      color: PALETTE.gold,
      scale: 2,
      align: 'center',
      shadow: PALETTE.ink,
    })
    let y = 60
    for (const line of wrap(tr.t('loan.pitch', { amount: tr.n(loan.amount) }), 264)) {
      drawText(g, line, 28, y, { color: PALETTE.cream, shadow: PALETTE.ink })
      y += 11
    }
    y += 3
    const terms = tr.t('loan.terms', {
      apr: tr.n(loan.displayApr),
      interest: String(Math.round(loan.interestPerSpin * 1000) / 10),
    })
    for (const line of wrap(terms, 264)) {
      drawText(g, line, 28, y, { color: PALETTE.loss, shadow: PALETTE.ink })
      y += 11
    }
    this.menu.draw(g, 34, y + 8, 240, 15, t)
    y += 8 + 2 * 15 + 4
    if (this.pending) {
      drawText(g, tr.t('loan.pending'), 160, y, { color: PALETTE.muted, align: 'center' })
      y += 11
    }
    g.fillStyle = PALETTE.frameInner
    g.fillRect(28, y, 264, 1)
    y += 5
    // La letra pequeña: en gris, apretada y larguísima, como debe ser.
    for (const line of wrap(tr.t('loan.fine'), 264)) {
      drawText(g, line, 28, y, { color: PALETTE.line })
      y += 9
    }
  }
}
