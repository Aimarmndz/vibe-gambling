// SPDX-License-Identifier: AGPL-3.0-or-later
// AJUSTES (`menu-settings.png`): filas de 18 px con interruptores, volumen en 8 barras, `◄ valor ►`
// para listas, el selector de idioma con banderas (fase 7b: cambia al momento y se guarda),
// "MOVIMIENTO REDUCIDO" de solo lectura (sigue al sistema), la descripción del ajuste elegido y
// cerrar la sesión de esta ventana.
import type { Locale } from '@vibe-gambling/shared'
import { FLAG_HEIGHT, FLAG_WIDTH } from '@vibe-gambling/shared/i18n'

import type { ActionEvent } from '../../../app/input.ts'
import { VOLUME_STEPS } from '../../../app/prefs.ts'
import { drawText, wrap } from '../../../font/bitmap.ts'
import { LANGUAGES, cycleLocale, languageOf } from '../../../i18n/index.ts'
import type { MessageKey } from '../../../i18n/index.ts'
import { drawWindow } from '../../draw.ts'
import { drawFlag } from '../../flags.ts'
import { PALETTE } from '../../palette.ts'
import { drawBand, drawCorners } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'

export const SETTING_IDS = [
  'sound',
  'volume',
  'crt',
  'quality',
  'language',
  'leaderboard',
  'reducedMotion',
  'logout',
] as const
export type SettingId = (typeof SETTING_IDS)[number]

/** Texto de cada fila (algunos ya existían para otros sitios, como el aviso de silencio). */
const LABELS: Readonly<Record<SettingId, MessageKey>> = Object.freeze({
  sound: 'settings.sound',
  volume: 'settings.volume',
  crt: 'settings.crt',
  quality: 'settings.quality',
  language: 'settings.language',
  leaderboard: 'settings.showInLeaderboard',
  reducedMotion: 'settings.motion',
  logout: 'settings.logout',
})

const WIN = Object.freeze({ x: 8, y: 28, w: 304, h: 188 })
const ROW_H = 18
const FIRST_ROW = 41
/** La fila de cerrar sesión va al pie, debajo de la descripción. */
const LOGOUT_Y = 203
const FLAG_GAP = 5
/** Ancho máximo de la fila de banderas. */
const LANGUAGE_ROW_WIDTH = 100

/** Fila (y del texto) de cada ajuste. */
export function settingY(id: SettingId): number {
  if (id === 'logout') return LOGOUT_Y
  return FIRST_ROW + SETTING_IDS.indexOf(id) * ROW_H
}

export class SettingsPage implements MenuPage {
  readonly id = 'settings'
  readonly icon = 'gear' as const
  private readonly host: MenuHost
  index = 0
  /** Primera pulsación de cerrar sesión: pide confirmación. */
  private confirmLogout = false

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  title(): string {
    return this.ctx.tr.t('settings.title')
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    return [
      { key: '↑↓', label: tr.t('help.move') },
      { key: '←→', label: tr.t('help.change') },
      { key: this.ctx.buttons().o, label: tr.t('help.back') },
    ]
  }

  /** Ajustes que no se pueden elegir ahora (solo lectura o sin sesión). */
  private enabled(id: SettingId): boolean {
    const { ctx } = this
    switch (id) {
      case 'reducedMotion':
        return false
      case 'crt':
        return !ctx.reducedMotion
      case 'leaderboard':
      case 'logout':
        return !ctx.demo && ctx.state().user !== null
      default:
        return true
    }
  }

  /** Idioma elegido (las preferencias cambian al momento; los textos, al llegar su chunk). */
  private locale(): Locale {
    return this.ctx.prefs.locale ?? this.ctx.tr.locale
  }

  /** Cambia el idioma al instante y lo guarda en el navegador y en el servidor. */
  private chooseLocale(locale: Locale): void {
    if (locale === this.locale()) return
    this.ctx.setPrefs({ locale })
    this.ctx.send({ type: 'settings.update', locale })
  }

  value(id: SettingId): string {
    const { ctx } = this
    const { tr, prefs } = ctx
    const onOff = (v: boolean) => tr.t(v ? 'settings.on' : 'settings.off')
    switch (id) {
      case 'sound':
        return onOff(prefs.sound)
      case 'volume':
        return `${prefs.volume}/${VOLUME_STEPS}`
      case 'crt':
        return onOff(prefs.crt && !ctx.reducedMotion)
      case 'quality':
        return tr.t(prefs.quality === 'high' ? 'settings.high' : 'settings.low')
      case 'language':
        return languageOf(this.locale()).meta.nativeName.toLocaleUpperCase(this.locale())
      case 'leaderboard':
        return tr.t(ctx.state().user?.hidden ? 'settings.hidden' : 'settings.visible')
      case 'reducedMotion':
        return tr.t('settings.system', { value: onOff(ctx.reducedMotion) })
      case 'logout':
        return ''
    }
  }

