// SPDX-License-Identifier: AGPL-3.0-or-later
// "Ludo-Crédito Express" (docs/DISENO-V2.md, "Préstamo: secuencia de banco", sb-loan.png): la
// ventanilla con el banquero tras las rejas y su oferta (TAE absurdo de la configuración y letra
// pequeña que pasa demasiado rápido). Aceptar solo manda `loan.request`; cuando el servidor
// confirma (`loan.granted`) empieza la secuencia: contrato, firma pixelada, sello APROBADO,
// monedas al saldo y la deuda que sube con caja registradora. La animación nunca cambia lo que se
// firma: los valores son los de la cartera del servidor.
import type { Wallet } from '@vibe-gambling/shared'

import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, measure, wrap } from '../../font/bitmap.ts'
import { FxClock } from '../../render/fx/clock.ts'
import type { Cue } from '../../render/fx/clock.ts'
import {
  inQuad,
  outBack,
  outCubic,
  progress,
  rollValue,
  stepScale,
} from '../../render/fx/easing.ts'
import type { FxKit } from '../../render/fx/kit.ts'
import { drawBanker, drawPen } from '../../render/fx/sprites.ts'
import { drawRotated } from '../../render/fx/text.ts'
import { HELP_BAR_TOP, drawHelpBar, drawWindow } from '../draw.ts'
import { ListMenu } from '../listMenu.ts'
import { PALETTE } from '../palette.ts'

/** Contrato (180×150, papel). */
const CONTRACT = { x: 70, w: 180, h: 150, top: 40 } as const

/** Instantes de la secuencia tras `loan.granted` (ms). Exportado para las pruebas. */
export function loanTimes(kit: Pick<FxKit, 'cfg' | 'reduced'>) {
  const l = kit.cfg.loan
  if (kit.reduced) {
    const final = Math.min(kit.cfg.reducedMaxMs, kit.cfg.reduced.loanMs)
    return { sign: 0, stamp: 0, coins: 0, debt: 0, final }
  }
  const sign = l.contractMs
  const stamp = sign + l.signMs
  const coins = stamp + l.stampMs
  const debt = coins + l.coinsMs
  return { sign, stamp, coins, debt, final: debt + l.debtMs }
}

/** Puntos de la firma (polilínea ondulada) relativos al origen, de izquierda a derecha. */
export function signaturePath(width: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let x = 0; x <= width; x++) {
    // Dos ondas superpuestas y un lazo: una firma "de verdad" de banquero con prisa.
    const y = Math.round(Math.sin(x / 7) * 4 + Math.sin(x / 2.3) * 1.5 - (x > width * 0.7 ? 2 : 0))
    out.push({ x, y })
  }
  return out
}

type Stage = 'offer' | 'granted'

export class LoanScreen implements Screen {
  readonly id = 'loan'
  readonly opaque = true
  private readonly ctx: AppContext
  private readonly kit: FxKit
  private readonly menu: ListMenu
  private pending = false
  private stage: Stage = 'offer'
  private clock = new FxClock(0, 0)
  private times: ReturnType<typeof loanTimes>
  /** Cartera antes y después del préstamo (las del servidor). */
  private before: Wallet | null
  private after: Wallet | null = null
  private amount = 0
  private age = 0
  private coinsDropped = 0
  private closed = false
  private readonly signature = signaturePath(110)

  constructor(ctx: AppContext, kit: FxKit) {
    this.ctx = ctx
    this.kit = kit
    this.times = loanTimes(kit)
    this.before = ctx.state().shown
    this.menu = new ListMenu(ctx, 'loan', [
      {
        label: () => ctx.tr.t('loan.accept'),
        accept: () => {
          if (this.pending) return
          this.pending = ctx.send({ type: 'loan.request' })
          if (!this.pending) ctx.sfx.play('error')
        },
      },
      { label: () => ctx.tr.t('loan.decline'), accept: () => this.close() },
    ])
    // Campanilla de la ventanilla.
    ctx.sfx.playFx('deskBell')
  }

  /** ¿Está ya en la secuencia del préstamo concedido? */
  get granting(): boolean {
    return this.stage === 'granted'
  }

