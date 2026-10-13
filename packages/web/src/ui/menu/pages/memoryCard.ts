// SPDX-License-Identifier: AGPL-3.0-or-later
// MEMORY CARD (`menu-memory.png`): 15 bloques. El 1 es la partida de la temporada, con la marca de
// vibe-gambling como icono de guardado (el "_" parpadea); el resto está libre. Debajo, el resumen
// de la partida: saldo, deuda, patrimonio, tiradas, logros y pendientes.
import type { ActionEvent } from '../../../app/input.ts'
import { drawText, wrap } from '../../../font/bitmap.ts'
import { pendingSpins } from '../../../game/state.ts'
import { brandMarks, drawMark } from '../../brandMark.ts'
import { drawWindow } from '../../draw.ts'
import { PALETTE } from '../../palette.ts'
import { seasonTimeLeft } from '../format.ts'
import { drawCorners, drawWell } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'
import { gridMove } from './main.ts'

const COLS = 5
const ROWS = 3
const BLOCKS = COLS * ROWS
const BLOCK = Object.freeze({ x: 8, y: 27, w: 56, h: 36, dx: 62, dy: 39 })

export function blockRect(i: number): { x: number; y: number; w: number; h: number } {
  return {
    x: BLOCK.x + (i % COLS) * BLOCK.dx,
    y: BLOCK.y + Math.floor(i / COLS) * BLOCK.dy,
    w: BLOCK.w,
    h: BLOCK.h,
  }
}

/** Movimiento en la rejilla de 5×3 (como el menú principal, pero con tres filas). */
export function blockMove(index: number, action: ActionEvent['action']): number {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  if (action === 'up' || action === 'down') {
    const r = (row + (action === 'up' ? ROWS - 1 : 1)) % ROWS
    return r * COLS + col
  }
  // ←→ como en el menú (dan la vuelta dentro de la fila).
  return row * COLS + (gridMove(col, action) % COLS)
}

export class MemoryCardPage implements MenuPage {
  readonly id = 'memoryCard'
  readonly icon = 'memoryCard' as const
  private readonly host: MenuHost
  private index = 0

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  title(): string {
    return this.ctx.tr.t('mc.titleShort')
  }

  headerRight(): string {
    return this.ctx.tr.t('mc.slot', { used: 1, total: BLOCKS })
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    return [
      { key: '←→↑↓', label: tr.t('help.move') },
      { key: this.ctx.buttons().o, label: tr.t('help.back') },
    ]
  }

  describe(): string {
    const { tr } = this.ctx
    const w = this.ctx.state().shown
    if (!w) return tr.t('mc.noData')
    return tr.t('mc.a11y', {
      season: w.seasonId,
      balance: tr.n(w.balance),
      debt: tr.n(w.debt),
      net: tr.n(w.netWorth),
    })
  }

  action(e: ActionEvent): boolean {
    if (e.action === 'left' || e.action === 'right' || e.action === 'up' || e.action === 'down') {
      const next = blockMove(this.index, e.action)
      if (next !== this.index) {
        this.index = next
        this.ctx.sfx.play('move')
        this.ctx.announce(next === 0 ? this.describe() : this.ctx.tr.t('mc.freeInfo'))
      }
      return true
    }
    return false
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const blink =
      this.host.still || Math.floor((t * 1000) / this.ctx.client.menu.saveBlinkMs) % 2 === 0
    const hover = this.ctx.hoverId()
    for (let i = 0; i < BLOCKS; i++) {
      const r = blockRect(i)
      const id = `mc:${i}`
      if (hover === id && this.index !== i) this.index = i
      if (i === 0) {
        drawWindow(g, r.x, r.y, r.w, r.h, {
          shadow: false,
          top: PALETTE.goldDark,
          bottom: PALETTE.carpet,
        })
        const { small } = brandMarks()
        drawMark(g, small, r.x + r.w / 2 - 16, r.y + 2, 2, blink)
      } else {
        drawWell(g, r.x, r.y, r.w, r.h)
        drawText(g, tr.t('mc.free'), r.x + r.w / 2, r.y + 15, {
          color: PALETTE.muted,
          align: 'center',
        })
      }
      if (i === this.index) drawCorners(g, r.x, r.y, r.w, r.h, this.host.cornerGap(t))
      this.ctx.hits.add({ ...r, id, onClick: () => (this.index = i) })
    }
    this.drawDetail(g)
  }

  private drawDetail(g: CanvasRenderingContext2D): void {
    const { tr, web } = this.ctx
    const state = this.ctx.state()
    const w = state.shown
    drawWindow(g, 8, 146, 304, 70, { top: PALETTE.deepTop })
    if (this.index !== 0) {
      drawText(g, tr.t('mc.free'), 16, 155, { color: PALETTE.gold, shadow: PALETTE.ink })
      wrap(tr.t('mc.freeInfo'), 288).forEach((line, i) => {
        drawText(g, line, 16, 170 + i * 11, { color: PALETTE.cream })
      })
      return
    }
    if (!w) {
      wrap(tr.t('mc.noData'), 288).forEach((line, i) => {
        drawText(g, line, 16, 156 + i * 11, { color: PALETTE.cream })
      })
      return
    }
    drawText(g, tr.t('brand.title'), 16, 155, { color: PALETTE.gold, shadow: PALETTE.ink })
    drawText(g, tr.t('mc.season', { season: w.seasonId }), 304, 155, {
      color: PALETTE.cream,
      align: 'right',
      shadow: PALETTE.ink,
    })
    const { unlocked, total } = this.ctx.achievements().count()
    const stats: [string, string, string][] = [
      [tr.t('mc.balance'), tr.n(w.balance), PALETTE.cream],
      [tr.t('mc.debt'), tr.n(w.debt), w.debt > 0 ? PALETTE.loss : PALETTE.cream],
      [tr.t('mc.net'), tr.n(w.netWorth), w.netWorth < 0 ? PALETTE.loss : PALETTE.win],
      [tr.t('mc.spins'), tr.n(w.spins), PALETTE.cream],
      [tr.t('mc.achievements'), total > 0 ? `${tr.n(unlocked)}/${tr.n(total)}` : '—', PALETTE.gold],
      [tr.t('mc.pending'), tr.n(pendingSpins(state)), PALETTE.gold],
    ]
    stats.forEach(([label, value, color], i) => {
      const x = i < 3 ? 16 : 168
      const y = 168 + (i % 3) * 11
      drawText(g, label, x, y, { color: PALETTE.cream })
      drawText(g, value, i < 3 ? 152 : 304, y, { color, align: 'right', shadow: PALETTE.ink })
    })
    drawText(
      g,
      tr.t('mc.endsLine', { time: seasonTimeLeft(w.seasonId, web.game, Date.now(), tr) }),
      16,
      204,
      { color: PALETTE.muted },
    )
  }
}
