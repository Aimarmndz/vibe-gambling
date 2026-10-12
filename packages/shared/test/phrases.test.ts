// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { fillTemplate, phraseCatalogSchema, pickPhrase } from '../src/i18n/index.ts'
import type { PhraseCatalog } from '../src/i18n/index.ts'

/** Frases de un idioma tal y como están en `locales/` (la paridad la prueba locales.test.ts). */
function phrases(locale: string): PhraseCatalog {
  const path = new URL(`../../../locales/${locale}/phrases.json`, import.meta.url)
  return phraseCatalogSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

const EN = phrases('en')
const ES = phrases('es')

describe('frases', () => {
  it('no repite la frase anterior', () => {
    let previous: string | null = null
    for (let i = 0; i < 200; i++) {
      const next = pickPhrase(ES, 'lose', previous)
      expect(next).not.toBe(previous)
      previous = next
    }
  })

  it('con una sola frase la repite sin bucles infinitos y respeta el azar inyectado', () => {
    const catalog = { ...EN, noBet: ['only one'] }
    expect(pickPhrase(catalog, 'noBet', 'only one')).toBe('only one')
    expect(pickPhrase(EN, 'win', null, () => 0)).toBe(EN.win[0])
    expect(pickPhrase(EN, 'win', null, () => 0.999999)).toBe(EN.win.at(-1))
    expect(() => pickPhrase({ ...EN, win: [] }, 'win', null)).toThrow()
  })

  it('rellena plantillas', () => {
    expect(fillTemplate('{count} {color}, {pick}!', { count: 7, color: 'rojos' })).toBe(
      '7 rojos, {pick}!',
    )
  })
})
