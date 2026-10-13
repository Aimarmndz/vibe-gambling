// SPDX-License-Identifier: AGPL-3.0-or-later
// i18n de la web: registro descubierto con import.meta.glob, carga bajo demanda, detección del
// idioma del navegador, formato de números y que todo se pueda pintar con la fuente bitmap.
// (La paridad de claves y marcadores de todos los idiomas está en shared/test/locales.test.ts.)
import { readFileSync } from 'node:fs'

import { ACHIEVEMENT_IDS, achievementParams, gameConfigSchema } from '@vibe-gambling/shared'
import { LOCALES, REFERENCE_LOCALE, placeholdersOf } from '@vibe-gambling/shared/i18n'
import { describe, expect, it, vi } from 'vitest'

import { hasGlyph } from '../src/font/bitmap.ts'
import {
  LANGUAGES,
  createTranslator,
  cycleLocale,
  detectLocale,
  groupDigits,
  languageOf,
  loadCatalog,
  loadTranslator,
} from '../src/i18n/index.ts'
import { CATALOGS, translator } from './translators.ts'

describe('registro de idiomas', () => {
  it('descubre todas las carpetas de locales/ registradas, en su orden', () => {
    expect(LANGUAGES.map(l => l.code)).toEqual([...LOCALES])
    expect(LANGUAGES.map(l => l.code)).toEqual(expect.arrayContaining(['en', 'es', 'fr', 'de']))
    for (const language of LANGUAGES) {
      expect(language.meta.code).toBe(language.code)
      expect(language.flag.pixels.length).toBe(language.flag.height)
    }
    expect(languageOf('fr').meta.nativeName).toBe('Français')
    expect(languageOf('de').meta.nativeName).toBe('Deutsch')
  })

  it('cada idioma carga juego, landing y /privacy en un solo catálogo, una vez', async () => {
    for (const locale of LOCALES) {
      const catalog = await loadCatalog(locale)
      expect(catalog.texts['menu.title']).toBeTruthy()
      expect(catalog.texts['landing.headline1']).toBeTruthy()
      expect(catalog.texts['privacy.title']).toBeTruthy()
      expect(catalog.phrases.win.length).toBeGreaterThan(0)
      expect(await loadCatalog(locale)).toBe(catalog)
    }
  })

  it('las claves de los tres archivos no se pisan', async () => {
    const en = await loadCatalog('en')
    const total = Object.keys(en.texts).length
    const files = import.meta.glob<Record<string, string>>('../../../locales/en/*.json', {
      eager: true,
      import: 'default',
    })
    const sum = ['web', 'landing', 'privacy']
      .map(f => Object.keys(files[`../../../locales/en/${f}.json`]!).length)
      .reduce((a, b) => a + b, 0)
    expect(total).toBe(sum)
  })

  it('los selectores dan la vuelta con ←→', () => {
    expect(cycleLocale(LOCALES[0], -1)).toBe(LOCALES.at(-1))
    expect(cycleLocale(LOCALES.at(-1)!, 1)).toBe(LOCALES[0])
    expect(cycleLocale('en', 1)).toBe(LOCALES[1])
  })
})

describe('textos', () => {
  it('todos los caracteres de la interfaz existen en la fuente bitmap, en todos los idiomas', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, text] of Object.entries(catalog)) {
        // La landing y /privacy son HTML (la fuente web cae a otra si falta algo), pero también
        // se comprueban: así se ven igual en todas partes.
        const missing = [...text.replace(/\{\w+\}/g, '')].filter(ch => !hasGlyph(ch) && ch !== '\n')
        expect(missing, `${locale}:${key}`).toEqual([])
      }
    }
  })

  it('el selector de idioma del juego tiene etiqueta en todos los idiomas', () => {
    for (const catalog of Object.values(CATALOGS)) {
      expect(catalog['settings.language'].length).toBeGreaterThan(0)
      expect(catalog['footer.languages'].length).toBeGreaterThan(0)
    }
  })
})

