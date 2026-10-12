// SPDX-License-Identifier: AGPL-3.0-or-later
// Traducciones de todos los idiomas ya cargadas para los tests (en la web se cargan bajo demanda).
import type { Locale } from '@vibe-gambling/shared'
import { LOCALES } from '@vibe-gambling/shared/i18n'

import { loadCatalog, loadTranslator } from '../src/i18n/index.ts'
import type { Messages, Translator } from '../src/i18n/index.ts'

const loaded = await Promise.all(
  LOCALES.map(
    async locale => [locale, await loadTranslator(locale), await loadCatalog(locale)] as const,
  ),
)

/** Traducción de un idioma (síncrona: ya está cargada). */
export function translator(locale: Locale): Translator {
  return loaded.find(([l]) => l === locale)![1]
}

/** Textos de la web (juego, landing y /privacy) de cada idioma. */
export const CATALOGS: Readonly<Record<Locale, Messages>> = Object.fromEntries(
  loaded.map(([locale, , catalog]) => [locale, catalog.texts as Messages]),
) as Record<Locale, Messages>
