// SPDX-License-Identifier: AGPL-3.0-or-later
// BANCO (`menu-bank.png`): la deuda con el Ludo-Crédito Express, lo que subirá en la próxima
// tirada, los préstamos y el historial (`bank.request`). Devolver no existe. Sin saldo para la
// ficha mínima, la última fila de la deuda pasa a "✕ PEDIR PRÉSTAMO" y abre la oferta de siempre.
import type { BankStatement } from '@vibe-gambling/shared'

import type { ActionEvent } from '../../../app/input.ts'
import { drawText, wrap } from '../../../font/bitmap.ts'
import { swingAngle } from '../../../render/menuIcons/layer.ts'
import { drawWindow } from '../../draw.ts'
import { PALETTE } from '../../palette.ts'
import { bankRow, interestPercent } from '../format.ts'
import type { BankRow } from '../format.ts'
import { GRADIENTS, SECONDARY, drawCorners, drawGradientText, fit } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'

const HISTORY_ROWS = 4
/** Vaivén del banco 3D (radianes a cada lado del 3/4). */
const SWING = 0.5

type HistoryLine = { kind: 'entry'; row: BankRow } | { kind: 'text'; text: string; color: string }

/** Días (de pared, contando el de hoy) desde el préstamo más antiguo del historial. */
export function daysInDebt(bank: Pick<BankStatement, 'history' | 'debt'>, nowMs: number): number {
  if (bank.debt <= 0) return 0
  const loans = bank.history.filter(e => e.kind === 'loan').map(e => Date.parse(e.at))
  if (loans.length === 0) return 0
  return Math.max(1, Math.ceil((nowMs - Math.min(...loans)) / 86_400_000))
}

export class BankPage implements MenuPage {
  readonly id = 'bank'
  readonly icon = 'bank' as const
  private readonly host: MenuHost
  private bank: BankStatement | null = null
  private failed = false
  private scroll = 0
  private request = 0
  private deferred = false

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  title(): string {
    return this.ctx.tr.t('bank.title')
  }

  headerRight(): string {
    return this.ctx.tr.t('loan.title')
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    const b = this.ctx.buttons()
    const items: HelpItem[] = [{ key: '↑↓', label: tr.t('bank.history') }]
    if (this.ctx.loanAvailable()) items.push({ key: b.x, label: tr.t('bank.borrow') })
    items.push({ key: b.o, label: tr.t('help.back') })
    return items
  }

  enter(): void {
    this.fetch()
  }

  private fetch(): void {
    const id = ++this.request
    this.failed = false
    if (this.ctx.state().phase === 'landing') {
      this.deferred = true
      return
    }
    this.deferred = false
    this.ctx.progress('bank').then(
      bank => {
        if (id !== this.request) return
        // Llegado con la bola cayendo: podría traer ya los intereses de la ronda. Se vuelve a pedir.
        if (this.ctx.state().phase === 'landing') {
          this.deferred = true
          return
        }
        this.bank = bank
        this.scroll = 0
        this.ctx.announce(this.summary(bank))
      },
      (error: unknown) => {
        if (id !== this.request) return
        console.warn('[banco] no se pudo cargar', error)
        this.failed = true
        this.ctx.announce(this.ctx.tr.t('bank.error'))
      },
    )
  }

  summary(bank: BankStatement): string {
    const { tr } = this.ctx
    return tr.plural('bank.a11y', bank.loans, {
      debt: tr.n(bank.debt),
      loans: tr.n(bank.loans),
      next: tr.n(bank.nextInterest),
    })
  }

  update(): void {
    if (this.deferred && this.ctx.state().phase !== 'landing') this.fetch()
  }

  /**
   * Lo que se desplaza con ↑↓ en la ventana de historial: los movimientos y, debajo, la letra
   * pequeña completa del préstamo (la que en la secuencia del préstamo pasa demasiado rápido).
   */
  private lines(): HistoryLine[] {
    const { tr, web } = this.ctx
    const tz = web.game.seasonTimeZone
    const out: HistoryLine[] = (this.bank?.history ?? []).map(entry => ({
      kind: 'entry',
      row: bankRow(entry, tr, tz),
    }))
    if (out.length === 0) {
      for (const text of wrap(tr.t('bank.empty'), 288))
        out.push({ kind: 'text', text, color: PALETTE.cream })
    }
    if (this.bank?.truncated)
      out.push({ kind: 'text', text: tr.t('bank.truncated'), color: SECONDARY })
    out.push({ kind: 'text', text: '', color: SECONDARY })
    for (const text of wrap(tr.t('loan.fine'), 288))
      out.push({ kind: 'text', text, color: SECONDARY })
    return out
  }

  private borrow(): void {
    if (!this.ctx.loanAvailable()) return
    this.host.close()
    this.ctx.offerLoan()
  }

  action(e: ActionEvent): boolean {
    const rows = this.bank ? this.lines().length : 0
    switch (e.action) {
      case 'up':
      case 'down': {
        const max = Math.max(0, rows - HISTORY_ROWS)
        const next = Math.max(0, Math.min(max, this.scroll + (e.action === 'up' ? -1 : 1)))
        if (next !== this.scroll) {
          this.scroll = next
          this.ctx.sfx.play('move')
        }
        return true
      }
      case 'accept':
        if (!this.ctx.loanAvailable()) return true
        this.borrow()
        return true
      default:
        return false
    }
  }