  /** El servidor concedió el préstamo: empieza la secuencia del banco. */
  granted(amount: number, wallet: Wallet): void {
    this.stage = 'granted'
    this.amount = amount
    this.after = wallet
    this.before ??= wallet
    const sfx = this.ctx.sfx
    const t = this.times
    const cues: Cue[] = []
    if (this.kit.reduced) {
      cues.push({ at: 0, run: () => sfx.playFx('kaching') })
    } else {
      cues.push({ at: 0, run: () => sfx.playFx('paper') })
      cues.push({
        at: t.sign,
        run: () => sfx.playFx('scribble', this.kit.cfg.loan.signMs / 1000),
      })
      cues.push({ at: t.stamp, run: () => sfx.playFx('thud') })
      for (let i = 0; i < 10; i++) {
        cues.push({ at: t.coins + i * 50, run: () => sfx.playFx('coinBlip', i / 9) })
      }
      cues.push({ at: t.debt, run: () => sfx.playFx('kaching') })
    }
    this.clock = new FxClock(t.final, this.ctx.client.ui.toastMs, cues)
    this.kit.announce(this.ctx.tr.t('a11y.fx.loan', { amount: this.ctx.tr.n(amount) }))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.ctx.pop(this)
  }

  action(e: ActionEvent): void {
    if (this.stage === 'granted') {
      if (e.action === 'back') {
        this.ctx.sfx.play('back')
        this.close()
      } else if (e.action === 'accept' || e.action === 'start') {
        this.press()
      }
      return
    }
    if (this.menu.action(e)) return
    if (e.action === 'back') {
      this.ctx.sfx.play('back')
      this.close()
    }
  }

  private press(): void {
    if (this.clock.skip() === 'close') {
      this.ctx.sfx.play('accept')
      this.close()
    } else {
      this.dropCoins(true)
    }
  }

  pointer(kind: 'move' | 'down' | 'leave'): boolean {
    if (kind === 'down' && this.stage === 'granted') this.press()
    return true
  }

  update(dt: number): void {
    this.age += dt
    if (this.stage !== 'granted') return
    this.clock.tick(dt * 1000)
    const ms = this.clock.ms
    if (!this.kit.reduced) {
      // El sello: sacudida de 2 px durante 120 ms (solo mueve el contrato, que es de esta pantalla).
      if (ms >= this.times.coins && !this.clock.wasSkipped) this.dropCoins(false)
    }
    if (this.clock.expired) this.close()
  }

  /** Monedas 3D que caen en la fila del saldo (de una en una, o todas de golpe al saltar). */
  private dropCoins(all: boolean): void {
    if (this.kit.reduced) return
    const total = 10
    const due = all
      ? total
      : Math.min(
          total,
          Math.floor(((this.clock.ms - this.times.coins) / this.kit.cfg.loan.coinsMs) * total) + 1,
        )
    while (this.coinsDropped < due) {
      const i = this.coinsDropped++
      this.kit.coins.spawn({
        x: 40 + ((i * 37) % 70),
        y: -10 - (i % 3) * 8,
        vx: 0,
        vy: 40,
        color: PALETTE.gold,
        floorY: 12,
        size: 0.8,
      })
    }
  }

  // ------------------------------------------------------------------ pintar

  /** La ventanilla: moqueta, rótulo, mostrador de madera, banquero y rejas oro. */
  private drawBank(g: CanvasRenderingContext2D, t: number): void {
    // Pared con papel a rayas y mostrador.
    g.fillStyle = PALETTE.carpet
    g.fillRect(0, 0, 320, 150)
    g.fillStyle = PALETTE.jackpotBottom
    for (let x = 0; x < 320; x += 16) g.fillRect(x, 0, 6, 150)
    g.fillStyle = PALETTE.wood
    g.fillRect(0, 150, 320, 90)
    g.fillStyle = PALETTE.goldDark
    g.fillRect(0, 150, 320, 1)
    g.fillStyle = '#5a3018'
    g.fillRect(0, 151, 320, 3)
    // Rótulo del banco.
    drawWindow(g, 60, 8, 200, 15, { top: PALETTE.alertTop, bottom: PALETTE.jackpotBottom })
    drawText(g, this.ctx.tr.t('loan.title'), 160, 12, {
      color: PALETTE.gold,
      align: 'center',
      shadow: PALETTE.ink,
    })
    // Ventanilla: fondo oscuro, banquero y rejas oro de 2 px cada 14 px.
    g.fillStyle = PALETTE.ink
    g.fillRect(70, 30, 180, 120)
    const blink = Math.floor(t * 10) % 40 === 0
    drawBanker(g, 146, 92, blink)
    g.fillStyle = PALETTE.gold
    g.fillRect(68, 28, 184, 3)
    for (let x = 70; x <= 248; x += 14) {
      g.fillStyle = PALETTE.gold
      g.fillRect(x, 30, 2, 120)
      g.fillStyle = PALETTE.goldDark
      g.fillRect(x + 1, 30, 1, 120)
    }
  }

