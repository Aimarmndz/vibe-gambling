// SPDX-License-Identifier: AGPL-3.0-or-later
// AFILIADOS: el Programa de Afiliados Piramidal (legalmente distinto). Tu código y tu enlace (✕ lo
// copia), la pirámide 3D con las comisiones de la temporada y su tope, y debajo las cuentas
// (invitados, activados, en espera, ganado) y las reglas, que se desplazan con ↑↓ como el
// historial del BANCO. Los datos llegan con `referral.request`; el canje se hace en Claude Code
// (`/vibe-redeem`), que aquí no hay teclado para escribir un código.
import type { ReferralStatus } from '@vibe-gambling/shared'

import type { ActionEvent } from '../../../app/input.ts'
import { drawText, wrap } from '../../../font/bitmap.ts'
import { spinAngle } from '../../../render/menuIcons/layer.ts'
import { drawWindow } from '../../draw.ts'
import { PALETTE } from '../../palette.ts'
import { GRADIENTS, SECONDARY, drawBar, drawCorners, drawGradientText, fit } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'

/** Filas visibles de la ventana de abajo (cuentas y reglas). */
const ROWS = 4
/** Ancho del texto de la ventana de abajo. */
const TEXT_W = 288

type Line =
  | { kind: 'stat'; label: string; value: string; color: string }
  | { kind: 'text'; text: string; color: string }

/** Enlace sin el esquema y partido en dos líneas: el dominio y `/r/<código>`. */
export function linkLines(url: string): [string, string] {
  try {
    const u = new URL(url)
    return [u.host, `${u.pathname}${u.search}`]
  } catch {
    return [url, '']
  }
}

export class ReferralPage implements MenuPage {
  readonly id = 'referral'
  readonly icon = 'pyramid' as const
  private readonly host: MenuHost
  private data: ReferralStatus | null = null
  private failed = false
  private scroll = 0
  private request = 0

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  /** Lo que se ha cargado (para los tests E2E). */
  get status(): ReferralStatus | null {
    return this.data
  }

  title(): string {
    return this.ctx.tr.t('referral.title')
  }

  headerRight(): string {
    return this.ctx.tr.t('referral.header')
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    const b = this.ctx.buttons()
    const items: HelpItem[] = [{ key: '↑↓', label: tr.t('help.move') }]
    if (this.data) items.push({ key: b.x, label: tr.t('referral.copy') })
    items.push({ key: b.o, label: tr.t('help.back') })
    return items
  }

  enter(): void {
    this.fetch()
  }

  private fetch(): void {
    const id = ++this.request
    this.failed = false
    this.ctx.progress('referral').then(
      data => {
        if (id !== this.request) return
        this.data = data
        this.scroll = 0
        this.ctx.announce(this.summary(data))
      },
      (error: unknown) => {
        if (id !== this.request) return
        console.warn('[afiliados] no se pudo cargar', error)
        this.failed = true
        this.ctx.announce(this.ctx.tr.t('referral.error'))
      },
    )
  }

  summary(data: ReferralStatus): string {
    const { tr } = this.ctx
    return tr.t('referral.a11y', {
      code: data.code,
      invited: tr.n(data.invited),
      activated: tr.n(data.activated),
      earned: tr.n(data.earned),
      n: tr.n(data.season.commissions),
      cap: tr.n(data.season.cap),
    })
  }

  /** Cuentas de la pirámide y, debajo, la letra pequeña: lo que se desplaza con ↑↓. */
  lines(): Line[] {
    const { tr } = this.ctx
    const d = this.data
    if (!d) return []
    const out: Line[] = [
      {
        kind: 'stat',
        label: tr.t('referral.invited'),
        value: tr.n(d.invited),
        color: PALETTE.cream,
      },
      {
        kind: 'stat',
        label: tr.t('referral.activated'),
        value: tr.n(d.activated),
        color: d.activated > 0 ? PALETTE.win : PALETTE.cream,
      },
      {
        kind: 'stat',
        label: tr.t('referral.waiting'),
        value: tr.n(d.waiting),
        color: PALETTE.cream,
      },
      {
        kind: 'stat',
        label: tr.t('referral.earned'),
        value: tr.n(d.earned),
        color: d.earned > 0 ? PALETTE.gold : PALETTE.cream,
      },
    ]
    const text = (t: string, color: string = SECONDARY) => {
      for (const line of wrap(t, TEXT_W)) out.push({ kind: 'text', text: line, color })
    }
    const r = d.rules
    text(
      tr.t('referral.rules', {
        bonus: tr.n(r.welcomeBonus),
        commission: tr.n(r.commission),
        spins: tr.n(r.activationSpins),
      }),
    )
    if (r.minAccountAgeDays > 0)
      text(tr.t('referral.rulesAge', { days: tr.n(r.minAccountAgeDays) }))
    if (d.invitedBy)
      text(tr.t('referral.redeemed', { bonus: tr.n(d.invitedBy.bonus) }), PALETTE.cream)
    else if (d.canRedeem) {
      text(tr.t('referral.redeemHint', { date: tr.date(d.redeemUntil) }), PALETTE.cream)
    }
    return out
  }

