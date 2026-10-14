// SPDX-License-Identifier: AGPL-3.0-or-later
// Menú principal (`menu-main.png`): rejilla de iconos 3D low-poly (solo gira el elegido) en dos
// filas de 6 (la TIENDA completó la segunda, que antes era una pirámide invertida de 5),
// esquinas oro que respiran, ventana de información debajo y cabecera con la temporada y lo que
// le queda. ←→↑↓ mueven sin saltar de fila; ratón: pasar = elegir, clic = abrir.
import type { ActionEvent } from '../../../app/input.ts'
import { drawText, measure } from '../../../font/bitmap.ts'
import { pendingSpins } from '../../../game/state.ts'
import type { MessageKey } from '../../../i18n/index.ts'
import { bobOffset, spinAngle } from '../../../render/menuIcons/layer.ts'
import type { IconKind } from '../../../render/menuIcons/layer.ts'
import { drawWindow, fillCircle } from '../../draw.ts'
import { PALETTE } from '../../palette.ts'
import { GRADIENTS, drawCorners, drawGradientText, drawWell, fit } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'
import { seasonDaysLeft } from '../format.ts'
import { AchievementsPage } from './achievements.ts'
import { BankPage } from './bank.ts'
import { CreditsPage } from './credits.ts'
import { HowToPage } from './howTo.ts'
import { MemoryCardPage } from './memoryCard.ts'
import { PendingPage } from './pending.ts'
import { RankingPage } from './ranking.ts'
import { ReferralPage } from './referral.ts'
import { SettingsPage } from './settings.ts'
import { ShopPage } from './shop.ts'
import { StatsPage } from './stats.ts'

export const GRID = Object.freeze({
  /** Casillas de cada fila, de arriba abajo (cada fila va centrada en la pantalla). */
  rows: [6, 6] as readonly number[],
  y: 30,
  w: 46,
  h: 52,
  gap: 5,
})

/** Tamaño de los iconos (px por unidad de malla) elegido y en reposo, y su brillo. */
const ICON = Object.freeze({ selected: 15, idle: 12, bright: 1.12, dim: 0.72, bob: 1.5 })

export type MainItemId =
  | 'resume'
  | 'pending'
  | 'stats'
  | 'achievements'
  | 'leaderboard'
  | 'referral'
  | 'bank'
  | 'memoryCard'
  | 'settings'
  | 'howTo'
  | 'credits'
  | 'shop'

interface MainItem {
  id: MainItemId
  icon: IconKind
}

/** Orden de la rejilla (de izquierda a derecha y de arriba abajo). */
export const MAIN_ITEMS: readonly MainItem[] = Object.freeze([
  { id: 'resume', icon: 'chip' },
  { id: 'pending', icon: 'stack' },
  { id: 'stats', icon: 'bars' },
  { id: 'achievements', icon: 'trophy' },
  { id: 'leaderboard', icon: 'crown' },
  { id: 'referral', icon: 'pyramid' },
  { id: 'bank', icon: 'bank' },
  { id: 'memoryCard', icon: 'memoryCard' },
  { id: 'settings', icon: 'gear' },
  { id: 'howTo', icon: 'book' },
  { id: 'credits', icon: 'gem' },
  { id: 'shop', icon: 'bag' },
])

/** Fila y columna de la casilla i (y el índice de la primera casilla de su fila). */
function cellOf(index: number): { row: number; col: number; first: number } {
  let first = 0
  for (let row = 0; row < GRID.rows.length; row++) {
    const n = GRID.rows[row]!
    if (index < first + n) return { row, col: index - first, first }
    first += n
  }
  return { row: 0, col: 0, first: 0 }
}

/** Rectángulo de la casilla i: cada fila va centrada en los 320 px de la pantalla. */
export function tileRect(i: number): { x: number; y: number; w: number; h: number } {
  const { row, col } = cellOf(i)
  const n = GRID.rows[row]!
  const width = n * GRID.w + (n - 1) * GRID.gap
  return {
    x: Math.round((320 - width) / 2) + col * (GRID.w + GRID.gap),
    y: GRID.y + row * (GRID.h + GRID.gap),
    w: GRID.w,
    h: GRID.h,
  }
}

/**
 * Siguiente casilla con una flecha: ←→ dan la vuelta dentro de la fila; ↑↓ cambian de fila (con
 * vuelta) a la casilla cuyo centro queda más cerca (con empate, la de la izquierda).
 */
