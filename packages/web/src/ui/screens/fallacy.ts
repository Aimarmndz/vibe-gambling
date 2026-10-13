// SPDX-License-Identifier: AGPL-3.0-or-later
// Aviso de la falacia del jugador (docs/DISENO-V2.md, sb-fallacy.png): con `streak.colorWarningAt`
// colores iguales seguidos, el historial, "7 ROJOS SEGUIDOS", la frase del ludópata y SIEMPRE la
// aclaración honesta (cada tirada es independiente). Es una parodia: no puede reforzar la falacia.
import type { PocketColor } from '@vibe-gambling/shared'
import { colorOf } from '@vibe-gambling/shared'

import { drawText, measure, wrap } from '../../font/bitmap.ts'
import type { Cue } from '../../render/fx/clock.ts'
import { outBack, progress } from '../../render/fx/easing.ts'
import { FxScreen } from '../../render/fx/fxScreen.ts'
import type { FxKit } from '../../render/fx/kit.ts'
import { GRADIENTS, drawFancyText, drawRotated } from '../../render/fx/text.ts'
import { dim, drawWindow } from '../draw.ts'
import { PALETTE, pocketHex } from '../palette.ts'

/** Casillas que caben en la ventana del historial. */
const MAX_BOXES = 14

export interface FallacyView {
  color: PocketColor
  count: number
  /** Últimos números vistos en esta sesión (el más reciente al final). */
  recent: readonly number[]
}

/**
 * Casillas del historial: las `count` últimas (hasta las que caben), con su número si se vio en
 * esta sesión o null si la racha viene de antes de abrir la ventana.
 */
export function streakBoxes(view: FallacyView): (number | null)[] {
  const shown = Math.min(view.count, MAX_BOXES)
  // Los números vistos que forman la racha: desde el final, mientras sean de su color.
  const known: number[] = []
  for (let i = view.recent.length - 1; i >= 0 && known.length < shown; i--) {
    const n = view.recent[i]!
    if (colorOf(n) !== view.color) break
    known.unshift(n)
  }
  return [...Array.from({ length: shown - known.length }, () => null), ...known]
}

export class FallacyScreen extends FxScreen {
  readonly id = 'fx:fallacy'
  private readonly view: FallacyView
  private readonly boxes: (number | null)[]

  constructor(kit: FxKit, view: FallacyView, onDone: () => void) {
    super(kit, onDone)
    this.view = view
    this.boxes = streakBoxes(view)
    const sfx = kit.ctx.sfx
    const cues: Cue[] = [{ at: 200, run: () => sfx.playFx('dunDun') }]
    this.timeline(600, kit.cfg.fallacy.holdMs, cues)
    const tr = kit.ctx.tr
    kit.announce(
      [
        tr.t(`fx.fallacy.title.${view.color}`, { n: view.count }),
        tr.t(`fx.fallacy.quote.${view.color}`),
        tr.t(`fx.fallacy.truth.${view.color}`),
      ].join(' '),
    )
  }

  protected override drawUi(g: CanvasRenderingContext2D): void {
    const { tr } = this.kit.ctx
    const ms = this.ms
    const v = this.view
    if (ms >= 200) dim(g, 0.6)
    drawWindow(g, 20, 56, 280, 40)
    drawText(g, tr.t('fx.fallacy.recent'), 28, 62, { color: PALETTE.cream, shadow: PALETTE.ink })
    const last = this.boxes.length - 1
    this.boxes.forEach((n, i) => {
      const x = 28 + i * 18
      let y = 76
      if (i === last && !this.kit.reduced) {
        // La última cae 4 px y rebota (outBack, 200 ms).
        y = Math.round(72 + 4 * outBack(progress(ms, 0, 200)))
      }
      if (i === last) {
        g.fillStyle = PALETTE.gold
        g.fillRect(x - 1, y - 1, 17, 15)
      }
      g.fillStyle = pocketHex(v.color)
      g.fillRect(x, y, 15, 13)
      g.fillStyle = PALETTE.ink
      g.fillRect(x, y + 12, 15, 1)
      if (n !== null) {
        drawText(g, String(n), x + 8, y + 3, {
          color: i === last ? PALETTE.gold : PALETTE.cream,
          align: 'center',
          shadow: PALETTE.ink,
        })
      }
    })
    if (ms < 200) return
    drawFancyText(g, tr.t(`fx.fallacy.title.${v.color}`, { n: v.count }), 160, 110, {
      scale: 2,
      bands: GRADIENTS.red,
      shadow: PALETTE.ink,
      align: 'center',
    })
    if (ms < 600 && !this.clock.finished) return
    drawWindow(g, 30, 134, 260, 52)
    drawText(g, tr.t(`fx.fallacy.quote.${v.color}`), 160, 141, {
      color: PALETTE.cream,
      align: 'center',
      shadow: PALETTE.ink,
    })
    wrap(tr.t(`fx.fallacy.truth.${v.color}`), 244).forEach((line, i) => {
      drawText(g, line, 160, 158 + i * 11, {
        color: PALETTE.cream,
        align: 'center',
        shadow: PALETTE.ink,
      })
    })
    // Sello oro girado.
    const stamp = tr.t('fx.fallacy.stamp')
    drawRotated(g, 236, 186, -8, s => {
      const w = measure(stamp) + 10
      s.fillStyle = 'rgba(8,7,13,0.75)'
      s.fillRect(-w / 2, -7, w, 14)
      s.fillStyle = PALETTE.gold
      s.fillRect(-w / 2, -7, w, 1)
      s.fillRect(-w / 2, 6, w, 1)
      s.fillRect(-w / 2, -7, 1, 14)
      s.fillRect(w / 2 - 1, -7, 1, 14)
      drawText(s, stamp, 0, -3, { color: PALETTE.gold, align: 'center' })
    })
  }

  drawFx(): boolean {
    return false
  }
}
