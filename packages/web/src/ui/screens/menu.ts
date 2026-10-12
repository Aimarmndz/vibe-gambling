// SPDX-License-Identifier: AGPL-3.0-or-later
// Menú de pausa (START), ajustes y créditos.
import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, wrap } from '../../font/bitmap.ts'
import { dim, drawHelpBar, drawWindow } from '../draw.ts'
import { ListMenu } from '../listMenu.ts'
import { PALETTE } from '../palette.ts'
import { LeaderboardScreen } from './leaderboard.ts'
import { MemoryCardScreen } from './memoryCard.ts'

const ROW = 14

export class MenuScreen implements Screen {
  readonly id = 'menu'
  private readonly ctx: AppContext
  private readonly menu: ListMenu

  constructor(ctx: AppContext) {
    this.ctx = ctx
    this.menu = new ListMenu(ctx, 'menu', [
      { label: () => ctx.tr.t('menu.resume'), accept: () => ctx.pop(this) },
      {
        label: () => ctx.tr.t('menu.leaderboard'),
        accept: () => ctx.push(new LeaderboardScreen(ctx)),
      },
      {
        label: () => ctx.tr.t('menu.memoryCard'),
        accept: () => ctx.push(new MemoryCardScreen(ctx)),
      },
      {
        label: () => ctx.tr.t('menu.loan'),
        accept: () => {
          ctx.pop(this)
          ctx.offerLoan()
        },
        disabled: () => !ctx.loanAvailable(),
      },
      { label: () => ctx.tr.t('menu.settings'), accept: () => ctx.push(new SettingsScreen(ctx)) },
      { label: () => ctx.tr.t('menu.credits'), accept: () => ctx.push(new CreditsScreen(ctx)) },
    ])
  }

  action(e: ActionEvent): void {
    if (this.menu.action(e)) return
    if (e.action === 'back' || e.action === 'start') {
      this.ctx.sfx.play('back')
      this.ctx.pop(this)
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    dim(g, 0.45)
    const h = 30 + this.menu.items.length * ROW
    const y = 120 - h / 2
    drawWindow(g, 92, y, 136, h)
    drawText(g, this.ctx.tr.t('menu.title'), 160, y + 8, { color: PALETTE.muted, align: 'center' })
    this.menu.draw(g, 104, y + 24, 112, ROW, t)
    drawHelpBar(g, this.ctx.tr.t('help.menu', { ...this.ctx.buttons() }), PALETTE.muted)
  }
}

export class SettingsScreen implements Screen {
  readonly id = 'settings'
  private readonly ctx: AppContext
  private readonly menu: ListMenu

  constructor(ctx: AppContext) {
    this.ctx = ctx
    const onOff = (v: boolean) => ctx.tr.t(v ? 'settings.on' : 'settings.off')
    this.menu = new ListMenu(ctx, 'settings', [
      {
        label: () => ctx.tr.t('settings.sound'),
        value: () => onOff(ctx.prefs.sound),
        change: () => ctx.setPrefs({ sound: !ctx.prefs.sound }),
      },
      {
        label: () => ctx.tr.t('settings.crt'),
        value: () => onOff(ctx.prefs.crt && !ctx.reducedMotion),
        change: () => ctx.setPrefs({ crt: !ctx.prefs.crt }),
        disabled: () => ctx.reducedMotion,
      },
      {
        label: () => ctx.tr.t('settings.language'),
        value: () => ctx.tr.t('meta.lang'),
        change: () => {
          const locale = ctx.tr.locale === 'en' ? 'es' : 'en'
          ctx.setPrefs({ locale })
          ctx.send({ type: 'settings.update', locale })
        },
      },
      {
        label: () => ctx.tr.t('settings.leaderboard'),
        value: () => ctx.tr.t(ctx.state().user?.hidden ? 'settings.hidden' : 'settings.visible'),
        change: () => {
          const user = ctx.state().user
          if (user) ctx.send({ type: 'settings.update', hidden: !user.hidden })
        },
        disabled: () => ctx.demo || ctx.state().user === null,
      },
      {
        label: () => ctx.tr.t('settings.quality'),
        value: () => ctx.tr.t(ctx.prefs.quality === 'high' ? 'settings.high' : 'settings.low'),
        change: () => ctx.setPrefs({ quality: ctx.prefs.quality === 'high' ? 'low' : 'high' }),
      },
    ])
  }

