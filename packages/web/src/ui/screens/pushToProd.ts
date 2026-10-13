// SPDX-License-Identifier: AGPL-3.0-or-later
// PUSH TO PROD (docs/DISENO-V2.md, sb-push.png): el jackpot dev del `git push`, entre la caída de la
// bola y el resultado. Terminal con texto fijo (el mod no manda rama, repo ni commit), barra de
// deploy, cohete pixel que despega y sello con el multiplicador ×N bien visible.
import { drawText } from '../../font/bitmap.ts'
import type { Cue } from '../../render/fx/clock.ts'
import { inQuad, outExpo, progress, stepScale } from '../../render/fx/easing.ts'
import { FxScreen } from '../../render/fx/fxScreen.ts'
import type { FxKit } from '../../render/fx/kit.ts'
import { fillScreen } from '../../render/fx/rays.ts'
import {
  FLAME_COLORS,
  ROCKET,
  ROCKET_COLORS,
  ROCKET_FLAME,
  drawSmoke,
  drawSprite,
} from '../../render/fx/sprites.ts'
import { GRADIENTS, drawFancyText, drawRotated } from '../../render/fx/text.ts'
import { drawWindow } from '../draw.ts'
import { PALETTE } from '../palette.ts'

/** Ventana de la terminal (docs/DISENO-V2.md). */
const TERM = { x: 30, y: 50, w: 260, h: 100 } as const

export function pushTimes(kit: Pick<FxKit, 'cfg' | 'reduced'>) {
  const p = kit.cfg.push
  if (kit.reduced) {
    const final = Math.min(kit.cfg.reducedMaxMs, kit.cfg.reduced.pushBandMs)
    return { deployed: 0, rocket: 0, stamp: 0, final, hold: p.stampMs }
  }
  const deployed = p.terminalMs / 2
  const rocket = p.terminalMs
  const stamp = rocket + p.rocketMs
  return { deployed, rocket, stamp, final: stamp + p.stampMs, hold: p.stampMs }
}

/** Porcentaje de la barra de deploy: a saltos de 10 % hasta el 40 %, luego 100 %. */
export function deployPercent(ms: number, deployedAt: number): number {
  if (ms >= deployedAt) return 100
  return Math.min(40, Math.floor((ms / deployedAt) * 5) * 10)
}

export class PushScreen extends FxScreen {
  readonly id = 'fx:push'
  private readonly multiplier: number
  private readonly times: ReturnType<typeof pushTimes>

  constructor(kit: FxKit, multiplier: number, onDone: () => void) {
    super(kit, onDone)
    this.multiplier = multiplier
    this.times = pushTimes(kit)
    const sfx = kit.ctx.sfx
    const cues: Cue[] = []
    if (kit.reduced) {
      cues.push({ at: 0, run: () => sfx.play('jackpot') })
    } else {
      // Tecleo de "git push": un clic cada 45 ms hasta el deploy.
      for (let at = 0; at < this.times.deployed; at += 45) {
        cues.push({ at, run: () => sfx.playFx('typeClick') })
      }
      cues.push({ at: this.times.deployed, run: () => sfx.playFx('deployed') })
      cues.push({ at: this.times.rocket, run: () => sfx.playFx('rocket') })
      cues.push({ at: this.times.stamp, run: () => sfx.playFx('stampHit') })
      cues.push({ at: this.times.stamp + 60, run: () => sfx.play('jackpot') })
    }
    this.timeline(this.times.final, this.times.hold, cues)
    kit.announce(kit.ctx.tr.t('a11y.fx.push', { multiplier }))
  }

