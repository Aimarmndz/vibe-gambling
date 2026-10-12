// SPDX-License-Identifier: AGPL-3.0-or-later
// Gestor de MEMORY CARD: 15 bloques. El 1 es la partida de la temporada; el resto lo ocupa
// node_modules, claro.
import { seasonBounds } from '@vibe-gambling/shared'

import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, wrap } from '../../font/bitmap.ts'
import type { Translator } from '../../i18n/index.ts'
import { dim, drawHelpBar, drawGemIcon, drawWindow } from '../draw.ts'
import { PALETTE } from '../palette.ts'

const COLS = 5
const ROWS = 3
const BLOCKS = COLS * ROWS

/** "12 d" o "5 h": lo que le queda a la temporada. */
export function timeLeft(ms: number, tr: Translator): string {
  const hours = Math.max(0, Math.floor(ms / 3_600_000))
  if (hours >= 48) return tr.t('mc.days', { n: Math.floor(hours / 24) })
  return tr.t('mc.hours', { n: hours })
}

export class MemoryCardScreen implements Screen {
  readonly id = 'memoryCard'
  readonly opaque = true
  private readonly ctx: AppContext
  private index = 0

  constructor(ctx: AppContext) {
    this.ctx = ctx
  }

  action(e: ActionEvent): void {
    const col = this.index % COLS
    const row = Math.floor(this.index / COLS)
    switch (e.action) {
      case 'left':
        this.index = row * COLS + ((col + COLS - 1) % COLS)
        break
      case 'right':
        this.index = row * COLS + ((col + 1) % COLS)
        break
      case 'up':
        this.index = ((row + ROWS - 1) % ROWS) * COLS + col
        break
      case 'down':
        this.index = ((row + 1) % ROWS) * COLS + col
        break
      case 'back':
      case 'start':
        this.ctx.sfx.play('back')
        this.ctx.pop(this)
        return
      default:
        return
    }
    this.ctx.sfx.play('move')
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    dim(g, 0.85)
    drawWindow(g, 6, 6, 308, 228, { top: PALETTE.deepTop, bottom: PALETTE.ink })
    drawText(g, tr.t('mc.title'), 16, 14, { color: PALETTE.cream })

    // Rejilla de bloques.
    for (let i = 0; i < BLOCKS; i++) {
      const x = 16 + (i % COLS) * 58
      const y = 28 + Math.floor(i / COLS) * 34
      const selected = i === this.index
      g.fillStyle = selected ? PALETTE.gold : PALETTE.line
      g.fillRect(x - 1, y - 1, 54, 32)
      g.fillStyle = i === 0 ? '#2b1d10' : '#101326'
      g.fillRect(x, y, 52, 30)
      if (i === 0) {
        drawGemIcon(g, x + 26, y + 15, 10, t * 2)
      } else {
        // Carpeta gris de node_modules.
        g.fillStyle = '#6b6f86'
        g.fillRect(x + 18, y + 9, 16, 12)
        g.fillRect(x + 18, y + 7, 7, 2)
        drawText(g, 'nm', x + 26, y + 12, { color: PALETTE.ink, align: 'center' })
      }
      this.ctx.hits.add({
        x,
        y,
        w: 52,
        h: 30,
        id: `mc:${i}`,
        onClick: () => {
          this.index = i
          this.ctx.sfx.play('move')
        },
      })
    }

    // Detalle del bloque elegido.
    drawWindow(g, 14, 134, 292, 82, { shadow: false })
    const w = this.ctx.state().shown
    if (this.index !== 0) {
      drawText(g, tr.t('mc.nodeModules'), 22, 142, { color: PALETTE.cream })
      drawText(g, tr.t('mc.blocks', { n: 14 }), 298, 142, { color: PALETTE.muted, align: 'right' })
      let y = 156
      for (const line of wrap(tr.t('mc.nodeModulesInfo'), 276)) {
        drawText(g, line, 22, y, { color: PALETTE.muted })
        y += 11
      }
    } else if (!w) {
      drawText(g, tr.t('mc.noData'), 22, 142, { color: PALETTE.muted })
    } else {
      drawText(g, tr.t('mc.saveName'), 22, 142, { color: PALETTE.gold })
      drawText(g, tr.t('mc.season', { season: w.seasonId }), 298, 142, {
        color: PALETTE.cream,
        align: 'right',
      })
      const stats: [string, string, string][] = [
        [tr.t('mc.balance'), tr.n(w.balance), PALETTE.cream],
        [tr.t('mc.debt'), tr.n(w.debt), w.debt > 0 ? PALETTE.loss : PALETTE.cream],
        [tr.t('mc.net'), tr.n(w.netWorth), w.netWorth < 0 ? PALETTE.loss : PALETTE.win],
        [tr.t('mc.spins'), tr.n(w.spins), PALETTE.cream],
        [tr.t('mc.loans'), tr.n(w.loans), PALETTE.cream],
        [tr.t('mc.bestStreak'), tr.n(w.bestStreak), PALETTE.cream],
      ]
      stats.forEach(([label, value, color], i) => {
        const x = i < 3 ? 22 : 170
        const y = 156 + (i % 3) * 11
        drawText(g, label, x, y, { color: PALETTE.muted })
        drawText(g, value, i < 3 ? x + 122 : 298, y, { color, align: 'right' })
      })
      const game = this.ctx.web.game
      const ends = seasonBounds(w.seasonId, game.seasonTimeZone, game.seasonStartDay).endsAt
      drawText(
        g,
        tr.t('mc.timeLeft', { time: timeLeft(ends.getTime() - Date.now(), tr) }),
        22,
        194,
        {
          color: PALETTE.muted,
        },
      )
    }
    drawHelpBar(g, tr.t('help.menu', { ...this.ctx.buttons() }), PALETTE.muted)
  }
}
