// SPDX-License-Identifier: AGPL-3.0-or-later
// La mesa: HUD (saldo, deuda, patrimonio, racha, tiradas, estado), selector de fichas, ayuda del
// mando y el cursor sobre el tapete. Apostar solo manda `bet.place`; lo que se pinta es lo que
// confirma el servidor (`slip`).
import { selectionKey } from '@vibe-gambling/shared'
import type { BetSelection } from '@vibe-gambling/shared'

import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, measure } from '../../font/bitmap.ts'
import { chipLabel, describePayout, describeSelection } from '../../game/describe.ts'
import { INITIAL_CURSOR, hitTest, moveCursor } from '../../game/layout.ts'
import type { Point } from '../../game/layout.ts'
import { drawChipIcon, drawWindow } from '../draw.ts'
import { CHIP_COLORS, PALETTE } from '../palette.ts'
import { MenuScreen } from './menu.ts'

/** Altura del letrero de estado (entre la ruleta y el tapete). */
const STATUS_Y = 88

export type Chip = number | 'all-in'

export interface TableHost {
  /** Punto del tapete bajo un píxel de la pantalla virtual. */
  pick(x: number, y: number): Point | null
}

export class TableScreen implements Screen {
  readonly id = 'table'
  readonly showsTable = true
  cursor: Point = { ...INITIAL_CURSOR }
  /** Punto bajo el ratón (tiene prioridad sobre el cursor del mando mientras está en la mesa). */
  mouse: Point | null = null
  chipIndex = 0
  private readonly ctx: AppContext
  private readonly host: TableHost

  constructor(ctx: AppContext, host: TableHost) {
    this.ctx = ctx
    this.host = host
    // Por defecto, la ficha más pequeña que no sea ridícula: la segunda si existe.
    this.chipIndex = Math.min(1, this.ctx.web.game.chips.length - 1)
  }

  chips(): Chip[] {
    const list: Chip[] = [...this.ctx.web.game.chips]
    if (this.ctx.web.game.allIn) list.push('all-in')
    return list
  }

  chip(): Chip {
    const list = this.chips()
    return list[Math.min(this.chipIndex, list.length - 1)]!
  }

  /** Punto activo: el del ratón si está sobre el tapete, si no el del mando. */
  focus(): Point {
    return this.mouse ?? this.cursor
  }

  hover(): BetSelection | null {
    return hitTest(this.focus())
  }

  private bet(sel: BetSelection | null): void {
    if (!sel) return
    const chip = this.chip()
    const ok = this.ctx.send({ type: 'bet.place', selection: sel, amount: chip })
    this.ctx.sfx.play(ok ? 'chip' : 'error')
  }

  private cycleChip(dir: number): void {
    const n = this.chips().length
    this.chipIndex = (this.chipIndex + dir + n) % n
    this.ctx.sfx.play('move')
  }

  action(e: ActionEvent): void {
    switch (e.action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        this.mouse = null
        this.cursor = moveCursor(this.cursor, e.action, e.fine)
        this.ctx.sfx.play('move')
        return
      case 'accept':
        this.bet(this.hover())
        return
      case 'clear':
        if (this.ctx.state().slip.bets.length === 0) return
        this.ctx.send({ type: 'bet.clear' })
        this.ctx.sfx.play('clear')
        return
      case 'chip':
        if (e.chipIndex !== undefined) {
          if (e.chipIndex < this.chips().length) {
            this.chipIndex = e.chipIndex
            this.ctx.sfx.play('move')
          }
          return
        }
        this.cycleChip(1)
        return
      case 'start':
      case 'back':
        this.ctx.sfx.play('accept')
        this.ctx.push(new MenuScreen(this.ctx))
        return
      case 'mute':
        return
    }
  }

  pointer(kind: 'move' | 'down' | 'leave', x: number, y: number): boolean {
    if (kind === 'leave') {
      this.mouse = null
      return true
    }
    // La franja inferior es interfaz, no mesa.
    const p = y < 204 ? this.host.pick(x, y) : null
    const sel = p ? hitTest(p) : null
    this.mouse = sel ? p : null
    if (kind === 'down' && sel && p) {
      this.cursor = p
      this.bet(sel)
    }
    return true
  }