  /** La letra pequeña cruzando la barra inferior, a `finePrintPxPerS`. */
  private drawTicker(g: CanvasRenderingContext2D, seconds: number): void {
    const text = this.ctx.tr.t('loan.fine')
    const w = measure(text)
    const speed = this.kit.cfg.loan.finePrintPxPerS
    // Con movimiento reducido no se mueve: se queda quieta al principio.
    const offset = this.kit.reduced ? 0 : (seconds * speed) % (w + 320)
    g.fillStyle = 'rgba(8,7,13,0.92)'
    g.fillRect(0, HELP_BAR_TOP, 320, 18)
    g.fillStyle = PALETTE.frameInner
    g.fillRect(0, HELP_BAR_TOP, 320, 1)
    drawText(g, text, Math.round(320 - offset), 228, { color: PALETTE.muted })
  }

  private drawOffer(g: CanvasRenderingContext2D, t: number): void {
    const { tr, web } = this.ctx
    const loan = web.game.loan
    const pitch = wrap(tr.t('loan.pitch', { amount: tr.n(loan.amount) }), 272)
    const terms = wrap(
      tr.t('loan.terms', {
        apr: tr.n(loan.displayApr),
        interest: String(Math.round(loan.interestPerSpin * 1000) / 10),
      }),
      272,
    )
    // La ventana crece hacia arriba con lo que haya que decir (las condiciones, siempre enteras).
    const h = 14 + (pitch.length + terms.length) * 10 + 2 * 11 + 6
    const y0 = HELP_BAR_TOP - 4 - h
    drawWindow(g, 16, y0, 288, h)
    drawText(g, tr.t('fx.loan.offer'), 160, y0 + 5, {
      color: PALETTE.gold,
      align: 'center',
      shadow: PALETTE.ink,
    })
    let y = y0 + 16
    for (const line of pitch) {
      drawText(g, line, 24, y, { color: PALETTE.cream, shadow: PALETTE.ink })
      y += 10
    }
    for (const line of terms) {
      drawText(g, line, 24, y, { color: PALETTE.loss, shadow: PALETTE.ink })
      y += 10
    }
    this.menu.draw(g, 32, y + 2, 240, 11, t)
    if (this.pending) {
      drawText(g, tr.t('loan.pending'), 296, y + 13, { color: PALETTE.muted, align: 'right' })
    }
    this.drawTicker(g, this.age)
  }