  private label(id: SettingId): string {
    return this.ctx.tr.t(LABELS[id])
  }

  private announceRow(): void {
    const id = SETTING_IDS[this.index]!
    const value = this.value(id)
    this.ctx.announce(value ? `${this.label(id)}: ${value}` : this.label(id))
  }

  describe(): string {
    const id = SETTING_IDS[this.index]!
    return `${this.title()}. ${this.label(id)}: ${this.value(id)}`
  }

  private move(dir: number): void {
    const n = SETTING_IDS.length
    for (let step = 1; step <= n; step++) {
      const next = (this.index + dir * step + n * 4) % n
      if (this.enabled(SETTING_IDS[next]!)) {
        this.select(next)
        return
      }
    }
  }

  private select(i: number): void {
    if (i === this.index) return
    this.index = i
    this.confirmLogout = false
    this.ctx.sfx.play('move')
    this.announceRow()
  }

  /** Cambia el ajuste elegido (dir = −1 | 1; aceptar = 1). */
  change(id: SettingId, dir: number): void {
    const { ctx } = this
    switch (id) {
      case 'sound':
        ctx.setPrefs({ sound: !ctx.prefs.sound })
        break
      case 'volume': {
        const volume = Math.max(0, Math.min(VOLUME_STEPS, ctx.prefs.volume + dir))
        if (volume === ctx.prefs.volume) return
        ctx.setPrefs({ volume })
        break
      }
      case 'crt':
        ctx.setPrefs({ crt: !ctx.prefs.crt })
        break
      case 'quality':
        ctx.setPrefs({ quality: ctx.prefs.quality === 'high' ? 'low' : 'high' })
        break
      case 'language':
        this.chooseLocale(cycleLocale(this.locale(), dir))
        break
      case 'leaderboard': {
        const user = ctx.state().user
        if (!user) return
        ctx.send({ type: 'settings.update', hidden: !user.hidden })
        break
      }
      case 'reducedMotion':
      case 'logout':
        return
    }
    ctx.sfx.play('move')
    this.announceRow()
  }

  private logout(): void {
    if (!this.confirmLogout) {
      this.confirmLogout = true
      this.ctx.sfx.play('accept')
      this.ctx.announce(this.ctx.tr.t('settings.logoutConfirm', { ...this.ctx.buttons() }))
      return
    }
    this.confirmLogout = false
    this.ctx.sfx.play('accept')
    this.ctx.logout()
  }

