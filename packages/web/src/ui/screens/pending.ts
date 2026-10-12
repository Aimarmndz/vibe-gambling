// SPDX-License-Identifier: AGPL-3.0-or-later
// "Tiradas pendientes": los prompts que se mandaron con la ventana cerrada u oculta. Contador
// grande, GIRAR UNA / GIRAR TODAS y cómo funcionan. Sale desde el menú, desde el contador de la
// mesa y desde el aviso al abrir la ventana (`PendingNoticeScreen`). Pulsar GIRAR solo pide la
// tirada: la tira el servidor y llega como cualquier otra ronda. Es la versión funcional: el pase
// de diseño de las fases 8–9 (docs/DISENO-V2.md, "Tiradas pendientes") la vestirá.
import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, wrap } from '../../font/bitmap.ts'
import { canSpinPending, pendingSpins } from '../../game/state.ts'
import { BumpCounter } from '../counter.ts'
import { dim, drawHelpBar, drawWindow } from '../draw.ts'
import { ListMenu } from '../listMenu.ts'
import { PALETTE } from '../palette.ts'

const WIDTH = 264
const TEXT_W = WIDTH - 24

export class PendingScreen implements Screen {
  readonly id = 'pending'
  private readonly ctx: AppContext
  private readonly menu: ListMenu
  private readonly counter: BumpCounter

  constructor(ctx: AppContext) {
    this.ctx = ctx
    this.counter = new BumpCounter(ctx.client.ui.counterBumpMs, ctx.reducedMotion)
    const blocked = () => !canSpinPending(ctx.state())
    this.menu = new ListMenu(ctx, 'pending', [
      {
        label: () => ctx.tr.t('pending.spinOne'),
        accept: () => {
          // Se cierra para ver caer la bola.
          if (ctx.spinPending()) ctx.pop(this)
        },
        disabled: blocked,
      },
      {
        label: () => ctx.tr.t('pending.spinAll'),
        accept: () => {
          if (ctx.spinAllPending()) ctx.pop(this)
        },
        disabled: blocked,
      },
      {
        label: () => ctx.tr.t('pending.back'),
        accept: () => ctx.pop(this),
      },
    ])
  }

  action(e: ActionEvent): void {
    if (this.menu.action(e)) return
    if (e.action === 'spin') {
      if (this.ctx.spinPending()) this.ctx.pop(this)
      return
    }
    if (e.action === 'back' || e.action === 'start') {
      this.ctx.sfx.play('back')
      this.ctx.pop(this)
    }
  }

  update(_dt: number, t: number): void {
    this.counter.see(pendingSpins(this.ctx.state()), t)
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const count = pendingSpins(this.ctx.state())
    const body = wrap(tr.t(count > 0 ? 'pending.body' : 'pending.none'), TEXT_W)
    const help = count > 0 ? wrap(tr.t('pending.allHelp', { ...this.ctx.buttons() }), TEXT_W) : []
    const rules = wrap(
      tr.t('pending.rules', { max: tr.n(this.ctx.web.game.pendingSpins.max) }),
      TEXT_W,
    )
    // Título y contador (74) + cuerpo + menú (6 + 3 filas + 4) + ayuda y reglas + margen (6).
    const h = 74 + body.length * 10 + 6 + 3 * 15 + 4 + (help.length + rules.length) * 10 + 6
    const x = 160 - WIDTH / 2
    const y = Math.max(6, Math.round(112 - h / 2))
    dim(g, 0.55)
    drawWindow(g, x, y, WIDTH, h)
    drawText(g, tr.t('pending.title'), 160, y + 8, {
      color: PALETTE.gold,
      align: 'center',
      shadow: PALETTE.ink,
    })

    // El contador grande, con su bote al cambiar.
    const look = this.counter.look(t)
    drawText(g, tr.n(count), 160, y + 24 + look.dy, {
      color: look.flash ? PALETTE.cream : count > 0 ? PALETTE.gold : PALETTE.muted,
      align: 'center',
      scale: 3,
      shadow: PALETTE.ink,
    })
    if (look.delta) {
      drawText(g, look.delta, 214, y + 30 - look.deltaRise, {
        color: look.delta.startsWith('+') ? PALETTE.win : PALETTE.loss,
        shadow: PALETTE.ink,
      })
    }
    if (count > 0) {
      drawText(g, tr.t('status.pending', { n: tr.n(count), ...this.ctx.buttons() }), 160, y + 60, {
        color: PALETTE.cream,
        align: 'center',
        shadow: PALETTE.ink,
      })
    }

    let ty = y + 74
    for (const line of body) {
      drawText(g, line, x + 12, ty, { color: PALETTE.cream, shadow: PALETTE.ink })
      ty += 10
    }
    this.menu.draw(g, x + 22, ty + 6, WIDTH - 44, 15, t)
    ty += 6 + 3 * 15 + 4
    for (const line of help) {
      drawText(g, line, x + 12, ty, { color: PALETTE.cream, shadow: PALETTE.ink })
      ty += 10
    }
    for (const line of rules) {
      drawText(g, line, x + 12, ty, { color: PALETTE.muted, shadow: PALETTE.ink })
      ty += 10
    }
    if (count > 0 && !canSpinPending(this.ctx.state())) {
      drawHelpBar(g, tr.t('pending.busy'), PALETTE.muted)
    } else {
      drawHelpBar(g, tr.t('help.menu', { ...this.ctx.buttons() }), PALETTE.muted)
    }
  }
}

/**
 * Aviso al abrir la ventana con tiradas pendientes (una vez por apertura): "TIENES / 20 TIRADAS /
 * PENDIENTES", ✕ va a la pantalla de tiradas pendientes y ○ lo deja para luego.
 */
export class PendingNoticeScreen implements Screen {
  readonly id = 'pendingNotice'
  private readonly ctx: AppContext

  constructor(ctx: AppContext) {
    this.ctx = ctx
  }

  action(e: ActionEvent): void {
    if (e.action === 'accept' || e.action === 'spin') {
      this.ctx.sfx.play('accept')
      this.ctx.pop(this)
      this.ctx.showPending()
      return
    }
    if (e.action === 'back' || e.action === 'start') {
      this.ctx.sfx.play('back')
      this.ctx.pop(this)
    }
  }

  pointer(kind: 'move' | 'down' | 'leave'): boolean {
    if (kind === 'down') this.action({ action: 'accept', fine: false })
    return true
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const count = pendingSpins(this.ctx.state())
    dim(g, 0.55)
    drawWindow(g, 40, 70, 240, 92)
    drawText(g, tr.t('pending.noticeLine1'), 160, 80, {
      color: PALETTE.cream,
      align: 'center',
      shadow: PALETTE.ink,
    })
    // El número en oro y grande, con un parpadeo suave para llamar la atención.
    const on = this.ctx.reducedMotion || Math.floor(t * 2) % 2 === 0
    drawText(g, tr.t('pending.noticeLine2', { n: tr.n(count) }), 160, 96, {
      color: on ? PALETTE.gold : PALETTE.cream,
      align: 'center',
      scale: 2,
      shadow: PALETTE.ink,
    })
    drawText(g, tr.t('pending.noticeLine3'), 160, 124, {
      color: PALETTE.cream,
      align: 'center',
      shadow: PALETTE.ink,
    })
    drawText(g, tr.t('pending.noticeHelp', { ...this.ctx.buttons() }), 160, 144, {
      color: PALETTE.gold,
      align: 'center',
      shadow: PALETTE.ink,
    })
  }
}
