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
import { idleStatusKey, spinHelpOnRepeat, tableHelpKey } from '../../game/hints.ts'
import { INITIAL_CURSOR, hitTest, moveCursor } from '../../game/layout.ts'
import { pendingSpins } from '../../game/state.ts'
import { Odometer } from '../../render/fx/odometer.ts'
import type { Point } from '../../game/layout.ts'
import { DEMO_PANEL, drawDemoPanel } from '../demoPanel.ts'
import { drawPocketPanel } from '../pocketPanel.ts'
import { streakText } from '../../game/shopView.ts'
import { drawChipIcon, drawWindow } from '../draw.ts'
import { PALETTE } from '../palette.ts'
import { chipColor, chipSkin } from '../../render/skins.ts'
import { STATUS_BOX, STATUS_LOOKS, statusColor } from '../status.ts'
import type { StatusKind } from '../status.ts'
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
  /** Contador de tiradas pendientes del HUD (bota al sumar y al gastar). */
  private readonly pendingCounter: Odometer

  constructor(ctx: AppContext, host: TableHost) {
    this.ctx = ctx
    this.host = host
    this.pendingCounter = new Odometer(
      {
        rollMs: ctx.client.fx.pending.rollMs,
        floatMs: ctx.client.fx.pending.floatMs,
        budgetMs: ctx.client.ui.counterBumpMs,
      },
      ctx.reducedMotion,
    )
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

  private bet(sel: BetSelection | null, fromPad = false): void {
    if (!sel) return
    const state = this.ctx.state()
    const onIt = state.slip.bets.some(b => selectionKey(b.selection) === selectionKey(sel))
    const chip = this.chip()
    const ok = this.ctx.send({ type: 'bet.place', selection: sel, amount: chip })
    this.ctx.sfx.play(ok ? 'chip' : 'error')
    // ✕ otra vez sobre las mismas fichas suele ser buscar "girar": se explica cómo se gira.
    if (ok && fromPad && spinHelpOnRepeat(onIt, state.phase)) {
      const key = !this.ctx.demo
        ? 'toast.howToSpin'
        : this.ctx.demoAuto() === false
          ? 'toast.howToSpinDemoPaused'
          : 'toast.howToSpinDemo'
      this.ctx.toast(this.ctx.tr.t(key, { ...this.ctx.buttons() }))
    }
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
        this.bet(this.hover(), true)
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
      case 'spin':
        // GIRAR: con pendientes, gasta una; sin ellas, explica de dónde salen (en la demo, que no
        // las acumula, lanza una tirada ya, como si se mandara un prompt).
        if (pendingSpins(this.ctx.state()) > 0) this.ctx.spinPending()
        else if (this.ctx.demo) this.ctx.demoSpin()
        else this.ctx.showPending()
        return
      case 'mute':
      case 'auto':
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

  update(_dt: number, t: number): void {
    this.pendingCounter.see(pendingSpins(this.ctx.state()), t * 1000)
  }

  /**
   * Fila "PENDIENTES n" del panel derecho (docs/DISENO-V2.md, HUD): el panel crece de 29 a 40 px
   * cuando hay alguna. El número bota al sumar o gastar; en el tope, en rojo que respira.
   * Clic: la pantalla de tiradas pendientes.
   */
  private drawPendingRow(g: CanvasRenderingContext2D, t: number, count: number): void {
    const { tr } = this.ctx
    const look = this.pendingCounter.look(t * 1000)
    const full = count >= this.ctx.web.game.pendingSpins.max
    // Destello crema del 15 % en el panel durante un fotograma al cambiar.
    if (look.flash) {
      g.fillStyle = 'rgba(243,234,214,0.15)'
      g.fillRect(222, 4, 94, 40)
    }
    drawText(g, tr.t('hud.pending'), 228, 32, { color: PALETTE.muted, shadow: PALETTE.ink })
    const breathe = Math.floor(t) % 2 === 0
    const color = full ? (breathe ? PALETTE.loss : PALETTE.cream) : PALETTE.gold
    // En el tope solo el número (en rojo que respira): "100 MÁX" no cabe junto a "PENDIENTES".
    // Odómetro: el número viejo sale y el nuevo entra, recortados a la fila (24×10 en (288, 31)).
    const style = { color, align: 'right' as const, shadow: PALETTE.ink }
    if (look.from === null) {
      drawText(g, tr.n(look.to), 310, 32, style)
    } else {
      const off = Math.round(10 * look.k) * look.dir
      g.save()
      g.beginPath()
      g.rect(286, 31, 26, 10)
      g.clip()
      drawText(g, tr.n(look.from), 310, 32 - off, style)
      drawText(g, tr.n(look.to), 310, 32 - off + 10 * look.dir, style)
      g.restore()
    }
    if (look.float) {
      g.save()
      g.globalAlpha = look.float.alpha
      drawText(g, look.float.text, 310, 58 - look.float.rise, {
        color: look.float.text.startsWith('+') ? PALETTE.gold : PALETTE.loss,
        align: 'right',
        shadow: PALETTE.ink,
      })
      g.restore()
    }
    this.ctx.hits.add({
      x: 222,
      y: 29,
      w: 94,
      h: 15,
      id: 'hud:pending',
      onClick: () => {
        this.ctx.sfx.play('accept')
        this.ctx.showPending()
      },
    })
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

    // Racha, tiradas y (si hay) tiradas pendientes: arriba a la derecha.
    const pending = pendingSpins(state)
    drawWindow(g, 222, 4, 94, pending > 0 ? 40 : 29)
    // ON FIRE: llamitas detrás de la racha mientras dure (render/fx).
    this.ctx.hudFlames?.(g)
    if (w) {
      const streak = w.currentStreak
      // Con el Casco de Racha, la racha salvada lleva asterisco ("▲7*").
      const streakLabel = streakText(streak, w.streakAsterisk)
      const streakColor = streak > 0 ? PALETTE.win : streak < 0 ? PALETTE.loss : PALETTE.cream
      drawText(g, tr.t('hud.streak'), 228, 10, { color: muted, shadow: PALETTE.ink })
      drawText(g, streakLabel, 310, 10, { color: streakColor, align: 'right', shadow: PALETTE.ink })
      drawText(g, tr.t('hud.spins'), 228, 21, { color: muted, shadow: PALETTE.ink })
      drawText(g, tr.n(w.spins), 310, 21, {
        color: PALETTE.cream,
        align: 'right',
        shadow: PALETTE.ink,
      })
    }

    if (w && pending > 0) this.drawPendingRow(g, t, pending)

    // Demo: AUTO/PAUSA y GIRAR, bajo el panel de la racha.
    const demoAuto = this.ctx.demoAuto()
    let panelY = 4 + (pending > 0 ? 40 : 29) + 3
    if (demoAuto !== null) {
      drawDemoPanel(g, this.ctx, panelY, demoAuto)
      panelY += DEMO_PANEL.h + 3
    }
    // BOLSILLO: lo armado para la próxima ronda, en la misma columna.
    drawPocketPanel(g, this.ctx, panelY, t)

    // Estado: centrado bajo la ruleta.
    const status = this.statusText()
    if (status) {
      const look = STATUS_LOOKS[status.kind]
      const sw = measure(status.text) + 16
      const box = STATUS_BOX
      drawWindow(g, 160 - sw / 2, STATUS_Y, sw, box.height, {
        shadow: true,
        top: look.top,
        bottom: look.bottom,
      })
      // El parpadeo alterna dos colores legibles (nunca deja el letrero tenue ni vacío).
      drawText(g, status.text, 160, STATUS_Y + box.textTop, {
        color: statusColor(look, t),
        align: 'center',
        shadow: PALETTE.ink,
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
    const skin = chipSkin(state.user?.chipSkin)
    let x = 12
    chips.forEach((chip, i) => {
      const selected = i === this.chipIndex
      const label = chip === 'all-in' ? tr.t('hud.allIn') : chipLabel(chip)
      const color = chip === 'all-in' ? PALETTE.gold : chipColor(skin, i)
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
    // La ayuda alterna los controles con cómo se gira (no hay botón de girar).
    const helpKey = tableHelpKey(
      t * 1000,
      this.ctx.client.ui.helpCycleMs,
      this.ctx.demo,
      this.ctx.demoAuto(),
    )
    drawText(g, tr.t(helpKey, { ...this.ctx.buttons() }), 6, 231, {
      color: helpKey === 'help.table' ? muted : PALETTE.gold,
    })
  }

  private statusText(): { text: string; kind: StatusKind } | null {
    const { tr } = this.ctx
    const conn = this.ctx.connection()
    if (conn === 'connecting') return { text: tr.t('status.connecting'), kind: 'connecting' }
    if (conn === 'reconnecting') return { text: tr.t('status.offline'), kind: 'offline' }
    const state = this.ctx.state()
    const loop = this.ctx.spinAll()
    if (loop.running) {
      const n = tr.n(pendingSpins(state))
      return { text: tr.t('status.spinAll', { n, ...this.ctx.buttons() }), kind: 'pending' }
    }
    switch (state.phase) {
      case 'spinning':
        return { text: tr.t('status.thinking'), kind: 'thinking' }
      case 'landing':
        return { text: tr.t('status.landing'), kind: 'landing' }
      case 'idle': {
        const pending = pendingSpins(state)
        if (pending > 0 && !this.ctx.demo) {
          return {
            text: tr.t('status.pending', { n: tr.n(pending), ...this.ctx.buttons() }),
            kind: 'pending',
          }
        }
        // Sin ronda abierta: el giro lo lanza un prompt en Claude Code, no la ventana.
        const key = idleStatusKey(this.ctx.demo, state.slip.total, this.ctx.demoAuto())
        // En PAUSA, en oro: la ruleta espera a que gires tú.
        const ready = key !== 'status.idle' && key !== 'status.demo'
        return { text: tr.t(key, { ...this.ctx.buttons() }), kind: ready ? 'ready' : 'idle' }
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
