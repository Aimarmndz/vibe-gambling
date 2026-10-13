// SPDX-License-Identifier: AGPL-3.0-or-later
// GENERADO por scripts/sync-mod-shared.ts a partir de packages/shared/src/i18n/phrases.ts. No lo edites a mano.
// Catálogo de frases de humor y selección sin repetir la anterior.

export const PHRASE_CATEGORIES = [
  'win',
  'lose',
  'zero',
  'bigWin',
  'bigLoss',
  'jackpot',
  'testFailed',
  'autoDefault',
  'autoRepeat',
  'noBet',
  'streakWarning',
  'broke',
  'pendingDropped',
  'dailyLimit',
] as const
export type PhraseCategory = (typeof PHRASE_CATEGORIES)[number]
export type PhraseCatalog = Readonly<Record<PhraseCategory, readonly string[]>>

/**
 * Elige una frase de la categoría sin repetir la última que se dijo.
 * `random` devuelve un número en [0, 1) (inyectable para los tests).
 */
export function pickPhrase(
  catalog: PhraseCatalog,
  category: PhraseCategory,
  previous: string | null,
  random: () => number = Math.random,
): string {
  const list = catalog[category]
  if (list.length === 0) throw new Error(`no hay frases para ${category}`)
  const candidates = list.length > 1 ? list.filter(p => p !== previous) : list
  const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
  return candidates[index] ?? list[0]!
}

/** Rellena los {marcadores} de una plantilla. Los que falten se dejan tal cual. */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  )
}