  wheel(delta: number): void {
    this.cycleChip(delta > 0 ? 1 : -1)
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const state = this.ctx.state()
    const w = state.shown
    const muted = PALETTE.muted

    // Cartera: arriba a la izquierda.
    drawWindow(g, 4, 4, 116, 40)
    const row = (label: string, value: string, y: number, color: string) => {
      drawText(g, label, 10, y, { color: muted, shadow: PALETTE.ink })
      drawText(g, value, 114, y, { color, align: 'right', shadow: PALETTE.ink })
    }
    if (w) {
      row(tr.t('hud.balance'), tr.n(w.balance), 10, PALETTE.cream)
      row(tr.t('hud.debt'), tr.n(w.debt), 21, w.debt > 0 ? PALETTE.loss : PALETTE.cream)
      row(tr.t('hud.net'), tr.n(w.netWorth), 32, w.netWorth < 0 ? PALETTE.loss : PALETTE.win)
    } else {
      drawText(g, tr.t('status.connecting'), 10, 10, { color: muted })
    }

    // Racha y tiradas: arriba a la derecha.
    drawWindow(g, 222, 4, 94, 29)
    if (w) {
      const streak = w.currentStreak
      const streakText = streak > 0 ? `▲${streak}` : streak < 0 ? `▼${-streak}` : '–'
      const streakColor = streak > 0 ? PALETTE.win : streak < 0 ? PALETTE.loss : PALETTE.cream
      drawText(g, tr.t('hud.streak'), 228, 10, { color: muted, shadow: PALETTE.ink })
      drawText(g, streakText, 310, 10, { color: streakColor, align: 'right', shadow: PALETTE.ink })
      drawText(g, tr.t('hud.spins'), 228, 21, { color: muted, shadow: PALETTE.ink })
      drawText(g, tr.n(w.spins), 310, 21, {
        color: PALETTE.cream,
        align: 'right',
        shadow: PALETTE.ink,
      })
    }

    // Estado: centrado bajo la ruleta.
    const status = this.statusText()
    if (status) {
      const sw = measure(status.text) + 16
      drawWindow(g, 160 - sw / 2, STATUS_Y, sw, 15, { shadow: true })
      // El parpadeo alterna el brillo (nunca deja el letrero vacío).
      const dimmed = status.blink && Math.floor(t * 2) % 2 === 1
      drawText(g, status.text, 160, STATUS_Y + 4, {
        color: dimmed ? PALETTE.frameInner : status.color,
        align: 'center',
      })
    }

    // Barra inferior (36 px): casilla bajo el cursor y apuesta, fichas y ayuda del mando.
    drawWindow(g, 0, 204, 320, 36, { shadow: false })
    const sel = this.hover()
    const total = state.slip.total
    const totalText = `${tr.t('hud.bet')} ${tr.n(total)}`
    const totalW = measure(totalText)
    drawText(g, totalText, 314, 208, { color: total > 0 ? PALETTE.gold : muted, align: 'right' })
    if (sel) {
      const onIt = state.slip.bets.find(b => selectionKey(b.selection) === selectionKey(sel))
      const parts = [describeSelection(sel, tr), describePayout(sel, tr)]
      if (onIt) parts.push(tr.t('bet.onIt', { amount: tr.n(onIt.amount) }))
      drawText(g, truncate(parts.join(' · '), 300 - totalW - 12), 6, 208, { color: PALETTE.cream })
    }
    const chips = this.chips()
    let x = 12
    chips.forEach((chip, i) => {
      const selected = i === this.chipIndex
      const label = chip === 'all-in' ? tr.t('hud.allIn') : chipLabel(chip)
      const color = chip === 'all-in' ? PALETTE.gold : CHIP_COLORS[i % CHIP_COLORS.length]!
      drawChipIcon(g, x, 222, color, selected)
      const lw = measure(label)
      drawText(g, label, x + 9, 219, {
        color: selected ? PALETTE.gold : chip === 'all-in' ? PALETTE.loss : PALETTE.cream,
      })
      const slotW = 9 + lw + 9
      this.ctx.hits.add({
        x: x - 7,
        y: 215,
        w: slotW + 4,
        h: 14,
        id: `chip:${i}`,
        onClick: () => {
          this.chipIndex = i
          this.ctx.sfx.play('move')
        },
      })
      x += slotW + 4
    })
    drawText(g, tr.t('help.table', { ...this.ctx.buttons() }), 6, 231, { color: muted })
  }

  private statusText(): { text: string; color: string; blink: boolean } | null {
    const { tr } = this.ctx
    const conn = this.ctx.connection()
    if (conn === 'connecting')
      return { text: tr.t('status.connecting'), color: PALETTE.muted, blink: true }
    if (conn === 'reconnecting')
      return { text: tr.t('status.offline'), color: PALETTE.loss, blink: true }
    switch (this.ctx.state().phase) {
      case 'spinning':
        return { text: tr.t('status.thinking'), color: PALETTE.gold, blink: true }
      case 'landing':
        return { text: tr.t('status.landing'), color: PALETTE.cream, blink: false }
      case 'idle':
        return {
          text: this.ctx.demo ? tr.t('status.demo') : tr.t('status.idle'),
          color: PALETTE.cream,
          blink: false,
        }
      default:
        return null
    }
  }
}

function truncate(text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text
  let out = text
  while (out.length > 1 && measure(`${out}…`) > maxWidth) out = out.slice(0, -1)
  return `${out}…`
}
