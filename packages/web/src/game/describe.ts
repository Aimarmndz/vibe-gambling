// SPDX-License-Identifier: AGPL-3.0-or-later
// Nombres legibles de las apuestas y de las fichas, en el idioma de la ventana.
import { PAYOUTS } from '@vibe-gambling/shared'
import type { BetSelection } from '@vibe-gambling/shared'

import type { Translator } from '../i18n/index.ts'

/** "PLENO 17", "CABALLO 17-20", "DOCENA 2", "ROJO"… */
export function describeSelection(sel: BetSelection, tr: Translator): string {
  if ('numbers' in sel) {
    return tr.t(`bet.${sel.kind}`, { numbers: sel.numbers.join('-') })
  }
  if ('index' in sel) return tr.t(`bet.${sel.kind}`, { index: sel.index })
  return tr.t(`bet.${sel.kind}`)
}

/** "PAGA 35 A 1". */
export function describePayout(sel: BetSelection, tr: Translator): string {
  return tr.t('bet.payout', { payout: PAYOUTS[sel.kind] })
}

/** Etiqueta corta de una ficha: 10, 50, 1K, 2.5K, 1M… */
export function chipLabel(value: number): string {
  const short = (v: number, unit: string) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`
  if (value >= 1_000_000) return short(value / 1_000_000, 'M')
  if (value >= 1000) return short(value / 1000, 'K')
  return String(value)
}
