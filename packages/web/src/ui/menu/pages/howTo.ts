// SPDX-License-Identifier: AGPL-3.0-or-later
// CÓMO SE JUEGA (`menu-help.png`): un libro abierto en papel con 4 páginas dobles (mesa y fichas,
// girar con Claude, tiradas pendientes, préstamo y temporadas). ←→ pasa página con un barrido de
// columnas de 8 px y roce de papel.
import type { ActionEvent } from '../../../app/input.ts'
import { drawText, wrap } from '../../../font/bitmap.ts'
import type { MessageKey } from '../../../i18n/index.ts'
import type { IconKind } from '../../../render/menuIcons/layer.ts'
import { swingAngle } from '../../../render/menuIcons/layer.ts'
import { fillCircle } from '../../draw.ts'
import { PALETTE } from '../../palette.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'
import { interestPercent } from '../format.ts'

export const BOOK = Object.freeze({ x: 10, y: 28, w: 300, h: 172 })
const SPINE = Object.freeze({ light: '#b8a77e', dark: '#8a7a55' })
const COLUMN = 8
/** Vaivén de la ilustración (radianes a cada lado del 3/4). */
const SWING = 0.5
/** Centro de la ilustración de la página izquierda. */
const ICON_X = 83

export interface BookSpread {
  id: 'table' | 'claude' | 'pending' | 'loan'
  icon: IconKind
}

export const SPREADS: readonly BookSpread[] = Object.freeze([
  { id: 'table', icon: 'chip' },
  { id: 'claude', icon: 'gem' },
  { id: 'pending', icon: 'stack' },
  { id: 'loan', icon: 'bank' },
])

/**
 * Columnas (de 8 px) del libro que ya muestran la página nueva a los `elapsedMs` de pasar
 * página; la dirección decide por qué lado empieza el barrido.
 */
export function turnedColumns(elapsedMs: number, turnMs: number, total: number): number {
  if (turnMs <= 0 || elapsedMs >= turnMs) return total
  return Math.floor((Math.max(0, elapsedMs) / turnMs) * total)
}

export class HowToPage implements MenuPage {
  readonly id = 'howTo'
  readonly icon = 'book' as const
  private readonly host: MenuHost
  private spread = 0
  private turn: { at: number; dir: number } | null = null
  private time = 0

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  title(): string {
    return this.ctx.tr.t('menu.item.howTo')
  }

  headerRight(): string {
    return this.ctx.tr.t('howto.page', { n: this.spread + 1, total: SPREADS.length })
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    return [
      { key: '←→', label: tr.t('howto.turn') },
      { key: this.ctx.buttons().o, label: tr.t('help.back') },
    ]
  }

  /** Texto de una página doble (título, cuerpo y nota), con los valores de esta instancia. */
  texts(i: number): { title: string; body: string; note: string } {
    const { tr, web } = this.ctx
    const id = SPREADS[i]!.id
    const vars = {
      ...this.ctx.buttons(),
      max: tr.n(web.game.pendingSpins.max),
      amount: tr.n(web.game.loan.amount),
      interest: interestPercent(web.game.loan, tr),
      multiplier: web.game.jackpot.gitPushMultiplier,
    }
    return {
      title: tr.t(`howto.${id}.title` as MessageKey),
      body: tr.t(`howto.${id}.body` as MessageKey, vars),
      note: tr.t(`howto.${id}.note` as MessageKey, vars),
    }
  }

  describe(): string {
    const p = this.texts(this.spread)
    return `${this.headerRight()}. ${p.title}. ${p.body} ${p.note}`
  }

  private go(dir: number): void {
    const next = this.spread + dir
    if (next < 0 || next >= SPREADS.length) return
    this.spread = next
    this.turn = this.host.still ? null : { at: this.time, dir }
    this.ctx.sfx.play('page')
    this.ctx.announce(this.describe())
  }

  action(e: ActionEvent): boolean {
    if (e.action === 'left' || e.action === 'right') {
      this.go(e.action === 'left' ? -1 : 1)
      return true
    }
    if (e.action === 'accept') {
      this.go(1)
      return true
    }
    return false
  }

