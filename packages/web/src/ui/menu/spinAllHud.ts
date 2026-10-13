// SPDX-License-Identifier: AGPL-3.0-or-later
// GIRAR TODAS (`menu-pending-all.png`): mientras la ruleta gira a pantalla completa, una ventana de
// progreso arriba (k / n ×2 y barra), la lista ÚLTIMAS con las 7 últimas y su neto (la nueva arriba
// con marco oro) y la ayuda "○ PARAR". Solo pinta lo que ya se ha enseñado (nunca adelanta nada).
import type { ResolvedRound } from '@vibe-gambling/shared'

import type { ButtonLabels } from '../../app/context.ts'
import { drawText } from '../../font/bitmap.ts'
import type { SpinAllStatus } from '../../game/spinAll.ts'
import { pendingSpins } from '../../game/state.ts'
import type { GameState } from '../../game/state.ts'
import type { Translator } from '../../i18n/index.ts'
import { drawWindow } from '../draw.ts'
import { PALETTE, pocketHex } from '../palette.ts'
import { drawBar, drawHelp, pocketText } from './kit.ts'

const RECENT = 7

export interface SpinAllView {
  /** Tiradas ya enseñadas en esta pasada. */
  done: number
  /** Total de la pasada (las enseñadas más las que quedan). */
  total: number
  recent: readonly ResolvedRound[]
}

export class SpinAllHud {
  private recent: ResolvedRound[] = []
  private lastSeen: string | null = null
  private running = false
  private done = 0

  /**
   * Mira el estado en cada fotograma: al empezar una pasada se vacía la lista y cada resultado
   * enseñado (`lastRound` nuevo) entra arriba. Devuelve el texto para `aria-live` si hay uno nuevo.
   */
  see(state: GameState, status: SpinAllStatus, tr: Translator): string | null {
    if (status.running && !this.running) {
      this.recent = []
      this.done = 0
      this.lastSeen = state.lastRound?.roundId ?? null
    }
    this.running = status.running
    const last = state.lastRound
    if (!status.running || !last || last.roundId === this.lastSeen) return null
    this.lastSeen = last.roundId
    this.done += 1
    this.recent = [last, ...this.recent].slice(0, RECENT)
    const view = this.view(state)
    return tr.t('spinAll.a11y', {
      k: view.done,
      n: view.total,
      number: last.result,
      color: tr.t(`color.${last.color}.one`),
      net: tr.signed(last.net),
    })
  }

  view(state: GameState): SpinAllView {
    // Lo que queda incluye la que está cayendo (ya descontada del contador del servidor).
    const inFlight = state.phase === 'landing' || state.phase === 'spinning' ? 1 : 0
    return {
      done: this.done,
      total: this.done + pendingSpins(state) + inFlight,
      recent: this.recent,
    }
  }

  draw(g: CanvasRenderingContext2D, state: GameState, tr: Translator, buttons: ButtonLabels): void {
    const view = this.view(state)
    drawWindow(g, 8, 8, 304, 34)
    drawText(g, tr.t('pending.spinAll'), 16, 15, { color: PALETTE.gold, shadow: PALETTE.ink })
    drawText(g, `${tr.n(view.done)} / ${tr.n(view.total)}`, 304, 12, {
      color: PALETTE.cream,
      scale: 2,
      align: 'right',
      shadow: PALETTE.ink,
    })
    drawBar(g, 16, 30, 288, 5, view.total > 0 ? view.done / view.total : 0)

    if (view.recent.length > 0) {
      drawWindow(g, 240, 50, 72, 132, { top: PALETTE.deepTop })
      drawText(g, tr.t('spinAll.recent'), 248, 58, { color: PALETTE.cream, shadow: PALETTE.ink })
      view.recent.forEach((round, i) => {
        const y = 70 + i * 16
        g.fillStyle = i === 0 ? PALETTE.gold : PALETTE.cream
        g.fillRect(248, y, 15, 13)
        g.fillStyle = pocketHex(round.color)
        g.fillRect(249, y + 1, 13, 11)
        drawText(g, String(round.result), 256, y + 3, {
          color: pocketText(round.color),
          align: 'center',
        })
        drawText(g, round.net === 0 ? '0' : tr.signed(round.net), 306, y + 3, {
          color: round.net > 0 ? PALETTE.win : round.net < 0 ? PALETTE.loss : PALETTE.cream,
          align: 'right',
          shadow: PALETTE.ink,
        })
      })
    }
    drawHelp(g, [
      { key: buttons.o, label: tr.t('spinAll.stop') },
      { key: '', label: tr.t('spinAll.autoStop') },
    ])
  }
}