  action(e: ActionEvent): boolean {
    const id = SETTING_IDS[this.index]!
    switch (e.action) {
      case 'up':
      case 'down':
        this.move(e.action === 'up' ? -1 : 1)
        return true
      case 'left':
      case 'right':
        if (this.enabled(id)) this.change(id, e.action === 'left' ? -1 : 1)
        return true
      case 'accept':
        if (!this.enabled(id)) return true
        if (id === 'logout') this.logout()
        else this.change(id, 1)
        return true
      default:
        return false
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { ctx } = this
    const { tr } = ctx
    drawWindow(g, WIN.x, WIN.y, WIN.w, WIN.h, { top: PALETTE.deepTop })
    const hover = ctx.hoverId()
    const right = WIN.x + WIN.w - 12
    SETTING_IDS.forEach((id, i) => {
      const y = settingY(id)
      const hitId = `settings:${id}`
      const enabled = this.enabled(id)
      if (hover === hitId && enabled) this.select(i)
      const selected = i === this.index
      if (selected) drawBand(g, WIN.x + 4, y - 5, WIN.w - 8, 16)
      const color = !enabled ? PALETTE.muted : selected ? PALETTE.gold : PALETTE.cream
      const label =
        id === 'logout' && this.confirmLogout
          ? tr.t('settings.logoutConfirm', { ...ctx.buttons() })
          : this.label(id)
      drawText(g, label, WIN.x + 12, y, { color, shadow: PALETTE.ink })
      ctx.hits.add({
        x: WIN.x + 4,
        y: y - 5,
        w: WIN.w - 8,
        h: 16,
        id: hitId,
        onClick: () => {
          if (!enabled) return
          this.select(i)
          if (id === 'logout') this.logout()
          else this.change(id, 1)
        },
      })
      this.drawValue(g, id, right, y, selected, enabled, t)
      if (selected) drawCorners(g, WIN.x + 4, y - 5, WIN.w - 8, 16, this.host.cornerGap(t))
    })
    // Separador y descripción del ajuste elegido.
    g.fillStyle = PALETTE.frameInner
    g.fillRect(WIN.x + 12, 165, WIN.w - 24, 1)
    const id = SETTING_IDS[this.index]!
    const lines = [
      ...wrap(tr.t(`settings.desc.${id}` as MessageKey), WIN.w - 24).map(text => ({
        text,
        color: PALETTE.cream,
      })),
    ]
    lines.slice(0, 2).forEach((line, k) => {
      drawText(g, line.text, WIN.x + 12, 174 + k * 11, { color: line.color, shadow: PALETTE.ink })
    })
  }

  private drawValue(
    g: CanvasRenderingContext2D,
    id: SettingId,
    right: number,
    y: number,
    selected: boolean,
    enabled: boolean,
    t: number,
  ): void {
    const { ctx } = this
    switch (id) {
      case 'sound':
        this.drawToggle(g, right, y, ctx.prefs.sound)
        return
      case 'crt':
        this.drawToggle(g, right, y, ctx.prefs.crt && !ctx.reducedMotion, !enabled)
        return
      case 'leaderboard':
        this.drawToggle(g, right, y, !(ctx.state().user?.hidden ?? false), !enabled)
        return
      case 'volume':
        this.drawVolume(g, right, y, ctx.prefs.volume)
        return
      case 'language':
        this.drawLanguages(g, right, y, selected, t)
        return
      case 'logout':
        return
      default: {
        const value = this.value(id)
        const text = enabled ? `◄ ${value} ►` : value
        drawText(g, text, right, y, {
          color: !enabled ? PALETTE.muted : selected ? PALETTE.gold : PALETTE.cream,
          align: 'right',
          shadow: PALETTE.ink,
        })
      }
    }
  }

  /** Interruptor de 22×11: `moneyTop` con el botón `win` a la derecha si está encendido. */
  private drawToggle(
    g: CanvasRenderingContext2D,
    right: number,
    y: number,
    on: boolean,
    off = false,
  ) {
    const x = right - 22
    const top = y - 2
    g.fillStyle = PALETTE.ink
    g.fillRect(x - 1, top - 1, 24, 13)
    g.fillStyle = on && !off ? PALETTE.moneyTop : PALETTE.line
    g.fillRect(x, top, 22, 11)
    g.fillStyle = on && !off ? PALETTE.win : PALETTE.muted
    g.fillRect(on ? x + 11 : x, top, 11, 11)
  }

  /** Volumen en 8 barras crecientes (oro las encendidas). */
  private drawVolume(g: CanvasRenderingContext2D, right: number, y: number, level: number) {
    for (let i = 0; i < VOLUME_STEPS; i++) {
      const h = 2 + i
      const x = right - (VOLUME_STEPS - i) * 7 + 2
      g.fillStyle = i < level ? PALETTE.gold : PALETTE.line
      g.fillRect(x, y + 7 - h, 5, h)
    }
  }

  /**
   * Fila de banderas alineada a la derecha, con el nombre del idioma delante. La elegida va a
   * color con esquinas oro que respiran; las demás, apagadas. Clic en una bandera la elige.
   */
  private drawLanguages(
    g: CanvasRenderingContext2D,
    right: number,
    y: number,
    selected: boolean,
    t: number,
  ): void {
    const current = this.locale()
    const pitch = FLAG_WIDTH + FLAG_GAP
    const fit = Math.max(1, Math.floor((LANGUAGE_ROW_WIDTH + FLAG_GAP) / pitch))
    const at = LANGUAGES.findIndex(l => l.code === current)
    const first = Math.min(
      Math.max(0, at - Math.floor(fit / 2)),
      Math.max(0, LANGUAGES.length - fit),
    )
    const shown = LANGUAGES.slice(first, first + fit)
    const fy = y - 2
    let x = right - shown.length * pitch + FLAG_GAP
    const name = languageOf(current).meta.nativeName.toLocaleUpperCase(current)
    drawText(g, `◄ ${name} ►`, x - 8, y, {
      color: selected ? PALETTE.gold : PALETTE.cream,
      align: 'right',
      shadow: PALETTE.ink,
    })
    const hover = this.ctx.hoverId()
    for (const language of shown) {
      const id = `settings:lang:${language.code}`
      const active = language.code === current
      drawFlag(g, language.flag, x, fy)
      if (!active) {
        // Apagada: tinta al 55 % por encima (como los pozos).
        g.fillStyle = 'rgba(8,7,13,0.55)'
        g.fillRect(x, fy, FLAG_WIDTH, FLAG_HEIGHT)
      }
      if (active)
        drawCorners(g, x, fy, FLAG_WIDTH, FLAG_HEIGHT, 1 + (this.host.cornerGap(t) % 2), 3, 1)
      else if (hover === id) {
        g.fillStyle = PALETTE.cream
        g.fillRect(x - 1, fy - 1, FLAG_WIDTH + 2, 1)
        g.fillRect(x - 1, fy + FLAG_HEIGHT, FLAG_WIDTH + 2, 1)
      }
      this.ctx.hits.add({
        x: x - 2,
        y: fy - 2,
        w: FLAG_WIDTH + 4,
        h: FLAG_HEIGHT + 4,
        id,
        onClick: () => {
          this.index = SETTING_IDS.indexOf('language')
          if (language.code !== current) this.ctx.sfx.play('move')
          this.chooseLocale(language.code)
        },
      })
      x += pitch
    }
  }
}
