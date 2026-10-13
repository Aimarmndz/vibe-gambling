// SPDX-License-Identifier: AGPL-3.0-or-later
// TIRADAS PENDIENTES (`menu-pending.png`, `menu-pending-empty.png`): los prompts que se mandaron
// con la ventana cerrada u oculta. Pila 3D con el contador grande, la cola, con qué se juegan y
// los botones ✕ GIRAR / □ TODAS. Pulsar GIRAR solo pide la tirada: la tira el servidor y llega
// como cualquier otra ronda (por eso el menú se cierra, para ver caer la bola).
import type { ActionEvent } from '../../../app/input.ts'
import { drawText, wrap } from '../../../font/bitmap.ts'
import { describeSelection } from '../../../game/describe.ts'
import { canSpinPending, pendingSpins } from '../../../game/state.ts'
import { spinAngle } from '../../../render/menuIcons/layer.ts'
import { BumpCounter } from '../../counter.ts'
import { drawWindow } from '../../draw.ts'
import { PALETTE } from '../../palette.ts'
import { pendingPlay, seasonDaysLeft } from '../format.ts'
import {
  GRADIENTS,
  SECONDARY,
  drawBand,
  drawBar,
  drawCorners,
  drawGradientText,
  drawWell,
  fit,
} from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'

/** Filas de la cola que se ven antes del "+n MÁS". */
const QUEUE_ROWS = 5
const BUTTONS = [
  { x: 8, y: 182, w: 148, h: 34 },
  { x: 164, y: 182, w: 148, h: 34 },
] as const

/** Fichas de la pila 3D: una cada 2 pendientes, de 1 a 10. */
export function stackChips(pending: number): number {
  return Math.max(1, Math.min(10, Math.ceil(pending / 2)))
}

export class PendingPage implements MenuPage {
  readonly id = 'pending'
  readonly icon = 'stack' as const
  private readonly host: MenuHost
  private readonly counter: BumpCounter
  /** 0 = GIRAR, 1 = TODAS. */
  private button = 0

  constructor(host: MenuHost) {
    this.host = host
    this.counter = new BumpCounter(host.ctx.client.ui.counterBumpMs, host.still)
  }

  private get ctx() {
    return this.host.ctx
  }

  title(): string {
    return this.ctx.tr.t('pending.title')
  }

  headerRight(): string | undefined {
    const w = this.ctx.state().shown
    return w ? this.ctx.tr.t('mc.season', { season: w.seasonId }) : undefined
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    const b = this.ctx.buttons()
    const count = pendingSpins(this.ctx.state())
    if (count === 0) return [{ key: b.o, label: tr.t('help.back') }]
    return [
      { key: b.x, label: tr.t('pending.spin') },
      { key: b.sq, label: tr.t('pending.spinAll') },
      { key: b.o, label: tr.t('help.back') },
    ]
  }

  describe(): string {
    const { tr } = this.ctx
    const count = pendingSpins(this.ctx.state())
    return count > 0
      ? tr.t('status.pending', { n: tr.n(count), ...this.ctx.buttons() })
      : tr.t('pending.none')
  }

  private spinOne(): void {
    if (this.ctx.spinPending()) this.host.close()
  }

  private spinAll(): void {
    if (this.ctx.spinAllPending()) this.host.close()
  }

  action(e: ActionEvent): boolean {
    switch (e.action) {
      case 'left':
      case 'right':
        if (pendingSpins(this.ctx.state()) === 0) return true
        this.button = this.button === 0 ? 1 : 0
        this.ctx.sfx.play('move')
        return true
      case 'accept':
        if (pendingSpins(this.ctx.state()) === 0) return false
        if (this.button === 0) this.spinOne()
        else this.spinAll()
        return true
      case 'spin':
        this.spinOne()
        return true
      case 'chip':
        this.spinAll()
        return true
      default:
        return false
    }
  }

  update(_dt: number, t: number): void {
    this.counter.see(pendingSpins(this.ctx.state()), t)
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    if (pendingSpins(this.ctx.state()) === 0) this.drawEmpty(g)
    else this.drawQueue(g, t)
  }

  private drawEmpty(g: CanvasRenderingContext2D): void {
    const { tr } = this.ctx
    drawWindow(g, 40, 60, 240, 100)
    this.host.icons.icon('chipDim', 160, 90, 17, { tilt: 0.55 })
    drawGradientText(g, tr.t('pending.zero'), 160, 118, GRADIENTS.gold, {
      scale: 2,
      align: 'center',
      shadow: PALETTE.ink,
    })
    drawText(g, tr.t('pending.emptyHint'), 160, 141, {
      color: PALETTE.muted,
      align: 'center',
      shadow: PALETTE.ink,
    })
  }

