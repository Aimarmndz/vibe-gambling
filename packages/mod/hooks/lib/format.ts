// SPDX-License-Identifier: AGPL-3.0-or-later
// Lo que el mod enseña: la status line con el saldo y el toast con el resultado. Módulo puro.
import { PHRASE_CATEGORIES, fillTemplate, pickPhrase } from '../generated/phrases.ts'
import type { PhraseCatalog, PhraseCategory } from '../generated/phrases.ts'
import { LOCALE_INFO, PHRASES } from '../generated/locales.ts'
import type { Locale } from '../generated/protocol.ts'
import { effectsOf } from './items.ts'
import type { ItemEffectView } from './items.ts'
import type { Messages } from './messages.ts'
import type { PocketColor, ResolvedRoundView, WalletView } from './responses.ts'

export { PHRASES }

const COLOR_EMOJI: Readonly<Record<PocketColor, string>> = { red: '🔴', black: '⚫', green: '🟢' }

/**
 * Formatea monedas con el separador de miles del idioma (`1,234` / `1.234` / `1 234`) y signo
 * menos tipográfico.
 */
export function formatCoins(amount: number, locale: Locale, signed = false): string {
  const digits = Math.abs(Math.trunc(amount)).toString()
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, LOCALE_INFO[locale].groupSeparator)
  if (amount < 0) return `−${grouped}`
  return signed && amount > 0 ? `+${grouped}` : grouped
}

/** Status line: saldo y, si hay, deuda, tiradas pendientes y glifos de los objetos armados. */
export function statusText(
  wallet: WalletView,
  locale: Locale,
  messages: Messages,
  armed = '',
): string {
  const parts = [`🎰 ${formatCoins(wallet.balance, locale)} ${messages.coin}`]
  if (wallet.debt > 0) parts.push(`${messages.debtLabel} ${formatCoins(wallet.debt, locale)}`)
  const pending = wallet.pendingSpins ?? 0
  if (pending > 0) parts.push(messages.pendingCount(pending, formatCoins(pending, locale)))
  if (armed !== '') parts.push(armed)
  return parts.join(' · ')
}

/** Líneas de los objetos de una ronda para el toast (seguro +X, turbo +X, la IA predijo N…). */
export function effectLines(
  effects: readonly ItemEffectView[],
  locale: Locale,
  messages: Messages,
): string[] {
  const m = messages.shop
  return effects.flatMap(effect => {
    switch (effect.kind) {
      case 'placebo':
        return [m.effectPlacebo]
      case 'prediction':
        return effect.prediction === undefined
          ? []
          : [m.effectPrediction(effect.prediction, effect.hit === true)]
      case 'refund':
        return [m.effectRefund(formatCoins(effect.amount, locale, true))]
      case 'boost':
        return effect.amount > 0
          ? [m.effectBoost(formatCoins(effect.amount, locale, true))]
          : [m.effectBoostMiss]
      case 'shield':
        return [m.effectShield]
      case 'revert':
        return []
    }
  })
}

/**
 * Toast de un turno que terminó sin ventana visible: la tirada se ha guardado como pendiente o,
 * si ya estaba en el tope, se ha descartado con una frase de broma.
 */
export function queuedToast(
  dropped: boolean,
  wallet: WalletView,
  locale: Locale,
  messages: Messages,
  previousPhrase: string | null,
  random: () => number = Math.random,
): ResultToast {
  const pending = wallet.pendingSpins ?? 0
  const count = formatCoins(pending, locale)
  if (!dropped) return { text: messages.spinSaved(pending, count), phrase: null }
  // En el tope, el contador es justo el tope: con él se rellena el {max} de las frases.
  const phrase = pickFilledPhrase(
    PHRASES[locale],
    'pendingDropped',
    { max: count },
    previousPhrase,
    random,
  )
  const parts = [messages.spinDropped(pending, count)]
  if (phrase !== null) parts.push(`“${phrase.text}”`)
  return { text: parts.join(' · '), phrase: phrase?.template ?? null }
}

