// SPDX-License-Identifier: AGPL-3.0-or-later
// Premio gordo por niveles (docs/DISENO-V2.md, "Premio gordo por niveles", sb-bigwin*.png): BIG WIN,
// MEGA WIN o ¡PLENO!. Flash único, rayos, rótulo que entra a escalones (×7 → ×6 → ×5), sacudida,
// contador que rueda, lluvia de fichas 3D y fanfarria. Empieza cuando la bola ya se ha asentado
// (después de `revealAt`) y la cantidad es la que manda el servidor en la ronda.
import { colorOf } from '@vibe-gambling/shared'

import { drawText } from '../../font/bitmap.ts'
import type { PrizeTier } from '../../render/fx/plan.ts'
import { FxScreen } from '../../render/fx/fxScreen.ts'
import type { FxKit } from '../../render/fx/kit.ts'
import { shakeAt } from '../../render/fx/kit.ts'
import { progress, rollValue, stepScale } from '../../render/fx/easing.ts'
import { fillScreen } from '../../render/fx/rays.ts'
import { GRADIENTS, drawFancyText } from '../../render/fx/text.ts'
import type { Bands } from '../../render/fx/text.ts'
import { drawHelpBar, drawWindow, fillCircle } from '../draw.ts'
import { PALETTE, pocketHex } from '../palette.ts'
import type { Cue } from '../../render/fx/clock.ts'

export interface PrizeView {
  tier: PrizeTier
  /** Ganancia neta de la ronda (la del servidor). */
  net: number
  /** El "×15" (neto / apostado, entero). */
  netMultiple: number
  /** Número ganador (para ¡PLENO!). */
  number: number
}

/** Centro de los rayos (docs/DISENO-V2.md). */
export const RAYS_CENTER = { x: 160, y: 96 } as const

interface TierLook {
  labelKey: 'fx.prize.big' | 'fx.prize.mega' | 'fx.prize.straight'
  bands: Bands
  outline: number
  rays: { count: number; colors: [string, string]; alpha: number }
}

const LOOKS: Readonly<Record<PrizeTier, TierLook>> = {
  big: {
    labelKey: 'fx.prize.big',
    bands: GRADIENTS.gold,
    outline: 1,
    rays: { count: 12, colors: [PALETTE.deepTop, PALETTE.carpet], alpha: 0.5 },
  },
  mega: {
    labelKey: 'fx.prize.mega',
    bands: GRADIENTS.fire,
    outline: 2,
    rays: { count: 20, colors: [PALETTE.jackpotBottom, PALETTE.carpet], alpha: 0.7 },
  },
  straight: {
    labelKey: 'fx.prize.straight',
    bands: GRADIENTS.gold,
    outline: 1,
    rays: { count: 20, colors: [PALETTE.jackpotBottom, PALETTE.goldDark], alpha: 0.7 },
  },
}

/** Instantes clave de la secuencia (ms). Exportado para las pruebas. */
export function prizeTimes(kit: Pick<FxKit, 'cfg' | 'reduced'>, tier: PrizeTier) {
  const c = kit.cfg.bigWin
  if (kit.reduced) {
    const final = Math.min(kit.cfg.reducedMaxMs, 3 * c.reducedStepMs)
    return { impact: 0, settle: 0, final, count: final, hold: c.holdMs }
  }
  const impact = c.flashMs
  const settle = impact + 3 * c.impactStepMs
  const count = tier === 'big' ? c.countMs.big : tier === 'mega' ? c.countMs.mega : c.countMs.pleno
  return { impact, settle, final: settle + count, count, hold: c.holdMs }
}

export class PrizeScreen extends FxScreen {
  readonly id = 'fx:prize'
  private readonly view: PrizeView
  private readonly look: TierLook
  private readonly times: ReturnType<typeof prizeTimes>
  /** Fichas que faltan por soltar en la lluvia. */
  private toSpawn: number
  private spawnClock = 0

  constructor(kit: FxKit, view: PrizeView, onDone: () => void) {
    super(kit, onDone)
    this.view = view
    this.look = LOOKS[view.tier]
    this.times = prizeTimes(kit, view.tier)
    const c = kit.cfg.bigWin
    const coins =
      view.tier === 'big' ? c.coins.big : view.tier === 'mega' ? c.coins.mega : c.coins.pleno
    this.toSpawn = kit.reduced ? 0 : Math.min(coins, kit.cfg.maxCoins)
    const sfx = kit.ctx.sfx
    const cues: Cue[] = []
    const { settle, final } = this.times
    if (kit.reduced) {
      cues.push({ at: 0, run: () => sfx.play(view.tier === 'big' ? 'bigWin' : 'jackpot') })
    } else {
      cues.push({ at: 0, run: () => sfx.playFx('impact') })
      cues.push({
        at: this.times.impact,
        run: () =>
          view.tier === 'big'
            ? sfx.play('bigWin')
            : sfx.playFx(view.tier === 'mega' ? 'fanfareMega' : 'fanfare'),
      })
      for (let at = settle; at < final; at += c.tickMs) {
        const k = (at - settle) / Math.max(1, final - settle)
        cues.push({ at, run: () => sfx.playFx('countTick', k) })
      }
      cues.push({ at: final, run: () => sfx.playFx('winChord') })
      if (view.tier === 'straight') cues.push({ at: final + 120, run: () => sfx.playFx('bell') })
    }
    this.timeline(final, this.times.hold, cues)
    const label = kit.ctx.tr.t(this.look.labelKey)
    kit.announce(kit.ctx.tr.t('a11y.fx.prize', { label, net: kit.ctx.tr.signed(view.net) }))
  }

