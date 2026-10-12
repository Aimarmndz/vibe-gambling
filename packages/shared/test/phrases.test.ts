// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import { fillTemplate, PHRASE_CATEGORIES, PHRASES, pickPhrase } from '../src/i18n/index.ts'

describe('frases', () => {
  it('hay al menos 40 frases por idioma y todas las categorías tienen alguna', () => {
    for (const locale of ['en', 'es'] as const) {
      const catalog = PHRASES[locale]
      const total = PHRASE_CATEGORIES.reduce((acc, c) => acc + catalog[c].length, 0)
      expect(total, locale).toBeGreaterThanOrEqual(40)
      for (const c of PHRASE_CATEGORIES)
        expect(catalog[c].length, `${locale}.${c}`).toBeGreaterThan(0)
    }
  })

  it('los dos idiomas usan los mismos marcadores en cada categoría', () => {
    const markers = (list: readonly string[]): string[] =>
      [...new Set(list.join(' ').match(/\{\w+\}/g) ?? [])].sort()
    for (const c of PHRASE_CATEGORIES) {
      expect(markers(PHRASES.es[c]), c).toEqual(markers(PHRASES.en[c]))
    }
  })

  it('no repite la frase anterior', () => {
    let previous: string | null = null
    for (let i = 0; i < 200; i++) {
      const next = pickPhrase(PHRASES.es, 'lose', previous)
      expect(next).not.toBe(previous)
      previous = next
    }
  })

  it('con una sola frase la repite sin bucles infinitos y respeta el azar inyectado', () => {
    const catalog = { ...PHRASES.en, noBet: ['only one'] }
    expect(pickPhrase(catalog, 'noBet', 'only one')).toBe('only one')
    expect(pickPhrase(PHRASES.en, 'win', null, () => 0)).toBe(PHRASES.en.win[0])
    expect(pickPhrase(PHRASES.en, 'win', null, () => 0.999999)).toBe(PHRASES.en.win.at(-1))
    expect(() => pickPhrase({ ...PHRASES.en, win: [] }, 'win', null)).toThrow()
  })

  it('rellena plantillas', () => {
    expect(fillTemplate('{count} {color}, {pick}!', { count: 7, color: 'rojos' })).toBe(
      '7 rojos, {pick}!',
    )
  })
})