export function gridMove(index: number, action: ActionEvent['action']): number {
  const { row, col, first } = cellOf(index)
  const n = GRID.rows[row]!
  switch (action) {
    case 'left':
      return first + ((col + n - 1) % n)
    case 'right':
      return first + ((col + 1) % n)
    case 'up':
    case 'down': {
      const rows = GRID.rows.length
      const target = (row + (action === 'up' ? rows - 1 : 1)) % rows
      const start = GRID.rows.slice(0, target).reduce((a, b) => a + b, 0)
      const center = (r: { x: number; w: number }) => r.x + r.w / 2
      const here = center(tileRect(index))
      let best = start
      for (let i = start; i < start + GRID.rows[target]!; i++) {
        if (Math.abs(center(tileRect(i)) - here) < Math.abs(center(tileRect(best)) - here)) best = i
      }
      return best
    }
    default:
      return index
  }
}

export class MainMenuPage implements MenuPage {
  readonly id = 'menu'
  readonly icon = 'chip' as const
  index = 0
  private readonly host: MenuHost

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  title(): string {
    return this.ctx.tr.t('menu.title')
  }

  headerRight(): string | undefined {
    const w = this.ctx.state().shown
    if (!w) return undefined
    const days = seasonDaysLeft(w.seasonId, this.ctx.web.game, Date.now())
    return this.ctx.tr.t('menu.seasonLeft', { season: w.seasonId, n: this.ctx.tr.n(days) })
  }

  help(): HelpItem[] {
    const b = this.ctx.buttons()
    const { tr } = this.ctx
    return [
      { key: '←→↑↓', label: tr.t('help.choose') },
      { key: b.x, label: tr.t('help.open') },
      { key: b.o, label: tr.t('help.backToTable') },
    ]
  }

  /** Nombre, línea principal y pista de una opción (también para `aria-live`). */
  info(id: MainItemId): { name: string; line: string; hint: string } {
    const { tr } = this.ctx
    const state = this.ctx.state()
    const w = state.shown
    const name = tr.t(`menu.item.${id}` as MessageKey)
    switch (id) {
      case 'pending': {
        const n = pendingSpins(state)
        const days = w ? seasonDaysLeft(w.seasonId, this.ctx.web.game, Date.now()) : 0
        return {
          name,
          line:
            n > 0
              ? tr.plural('menu.item.pending.line', n, { n: tr.n(n), days: tr.n(days) })
              : tr.t('menu.item.pending.none'),
          hint: tr.t(n > 0 ? 'menu.item.pending.hint' : 'pending.emptyHint'),
        }
      }
      case 'achievements': {
        const { unlocked, total } = this.ctx.achievements().count()
        return {
          name,
          line: tr.t('menu.item.achievements.line', { n: tr.n(unlocked), total: tr.n(total) }),
          hint: tr.t('menu.item.achievements.hint'),
        }
      }
      case 'bank':
        return {
          name,
          line: tr.plural('menu.item.bank.line', w?.loans ?? 0, {
            debt: tr.n(w?.debt ?? 0),
            loans: tr.n(w?.loans ?? 0),
          }),
          hint: tr.t('menu.item.bank.hint'),
        }
      case 'stats':
        return {
          name,
          line: tr.t('menu.item.stats.line'),
          hint: tr.plural('menu.item.stats.hint', w?.spins ?? 0, { n: tr.n(w?.spins ?? 0) }),
        }
      default:
        return {
          name,
          line: tr.t(`menu.item.${id}.line` as MessageKey),
          hint: tr.t(`menu.item.${id}.hint` as MessageKey),
        }
    }
  }

  describe(): string {
    const item = MAIN_ITEMS[this.index]!
    const info = this.info(item.id)
    return `${this.ctx.tr.t('menu.title')}. ${info.name}. ${info.line}`
  }

  private select(i: number): void {
    if (i === this.index) return
    this.index = i
    this.ctx.sfx.play('move')
    const info = this.info(MAIN_ITEMS[i]!.id)
    this.ctx.announce(`${info.name}. ${info.line}`)
  }

  /** Abre la opción elegida. */
  accept(): void {
    const { host, ctx } = this
    switch (MAIN_ITEMS[this.index]!.id) {
      case 'resume':
        ctx.sfx.play('back')
        host.close()
        return
      case 'pending':
        host.open(new PendingPage(host))
        return
      case 'stats':
        host.open(new StatsPage(host))
        return
      case 'achievements':
        host.open(new AchievementsPage(host))
        return
      case 'leaderboard':
        host.open(new RankingPage(host))
        return
      case 'referral':
        host.open(new ReferralPage(host))
        return
      case 'bank':
        host.open(new BankPage(host))
        return
      case 'memoryCard':
        host.open(new MemoryCardPage(host))
        return
      case 'settings':
        host.open(new SettingsPage(host))
        return
      case 'howTo':
        host.open(new HowToPage(host))
        return
      case 'credits':
        host.open(new CreditsPage(host))
        return
      case 'shop':
        host.open(new ShopPage(host))
        return
    }
  }

