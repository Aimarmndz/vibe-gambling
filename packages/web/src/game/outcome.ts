// SPDX-License-Identifier: AGPL-3.0-or-later
// Qué se cuenta en la pantalla de resultado: veredicto, frase de ludópata y avisos extra.
// Las frases son las del idioma (locales/<idioma>/phrases.json) y nunca se repite la anterior de
// cada categoría.
import { colorOf, gamblersFallacyPick } from '@vibe-gambling/shared'
import type { PocketColor, PublicGameConfig, ResolvedRound, Wallet } from '@vibe-gambling/shared'
import { fillTemplate, pickPhrase } from '@vibe-gambling/shared/i18n'
import type { PhraseCategory } from '@vibe-gambling/shared/i18n'

import type { Translator } from '../i18n/index.ts'

export type Verdict = 'win' | 'lose' | 'even' | 'noBet'

export interface OutcomeView {
  number: number
  color: PocketColor
  verdict: Verdict
  net: number
  /** Frase principal. */
  phrase: string
  /** Líneas extra (racha de color, tests fallidos, apuesta automática, ruina…). */
  extras: string[]
  /** Pago doble por `git push`. */
  jackpot: boolean
  interest: number
}

/** Recuerda la última frase de cada categoría para no repetirla seguida. */
export class PhraseMemory {
  private readonly last = new Map<PhraseCategory, string>()

  pick(
    tr: Translator,
    category: PhraseCategory,
    vars: Record<string, string | number>,
    random: () => number,
  ): string {
    const phrase = pickPhrase(tr.phrases, category, this.last.get(category) ?? null, random)
    this.last.set(category, phrase)
    return fillTemplate(phrase, vars)
  }
}

/** Elige la categoría de la frase principal. */
export function mainCategory(
  round: ResolvedRound,
  wallet: Wallet,
  minChip: number,
): PhraseCategory {
  if (round.source === 'none') return wallet.balance < minChip ? 'broke' : 'noBet'
  if (round.net > 0) {
    const straightWin = round.bets.some(b => b.won && b.selection.kind === 'straight')
    return straightWin ? 'bigWin' : 'win'
  }
  if (round.net === 0) return 'win'
  if (round.result === 0) return 'zero'
  const before = wallet.balance - round.net
  return -round.net * 2 >= before ? 'bigLoss' : 'lose'
}

export function describeOutcome(args: {
  round: ResolvedRound
  wallet: Wallet
  game: PublicGameConfig
  tr: Translator
  memory: PhraseMemory
  random?: () => number
}): OutcomeView {
  const { round, wallet, game, tr, memory } = args
  const random = args.random ?? Math.random
  const minChip = Math.min(...game.chips)
  const color = colorOf(round.result)
  const one = tr.t(`color.${color}.one`)
  const vars = {
    multiplier: game.jackpot.gitPushMultiplier,
    color: one,
    apr: tr.n(game.loan.displayApr),
  }
  const verdict: Verdict =
    round.source === 'none' ? 'noBet' : round.net > 0 ? 'win' : round.net < 0 ? 'lose' : 'even'
  const phrase = memory.pick(tr, mainCategory(round, wallet, minChip), vars, random)

  const extras: string[] = []
  if (round.jackpot) extras.push(memory.pick(tr, 'jackpot', vars, random))
  if (round.testFailed) extras.push(memory.pick(tr, 'testFailed', vars, random))
  if (round.source === 'repeat') extras.push(memory.pick(tr, 'autoRepeat', vars, random))
  if (round.source === 'default') extras.push(memory.pick(tr, 'autoDefault', vars, random))
  const streak = round.colorStreak
  if (streak && streak.count >= game.colorWarningAt) {
    const pick = gamblersFallacyPick(streak)
    extras.push(
      memory.pick(
        tr,
        'streakWarning',
        {
          count: streak.count,
          color: tr.t(`color.${streak.color}.lower`),
          pick: tr.t(`color.${pick}.pick`),
        },
        random,
      ),
    )
  }
  if (round.source !== 'none' && wallet.balance < minChip) {
    extras.push(memory.pick(tr, 'broke', vars, random))
  }
  return {
    number: round.result,
    color,
    verdict,
    net: round.net,
    phrase,
    extras: extras.slice(0, 3),
    jackpot: round.jackpot,
    interest: round.interestCharged,
  }
}