  private drawQueue(g: CanvasRenderingContext2D, t: number): void {
    const { tr, web } = this.ctx
    const state = this.ctx.state()
    const count = pendingSpins(state)
    const max = web.game.pendingSpins.max
    const full = count >= max
    const { menu } = this.ctx.client

    // Contador grande con la pila de fichas.
    drawWindow(g, 8, 28, 148, 120)
    this.host.icons.icon('stack', 40, 86, 19, {
      count: stackChips(count),
      yaw: spinAngle(t, menu.iconSpinMs * 2, this.host.still),
      tilt: 0.3,
    })
    const look = this.counter.look(t)
    drawGradientText(g, tr.n(count), 116, 44 + look.dy, full ? GRADIENTS.red : GRADIENTS.gold, {
      scale: 5,
      align: 'center',
      shadow: PALETTE.jackpotBottom,
    })
    if (look.delta) {
      drawText(g, look.delta, 148, 40 - look.deltaRise, {
        color: look.delta.startsWith('+') ? PALETTE.gold : PALETTE.loss,
        align: 'right',
        shadow: PALETTE.ink,
      })
    }
    drawText(g, tr.t('hud.pending'), 116, 92, {
      color: PALETTE.cream,
      align: 'center',
      shadow: PALETTE.ink,
    })
    const w = state.shown
    const days = w ? seasonDaysLeft(w.seasonId, web.game, Date.now()) : 0
    drawText(
      g,
      full ? tr.t('pending.full', { max: tr.n(max) }) : `${tr.n(count)}/${tr.n(max)}`,
      16,
      116,
      {
        color: full ? PALETTE.loss : PALETTE.cream,
        shadow: PALETTE.ink,
      },
    )
    drawText(g, tr.t('pending.expires', { n: tr.n(days) }), 148, 116, {
      color: PALETTE.cream,
      align: 'right',
      shadow: PALETTE.ink,
    })
    drawBar(g, 17, 129, 130, 4, count / max, full ? PALETTE.loss : PALETTE.gold)

    // La cola: el orden en que se gastan (la más antigua, la siguiente).
    drawWindow(g, 162, 28, 150, 120)
    drawText(g, tr.t('pending.queue'), 170, 37, { color: SECONDARY, shadow: PALETTE.ink })
    const shown = Math.min(count, QUEUE_ROWS)
    for (let i = 0; i < shown; i++) {
      const y = 51 + i * 13
      if (i === 0) drawBand(g, 166, y - 3, 142, 13)
      drawText(g, String(i + 1).padStart(2, '0'), 170, y, {
        color: i === 0 ? PALETTE.gold : PALETTE.muted,
        shadow: PALETTE.ink,
      })
      drawText(g, fit(tr.t('pending.saved'), 106), 186, y, {
        color: PALETTE.cream,
        shadow: PALETTE.ink,
      })
      // La siguiente en gastarse (la más antigua) lleva la banda y el ◄ oro.
      if (i === 0) drawText(g, '◄', 304, y, { color: PALETTE.gold, align: 'right' })
    }
    if (count > shown) {
      drawText(g, tr.t('pending.more', { n: tr.n(count - shown) }), 170, 51 + shown * 13, {
        color: SECONDARY,
      })
    }
    // El jackpot del git push y la frase de los tests fallidos se conservan al gastarlas.
    const keeps = wrap(tr.t('pending.keeps'), 136)
    keeps.slice(0, 2).forEach((line, i) => {
      drawText(g, line, 170, 128 + i * 10, { color: PALETTE.gold, shadow: PALETTE.ink })
    })

    // Con qué se juegan.
    const play = pendingPlay(
      state.slip,
      (state.lastRound?.bets ?? []).map(b => ({
        selection: b.selection,
        amount: b.amount,
      })),
      w?.balance ?? 0,
    )
    drawWell(g, 8, 152, 304, 24)
    const label = tr.t('pending.playsWith')
    const lw = drawText(g, label, 14, 161, { color: PALETTE.muted })
    const bets = play.bets.map(b => `${describeSelection(b.selection, tr)} ${tr.n(b.amount)}`)
    const what =
      play.source === 'slip' || play.source === 'repeat'
        ? `${tr.t(`pending.source.${play.source}`)} · ${bets.join(' + ')}`
        : tr.t(`pending.source.${play.source}`)
    drawText(g, fit(what, 300 - 20 - lw), 20 + lw, 161, {
      color: PALETTE.cream,
      shadow: PALETTE.ink,
    })

    // Botones.
    const ready = canSpinPending(state)
    const b = this.ctx.buttons()
    const labels = [
      {
        key: b.x,
        name: tr.t('pending.spin'),
        sub:
          play.cost > 0
            ? tr.t('pending.spinSub', { cost: tr.n(play.cost) })
            : tr.t('pending.spinSubFree'),
      },
      { key: b.sq, name: tr.t('pending.all'), sub: tr.t('pending.allSub', { n: tr.n(count) }) },
    ]
    const hover = this.ctx.hoverId()
    BUTTONS.forEach((r, i) => {
      const id = `pending:button:${i}`
      if (hover === id && this.button !== i) this.button = i
      const selected = i === this.button
      if (selected) drawWindow(g, r.x, r.y, r.w, r.h, { shadow: false })
      else drawWell(g, r.x, r.y, r.w, r.h)
      const color = !ready ? PALETTE.muted : selected ? PALETTE.cream : PALETTE.muted
      const l = labels[i]!
      const kw = drawText(g, l.key, r.x + 14, r.y + 7, { color: PALETTE.gold, scale: 2 })
      drawText(g, l.name, r.x + 20 + kw, r.y + 7, {
        color,
        scale: 2,
        shadow: selected ? PALETTE.ink : undefined,
      })
      drawText(g, ready ? l.sub : tr.t('pending.busyShort'), r.x + r.w / 2, r.y + 25, {
        color: selected ? PALETTE.cream : PALETTE.muted,
        align: 'center',
      })
      if (selected) drawCorners(g, r.x, r.y, r.w, r.h, this.host.cornerGap(t))
      this.ctx.hits.add({
        ...r,
        id,
        onClick: () => {
          this.button = i
          if (i === 0) this.spinOne()
          else this.spinAll()
        },
      })
    })
  }
}
