// SPDX-License-Identifier: AGPL-3.0-or-later
// Formateo puro de las pantallas del menú v2: tiempo que queda, fechas cortas, movimientos del
// banco, la apuesta con la que se juegan las pendientes y el escalado de la gráfica del
// patrimonio. Sin canvas: todo se prueba en test/menuFormat.test.ts.
import { seasonBounds } from '@vibe-gambling/shared'
import type { BankEntry, Bet, PublicGameConfig, SeasonStats, Slip } from '@vibe-gambling/shared'

import type { Translator } from '../../i18n/index.ts'

/** "12 d" o "5 h": lo que le queda a algo (la temporada). */
export function timeLeft(ms: number, tr: Translator): string {
  const hours = Math.max(0, Math.floor(ms / 3_600_000))
  if (hours >= 48) return tr.t('mc.days', { n: Math.floor(hours / 24) })
  return tr.t('mc.hours', { n: hours })
}

/** Lo que le queda a la temporada `seasonId` desde `nowMs`. */
export function seasonTimeLeft(
  seasonId: string,
  game: Pick<PublicGameConfig, 'seasonTimeZone' | 'seasonStartDay'>,
  nowMs: number,
  tr: Translator,
): string {
  const ends = seasonBounds(seasonId, game.seasonTimeZone, game.seasonStartDay).endsAt
  return timeLeft(ends.getTime() - nowMs, tr)
}

/** Días enteros que le quedan a la temporada (para "CADUCAN EN n D"). */
export function seasonDaysLeft(
  seasonId: string,
  game: Pick<PublicGameConfig, 'seasonTimeZone' | 'seasonStartDay'>,
  nowMs: number,
): number {
  const ends = seasonBounds(seasonId, game.seasonTimeZone, game.seasonStartDay).endsAt
  return Math.max(0, Math.ceil((ends.getTime() - nowMs) / 86_400_000))
}

/** "03 OCT": día y mes corto en el idioma, en mayúsculas y sin el punto de abreviatura. */
export function shortDate(iso: string, locale: string, timeZone: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso)
  const parts = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    timeZone: iso.length === 10 ? 'UTC' : timeZone,
  }).formatToParts(date)
  const day = parts.find(p => p.type === 'day')?.value ?? ''
  const month = (parts.find(p => p.type === 'month')?.value ?? '').replace(/\.$/, '')
  return `${day} ${month}`.toLocaleUpperCase(locale)
}

/** Fila del historial del banco: fecha, movimiento y deuda tras él. */
export interface BankRow {
  date: string
  label: string
  amount: string
  debtAfter: string
}

export function bankRow(entry: BankEntry, tr: Translator, timeZone: string): BankRow {
  if (entry.kind === 'loan') {
    return {
      date: shortDate(entry.at, tr.locale, timeZone),
      label: tr.t('bank.loanRow'),
      amount: tr.signed(entry.amount),
      debtAfter: tr.n(entry.debtAfter),
    }
  }
  return {
    date: shortDate(entry.day, tr.locale, timeZone),
    label: tr.t('bank.interestRow', { n: tr.n(entry.spins) }),
    amount: tr.signed(entry.amount),
    debtAfter: tr.n(entry.debtAfter),
  }
}

/** Con qué se juegan las tiradas pendientes: el boleto, la última apuesta o la de por defecto. */
export interface PendingPlay {
  source: 'slip' | 'repeat' | 'default' | 'none'
  bets: readonly Bet[]
  cost: number
}

/**
 * Lo mismo que decide `chooseRoundBets` en el servidor, visto desde la ventana: si hay fichas en
 * el boleto, esas (ya están pagadas); si no, la última apuesta si llega el saldo; si nunca apostó,
 * la de por defecto (que no es pública: entonces no hay apuestas que enseñar).
 */
export function pendingPlay(
  slip: Slip,
  lastBets: readonly Bet[] | null,
  balance: number,
): PendingPlay {
  if (slip.total > 0) return { source: 'slip', bets: slip.bets, cost: slip.total }
  if (lastBets && lastBets.length > 0) {
    const cost = lastBets.reduce((s, b) => s + b.amount, 0)
    if (cost > balance) return { source: 'none', bets: [], cost: 0 }
    return { source: 'repeat', bets: lastBets, cost }
  }
  return { source: 'default', bets: [], cost: 0 }
}

// ------------------------------------------------------------------ gráfica del patrimonio

export interface ChartBox {
  x: number
  y: number
  w: number
  h: number
}

export interface ChartPoint {
  spin: number
  value: number
  x: number
  y: number
}

export interface ChartGeometry {
  points: ChartPoint[]
  /** Fila del cero (siempre dentro del área). */
  zeroY: number
  lo: number
  hi: number
  /** Columna de cada préstamo (▼). */
  loans: number[]
}

/**
 * Escala la serie del patrimonio al área de la gráfica: el eje vertical va como mínimo de −`minHalf`
 * a +`minHalf` (siempre se ve el cero, la línea de la ruina) y se abre para que quepan el máximo y
 * el mínimo reales de la temporada; el horizontal va de la tirada 0 a la última.
 */
export function chartGeometry(
  stats: Pick<SeasonStats, 'series' | 'peakNetWorth' | 'lowestNetWorth' | 'loanMarks'>,
  box: ChartBox,
  minHalf: number,
): ChartGeometry {
  const series = [...stats.series].sort((a, b) => a.spin - b.spin)
  const values = series.map(p => p.netWorth)
  const lo = Math.min(-minHalf, stats.lowestNetWorth, ...values)
  const hi = Math.max(minHalf, stats.peakNetWorth, ...values)
  const lastSpin = series.length > 0 ? series[series.length - 1]!.spin : 0
  const xOf = (spin: number) =>
    box.x + (lastSpin > 0 ? Math.round((spin / lastSpin) * (box.w - 1)) : 0)
  const yOf = (value: number) => box.y + Math.round(((hi - value) / (hi - lo)) * (box.h - 1))
  return {
    points: series.map(p => ({
      spin: p.spin,
      value: p.netWorth,
      x: xOf(p.spin),
      y: yOf(p.netWorth),
    })),
    zeroY: yOf(0),
    lo,
    hi,
    loans: stats.loanMarks.filter(s => s <= lastSpin).map(xOf),
  }
}

/** Fila de la línea en la columna `x` (en escalón: vale el último punto a su izquierda). */
export function stepYAt(points: readonly ChartPoint[], x: number): number | null {
  let y: number | null = null
  for (const p of points) {
    if (p.x > x) break
    y = p.y
  }
  return y
}