describe('idioma inicial', () => {
  it('el primero del navegador que esté disponible, con o sin región; si no, inglés', () => {
    expect(detectLocale(['es-ES', 'en'])).toBe('es')
    expect(detectLocale(['fr-FR', 'es'])).toBe('fr')
    expect(detectLocale(['fr-CA'])).toBe('fr')
    expect(detectLocale(['de-AT', 'en'])).toBe('de')
    expect(detectLocale(['DE'])).toBe('de')
    expect(detectLocale(['en-GB', 'es'])).toBe('en')
    expect(detectLocale(['xx-XX', 'zz', 'es'])).toBe('es')
    expect(detectLocale(['qq-QQ'])).toBe(REFERENCE_LOCALE)
    expect(detectLocale([])).toBe('en')
  })
})

describe('traducción', () => {
  it('traduce, rellena marcadores y formatea números', () => {
    const tr = translator('es')
    expect(tr.t('status.thinking')).toBe('CLAUDE ESTÁ PENSANDO…')
    expect(tr.t('loan.granted', { amount: tr.n(1000) })).toBe(
      '+1.000 monedas. La deuda es problema de tu yo del futuro.',
    )
    expect(tr.signed(25)).toBe('+25')
    expect(tr.signed(-1500)).toBe('-1.500')
    expect(tr.signed(0)).toBe('0')
    const enTr = translator('en')
    expect(enTr.t('status.thinking')).toBe('CLAUDE IS THINKING…')
    expect(enTr.n(1234567)).toBe('1,234,567')
    expect(translator('fr').n(1234567)).toBe('1 234 567')
    expect(translator('de').n(-98765)).toBe('-98.765')
    expect(translator('de').meta.bcp47).toBe('de-DE')
  })

  it('agrupa cifras con el separador del idioma y sin decimales', () => {
    expect(groupDigits(999, '.')).toBe('999')
    expect(groupDigits(1000, '.')).toBe('1.000')
    expect(groupDigits(-0.4, ',')).toBe('0')
    expect(groupDigits(1234.6, ',')).toBe('1,235')
  })

  it('una clave desconocida se enseña tal cual y `has` lo distingue', () => {
    const tr = createTranslator('en', {
      texts: { 'menu.title': 'MENU' },
      phrases: translator('en').phrases,
    })
    expect(tr.t('menu.title')).toBe('MENU')
    expect(tr.has('menu.title')).toBe(true)
    expect(tr.has('error.nope')).toBe(false)
    expect(tr.t('menu.item.resume')).toBe('menu.item.resume')
  })

  it('cada idioma trae sus frases', async () => {
    const fr = await loadTranslator('fr')
    expect(fr.phrases).not.toBe(translator('en').phrases)
    expect(fr.phrases.win.join(' ')).not.toBe(translator('en').phrases.win.join(' '))
  })

  it('un idioma de la carpeta que no está en el registro no se ofrece', async () => {
    vi.resetModules()
    vi.doMock('@vibe-gambling/shared/i18n', async () => ({
      ...(await vi.importActual<object>('@vibe-gambling/shared/i18n')),
      LOCALES: ['en', 'es'],
    }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fresh = await import('../src/i18n/index.ts')
    expect(fresh.LANGUAGES.map(l => l.code)).toEqual(['en', 'es'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    vi.doUnmock('@vibe-gambling/shared/i18n')
    vi.resetModules()
  })
})

describe('logros', () => {
  it('cada logro tiene título, descripción y pista en todos los idiomas, con marcadores que sí se rellenan', () => {
    const game = gameConfigSchema.parse(
      JSON.parse(
        readFileSync(new URL('../../server/test/fixtures/game.test.json', import.meta.url), 'utf8'),
      ),
    )
    for (const id of ACHIEVEMENT_IDS) {
      const params = Object.keys(achievementParams(id, game))
      for (const [locale, catalog] of Object.entries(CATALOGS)) {
        for (const part of ['title', 'desc', 'hint'] as const) {
          const text = (catalog as Record<string, string>)[`achievements.${id}.${part}`]
          expect(text, `${locale}:${id}.${part}`).toBeTruthy()
          for (const marker of placeholdersOf(text!)) {
            expect(params, `${locale}:${id}.${part} {${marker}}`).toContain(marker)
          }
        }
      }
    }
  })
})
