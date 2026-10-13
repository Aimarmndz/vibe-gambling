// SPDX-License-Identifier: AGPL-3.0-or-later
// LOGROS (`menu-achievements.png`): los del catálogo con su copa 3D (oro si se consiguió), nombre,
// descripción, fecha o progreso ("n/meta" y barra). Los secretos salen como "???" hasta
// conseguirlos. La copa de la fila elegida gira. Textos: `achievements.<id>.*` de locales.
import type { ActionEvent } from '../../../app/input.ts'
import { drawText } from '../../../font/bitmap.ts'
import { achievementRow } from '../../../game/achievements.ts'
import type { AchievementRow } from '../../../game/achievements.ts'
import { spinAngle } from '../../../render/menuIcons/layer.ts'
import { drawWindow } from '../../draw.ts'
import { PALETTE } from '../../palette.ts'
import { shortDate } from '../format.ts'
import { SECONDARY, drawBand, drawBar, drawCorners, fit } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'

export const LIST = Object.freeze({ x: 8, y: 33, w: 304, h: 183, row: 29 })
/** Filas que caben en la lista. */
export const VISIBLE_ROWS = Math.floor((LIST.h - 6) / LIST.row)

/** Primera fila visible para que la elegida quede dentro (desplazamiento mínimo). */
export function scrollFor(index: number, top: number, visible: number, total: number): number {
  let first = top
  if (index < first) first = index
  if (index >= first + visible) first = index - visible + 1
  return Math.max(0, Math.min(first, Math.max(0, total - visible)))
}

export class AchievementsPage implements MenuPage {
  readonly id = 'achievements'
  readonly icon = 'trophy' as const
  private readonly host: MenuHost
  private index = 0
  private top = 0

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  private rows(): AchievementRow[] {
    return (this.ctx.achievements().all() ?? []).map(a => achievementRow(a, this.ctx.tr))
  }

  title(): string {
    return this.ctx.tr.t('ach.title')
  }

  headerRight(): string | undefined {
    const { unlocked, total } = this.ctx.achievements().count()
    if (total === 0) return undefined
    const pct = Math.floor((unlocked / total) * 100)
    return this.ctx.tr.t('ach.count', {
      n: this.ctx.tr.n(unlocked),
      total: this.ctx.tr.n(total),
      pct,
    })
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    return [
      { key: '↑↓', label: tr.t('help.move') },
      { key: this.ctx.buttons().o, label: tr.t('help.back') },
    ]
  }

  enter(): void {
    // Al abrir la pantalla, todo lo conseguido queda visto (se apaga el punto oro del menú).
    this.ctx.achievements().markAllSeen()
  }

  /** Texto de una fila para `aria-live`. */
  rowText(row: AchievementRow): string {
    const { tr } = this.ctx
    const state =
      row.state === 'unlocked'
        ? tr.t('ach.a11yUnlocked')
        : row.progress
          ? tr.t('ach.a11yProgress', {
              n: tr.n(row.progress.current),
              goal: tr.n(row.progress.goal),
            })
          : tr.t('ach.a11yLocked')
    return `${row.title}. ${row.desc}. ${state}`
  }

  describe(): string {
    const { unlocked, total } = this.ctx.achievements().count()
    const first = this.rows()[this.index]
    const head = this.ctx.tr.t('ach.a11y', { n: unlocked, total })
    return first ? `${head} ${this.rowText(first)}` : head
  }

  private select(i: number): void {
    const rows = this.rows()
    if (rows.length === 0) return
    const next = Math.max(0, Math.min(rows.length - 1, i))
    if (next === this.index) return
    this.index = next
    this.top = scrollFor(next, this.top, VISIBLE_ROWS, rows.length)
    this.ctx.sfx.play('move')
    this.ctx.announce(this.rowText(rows[next]!))
  }

  action(e: ActionEvent): boolean {
    if (e.action === 'up' || e.action === 'down') {
      this.select(this.index + (e.action === 'up' ? -1 : 1))
      return true
    }
    return false
  }

