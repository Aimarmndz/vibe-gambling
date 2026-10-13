// SPDX-License-Identifier: AGPL-3.0-or-later
// CRÉDITOS (`menu-credits.png`): el logotipo, la atribución 7(b) de LICENSE ("Created by Aimar
// (github.com/Aimarmndz)", de config/site.json vía `legal/attribution.ts`), consola, fuente,
// sonido, ayuda con el juego, descargos y licencia. Suben solos a `menu.creditsPxPerS`; ↑↓ a mano.
// ✕ abre la primera ayuda con el juego del idioma; con el ratón, cualquier enlace.
import { forLocale } from '@vibe-gambling/shared'

import type { ActionEvent } from '../../../app/input.ts'
import { drawText, wrap } from '../../../font/bitmap.ts'
import { attribution, displayUrl } from '../../../legal/attribution.ts'
import { brandMarks, drawMark } from '../../brandMark.ts'
import { PALETTE } from '../../palette.ts'
import { GRADIENTS, drawGradientText } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'

/** Zona por la que pasan los créditos (entre la cabecera y la ayuda). */
export const VIEW = Object.freeze({ top: 26, bottom: 218 })
/** Segundos quietos al entrar antes de empezar a subir. */
const HOLD_S = 2
const MANUAL_STEP = 11

type Line =
  | { kind: 'logo'; h: number }
  | { kind: 'text'; text: string; color: string; h: number; url?: string }
  | { kind: 'gap'; h: number }

/** Desplazamiento de los créditos: quietos `HOLD_S`, luego suben y vuelven a empezar. */
export function creditsOffset(
  elapsedS: number,
  pxPerS: number,
  contentH: number,
  manual: number,
  still: boolean,
): number {
  const viewH = VIEW.bottom - VIEW.top
  const loop = contentH + viewH
  const auto = still ? 0 : Math.max(0, elapsedS - HOLD_S) * pxPerS
  const raw = auto + manual
  // Al dar la vuelta, entran por abajo.
  return ((((raw + viewH) % loop) + loop) % loop) - viewH
}

export class CreditsPage implements MenuPage {
  readonly id = 'credits'
  readonly icon = 'gem' as const
  private readonly host: MenuHost
  private enteredAt = 0
  private manual = 0

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  title(): string {
    return this.ctx.tr.t('credits.title')
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    const b = this.ctx.buttons()
    const items: HelpItem[] = [{ key: '↑↓', label: tr.t('credits.scroll') }]
    if (this.helpLink()) items.push({ key: b.x, label: tr.t('credits.helpLink') })
    items.push({ key: b.o, label: tr.t('help.back') })
    return items
  }

  enter(t: number): void {
    this.enteredAt = t
    this.manual = 0
  }

  private helpLink() {
    return forLocale(this.ctx.web.site.helpLinks, this.ctx.tr.locale)[0] ?? null
  }

  /** Las líneas de los créditos en el idioma actual. */
  lines(): Line[] {
    const { tr, web } = this.ctx
    const site = web.site
    const credit = attribution(site.author, tr)
    const out: Line[] = [{ kind: 'logo', h: 44 }]
    out.push({ kind: 'text', text: credit.text, color: PALETTE.gold, h: 16, url: credit.href })
    const section = (label: string, value: string) => {
      out.push({ kind: 'text', text: label, color: PALETTE.muted, h: 11 })
      for (const line of wrap(value, 288))
        out.push({ kind: 'text', text: line, color: PALETTE.cream, h: 11 })
      out.push({ kind: 'gap', h: 4 })
    }
    section(tr.t('credits.consoleLabel'), `${tr.t('boot.console')} · ${tr.t('boot.system')}`)
    section(tr.t('credits.fontLabel'), tr.t('credits.fontValue'))
    section(tr.t('credits.soundLabel'), tr.t('credits.soundValue'))
    out.push({ kind: 'gap', h: 4 })
    for (const line of wrap(tr.t('credits.fakeCoins'), 288)) {
      out.push({ kind: 'text', text: line, color: PALETTE.cream, h: 11 })
    }
    for (const link of forLocale(site.helpLinks, tr.locale)) {
      out.push({ kind: 'text', text: link.label, color: PALETTE.gold, h: 11, url: link.url })
    }
    out.push({ kind: 'gap', h: 6 })
    for (const key of ['credits.disclaimer', 'credits.license'] as const) {
      for (const line of wrap(tr.t(key), 288)) {
        out.push({ kind: 'text', text: line, color: PALETTE.cream, h: 11 })
      }
    }
    out.push({
      kind: 'text',
      text: displayUrl(site.repoUrl),
      color: PALETTE.gold,
      h: 13,
      url: site.repoUrl,
    })
    out.push({
      kind: 'text',
      text: tr.t('credits.version', { instance: web.instanceName, version: web.serverVersion }),
      color: PALETTE.muted,
      h: 11,
    })
    return out
  }

  describe(): string {
    return this.lines()
      .flatMap(l => (l.kind === 'text' ? [l.text] : []))
      .join('. ')
  }

  action(e: ActionEvent): boolean {
    switch (e.action) {
      case 'up':
      case 'down':
        this.manual += e.action === 'up' ? -MANUAL_STEP : MANUAL_STEP
        return true
      case 'accept': {
        const link = this.helpLink()
        if (link) this.ctx.openLink(link.url)
        return true
      }
      default:
        return false
    }
  }

  wheel(delta: number): void {
    this.manual += Math.sign(delta) * MANUAL_STEP
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const lines = this.lines()
    const contentH = lines.reduce((s, l) => s + l.h, 0)
    const offset = creditsOffset(
      t - this.enteredAt,
      this.ctx.client.menu.creditsPxPerS,
      contentH,
      this.manual,
      this.host.still,
    )
    g.save()
    g.beginPath()
    g.rect(0, VIEW.top, 320, VIEW.bottom - VIEW.top)
    g.clip()
    let y = VIEW.top + 8 - offset
    const hover = this.ctx.hoverId()
    lines.forEach((line, i) => {
      const top = y
      y += line.h
      if (top + line.h < VIEW.top || top > VIEW.bottom) return
      if (line.kind === 'logo') this.drawLogo(g, top)
      else if (line.kind === 'text') {
        const id = `credits:${i}`
        const color = line.url && hover === id ? PALETTE.cream : line.color
        const w = drawText(g, line.text, 160, top + 2, {
          color,
          align: 'center',
          shadow: PALETTE.ink,
        })
        if (line.url) {
          const url = line.url
          this.ctx.hits.add({
            x: 160 - w / 2 - 2,
            y: top,
            w: w + 4,
            h: line.h,
            id,
            onClick: () => this.ctx.openLink(url),
          })
        }
      }
    })
    g.restore()
  }

  /** Logotipo: la marca de 32 px y "VIBE" oro / "GAMBLING" rojo a ×2. */
  private drawLogo(g: CanvasRenderingContext2D, top: number): void {
    const { tr } = this.ctx
    const [first = '', ...rest] = tr.t('brand.title').split(' ')
    const { large } = brandMarks()
    drawMark(g, large, 98, top + 4, 1)
    drawGradientText(g, first, 136, top + 8, GRADIENTS.gold, { scale: 2, shadow: PALETTE.ink })
    drawGradientText(g, rest.join(' '), 136, top + 24, GRADIENTS.red, {
      scale: 2,
      shadow: PALETTE.ink,
    })
  }
}
