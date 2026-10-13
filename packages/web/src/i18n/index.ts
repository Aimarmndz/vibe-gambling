// SPDX-License-Identifier: AGPL-3.0-or-later
// i18n de la web. Los textos viven en `locales/<idioma>/` (raíz del repo) y se descubren solos:
// los metadatos y las banderas de todos los idiomas van en el bundle (son diminutos y hacen falta
// para los selectores), y los textos y las frases de cada idioma se cargan bajo demanda, cada
// idioma en su propio chunk (ver `vite.config.ts`). Añadir un idioma: locales/README.md.
import type { Locale } from '@vibe-gambling/shared'
import {
  LOCALES,
  REFERENCE_LOCALE,
  fillTemplate,
  flagSchema,
  localeMetaSchema,
  phraseCatalogSchema,
} from '@vibe-gambling/shared/i18n'
import type { Flag, LocaleMeta, PhraseCatalog } from '@vibe-gambling/shared/i18n'

import type enLanding from '../../../../locales/en/landing.json'
import type enPrivacy from '../../../../locales/en/privacy.json'
import type enWeb from '../../../../locales/en/web.json'

/** Claves de los textos de la web: las del idioma de referencia (el inglés). */
export type MessageKey = keyof typeof enWeb | keyof typeof enLanding | keyof typeof enPrivacy
export type Messages = Readonly<Record<MessageKey, string>>

/** Un idioma disponible: sus metadatos y su bandera. */
export interface Language {
  readonly code: Locale
  readonly meta: LocaleMeta
  readonly flag: Flag
}

const metaFiles = import.meta.glob<unknown>('../../../../locales/*/meta.json', {
  eager: true,
  import: 'default',
})
const flagFiles = import.meta.glob<unknown>('../../../../locales/*/flag.json', {
  eager: true,
  import: 'default',
})
/** Textos de la ventana del juego, la landing y /privacy (se juntan en un solo catálogo). */
const textLoaders = import.meta.glob<Record<string, string>>(
  '../../../../locales/*/{web,landing,privacy}.json',
  { import: 'default' },
)
const phraseLoaders = import.meta.glob<unknown>('../../../../locales/*/phrases.json', {
  import: 'default',
})

function folderOf(path: string): string {
  return /locales\/([^/]+)\/[^/]+\.json$/.exec(path)?.[1] ?? ''
}

function isLocale(code: string): code is Locale {
  return (LOCALES as readonly string[]).includes(code)
}

/**
 * Idiomas disponibles, en el orden de los selectores. Solo los que están en el registro del
 * protocolo (`pnpm gen:locales`): uno que el servidor no aceptaría no se ofrece.
 */
export const LANGUAGES: readonly Language[] = Object.freeze(
  Object.entries(metaFiles)
    .flatMap(([path, raw]): Language[] => {
      const code = folderOf(path)
      if (!isLocale(code)) {
        console.warn(`[i18n] locales/${code} no está registrado: ejecuta pnpm gen:locales`)
        return []
      }
      const flagPath = path.replace(/meta\.json$/, 'flag.json')
      return [
        {
          code,
          meta: localeMetaSchema.parse(raw),
          flag: flagSchema.parse(flagFiles[flagPath]),
        },
      ]
    })
    .sort((a, b) => a.meta.order - b.meta.order),
)

export function languageOf(locale: Locale): Language {
  return LANGUAGES.find(l => l.code === locale) ?? LANGUAGES.find(l => l.code === REFERENCE_LOCALE)!
}

/**
 * Idioma a partir de las preferencias del navegador (`navigator.languages`): el primero que esté
 * disponible, con región (`pt-BR`) o sin ella (`fr-CA` → `fr`). Si ninguno, el de referencia.
 */
export function detectLocale(languages: readonly string[]): Locale {
  const available = LANGUAGES.map(l => l.code)
  for (const tag of languages) {
    const lower = tag.toLowerCase()
    const exact = available.find(code => code.toLowerCase() === lower)
    if (exact) return exact
    const base = available.find(code => code.toLowerCase() === lower.split('-')[0])
    if (base) return base
  }
  return REFERENCE_LOCALE as Locale
}