  private drawTerminal(fx: CanvasRenderingContext2D, ms: number): void {
    const { tr } = this.kit.ctx
    // Sube desde abajo en 200 ms (outExpo).
    const k = outExpo(progress(ms, 0, 200))
    const y = Math.round(240 + (TERM.y - 240) * k)
    const x = TERM.x
    fx.fillStyle = 'rgba(0,0,0,0.6)'
    fx.fillRect(x + 3, y + 3, TERM.w, TERM.h)
    fx.fillStyle = PALETTE.ink
    fx.fillRect(x, y, TERM.w, TERM.h)
    fx.fillStyle = PALETTE.frame
    fx.fillRect(x, y, TERM.w, 1)
    fx.fillRect(x, y + TERM.h - 1, TERM.w, 1)
    fx.fillRect(x, y, 1, TERM.h)
    fx.fillRect(x + TERM.w - 1, y, 1, TERM.h)
    fx.fillStyle = PALETTE.frameInner
    fx.fillRect(x + 1, y + 1, TERM.w - 2, 10)
    drawText(fx, tr.t('fx.push.terminal'), x + 6, y + 3, { color: PALETTE.ink })
    const pct = deployPercent(ms, this.times.deployed)
    // "$ git push" se teclea letra a letra en los primeros 200 ms.
    const cmd = tr.t('fx.push.command')
    const typed = cmd.slice(0, Math.ceil(cmd.length * progress(ms, 0, 200)))
    drawText(fx, typed, x + 8, y + 18, { color: PALETTE.win })
    if (ms >= 200) {
      drawText(fx, tr.t('fx.push.enumerating'), x + 8, y + 30, { color: PALETTE.cream })
      drawText(fx, tr.t('fx.push.writing', { percent: pct }), x + 8, y + 42, {
        color: PALETTE.cream,
      })
      fx.fillStyle = PALETTE.frameInner
      fx.fillRect(x + 8, y + 54, TERM.w - 16, 6)
      fx.fillStyle = PALETTE.ink
      fx.fillRect(x + 9, y + 55, TERM.w - 18, 4)
      fx.fillStyle = PALETTE.win
      fx.fillRect(x + 9, y + 55, Math.round(((TERM.w - 18) * pct) / 100), 4)
    }
    if (pct === 100) {
      drawText(fx, tr.t('fx.push.deployed'), x + 8, y + 70, { color: PALETTE.gold })
    }
  }

  drawFx(fx: CanvasRenderingContext2D, t: number): boolean {
    const { tr } = this.kit.ctx
    const ms = this.ms
    const title = tr.t('fx.push.title')
    const stampText = `×${this.multiplier}`
    if (this.kit.reduced) {
      drawWindow(fx, 40, 100, 240, 24, { top: PALETTE.goldDark, bottom: PALETTE.carpet })
      drawText(fx, `${title} ${stampText}`, 160, 106, {
        color: PALETTE.goldHi,
        scale: 2,
        align: 'center',
        shadow: PALETTE.ink,
      })
      return true
    }
    // Mesa al 50 %.
    fillScreen(fx, PALETTE.ink, 0.5)
    const { rocket, stamp } = this.times
    if (ms < rocket) {
      this.drawTerminal(fx, ms)
      return true
    }
    // El cohete: despega (×4) con humo y llama y luego sale por arriba (inQuad, ×2).
    const flame = ROCKET_FLAME[Math.floor(t * 15) % 2]!
    if (ms < stamp) {
      const k = progress(ms, rocket, this.kit.cfg.push.rocketMs)
      const scale = 4
      const x = 160 - Math.floor((9 * scale) / 2)
      const y = Math.round(150 - 40 * k)
      drawSmoke(fx, 160, 205, k, 3)
      drawSprite(fx, flame, FLAME_COLORS, x, y + 13 * scale, scale)
      drawSprite(fx, ROCKET, ROCKET_COLORS, x, y, scale)
      drawText(fx, title, 160, 30, {
        color: PALETTE.cream,
        scale: 2,
        align: 'center',
        shadow: PALETTE.ink,
      })
      return true
    }
    const k = inQuad(progress(ms, stamp, this.kit.cfg.push.stampMs))
    if (k < 1) {
      const y = Math.round(110 - 140 * k)
      drawSprite(fx, flame, FLAME_COLORS, 151, y + 26, 2)
      drawSprite(fx, ROCKET, ROCKET_COLORS, 151, y, 2)
      // Estela discontinua del cohete.
      fx.fillStyle = PALETTE.muted
      for (let yy = y + 36; yy < 200; yy += 6) fx.fillRect(159, yy, 1, 3)
    }
    drawFancyText(fx, title, 160, 80, {
      scale: 3,
      bands: GRADIENTS.gold,
      shadow: PALETTE.ink,
      align: 'center',
    })
    // El sello ×N cae a escalones girado −11° (más grande que en la tabla del diseño, como en su
    // guion gráfico: el multiplicador tiene que verse bien).
    const stepMs = Math.max(1, this.kit.cfg.push.stampMs / 4)
    const scale = stepScale(ms - stamp, 8, 5, stepMs)
    drawRotated(fx, 168, 142, -11, g =>
      drawFancyText(g, stampText, 0, -Math.floor((7 * scale) / 2), {
        scale,
        bands: GRADIENTS.gold,
        outline: 2,
        shadow: PALETTE.ink,
        align: 'center',
      }),
    )
    return true
  }
}
