// SPDX-License-Identifier: AGPL-3.0-or-later
// BANCARROTA — CONTINUE? (docs/DISENO-V2.md, sb-bankrupt.png): la primera vez en la temporada que
// el patrimonio llega a 0 o menos (lo marca el servidor en `spectacle.bankrupt`). Escena
// desaturada, rótulo con glitch y cuenta atrás de arcade que desemboca en la oferta del
// Ludo-Crédito. Llegar a 0 no castiga: no hay game over, solo la oferta de siempre.
import type { ActionEvent } from '../../app/input.ts'
import { drawText } from '../../font/bitmap.ts'
import type { Cue } from '../../render/fx/clock.ts'
import { stepScale } from '../../render/fx/easing.ts'
import { FxScreen } from '../../render/fx/fxScreen.ts'
import type { FxKit } from '../../render/fx/kit.ts'
import { seeded } from '../../render/textures.ts'
import { GRADIENTS, drawFancyText } from '../../render/fx/text.ts'
import { drawHelpBar, drawWindow } from '../draw.ts'
import { PALETTE } from '../palette.ts'

export function bankruptTimes(kit: Pick<FxKit, 'cfg' | 'reduced'>) {
  const b = kit.cfg.bankrupt
  const countAt = kit.reduced ? 0 : b.desaturateMs + b.glitchMs
  return {
    glitch: kit.reduced ? 0 : b.desaturateMs,
    countAt,
    zeroAt: countAt + b.countFrom * b.tickMs,
  }
}

/** Número de la cuenta atrás en el instante `ms` (de `countFrom` a 0). */
export function countdownAt(
  ms: number,
  countAt: number,
  countFrom: number,
  tickMs: number,
): number {
  if (ms < countAt) return countFrom
  return Math.max(0, countFrom - Math.floor((ms - countAt) / tickMs))
}

export class BankruptScreen extends FxScreen {
  readonly id = 'fx:bankrupt'
  private readonly times: ReturnType<typeof bankruptTimes>
  private readonly onContinue: () => void
  private reachedZero = false
  private glitchCanvas: HTMLCanvasElement | null = null

  /** `onContinue`: ✕ o la cuenta a 0 → la oferta del préstamo. */
  constructor(kit: FxKit, onContinue: () => void, onDone: () => void) {
    super(kit, onDone)
    this.onContinue = onContinue
    this.times = bankruptTimes(kit)
    const b = kit.cfg.bankrupt
    const sfx = kit.ctx.sfx
    const cues: Cue[] = []
    if (!kit.reduced) {
      cues.push({ at: 0, run: () => sfx.playFx('powerDown') })
      cues.push({ at: this.times.glitch, run: () => sfx.playFx('glitch') })
    }
    for (let i = 0; i < b.countFrom; i++) {
      const n = b.countFrom - i
      cues.push({
        at: this.times.countAt + i * b.tickMs,
        run: () => sfx.playFx('countdown', n <= 3 ? 1 : 0),
      })
    }
    // La "animación" acaba cuando empieza la cuenta; la cuenta es el hold (y no se cierra sola:
    // al llegar a 0 se ofrece el préstamo).
    this.timeline(this.times.countAt, b.countFrom * b.tickMs + 1, cues)
    kit.announce(kit.ctx.tr.t('a11y.fx.bankrupt', { ...kit.ctx.buttons() }))
  }

  /** Tapa la mesa en cuanto se apaga la escena. */
  get opaque(): boolean {
    return this.kit.reduced || this.ms >= this.times.glitch
  }

  private continue(): void {
    if (this.isClosed) return
    this.kit.ctx.sfx.play('accept')
    this.close()
    this.onContinue()
  }

  override action(e: ActionEvent): void {
    if (e.action === 'back') {
      this.kit.ctx.sfx.play('back')
      this.close()
      return
    }
    if (e.action === 'accept' || e.action === 'start') this.press()
  }

  protected override press(): void {
    // ✕ en la intro salta a la cuenta; en la cuenta, al préstamo.
    if (this.clock.finished) this.continue()
    else this.clock.skip()
  }