/** Siguiente o anterior idioma de la lista (en círculo), para los selectores con ←→. */
export function cycleLocale(locale: Locale, dir: number): Locale {
  const i = LANGUAGES.findIndex(l => l.code === locale)
  const n = LANGUAGES.length
  return LANGUAGES[(((i + dir) % n) + n) % n]!.code
}

type Vars = Readonly<Record<string, string | number>>

/** Textos y frases de un idioma ya cargados. */
export interface Catalog {
  readonly texts: Readonly<Record<string, string>>
  readonly phrases: PhraseCatalog
}

export interface Translator {
  readonly locale: Locale
  readonly meta: LocaleMeta
  /** Frases de ludópata de este idioma. */
  readonly phrases: PhraseCatalog
  t(key: MessageKey, vars?: Vars): string
  /**
   * Como `t`, pero con la forma de singular (`<clave>.one`, si el idioma la tiene) cuando `count`
   * es "uno" según las reglas del idioma (`Intl.PluralRules`: en francés también el 0).
   */
  plural(key: MessageKey, count: number, vars?: Vars): string
  /** ¿Existe esta clave? (para claves que llegan de fuera, como los códigos de error). */
  has(key: string): key is MessageKey
  /** Número entero con el separador de miles del idioma (también en las de cuatro cifras). */
  n(value: number): string
  /** Número con signo explícito (+1.000 / -1.000). */
  signed(value: number): string
}

/** Entero con separador de miles: como el tapete, siempre agrupado y sin decimales. */
export function groupDigits(value: number, separator: string): string {
  const rounded = Math.round(Math.abs(value))
  const digits = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, separator)
  return value < 0 && rounded !== 0 ? `-${digits}` : digits
}

export function createTranslator(locale: Locale, catalog: Catalog): Translator {
  const { meta } = languageOf(locale)
  const texts = catalog.texts
  const n = (value: number) => groupDigits(value, meta.groupSeparator)
  const rules = new Intl.PluralRules(meta.bcp47)
  const t = (key: string, vars?: Vars) => {
    const text = texts[key] ?? key
    return vars ? fillTemplate(text, vars) : text
  }
  return {
    locale,
    meta,
    phrases: catalog.phrases,
    t,
    plural: (key, count, vars) => {
      const one = `${key}.one`
      return t(rules.select(count) === 'one' && one in texts ? one : key, vars)
    },
    has: (key): key is MessageKey => key in texts,
    n,
    signed: value => (value > 0 ? `+${n(value)}` : n(value)),
  }
}

const cache = new Map<Locale, Promise<Catalog>>()

function loadersFor(locale: Locale) {
  const texts = Object.entries(textLoaders).filter(([path]) => folderOf(path) === locale)
  const phrases = Object.entries(phraseLoaders).find(([path]) => folderOf(path) === locale)
  if (texts.length === 0 || !phrases) throw new Error(`[i18n] no hay textos para ${locale}`)
  return { texts: texts.map(([, load]) => load), phrases: phrases[1] }
}

/** Carga (una sola vez) los textos y las frases de un idioma. */
export function loadCatalog(locale: Locale): Promise<Catalog> {
  let pending = cache.get(locale)
  if (!pending) {
    const loaders = loadersFor(locale)
    pending = Promise.all([Promise.all(loaders.texts.map(load => load())), loaders.phrases()]).then(
      ([parts, phrases]) => ({
        texts: Object.freeze(Object.assign({}, ...parts) as Record<string, string>),
        phrases: phraseCatalogSchema.parse(phrases),
      }),
    )
    // Si falla (red caída), que el siguiente intento vuelva a pedirlo.
    pending.catch(() => cache.delete(locale))
    cache.set(locale, pending)
  }
  return pending
}

export async function loadTranslator(locale: Locale): Promise<Translator> {
  return createTranslator(locale, await loadCatalog(locale))
}

/** `lang` y `dir` del documento según el idioma. */
export function applyDocumentLanguage(tr: Translator, doc: Document = document): void {
  doc.documentElement.lang = tr.locale
  doc.documentElement.dir = tr.meta.dir
}
