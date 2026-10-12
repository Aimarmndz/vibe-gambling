// SPDX-License-Identifier: AGPL-3.0-or-later
import { PHRASE_CATEGORIES, PHRASES } from '@vibe-gambling/shared/i18n'
import { describe, expect, it } from 'vitest'

import { hasGlyph } from '../src/font/bitmap.ts'
import { en } from '../src/i18n/en.ts'
import { es } from '../src/i18n/es.ts'
import { CATALOGS, createTranslator, detectLocale } from '../src/i18n/index.ts'

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

describe('i18n', () => {
  it('inglés y español tienen exactamente las mismas claves', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
  })

  it('ningún texto está vacío y los marcadores coinciden entre idiomas', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(en[key].trim(), key).not.toBe('')
      expect(es[key].trim(), key).not.toBe('')
      expect(placeholders(es[key]), key).toEqual(placeholders(en[key]))
    }
  })

  it('todos los caracteres de la interfaz existen en la fuente bitmap', () => {
    for (const catalog of Object.values(CATALOGS)) {
      for (const [key, text] of Object.entries(catalog)) {
        const missing = [...text.replace(/\{\w+\}/g, '')].filter(ch => !hasGlyph(ch) && ch !== '\n')
        expect(missing, key).toEqual([])
      }
    }
  })

  it('las frases de humor de shared tienen al menos 40 por idioma', () => {
    for (const catalog of Object.values(PHRASES)) {
      const total = PHRASE_CATEGORIES.reduce((n, c) => n + catalog[c].length, 0)
      expect(total).toBeGreaterThanOrEqual(40)
    }
  })

  it('elige el idioma del navegador: español si lo pide, inglés por defecto', () => {
    expect(detectLocale(['es-ES', 'en'])).toBe('es')
    expect(detectLocale(['fr-FR', 'es'])).toBe('es')
    expect(detectLocale(['en-GB', 'es'])).toBe('en')
    expect(detectLocale(['de-DE'])).toBe('en')
    expect(detectLocale([])).toBe('en')
  })

  it('traduce, rellena marcadores y formatea números', () => {
    const tr = createTranslator('es')
    expect(tr.t('status.thinking')).toBe('CLAUDE ESTÁ PENSANDO…')
    expect(tr.t('loan.granted', { amount: tr.n(1000) })).toBe(
      '+1.000 monedas. La deuda es problema de tu yo del futuro.',
    )
    expect(tr.signed(25)).toBe('+25')
    expect(tr.signed(-1500)).toBe('-1.500')
    expect(tr.signed(0)).toBe('0')
    const enTr = createTranslator('en')
    expect(enTr.t('status.thinking')).toBe('CLAUDE IS THINKING…')
    expect(enTr.n(1234567)).toBe('1,234,567')
  })
})