  override update(dt: number): void {
    this.clock.tick(dt * 1000)
    if (!this.kit.reduced && this.ms < this.times.glitch) this.kit.desaturate(0.7)
    const b = this.kit.cfg.bankrupt
    if (
      !this.reachedZero &&
      countdownAt(this.ms, this.times.countAt, b.countFrom, b.tickMs) === 0
    ) {
      this.reachedZero = true
      this.kit.ctx.sfx.play('lose')
      this.close()
      this.onContinue()
    }
  }

  /** Mini cartera (como el HUD) con el patrimonio que parpadea en rojo dos veces. */
  private drawWallet(g: CanvasRenderingContext2D): void {
    const { tr } = this.kit.ctx
    const w = this.kit.ctx.state().shown
    if (!w) return
    drawWindow(g, 4, 4, 116, 40)
    const blink = Math.floor(this.ms / 150) % 2 === 0 && this.ms < 600
    if (blink) {
      g.fillStyle = PALETTE.alertTop
      g.fillRect(6, 28, 112, 11)
    }
    const row = (label: string, value: number, y: number, color: string) => {
      drawText(g, label, 10, y, { color: PALETTE.muted, shadow: PALETTE.ink })
      drawText(g, tr.n(value), 114, y, { color, align: 'right', shadow: PALETTE.ink })
    }
    row(tr.t('hud.balance'), w.balance, 10, PALETTE.cream)
    row(tr.t('hud.debt'), w.debt, 21, w.debt > 0 ? PALETTE.loss : PALETTE.cream)
    row(tr.t('hud.net'), w.netWorth, 32, PALETTE.loss)
  }

  /** "BANCARROTA" ×4 con glitch: el 40 % de las filas se desplazan ±8 px, 4 fotogramas. */
  private drawGlitch(g: CanvasRenderingContext2D, label: string): void {
    if (!this.glitchCanvas) {
      const c = document.createElement('canvas')
      c.width = 320
      c.height = 60
      const cg = c.getContext('2d')
      if (!cg) return
      cg.imageSmoothingEnabled = false
      drawFancyText(cg, label, 160, 16, { scale: 4, bands: GRADIENTS.red, align: 'center' })
      this.glitchCanvas = c
    }
    const frames = 4
    const frame = Math.min(
      frames - 1,
      Math.floor(((this.ms - this.times.glitch) / this.kit.cfg.bankrupt.glitchMs) * frames),
    )
    const random = seeded(frame + 1)
    const top = 96
    for (let y = 0; y < 60; y += 2) {
      const dx = random() < 0.4 ? Math.round((random() * 2 - 1) * 8) : 0
      g.drawImage(this.glitchCanvas, 0, y, 320, 2, dx, top + y, 320, 2)
    }
  }

  protected override drawUi(g: CanvasRenderingContext2D): void {
    const { tr } = this.kit.ctx
    const ms = this.ms
    const label = tr.t('fx.bankrupt.title')
    if (!this.kit.reduced && ms < this.times.glitch) {
      this.drawWallet(g)
      return
    }
    g.fillStyle = PALETTE.ink
    g.fillRect(0, 0, 320, 240)
    if (!this.kit.reduced && ms < this.times.countAt) {
      this.drawGlitch(g, label)
      return
    }
    drawFancyText(g, label, 160, 18, { scale: 3, bands: GRADIENTS.red, align: 'center' })
    drawText(g, tr.t('fx.bankrupt.continue'), 160, 44, {
      color: PALETTE.cream,
      scale: 2,
      align: 'center',
      shadow: PALETTE.ink,
    })
    const b = this.kit.cfg.bankrupt
    const n = countdownAt(ms, this.times.countAt, b.countFrom, b.tickMs)
    const sinceTick = (ms - this.times.countAt) % b.tickMs
    const low = n <= 3
    // Cada número nuevo entra a ×10 y baja a ×9 (80 ms); los tres últimos, en rojo a ×10.
    const scale = low ? 10 : this.kit.reduced ? 9 : stepScale(sinceTick, 10, 9, 80)
    drawFancyText(g, String(n), 160, Math.round(110 - (7 * scale) / 2), {
      scale,
      bands: low ? GRADIENTS.red : GRADIENTS.gold,
      shadow: PALETTE.jackpotBottom,
      align: 'center',
    })
    drawHelpBar(g, tr.t('fx.bankrupt.help', { ...this.kit.ctx.buttons() }), PALETTE.muted)
  }

  drawFx(): boolean {
    return false
  }
}