  /** El contrato en papel con importe, TAE, letra pequeña movida y la firma. */
  private drawContract(g: CanvasRenderingContext2D, ms: number): void {
    const { tr, web } = this.ctx
    const t = this.times
    const reduced = this.kit.reduced
    let y: number = CONTRACT.top
    if (!reduced) {
      if (ms < t.sign) y = Math.round(240 + (CONTRACT.top - 240) * outBack(progress(ms, 0, t.sign)))
      // Al empezar a caer las monedas, el contrato se va hacia abajo.
      if (ms >= t.coins) y = Math.round(CONTRACT.top + 220 * inQuad(progress(ms, t.coins, 150)))
      if (y >= 240) return
    }
    // Sacudida del sello (2 px, 120 ms).
    const shaking = !reduced && ms >= t.stamp && ms < t.stamp + 120
    const x = CONTRACT.x + (shaking ? (Math.floor(ms / 40) % 2 ? 2 : -2) : 0)
    const grad = g.createLinearGradient(0, y, 0, y + CONTRACT.h)
    grad.addColorStop(0, PALETTE.paperTop)
    grad.addColorStop(1, PALETTE.paperBottom)
    g.fillStyle = 'rgba(0,0,0,0.5)'
    g.fillRect(x + 3, y + 3, CONTRACT.w, CONTRACT.h)
    g.fillStyle = grad
    g.fillRect(x, y, CONTRACT.w, CONTRACT.h)
    g.fillStyle = PALETTE.goldDark
    g.fillRect(x, y, CONTRACT.w, 1)
    g.fillRect(x, y + CONTRACT.h - 1, CONTRACT.w, 1)
    g.fillRect(x, y, 1, CONTRACT.h)
    g.fillRect(x + CONTRACT.w - 1, y, 1, CONTRACT.h)
    drawText(g, tr.t('fx.loan.contract'), x + CONTRACT.w / 2, y + 8, {
      color: PALETTE.ink,
      align: 'center',
    })
    drawText(g, tr.t('fx.loan.amount'), x + 10, y + 26, { color: PALETTE.goldDark })
    drawText(g, tr.n(this.amount || web.game.loan.amount), x + CONTRACT.w - 10, y + 22, {
      color: PALETTE.ink,
      scale: 2,
      align: 'right',
    })
    drawText(g, tr.t('fx.loan.apr'), x + 10, y + 44, { color: PALETTE.goldDark })
    drawText(g, `${tr.n(web.game.loan.displayApr)} %`, x + CONTRACT.w - 10, y + 40, {
      color: PALETTE.red,
      scale: 2,
      align: 'right',
    })
    // Letra pequeña "movida": rayitas que se desplazan, ilegibles a propósito (la de verdad, en
    // BANCO y en la barra de abajo).
    g.fillStyle = PALETTE.creamLo
    const drift = reduced ? 0 : Math.floor(ms / 30) % 6
    for (let row = 0; row < 7; row++) {
      for (let i = 0; i < 24; i++) {
        const dx = (i * 7 + row * 3 + drift) % 160
        g.fillRect(x + 10 + dx, y + 62 + row * 7, 4 + ((i + row) % 3), 1)
      }
    }
    drawText(g, tr.t('fx.loan.signature'), x + 10, y + 128, { color: PALETTE.goldDark })
    g.fillStyle = PALETTE.ink
    g.fillRect(x + 50, y + 136, 120, 1)
    // La firma, de izquierda a derecha, con la pluma en la punta.
    const k = reduced ? 1 : progress(ms, t.sign, this.kit.cfg.loan.signMs)
    const n = Math.floor(this.signature.length * k)
    g.fillStyle = PALETTE.night
    let prev: { x: number; y: number } | null = null
    for (let i = 0; i < n; i++) {
      const p = this.signature[i]!
      const top = prev ? Math.min(prev.y, p.y) : p.y
      const bottom = prev ? Math.max(prev.y, p.y) : p.y
      g.fillRect(x + 56 + p.x, y + 130 + top, 1, bottom - top + 1)
      prev = p
    }
    if (k > 0 && k < 1) {
      const tip = this.signature[Math.max(0, n - 1)]!
      drawPen(g, x + 56 + tip.x, y + 130 + tip.y)
    }
    // Sello APROBADO: rojo, doble marco, −12°, cae a escalones (×4 → ×2).
    if (ms >= t.stamp || reduced) {
      const scale = reduced
        ? 2
        : stepScale(ms - t.stamp, 4, 2, Math.max(1, this.kit.cfg.loan.stampMs / 3))
      const label = tr.t('fx.loan.approved')
      drawRotated(g, x + CONTRACT.w / 2 + 10, y + 100, -12, s => {
        const w = measure(label, scale) + 8 * scale
        const h = 9 * scale + 4
        s.fillStyle = PALETTE.red
        s.fillRect(-w / 2, -h / 2, w, 2)
        s.fillRect(-w / 2, h / 2 - 2, w, 2)
        s.fillRect(-w / 2, -h / 2, 2, h)
        s.fillRect(w / 2 - 2, -h / 2, 2, h)
        s.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, 1)
        s.fillRect(-w / 2 + 4, h / 2 - 5, w - 8, 1)
        s.fillRect(-w / 2 + 4, -h / 2 + 4, 1, h - 8)
        s.fillRect(w / 2 - 5, -h / 2 + 4, 1, h - 8)
        drawText(s, label, 0, -Math.floor((7 * scale) / 2), {
          color: PALETTE.red,
          scale,
          align: 'center',
        })
      })
    }
  }

  /** Mini cartera (como el HUD) donde caen las monedas y sube la deuda. */
  private drawWallet(g: CanvasRenderingContext2D, ms: number): void {
    const { tr } = this.ctx
    const before = this.before
    const after = this.after
    if (!before || !after) return
    const t = this.times
    const reduced = this.kit.reduced
    const done = this.clock.finished
    const balK = reduced || done ? 1 : outCubic(progress(ms, t.coins, this.kit.cfg.loan.coinsMs))
    const debtK = reduced || done ? 1 : outCubic(progress(ms, t.debt, this.kit.cfg.loan.debtMs))
    const balance = rollValue(before.balance, after.balance, balK)
    const debt = rollValue(before.debt, after.debt, debtK)
    drawWindow(g, 4, 4, 116, 40)
    if (ms >= t.coins && ms < t.debt) {
      g.fillStyle = PALETTE.moneyTop
      g.fillRect(6, 6, 112, 11)
    }
    if (ms >= t.debt && !done) {
      g.fillStyle = PALETTE.alertTop
      g.fillRect(6, 17, 112, 11)
    }
    const row = (label: string, value: number, y: number, color: string) => {
      drawText(g, label, 10, y, { color: PALETTE.muted, shadow: PALETTE.ink })
      drawText(g, tr.n(value), 114, y, { color, align: 'right', shadow: PALETTE.ink })
    }
    row(tr.t('hud.balance'), balance, 8, PALETTE.cream)
    row(tr.t('hud.debt'), debt, 19, debt > 0 ? PALETTE.loss : PALETTE.cream)
    row(tr.t('hud.net'), balance - debt, 30, balance - debt < 0 ? PALETTE.loss : PALETTE.win)
    const gained = after.balance - before.balance
    const owed = after.debt - before.debt
    if (ms >= t.coins && gained > 0) {
      const rise = reduced || done ? 0 : Math.round(6 * (1 - progress(ms, t.coins, 300)))
      // Bajo el rótulo del banco, sobre las rejas (no encima de su texto).
      drawText(g, tr.signed(gained), 128, 30 + rise, {
        color: PALETTE.win,
        scale: 2,
        shadow: PALETTE.ink,
      })
    }
    if (ms >= t.debt && owed > 0) {
      drawText(g, tr.signed(owed), 128, 50, { color: PALETTE.loss, scale: 2, shadow: PALETTE.ink })
      drawText(g, tr.t('fx.loan.kaching'), 252, 54, { color: PALETTE.gold, shadow: PALETTE.ink })
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    this.drawBank(g, t)
    if (this.stage === 'offer') {
      this.drawOffer(g, t)
      return
    }
    // Zona clicable de toda la pantalla: el clic salta o cierra (no cae en la mesa).
    this.ctx.hits.add({ x: 0, y: 0, w: 320, h: 240, id: 'loan:skip', onClick: () => this.press() })
    const ms = this.clock.ms
    if (this.kit.reduced) {
      // Sin movimiento: el contrato firmado y sellado y, al final, solo la cartera.
      if (!this.clock.finished) this.drawContract(g, ms)
      this.drawWallet(g, ms)
    } else {
      if (ms < this.times.coins + 150) this.drawContract(g, ms)
      if (ms >= this.times.coins) this.drawWallet(g, ms)
    }
    if (this.clock.finished) {
      drawHelpBar(g, this.ctx.tr.t('fx.loan.done', { ...this.ctx.buttons() }), PALETTE.muted)
    } else if (ms >= this.times.debt) {
      this.drawTicker(g, (ms - this.times.debt) / 1000)
    }
  }
}
