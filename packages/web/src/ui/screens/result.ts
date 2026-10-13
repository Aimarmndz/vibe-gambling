// SPDX-License-Identifier: AGPL-3.0-or-later
// Resultado: número y color en grande, ganancia o pérdida, frase de ludópata y avisos extra
// (jackpot "push to prod = bonus" con su cuenta, racha de color, tests fallidos, apuesta
// automática). Las animaciones de espectáculo (render/fx) van antes o después de esta pantalla.
import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, printable, wrap } from '../../font/bitmap.ts'
import type { OutcomeView } from '../../game/outcome.ts'
import { HELP_BAR_TOP, dim, drawHelpBar, drawWindow, fillCircle } from '../draw.ts'
import { PALETTE, pocketHex } from '../palette.ts'

export class ResultScreen implements Screen {
  readonly id = 'result'
  private readonly ctx: AppContext
  private readonly view: OutcomeView
  private readonly onClose: () => void
  /** Cuánto se queda en pantalla (más corto en GIRAR TODAS). */
  private readonly holdMs: number
  private age = 0
  private closed = false
  /** Borde inferior de la ventana de la frase (se calcula al pintar). */
  private panelBottom = 240

  constructor(
    ctx: AppContext,
    view: OutcomeView,
    onClose: () => void,
    holdMs: number = ctx.client.ui.resultHoldMs,
  ) {
    this.ctx = ctx
    this.view = view
    this.onClose = onClose
    this.holdMs = holdMs
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.ctx.pop(this)
    this.onClose()
  }

  /** Los avisos (memory card…) van entre la frase y la barra de ayuda, nunca encima del número. */
  toastBand(): { top: number; bottom: number } {
    return { top: this.panelBottom + 3, bottom: HELP_BAR_TOP - 3 }
  }

  update(dt: number): void {
    this.age += dt
    if (this.age * 1000 >= this.holdMs) this.close()
  }

  action(e: ActionEvent): void {
    // Medio segundo de gracia para no saltarse el resultado por pulsar justo al caer la bola.
    if (this.age < 0.5) return
    if (e.action === 'accept' || e.action === 'back' || e.action === 'start') {
      this.ctx.sfx.play('accept')
      this.close()
    }
  }

  pointer(kind: 'move' | 'down' | 'leave'): boolean {
    if (kind === 'down' && this.age >= 0.5) this.close()
    return true
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const v = this.view
    // Entrada rápida: el disco crece en 0,25 s (sin animación con movimiento reducido).
    const k = this.ctx.reducedMotion ? 1 : Math.min(1, this.age / 0.25)
    dim(g, 0.35 * k)

    if (v.jackpot) {
      const on = Math.floor(t * 4) % 2 === 0
      drawWindow(g, 40, 6, 240, 15, { top: PALETTE.red, bottom: PALETTE.jackpotBottom })
      drawText(
        g,
        tr.t('result.jackpot', { multiplier: this.ctx.web.game.jackpot.gitPushMultiplier }),
        160,
        10,
        {
          color: on ? PALETTE.gold : PALETTE.cream,
          align: 'center',
        },
      )
    }

    // Disco con el número.
    const r = Math.round(26 * k)
    fillCircle(g, 161, 59, r + 3, PALETTE.shadow)
    fillCircle(g, 160, 58, r + 2, PALETTE.gold)
    fillCircle(g, 160, 58, r, pocketHex(v.color))
    if (k >= 1) {
      drawText(g, String(v.number), 160, 48, {
        color: PALETTE.cream,
        scale: 3,
        align: 'center',
        shadow: PALETTE.ink,
      })
    }
    drawText(g, tr.t(`color.${v.color}`), 160, 92, {
      color: PALETTE.cream,
      align: 'center',
      shadow: PALETTE.ink,
    })

    // Veredicto y cantidad.
    const verdictKey = {
      win: 'result.win',
      lose: 'result.lose',
      even: 'result.even',
      noBet: 'result.noBet',
    } as const
    const color = v.net > 0 ? PALETTE.win : v.net < 0 ? PALETTE.loss : PALETTE.cream
    // Con jackpot, la cuenta del bonus: "GANAS · +100 · ×2" y debajo el total (sb-push.png).
    const multiplier = this.ctx.web.game.jackpot.gitPushMultiplier
    const verdict =
      v.jackpot && v.jackpotBase !== null && v.net > 0
        ? `${tr.t(verdictKey[v.verdict])} · ${tr.signed(v.jackpotBase)} · ×${multiplier}`
        : tr.t(verdictKey[v.verdict])
    drawText(g, verdict, 160, 104, {
      color: v.jackpot ? PALETTE.gold : PALETTE.muted,
      align: 'center',
      shadow: PALETTE.ink,
    })
    if (v.verdict !== 'noBet') {
      drawText(g, tr.signed(v.net), 160, 116, {
        color,
        scale: 2,
        align: 'center',
        shadow: PALETTE.ink,
      })
    }

    // Frase y extras.
    const lines = wrap(`“${printable(v.phrase)}”`, 268)
    const extras = v.extras.flatMap(e => wrap(printable(e), 268))
    if (v.interest > 0) extras.push(tr.t('result.interest', { amount: tr.n(v.interest) }))
    const h = 12 + lines.length * 11 + (extras.length ? 4 + extras.length * 10 : 0)
    const y0 = 138
    drawWindow(g, 18, y0, 284, h)
    this.panelBottom = y0 + h
    let y = y0 + 7
    for (const line of lines) {
      drawText(g, line, 160, y, { color: PALETTE.cream, align: 'center', shadow: PALETTE.ink })
      y += 11
    }
    if (extras.length) y += 4
    for (const line of extras) {
      drawText(g, line, 160, y, { color: PALETTE.gold, align: 'center', shadow: PALETTE.ink })
      y += 10
    }
    if (this.age >= 0.5) {
      drawHelpBar(g, tr.t('result.continue', { ...this.ctx.buttons() }), PALETTE.muted)
    }
  }
}