  protected override onSkip(): void {
    // Al saltar, la lluvia sale toda de golpe (si hay presupuesto).
    while (this.toSpawn > 0 && this.kit.coins.fountain(true)) this.toSpawn--
    this.toSpawn = 0
  }

  protected override step(dt: number): void {
    const ms = this.ms
    const { settle, final, hold } = this.times
    if (!this.kit.reduced) {
      const s = shakeAt(ms, this.times.impact, this.kit.cfg.shake)
      this.kit.shake(s.x, s.y)
      // La lluvia: las fichas salen repartidas en los primeros 600 ms tras asentarse el rótulo.
      if (ms >= settle && this.toSpawn > 0) {
        this.spawnClock -= dt
        while (this.spawnClock <= 0 && this.toSpawn > 0) {
          if (!this.kit.coins.fountain(true)) {
            this.toSpawn = 0
            break
          }
          this.toSpawn--
          this.spawnClock += 0.6 / Math.max(1, this.toSpawn + 1)
        }
      }
      // A mitad del hold dejan de reciclarse para que se vayan antes de cerrar.
      if (ms >= final + hold * 0.55) this.kit.coins.stopLoop()
    }
  }

  override close(): void {
    this.kit.coins.stopLoop()
    super.close()
  }

  override dispose(): void {
    this.kit.coins.clear()
    super.dispose()
  }

  /** ✕ CONTINUAR en la capa FX (encima de los rayos; la sacudida ya ha terminado). */
  private drawHelp(fx: CanvasRenderingContext2D): void {
    if (!this.clock.finished) return
    const { tr } = this.kit.ctx
    drawHelpBar(fx, tr.t('result.continue', { ...this.kit.ctx.buttons() }), PALETTE.muted)
  }

  /** Valor del contador en este instante (nunca más de lo que dice el servidor). */
  counterValue(): number {
    const { settle, count } = this.times
    const net = this.view.net
    if (this.kit.reduced) {
      // Tres saltos de `reducedStepMs`.
      const steps = Math.min(3, Math.floor(this.ms / this.kit.cfg.bigWin.reducedStepMs) + 1)
      return this.clock.finished ? net : Math.round((net * steps) / 3)
    }
    if (this.clock.finished) return net
    return rollValue(0, net, progress(this.ms, settle, count))
  }

  drawFx(fx: CanvasRenderingContext2D): boolean {
    const { tr } = this.kit.ctx
    const ms = this.ms
    const v = this.view
    const look = this.look
    const label = tr.t(look.labelKey)
    const counter = `+${tr.n(this.counterValue())}`
    if (this.kit.reduced) {
      // Ventana fija, rótulo ×4 y el contador en tres saltos.
      drawWindow(fx, 40, 50, 240, 120, { top: PALETTE.goldDark, bottom: PALETTE.carpet })
      drawFancyText(fx, label, 160, 64, { scale: 4, bands: look.bands, align: 'center' })
      if (v.tier === 'mega') {
        drawText(fx, `×${v.netMultiple}`, 160, 100, {
          color: PALETTE.cream,
          scale: 2,
          align: 'center',
          shadow: PALETTE.ink,
        })
      }
      drawFancyText(fx, counter, 160, 124, { scale: 3, bands: GRADIENTS.green, align: 'center' })
      this.drawHelp(fx)
      return true
    }
    const { impact, settle, final } = this.times
    // Flash crema, uno solo.
    if (ms < impact && !this.clock.wasSkipped) {
      fillScreen(fx, PALETTE.cream, 0.85)
      return true
    }
    const turn = ms > final ? (this.kit.cfg.bigWin.raysDegPerS * (ms - final)) / 1000 : 0
    this.kit.rays.draw(fx, look.rays, turn)
    const every = this.kit.cfg.bigWin.sheenEveryMs
    const sheenK = ms > final ? ((ms - final) % every) / (every / 2) : 2
    const sheen = sheenK < 1 ? sheenK : null
    const stepMs = this.kit.cfg.bigWin.impactStepMs
    if (v.tier === 'straight') {
      // El número en su color dentro de un aro oro, ×6 en el impacto y ×5 asentado.
      const scale = stepScale(ms - impact, 6, 5, stepMs)
      const cy = 72
      fillCircle(fx, 161, cy + 2, 35, PALETTE.ink)
      fillCircle(fx, 160, cy, 34, PALETTE.gold)
      fillCircle(fx, 160, cy, 31, pocketHex(colorOf(v.number)))
      drawText(fx, String(v.number), 160, cy - Math.floor((7 * scale) / 2), {
        color: PALETTE.cream,
        scale,
        align: 'center',
        shadow: PALETTE.ink,
      })
      drawFancyText(fx, label, 160, 118, { scale: 5, bands: look.bands, align: 'center', sheen })
    } else {
      const scale = stepScale(ms - impact, 7, 5, stepMs)
      // El rótulo crece desde su centro (y = 75), a escalones.
      const top = Math.round(75.5 - (7 * scale) / 2)
      drawFancyText(fx, label, 160, top, {
        scale,
        bands: look.bands,
        outline: look.outline,
        align: 'center',
        sheen,
      })
      if (v.tier === 'mega' && ms >= settle) {
        drawText(fx, `×${v.netMultiple}`, 160, 104, {
          color: PALETTE.cream,
          scale: 2,
          align: 'center',
          shadow: PALETTE.ink,
        })
      }
    }
    if (ms >= settle) {
      const y = v.tier === 'straight' ? 162 : 150
      drawFancyText(fx, counter, 160, y, { scale: 3, bands: GRADIENTS.green, align: 'center' })
    }
    this.drawHelp(fx)
    return true
  }
}