/**
 * Toast del tope diario: la mesa cierra hasta `reopensAt` y una frase de la batería `dailyLimit`
 * (sin repetir la anterior; el {limit} se rellena con el tope que manda el servidor).
 */
export function dailyLimitToast(
  limit: number,
  reopensAt: string,
  locale: Locale,
  messages: Messages,
  previousPhrase: string | null,
  random: () => number = Math.random,
): ResultToast {
  const phrase = pickFilledPhrase(
    PHRASES[locale],
    'dailyLimit',
    { limit: formatCoins(limit, locale) },
    previousPhrase,
    random,
  )
  const parts = [messages.dailyLimit(reopensAt)]
  if (phrase !== null) parts.push(`“${phrase.text}”`)
  return { text: parts.join(' · '), phrase: phrase?.template ?? null }
}

/** Categoría de frase para una ronda resuelta. */
export function phraseCategory(
  round: ResolvedRoundView,
  wallet: WalletView,
): PhraseCategory | null {
  if (round.source === 'none') return 'noBet'
  if (round.jackpot) return 'jackpot'
  if (round.testFailed && round.net <= 0) return 'testFailed'
  if (round.net > 0) {
    return round.bets.some(bet => bet.won && bet.selection.kind === 'straight') ? 'bigWin' : 'win'
  }
  if (round.net === 0) return null
  if (round.result === 0) return 'zero'
  if (wallet.balance === 0) return wallet.netWorth < 0 ? 'broke' : 'bigLoss'
  return 'lose'
}

/** Marcadores `{x}` de una plantilla. */
function markersOf(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]!)
}

/**
 * Elige una frase sin repetir la anterior, descartando las plantillas cuyos marcadores no se
 * pueden rellenar con lo que sabe el mod (p. ej. `{apr}` o `{multiplier}`, que no vienen en la
 * respuesta del turno).
 */
export function pickFilledPhrase(
  catalog: PhraseCatalog,
  category: PhraseCategory,
  values: Readonly<Record<string, string | number>>,
  previous: string | null,
  random: () => number = Math.random,
): { readonly template: string; readonly text: string } | null {
  const fillable = catalog[category].filter(template =>
    markersOf(template).every(marker => marker in values),
  )
  if (fillable.length === 0) return null
  const subset = Object.fromEntries(
    PHRASE_CATEGORIES.map(name => [name, name === category ? fillable : catalog[name]]),
  ) as Record<PhraseCategory, readonly string[]>
  const template = pickPhrase(subset, category, previous, random)
  return { template, text: fillTemplate(template, values) }
}

export interface ResultToast {
  readonly text: string
  /** Plantilla elegida, para no repetirla en la siguiente tirada. */
  readonly phrase: string | null
}

/** Texto del toast de una ronda resuelta: número, color, ganancia o pérdida y frase. */
export function resultToast(
  round: ResolvedRoundView,
  wallet: WalletView,
  locale: Locale,
  messages: Messages,
  previousPhrase: string | null,
  random: () => number = Math.random,
): ResultToast {
  const color = `${COLOR_EMOJI[round.color]} ${messages.colors[round.color]}`
  const parts = [`🎰 ${round.result} ${color}`]
  if (round.staked > 0 || round.net !== 0) {
    parts.push(`${formatCoins(round.net, locale, true)} ${messages.coin}`)
  }
  if (round.jackpot) parts.push(messages.jackpotTag)
  parts.push(...effectLines(effectsOf(round), locale, messages))
  const category = phraseCategory(round, wallet)
  const phrase =
    category === null
      ? null
      : pickFilledPhrase(
          PHRASES[locale],
          category,
          { color: messages.colors[round.color] },
          previousPhrase,
          random,
        )
  if (phrase !== null) parts.push(`“${phrase.text}”`)
  return { text: parts.join(' · '), phrase: phrase?.template ?? null }
}