  action(e: ActionEvent): boolean {
    switch (e.action) {
      case 'left':
      case 'right':
      case 'up':
      case 'down':
        this.select(gridMove(this.index, e.action))
        return true
      case 'accept':
        this.accept()
        return true
      case 'spin':
        // SELECT abre directamente las tiradas pendientes.
        this.index = MAIN_ITEMS.findIndex(i => i.id === 'pending')
        this.accept()
        return true
      default:
        return false
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { ctx, host } = this
    const { menu } = ctx.client
    const hover = ctx.hoverId()
    MAIN_ITEMS.forEach((item, i) => {
      const r = tileRect(i)
      const id = `menu:tile:${item.id}`
      if (hover === id) this.select(i)
      const selected = i === this.index
      if (selected) drawWindow(g, r.x, r.y, r.w, r.h, { shadow: false })
      else drawWell(g, r.x, r.y, r.w, r.h)
      // Con insignia, el icono se aparta un poco para no taparla (va por encima de la UI).
      const badge = item.id === 'pending' && pendingSpins(ctx.state()) > 0
      const cx = r.x + r.w / 2 - (badge ? 3 : 0)
      const cy = r.y + r.h / 2 + (badge ? 4 : 0)
      host.icons.icon(
        item.icon,
        cx,
        cy + (selected ? bobOffset(t, menu.iconBobMs, ICON.bob, host.still) : 0),
        selected ? ICON.selected : ICON.idle,
        {
          yaw: selected ? spinAngle(t, menu.iconSpinMs, host.still) : undefined,
          brightness: selected ? ICON.bright : ICON.dim,
          count: item.id === 'pending' ? 7 : undefined,
        },
      )
      if (selected) drawCorners(g, r.x, r.y, r.w, r.h, host.cornerGap(t))
      this.drawBadge(g, item.id, r)
      ctx.hits.add({
        ...r,
        id,
        onClick: () => {
          this.index = i
          this.accept()
        },
      })
    })
    this.drawInfo(g)
  }

  /** Insignias: TIRADAS con el número (caja roja) y LOGROS con un punto oro si hay uno sin ver. */
  private drawBadge(
    g: CanvasRenderingContext2D,
    id: MainItemId,
    r: { x: number; y: number; w: number },
  ): void {
    if (id === 'pending') {
      const n = pendingSpins(this.ctx.state())
      if (n <= 0) return
      const text = this.ctx.tr.n(n)
      const w = Math.max(15, text.length * 6 + 5)
      const x = r.x + r.w - w - 3
      const y = r.y + 3
      g.fillStyle = PALETTE.cream
      g.fillRect(x, y, w, 11)
      g.fillStyle = PALETTE.red
      g.fillRect(x + 1, y + 1, w - 2, 9)
      drawText(g, text, x + w / 2, y + 3, { color: PALETTE.cream, align: 'center' })
    } else if (id === 'achievements' && this.ctx.achievements().hasUnseen()) {
      fillCircle(g, r.x + r.w - 7, r.y + 8, 2, PALETTE.gold)
    }
  }

  private drawInfo(g: CanvasRenderingContext2D): void {
    const { tr } = this.ctx
    const item = MAIN_ITEMS[this.index]!
    const info = this.info(item.id)
    drawWindow(g, 8, 150, 304, 64)
    const counter = item.id === 'pending' ? pendingSpins(this.ctx.state()) : null
    const max = this.ctx.web.game.pendingSpins.max
    const of = tr.t('menu.item.pending.of', { max: tr.n(max) })
    // El contador grande ocupa la derecha: el texto llega hasta él.
    const counterW =
      counter !== null && counter > 0 ? Math.max(measure(tr.n(counter), 3), measure(of)) + 10 : 0
    const textW = 284 - counterW
    drawGradientText(g, info.name, 18, 160, GRADIENTS.gold, { scale: 2, shadow: PALETTE.ink })
    drawText(g, fit(info.line, textW), 18, 182, { color: PALETTE.cream, shadow: PALETTE.ink })
    drawText(g, fit(info.hint, textW), 18, 196, { color: PALETTE.muted })
    if (counter !== null && counter > 0) {
      const full = counter >= max
      drawGradientText(g, tr.n(counter), 302, 160, full ? GRADIENTS.red : GRADIENTS.gold, {
        scale: 3,
        align: 'right',
        shadow: PALETTE.jackpotBottom,
      })
      drawText(g, of, 302, 186, { color: PALETTE.muted, align: 'right' })
    }
  }
}