  action(e: ActionEvent): void {
    if (this.menu.action(e)) return
    if (e.action === 'back' || e.action === 'start') {
      this.ctx.sfx.play('back')
      this.ctx.pop(this)
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    dim(g, 0.6)
    drawWindow(g, 24, 14, 272, 200)
    drawText(g, tr.t('settings.title'), 160, 22, { color: PALETTE.gold, align: 'center' })
    this.menu.draw(g, 36, 42, 248, 16, t)
    const notes = [tr.t('settings.leaderboardNote')]
    if (this.ctx.reducedMotion) notes.push(tr.t('settings.reducedMotion'))
    let y = 128
    for (const note of notes) {
      for (const line of wrap(note, 248)) {
        drawText(g, line, 36, y, { color: PALETTE.muted })
        y += 10
      }
    }
    g.fillStyle = PALETTE.frameInner
    g.fillRect(36, 172, 248, 1)
    let ky = 178
    for (const line of wrap(tr.t('help.keys'), 248)) {
      drawText(g, line, 36, ky, { color: PALETTE.muted })
      ky += 10
    }
    drawHelpBar(g, tr.t('help.menu', { ...this.ctx.buttons() }), PALETTE.muted)
  }
}

export class CreditsScreen implements Screen {
  readonly id = 'credits'
  private readonly ctx: AppContext
  private readonly menu: ListMenu

  constructor(ctx: AppContext) {
    this.ctx = ctx
    const site = ctx.web.site
    // Los enlaces de ayuda del idioma actual (el idioma no cambia con los créditos abiertos).
    const help = site.helpLinks[ctx.tr.locale] ?? []
    this.menu = new ListMenu(ctx, 'credits', [
      {
        label: () => site.author.url.replace(/^https?:\/\//, ''),
        accept: () => ctx.openLink(site.author.url),
      },
      ...help.map(link => ({ label: () => link.label, accept: () => ctx.openLink(link.url) })),
      {
        label: () => site.repoUrl.replace(/^https?:\/\//, ''),
        accept: () => ctx.openLink(site.repoUrl),
      },
    ])
  }

  action(e: ActionEvent): void {
    if (this.menu.action(e)) return
    if (e.action === 'back' || e.action === 'start') {
      this.ctx.sfx.play('back')
      this.ctx.pop(this)
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr, web } = this.ctx
    dim(g, 0.6)
    drawWindow(g, 16, 16, 288, 208)
    drawText(g, tr.t('credits.title'), 160, 24, { color: PALETTE.gold, align: 'center' })
    drawText(g, tr.t('brand.title'), 160, 40, { color: PALETTE.cream, align: 'center', scale: 2 })
    drawText(g, tr.t('credits.createdBy', { author: web.site.author.name }), 28, 64, {
      color: PALETTE.cream,
    })
    let y = 76
    for (const line of wrap(tr.t('credits.fakeCoins'), 264)) {
      drawText(g, line, 28, y, { color: PALETTE.muted })
      y += 10
    }
    this.menu.draw(g, 28, y + 4, 260, 13, t)
    y += 8 + this.menu.items.length * 13
    for (const key of ['credits.disclaimer', 'credits.assets', 'credits.license'] as const) {
      for (const line of wrap(tr.t(key), 264)) {
        drawText(g, line, 28, y, { color: PALETTE.muted })
        y += 10
      }
    }
    drawText(
      g,
      tr.t('credits.version', { instance: web.instanceName, version: web.serverVersion }),
      28,
      y + 2,
      { color: PALETTE.line },
    )
    drawHelpBar(g, tr.t('credits.open', { ...this.ctx.buttons() }), PALETTE.muted)
  }
}