  wheel(delta: number): void {
    this.select(this.index + Math.sign(delta))
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr, web } = this.ctx
    const rows = this.rows()
    const { unlocked, total } = this.ctx.achievements().count()
    // Barra de progreso bajo la cabecera.
    drawBar(g, 9, 25, 302, 4, total > 0 ? unlocked / total : 0)
    drawWindow(g, LIST.x, LIST.y, LIST.w, LIST.h, { top: PALETTE.deepTop })
    if (rows.length === 0) {
      drawText(g, tr.t('lb.loading'), 160, 120, { color: PALETTE.cream, align: 'center' })
      return
    }
    const hover = this.ctx.hoverId()
    const shown = rows.slice(this.top, this.top + VISIBLE_ROWS)
    shown.forEach((row, k) => {
      const i = this.top + k
      const y = LIST.y + 3 + k * LIST.row
      const id = `ach:${row.id}`
      if (hover === id) this.select(i)
      const selected = i === this.index
      if (selected) drawBand(g, LIST.x + 3, y, LIST.w - 10, LIST.row - 1)
      else if (k > 0) {
        g.fillStyle = PALETTE.line
        g.fillRect(LIST.x + 10, y - 1, LIST.w - 20, 1)
      }
      const got = row.state === 'unlocked'
      this.host.icons.icon(got ? 'trophy' : 'trophyLocked', LIST.x + 17, y + 14, 9, {
        yaw: selected
          ? spinAngle(t, this.ctx.client.menu.trophySpinMs, this.host.still)
          : undefined,
        tilt: 0.2,
      })
      const nameColor = selected ? PALETTE.gold : got ? PALETTE.cream : PALETTE.muted
      const rightW = got || row.progress ? 70 : 0
      const title = row.title.toLocaleUpperCase(tr.locale)
      drawText(g, fit(title, LIST.w - 48 - rightW), LIST.x + 36, y + 7, {
        color: nameColor,
        shadow: PALETTE.ink,
      })
      drawText(g, fit(row.desc, LIST.w - 48 - (row.progress ? 66 : 8)), LIST.x + 36, y + 18, {
        color: selected ? PALETTE.cream : got ? SECONDARY : PALETTE.muted,
      })
      const right = LIST.x + LIST.w - 10
      if (got && row.unlockedAt) {
        drawText(g, shortDate(row.unlockedAt, tr.locale, web.game.seasonTimeZone), right, y + 7, {
          color: PALETTE.cream,
          align: 'right',
          shadow: PALETTE.ink,
        })
      } else if (row.progress) {
        const { current, goal } = row.progress
        drawText(g, `${tr.n(current)}/${tr.n(goal)}`, right, y + 7, {
          color: PALETTE.cream,
          align: 'right',
          shadow: PALETTE.ink,
        })
        drawBar(g, right - 56, y + 18, 56, 4, current / goal)
      }
      if (selected) drawCorners(g, LIST.x + 3, y, LIST.w - 10, LIST.row - 1, this.host.cornerGap(t))
      this.ctx.hits.add({
        x: LIST.x + 3,
        y,
        w: LIST.w - 10,
        h: LIST.row - 1,
        id,
        onClick: () => this.select(i),
      })
    })
    // Barra de desplazamiento de 2 px.
    if (rows.length > VISIBLE_ROWS) {
      const trackY = LIST.y + 4
      const trackH = LIST.h - 8
      g.fillStyle = PALETTE.line
      g.fillRect(306, trackY, 2, trackH)
      const thumbH = Math.max(8, Math.round((trackH * VISIBLE_ROWS) / rows.length))
      const thumbY =
        trackY + Math.round(((trackH - thumbH) * this.top) / (rows.length - VISIBLE_ROWS))
      g.fillStyle = PALETTE.frame
      g.fillRect(306, thumbY, 2, thumbH)
    }
  }
}
