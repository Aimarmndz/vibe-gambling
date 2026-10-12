// SPDX-License-Identifier: AGPL-3.0-or-later
// Carpeta `locales/`: cada idioma completo frente al inglés (claves, marcadores, frases), con su
// bandera y sus metadatos válidos, y el registro generado al día con lo que hay en disco.
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FLAG_HEIGHT,
  FLAG_WIDTH,
  LOCALE_FILES,
  LOCALES,
  PHRASE_CATEGORIES,
  REFERENCE_LOCALE,
  TEXT_FILES,
  flagColors,
  flagSchema,
  localeMetaSchema,
  parseLocaleFile,
  phraseCount,
  phraseParityProblems,
  placeholdersOf,
  textParityProblems,
} from '../src/i18n/index.ts'
import { forLocale, localeSchema, perLocaleSchema } from '../src/protocol/common.ts'
import { z } from 'zod'
import { LOCALES_DIR, readLocales, staleLocaleFiles } from '../../../scripts/gen-locales.ts'

/** Mínimo de frases de ludópata por idioma (.plan/12 §7). */
const MIN_PHRASES = 40

const folders = await readLocales()
const reference = folders.find(f => f.meta.code === REFERENCE_LOCALE)!

describe('registro de idiomas', () => {
  it('está al día con locales/ (si falla: `pnpm gen:locales`)', async () => {
    expect(await staleLocaleFiles()).toEqual([])
  })

  it('la lista del protocolo es la de las carpetas, en su orden, y empieza por el inglés', () => {
    expect(LOCALES).toEqual(folders.map(f => f.meta.code))
    expect(LOCALES).toEqual(expect.arrayContaining(['en', 'es', 'fr', 'de']))
    expect(new Set(folders.map(f => f.meta.order)).size).toBe(folders.length)
  })

  it('el servidor acepta los idiomas registrados y rechaza los demás', () => {
    for (const code of LOCALES) expect(localeSchema.parse(code)).toBe(code)
    for (const bad of ['xx', 'EN', 'es-ES', '', 'klingon']) {
      expect(localeSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe.each(folders.map(f => [f.meta.code, f] as const))('locales/%s', (code, folder) => {
  it('meta.json es válido y su código es el de la carpeta', () => {
    expect(localeMetaSchema.parse(folder.meta).code).toBe(code)
    expect(folder.meta.dir).toBe('ltr')
    expect(() => new Intl.PluralRules(folder.meta.bcp47)).not.toThrow()
  })

  it.each(TEXT_FILES)('%s.json tiene las mismas claves y marcadores que el inglés', file => {
    expect(textParityProblems(reference.texts[file], folder.texts[file])).toEqual([])
    for (const [key, text] of Object.entries(folder.texts[file])) {
      expect(text.trim(), `${file}:${key}`).not.toBe('')
    }
  })

  it(`tiene al menos ${MIN_PHRASES} frases, todas las categorías y los mismos marcadores`, () => {
    expect(phraseCount(folder.phrases)).toBeGreaterThanOrEqual(MIN_PHRASES)
    for (const category of PHRASE_CATEGORIES) {
      expect(folder.phrases[category].length, category).toBeGreaterThan(0)
    }
    expect(phraseParityProblems(reference.phrases, folder.phrases)).toEqual([])
  })

  it('tiene su bandera, con el tamaño y la paleta correctos', async () => {
    const raw: unknown = JSON.parse(await readFile(join(LOCALES_DIR, code, 'flag.json'), 'utf8'))
    const flag = flagSchema.parse(raw)
    expect(flag.pixels).toHaveLength(FLAG_HEIGHT)
    const colors = flagColors(flag)
    for (const row of colors) {
      expect(row).toHaveLength(FLAG_WIDTH)
      for (const color of row) expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
    // Al menos dos colores (una bandera de un solo color no se distingue en el selector).
    expect(new Set(colors.flat()).size).toBeGreaterThanOrEqual(2)
  })

  it('el resto de idiomas no copia el inglés a pelo', () => {
    if (code === REFERENCE_LOCALE) return
    for (const file of TEXT_FILES) {
      const same = Object.entries(folder.texts[file]).filter(
        ([key, text]) => text === reference.texts[file][key] && /[a-z]{4,}/.test(text),
      )
      // Alguno puede coincidir de verdad ("BIG WIN", "Memory Card"…), pero nunca la mayoría.
      expect(same.length, `${file}: ${same.map(([k]) => k).join(', ')}`).toBeLessThan(
        Object.keys(folder.texts[file]).length / 5,
      )
    }
  })
})

describe('validación de las carpetas', () => {
  async function withLocales(edit: (dir: string) => Promise<void>): Promise<unknown> {
    const dir = await mkdtemp(join(tmpdir(), 'vg-locales-'))
    try {
      for (const code of ['en', 'es'])
        await cp(join(LOCALES_DIR, code), join(dir, code), { recursive: true })
      await edit(dir)
      return await readLocales(dir).then(
        () => null,
        (error: unknown) => (error as Error).message,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  const readJson = async (path: string) =>
    JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>

  it('acepta una copia buena', async () => {
    expect(await withLocales(async () => {})).toBeNull()
  })

  it('falla si falta una clave, sobra otra o cambian los marcadores', async () => {
    const message = await withLocales(async dir => {
      const path = join(dir, 'es', 'web.json')
      const web = await readJson(path)
      delete web['menu.title']
      web['menu.extra'] = 'x'
      web['bet.straight'] = 'PLENO'
      await writeFile(path, JSON.stringify(web))
    })
    expect(message).toContain('falta la clave "menu.title"')
    expect(message).toContain('sobra la clave "menu.extra"')
    expect(message).toContain('"bet.straight": marcadores {} en vez de {numbers}')
  })

  it('falla si las frases cambian de marcadores', async () => {
    const message = await withLocales(async dir => {
      const path = join(dir, 'es', 'phrases.json')
      const phrases = await readJson(path)
      phrases['jackpot'] = ['sin marcadores']
      await writeFile(path, JSON.stringify(phrases))
    })
    expect(message).toContain('frases "jackpot"')
  })

  it('falla si falta la bandera o no cuadra', async () => {
    expect(await withLocales(dir => rm(join(dir, 'es', 'flag.json')))).toContain('flag.json')
    const message = await withLocales(async dir => {
      const path = join(dir, 'es', 'flag.json')
      const flag = await readJson(path)
      flag['pixels'] = [...(flag['pixels'] as string[]).slice(1), 'z'.repeat(FLAG_WIDTH)]
      await writeFile(path, JSON.stringify(flag))
    })
    expect(message).toContain('no está en la paleta')
  })

  it('falla si el código no es el de la carpeta, el orden se repite o la carpeta no vale', async () => {
    const message = await withLocales(async dir => {
      const path = join(dir, 'es', 'meta.json')
      const meta = await readJson(path)
      meta['code'] = 'fr'
      meta['order'] = 0
      await writeFile(path, JSON.stringify(meta))
      await mkdir(join(dir, 'Not A Locale'))
    })
    expect(message).toContain('"code" es "fr" y debe ser "es"')
    expect(message).toContain('repetido')
    expect(message).toContain('Not A Locale')
  })

  it('falla sin el idioma de referencia o con JSON roto', async () => {
    expect(await withLocales(dir => rm(join(dir, 'en'), { recursive: true }))).toContain(
      'idioma de referencia',
    )
    expect(await withLocales(dir => writeFile(join(dir, 'es', 'mod.json'), '{ roto'))).toContain(
      'no es JSON válido',
    )
  })

  it('parseLocaleFile da un error legible', () => {
    expect(parseLocaleFile('meta', { code: 'es' })).toMatchObject({ ok: false })
    expect(LOCALE_FILES).toContain('flag')
  })
})

describe('utilidades', () => {
  it('placeholdersOf saca los marcadores sin repetir y ordenados', () => {
    expect(placeholdersOf('{b} y {a}, otra vez {b}')).toEqual(['a', 'b'])
    expect(placeholdersOf('nada')).toEqual([])
  })

  it('perLocaleSchema exige el idioma de referencia y forLocale cae en él', () => {
    const schema = perLocaleSchema(z.string())
    expect(schema.safeParse({ es: 'hola' }).success).toBe(false)
    const parsed = schema.parse({ en: 'hi', es: 'hola' })
    expect(forLocale(parsed, 'es')).toBe('hola')
    expect(forLocale(parsed, 'de')).toBe('hi')
  })
})
