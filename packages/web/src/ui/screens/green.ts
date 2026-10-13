// SPDX-License-Identifier: AGPL-3.0-or-later
// Sale el verde (docs/DISENO-V2.md, "Sale el verde", sb-green.png): la escena parpadea en verde 3
// veces en 960 ms (nunca más de 3 destellos por segundo), "¡VERDE!" en degradado verde y la banda
// "todas las sencillas pierden". Si se había apostado al 0 y gana, banda oro y se encadena con el
// premio gordo (el paso siguiente de la secuencia).
import { drawText } from '../../font/bitmap.ts'
import type { Cue } from '../../render/fx/clock.ts'
import { stepScale } from '../../render/fx/easing.ts'
import { FxScreen } from '../../render/fx/fxScreen.ts'
import type { FxKit } from '../../render/fx/kit.ts'
import { fillScreen } from '../../render/fx/rays.ts'
import { GRADIENTS, drawFancyText } from '../../render/fx/text.ts'
import { drawWindow } from '../draw.ts'
import { PALETTE } from '../palette.ts'

/** Instantes clave (ms): fin de los parpadeos, aparición de la banda y estado final. */
export function greenTimes(kit: Pick<FxKit, 'cfg' | 'reduced'>, chain: boolean) {
  const g = kit.cfg.green
  if (kit.reduced) {
    const final = Math.min(kit.cfg.reducedMaxMs, kit.cfg.reduced.greenTintMs)
    return { band: 0, final, hold: chain ? g.chainMs : g.holdMs }
  }
  const final = 2 * g.blinks * g.blinkMs
  return { band: 2 * g.blinkMs, final, hold: chain ? g.chainMs : g.holdMs }
}

/** ¿Está el tinte verde encendido en el instante `ms`? (parpadeos de `blinkMs`). */
export function greenTintOn(ms: number, blinkMs: number, blinks: number): boolean {
  if (ms < 0) return false
  const phase = Math.floor(ms / blinkMs)
  return phase < blinks * 2 && phase % 2 === 0
}

export class GreenScreen extends FxScreen {
  readonly id = 'fx:green'
  private readonly chain: boolean
  private readonly times: ReturnType<typeof greenTimes>

  constructor(kit: FxKit, chain: boolean, onDone: () => void) {
    super(kit, onDone)
    this.chain = chain
    this.times = greenTimes(kit, chain)
    const sfx = kit.ctx.sfx
    const g = kit.cfg.green
    const cues: Cue[] = [{ at: 0, run: () => sfx.playFx('greenHi') }]
    if (!kit.reduced) {
      cues.push({ at: g.blinkMs, run: () => sfx.playFx('greenLo') })
      for (let i = 1; i < g.blinks; i++) {
        cues.push({ at: 2 * i * g.blinkMs, run: () => sfx.playFx('dingDong') })
      }
      cues.push({ at: this.times.band, run: () => sfx.playFx('boing') })
    }
    this.timeline(this.times.final, this.times.hold, cues)
    const tr = kit.ctx.tr
    kit.announce(
      // El número va dicho (el verde es el 0): el resultado de siempre llega después.
      [`${tr.t('fx.green.title')} 0`, tr.t('fx.green.band'), chain ? tr.t('fx.green.chain') : '']
        .filter(Boolean)
        .join(' '),
    )
  }

  drawFx(fx: CanvasRenderingContext2D): boolean {
    const { tr } = this.kit.ctx
    const ms = this.ms
    const g = this.kit.cfg.green
    if (this.kit.reduced) {
      // Un tinte fijo, sin parpadeo.
      if (!this.clock.finished) fillScreen(fx, PALETTE.green, 0.45)
    } else if (!this.clock.finished && greenTintOn(ms, g.blinkMs, g.blinks)) {
      fillScreen(fx, PALETTE.green, 0.45)
    }
    const scale = this.kit.reduced ? 6 : stepScale(ms, 7, 6, g.blinkMs)
    drawFancyText(fx, tr.t('fx.green.title'), 160, Math.round(58 - (7 * scale) / 2), {
      scale,
      bands: GRADIENTS.green,
      shadow: PALETTE.ink,
      align: 'center',
    })
    if (ms >= this.times.band || this.clock.finished) {
      drawWindow(fx, 40, 124, 240, 17, { top: PALETTE.moneyTop, bottom: PALETTE.menuBottom })
      drawText(fx, tr.t('fx.green.band'), 160, 129, {
        color: PALETTE.cream,
        align: 'center',
        shadow: PALETTE.ink,
      })
    }
    if (this.chain && this.clock.finished) {
      drawWindow(fx, 40, 147, 240, 17, { top: PALETTE.goldDark, bottom: PALETTE.carpet })
      drawText(fx, tr.t('fx.green.chain'), 160, 152, {
        color: PALETTE.goldHi,
        align: 'center',
        shadow: PALETTE.ink,
      })
    }
    return true
  }
}
