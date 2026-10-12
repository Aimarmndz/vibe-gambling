// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Locale } from '../protocol/common.ts'
import { phrasesEn } from './phrases.en.ts'
import { phrasesEs } from './phrases.es.ts'
import type { PhraseCatalog } from './phrases.ts'

export * from './phrases.ts'
export { phrasesEn, phrasesEs }

export const PHRASES: Readonly<Record<Locale, PhraseCatalog>> = Object.freeze({
  en: phrasesEn,
  es: phrasesEs,
})