  wheel(delta: number): void {
    this.action({ action: delta > 0 ? 'down' : 'up', fine: false })
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    this.drawDebt(g, t)
    this.drawBankWindow(g, t)
    this.drawHistory(g, t)
  }

  private drawDebt(g: CanvasRenderingContext2D, t: number): void {
    const { tr, web } = this.ctx
    const w = this.ctx.state().shown
    const debt = this.bank?.debt ?? w?.debt ?? 0
    const balance = this.bank?.balance ?? w?.balance ?? 0
    const net = this.bank?.netWorth ?? w?.netWorth ?? 0
    drawWindow(g, 8, 28, 150, 112, { top: PALETTE.alertTop })
    drawText(g, tr.t('hud.debt'), 16, 37, { color: PALETTE.cream, shadow: PALETTE.ink })
    drawGradientText(g, tr.n(debt), 16, 49, GRADIENTS.red, {
      scale: 3,
      shadow: PALETTE.ink,
    })
    const rows: [string, string, string][] = [
      [tr.t('hud.balance'), tr.n(balance), PALETTE.cream],
      [tr.t('bank.netWorth'), tr.n(net), net < 0 ? PALETTE.loss : PALETTE.win],
      [tr.t('bank.apr'), `${tr.n(web.game.loan.displayApr)} %`, PALETTE.gold],
      [
        tr.t('bank.interest'),
        tr.t('bank.perSpin', { pct: interestPercent(web.game.loan, tr) }),
        PALETTE.cream,
      ],
    ]
    rows.forEach(([label, value, color], i) => {
      const y = 80 + i * 11
      drawText(g, label, 16, y, { color: PALETTE.cream, shadow: PALETTE.ink })
      drawText(g, value, 150, y, { color, align: 'right', shadow: PALETTE.ink })
    })
    g.fillStyle = PALETTE.frameInner
    g.fillRect(14, 124, 138, 1)
    if (this.ctx.loanAvailable()) {
      const b = this.ctx.buttons()
      drawText(g, `${b.x} ${tr.t('bank.borrow')}`, 16, 129, {
        color: PALETTE.gold,
        shadow: PALETTE.ink,
      })
      drawCorners(g, 13, 126, 140, 11, this.host.cornerGap(t), 4, 1)
      this.ctx.hits.add({
        x: 12,
        y: 125,
        w: 142,
        h: 13,
        id: 'bank:borrow',
        onClick: () => this.borrow(),
      })
    } else {
      const next = this.bank?.nextInterest ?? 0
      drawText(g, tr.t('bank.nextSpin'), 16, 129, { color: PALETTE.cream, shadow: PALETTE.ink })
      drawText(g, next > 0 ? tr.signed(next) : '0', 150, 129, {
        color: next > 0 ? PALETTE.loss : PALETTE.cream,
        align: 'right',
        shadow: PALETTE.ink,
      })
    }
  }

  private drawBankWindow(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const w = this.ctx.state().shown
    drawWindow(g, 164, 28, 148, 112)
    this.host.icons.icon('bank', 238, 62, 26, {
      yaw: swingAngle(t, this.ctx.client.menu.iconSpinMs * 2, SWING, this.host.still),
      tilt: 0.3,
    })
    const loans = this.bank?.loans ?? w?.loans ?? 0
    const days = this.bank ? daysInDebt(this.bank, Date.now()) : 0
    const rows: [string, string, string][] = [
      [tr.t('bank.loans'), tr.n(loans), PALETTE.cream],
      [
        tr.t('bank.inDebt'),
        tr.t('bank.days', { n: tr.n(days) }),
        days > 0 ? PALETTE.loss : PALETTE.cream,
      ],
      [tr.t('bank.repay'), tr.t('bank.repayNo'), PALETTE.cream],
    ]
    rows.forEach(([label, value, color], i) => {
      const y = 106 + i * 11
      drawText(g, label, 172, y, { color: PALETTE.cream, shadow: PALETTE.ink })
      drawText(g, value, 304, y, { color, align: 'right', shadow: PALETTE.ink })
    })
  }

  private drawHistory(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    drawWindow(g, 8, 144, 304, 72, { top: PALETTE.deepTop })
    drawText(g, tr.t('bank.date'), 16, 151, { color: SECONDARY })
    drawText(g, tr.t('bank.movement'), 64, 151, { color: SECONDARY })
    drawText(g, tr.t('hud.debt'), 304, 151, { color: SECONDARY, align: 'right' })
    g.fillStyle = PALETTE.frameInner
    g.fillRect(14, 159, 292, 1)
    if (!this.bank) {
      const text = this.failed ? tr.t('bank.error') : tr.t('lb.loading')
      if (this.failed || this.host.still || Math.floor(t * 2) % 2 === 0) {
        drawText(g, text, 160, 180, {
          color: this.failed ? PALETTE.loss : PALETTE.cream,
          align: 'center',
        })
      }
      return
    }
    const lines = this.lines()
    lines.slice(this.scroll, this.scroll + HISTORY_ROWS).forEach((line, i) => {
      const y = 165 + i * 12
      if (line.kind === 'text') {
        drawText(g, line.text, 16, y, { color: line.color })
        return
      }
      const { row } = line
      drawText(g, row.date, 16, y, { color: PALETTE.cream })
      drawText(g, fit(row.label, 180), 64, y, { color: PALETTE.cream, shadow: PALETTE.ink })
      drawText(g, row.amount, 304, y, { color: PALETTE.loss, align: 'right', shadow: PALETTE.ink })
    })
  }
}