  update(_dt: number, t: number): void {
    this.time = t
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const total = Math.ceil(BOOK.w / COLUMN)
    const done = this.turn
      ? turnedColumns((t - this.turn.at) * 1000, this.ctx.client.menu.pageTurnMs, total)
      : total
    if (done >= total) this.turn = null
    // La ilustración 3D va por encima del papel: se enseña cuando su columna ya ha pasado.
    const iconCol = Math.floor((ICON_X - BOOK.x) / COLUMN)
    const iconShown = !this.turn || (this.turn.dir > 0 ? iconCol < done : iconCol >= total - done)
    this.drawBook(g, t, iconShown)
    // Barrido de columnas: lo que aún no ha pasado se ve en blanco de papel.
    if (this.turn) {
      for (let c = done; c < total; c++) {
        const col = this.turn.dir > 0 ? c : total - 1 - c
        const x = BOOK.x + col * COLUMN
        g.fillStyle = PALETTE.paperBottom
        g.fillRect(x, BOOK.y + 2, Math.min(COLUMN, BOOK.x + BOOK.w - x), BOOK.h - 4)
      }
      const edge = BOOK.x + (this.turn.dir > 0 ? done : total - done) * COLUMN
      g.fillStyle = SPINE.dark
      g.fillRect(Math.min(edge, BOOK.x + BOOK.w - 1), BOOK.y + 2, 1, BOOK.h - 4)
    }
    // Puntos de página.
    SPREADS.forEach((_, i) => {
      const x = 160 - (SPREADS.length - 1) * 7 + i * 14
      fillCircle(g, x, 210, 3, i === this.spread ? PALETTE.gold : PALETTE.frameInner)
      if (i !== this.spread) fillCircle(g, x, 210, 2, PALETTE.ink)
      this.ctx.hits.add({
        x: x - 5,
        y: 205,
        w: 10,
        h: 10,
        id: `howto:${i}`,
        onClick: () => this.go(i - this.spread),
      })
    })
  }

  private drawBook(g: CanvasRenderingContext2D, t: number, iconShown: boolean): void {
    const { x, y, w, h } = BOOK
    // Marco oro oscuro, papel en degradado y lomo.
    g.fillStyle = 'rgba(0,0,0,0.6)'
    g.fillRect(x + 3, y + 3, w, h)
    g.fillStyle = PALETTE.goldDark
    g.fillRect(x, y, w, h)
    const paper = g.createLinearGradient(0, y, 0, y + h)
    paper.addColorStop(0, PALETTE.paperTop)
    paper.addColorStop(1, PALETTE.paperBottom)
    g.fillStyle = paper
    g.fillRect(x + 2, y + 2, w - 4, h - 4)
    g.fillStyle = SPINE.light
    g.fillRect(156, y + 2, 4, h - 4)
    g.fillStyle = SPINE.dark
    g.fillRect(160, y + 2, 4, h - 4)

    const spread = SPREADS[this.spread]!
    const text = this.texts(this.spread)
    // Página izquierda: la ilustración (icono 3D grande).
    if (iconShown) {
      this.host.icons.icon(spread.icon, ICON_X, 108, 28, {
        count: 10,
        yaw: swingAngle(t, this.ctx.client.menu.iconSpinMs * 2, SWING, this.host.still),
        tilt: 0.3,
      })
    }
    if (spread.id === 'pending') {
      const badge = this.ctx.tr.n(this.ctx.web.game.pendingSpins.max)
      const bw = badge.length * 6 + 9
      g.fillStyle = PALETTE.ink
      g.fillRect(112, 55, bw + 2, 13)
      g.fillStyle = PALETTE.red
      g.fillRect(113, 56, bw, 11)
      drawText(g, badge, 113 + bw / 2, 58, { color: PALETTE.cream, align: 'center' })
    }
    drawText(g, String(this.spread * 2 + 1), 83, 188, {
      color: PALETTE.frameInner,
      align: 'center',
    })
    drawText(g, String(this.spread * 2 + 2), 237, 188, {
      color: PALETTE.frameInner,
      align: 'center',
    })

    // Página derecha: título, cuerpo y nota.
    const left = 172
    const width = 128
    let ty = y + 13
    drawText(g, text.title, left, ty, { color: PALETTE.redLo })
    ty += 16
    for (const line of wrap(text.body, width)) {
      drawText(g, line, left, ty, { color: PALETTE.ink })
      ty += 11
    }
    ty += 6
    for (const line of wrap(text.note, width)) {
      drawText(g, line, left, ty, { color: PALETTE.redLo })
      ty += 11
    }
  }
}