  /** Copia el enlace al portapapeles (✕ o clic). Sin permiso, el aviso enseña el enlace. */
  copy(): void {
    const d = this.data
    if (!d) return
    const { tr } = this.ctx
    const failed = () => this.ctx.toast(tr.t('referral.copyFailed', { url: d.url }), 'error')
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (!clipboard) {
      failed()
      return
    }
    this.ctx.sfx.play('accept')
    clipboard.writeText(d.url).then(
      () => this.ctx.toast(tr.t('referral.copied'), 'money'),
      (error: unknown) => {
        console.warn('[afiliados] no se pudo copiar', error)
        failed()
      },
    )
  }

  action(e: ActionEvent): boolean {
    switch (e.action) {
      case 'up':
      case 'down': {
        const max = Math.max(0, this.lines().length - ROWS)
        const next = Math.max(0, Math.min(max, this.scroll + (e.action === 'up' ? -1 : 1)))
        if (next !== this.scroll) {
          this.scroll = next
          this.ctx.sfx.play('move')
        }
        return true
      }
      case 'accept':
        this.copy()
        return true
      default:
        return false
    }
  }

  wheel(delta: number): void {
    this.action({ action: delta > 0 ? 'down' : 'up', fine: false })
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    this.drawCode(g, t)
    this.drawPyramid(g, t)
    this.drawStats(g, t)
  }

  private drawCode(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const d = this.data
    drawWindow(g, 8, 28, 150, 112, { top: PALETTE.goldDark })
    drawText(g, tr.t('referral.code'), 16, 37, { color: PALETTE.cream, shadow: PALETTE.ink })
    if (!d) {
      this.drawLoading(g, t, 83, 70)
      return
    }
    drawGradientText(g, d.code, 83, 52, GRADIENTS.gold, {
      scale: 2,
      align: 'center',
      shadow: PALETTE.ink,
    })
    const [host, path] = linkLines(d.url)
    drawText(g, fit(host, 134), 83, 82, { color: SECONDARY, align: 'center' })
    drawText(g, fit(path, 134), 83, 94, { color: PALETTE.cream, align: 'center' })
    g.fillStyle = PALETTE.frameInner
    g.fillRect(14, 124, 138, 1)
    const b = this.ctx.buttons()
    drawText(g, fit(`${b.x} ${tr.t('referral.copy')}`, 134), 16, 129, {
      color: PALETTE.gold,
      shadow: PALETTE.ink,
    })
    drawCorners(g, 13, 126, 140, 11, this.host.cornerGap(t), 4, 1)
    this.ctx.hits.add({
      x: 12,
      y: 125,
      w: 142,
      h: 13,
      id: 'referral:copy',
      onClick: () => this.copy(),
    })
  }

  private drawPyramid(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const d = this.data
    drawWindow(g, 164, 28, 148, 112)
    this.host.icons.icon('pyramid', 238, 58, 24, {
      yaw: spinAngle(t, this.ctx.client.menu.iconSpinMs * 2, this.host.still),
      tilt: 0.35,
    })
    drawText(g, tr.t('referral.pyramid'), 238, 98, {
      color: PALETTE.cream,
      align: 'center',
      shadow: PALETTE.ink,
    })
    if (!d) return
    const { commissions, cap } = d.season
    const full = commissions >= cap
    drawText(
      g,
      fit(
        full
          ? tr.t('referral.capFull')
          : tr.t('referral.seasonCap', { n: tr.n(commissions), cap: tr.n(cap) }),
        132,
      ),
      238,
      110,
      { color: full ? PALETTE.loss : PALETTE.gold, align: 'center', shadow: PALETTE.ink },
    )
    drawBar(g, 174, 124, 128, 7, cap > 0 ? commissions / cap : 0, full ? PALETTE.red : PALETTE.gold)
  }

  private drawStats(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    drawWindow(g, 8, 144, 304, 72, { top: PALETTE.deepTop })
    if (!this.data) {
      if (this.failed) {
        drawText(g, tr.t('referral.error'), 160, 176, { color: PALETTE.loss, align: 'center' })
      } else this.drawLoading(g, t, 160, 176)
      return
    }
    this.lines()
      .slice(this.scroll, this.scroll + ROWS)
      .forEach((line, i) => {
        const y = 152 + i * 14
        if (line.kind === 'text') {
          drawText(g, line.text, 16, y, { color: line.color })
          return
        }
        drawText(g, line.label, 16, y, { color: PALETTE.cream, shadow: PALETTE.ink })
        drawText(g, line.value, 304, y, { color: line.color, align: 'right', shadow: PALETTE.ink })
      })
  }

  private drawLoading(g: CanvasRenderingContext2D, t: number, x: number, y: number): void {
    const { tr } = this.ctx
    const text = this.failed ? tr.t('referral.error') : tr.t('lb.loading')
    if (this.failed || this.host.still || Math.floor(t * 2) % 2 === 0) {
      drawText(g, fit(text, 134), x, y, {
        color: this.failed ? PALETTE.loss : PALETTE.cream,
        align: 'center',
      })
    }
  }
}
