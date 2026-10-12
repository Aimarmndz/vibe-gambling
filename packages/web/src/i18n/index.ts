// SPDX-License-Identifier: AGPL-3.0-or-later
// i18n de la web: inglés por defecto, español si el navegador lo pide, cambiable en Ajustes.
import type { Locale } from '@vibe-gambling/shared'
import { fillTemplate } from '@vibe-gambling/shared/i18n'

import { en } from './en.ts'
import type { MessageKey, Messages } from './en.ts'
import { es } from './es.ts'

export type { MessageKey }

export const CATALOGS: Readonly<Record<Locale, Messages>> = Object.freeze({ en, es })

/** Idioma a partir de las preferencias del navegador: español si alguna empieza por "es". */
export function detectLocale(languages: readonly string[]): Locale {
  for (const lang of languages) {
    const base = lang.toLowerCase().split('-')[0]
    if (base === 'es') return 'es'
    if (base === 'en') return 'en'
  }
  return 'en'
}

type Vars = Readonly<Record<string, string | number>>

export interface Translator {
  readonly locale: Locale
  t(key: MessageKey, vars?: Vars): string
  /** Número con separadores de miles del idioma (siempre entero). */
  n(value: number): string
  /** Número con signo explícito (+1.000 / −1.000). */
  signed(value: number): string
}

export function createTranslator(locale: Locale): Translator {
  const catalog = CATALOGS[locale]
  const fmt = new Intl.NumberFormat(locale === 'es' ? 'es-ES' : 'en-US', {
    maximumFractionDigits: 0,
    // En español los números de cuatro cifras también llevan separador, como en el tapete.
    useGrouping: 'always',
  })
  return {
    locale,
    t: (key, vars) => (vars ? fillTemplate(catalog[key], vars) : catalog[key]),
    n: value => fmt.format(value),
    signed: value => (value > 0 ? `+${fmt.format(value)}` : fmt.format(value)),
  }
}
