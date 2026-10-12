// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
// Términos 7(b) de LICENSE: la atribución "Created by Aimar (github.com/Aimarmndz)" tiene que
// salir en el pie de la landing, en los créditos de la ventana y en la pantalla de arranque. Si
// alguien la quita de una de esas pantallas, o el texto deja de coincidir con LICENSE, esto falla.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { webConfigSchema } from '@vibe-gambling/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppContext } from '../src/app/context.ts'
import { clientConfig } from '../src/config.ts'
import { createTranslator } from '../src/i18n/index.ts'
import type { Translator } from '../src/i18n/index.ts'
import { attribution, displayUrl } from '../src/legal/attribution.ts'
import { renderFooter } from '../src/pages/common.ts'
import type * as Bitmap from '../src/font/bitmap.ts'
import type { World } from '../src/render/world.ts'
import { testWebConfig } from './fixtures.ts'

// Se apuntan los textos que pintan las pantallas del canvas (el canvas 2D no existe en los tests).
const painted: string[] = []
vi.mock('../src/font/bitmap.ts', async importOriginal => {
  const real = await importOriginal<typeof Bitmap>()
  return {
    ...real,
    drawText: (_g: unknown, text: string, _x: number, _y: number, style: { scale?: number }) => {
      painted.push(text)
      return real.measure(text, style.scale ?? 1)
    },
  }
})

// happy-dom cambia el `URL` global: la ruta sale de import.meta.dirname.
const repoRoot = resolve(import.meta.dirname, '../../..')
const site = JSON.parse(readFileSync(resolve(repoRoot, 'config/site.json'), 'utf8')) as unknown
const web = webConfigSchema.parse({ ...testWebConfig, site })

/** La línea de atribución tal como la exige LICENSE. */
function licenseAttribution(): string {
  const text = readFileSync(resolve(repoRoot, 'LICENSE'), 'utf8')
  const m = /preserved, in the language of the user interface or in English:\s+(.+)\n/.exec(text)
  if (!m) throw new Error('LICENSE no tiene el término de atribución 7(b)')
  return m[1]!.trim()
}

/** Contexto mínimo para pintar pantallas del canvas. */
function fakeContext(tr: Translator): AppContext {
  return {
    web,
    client: clientConfig,
    demo: false,
    reducedMotion: true,
    hits: { add: () => undefined, clear: () => undefined, at: () => null },
    sfx: { play: () => undefined, running: true },
    tr,
    prefs: { sound: true, crt: true, quality: 'high', locale: tr.locale },
    buttons: () => ({ x: 'X', o: 'O', tri: 'C', sq: 'Z', start: 'P' }),
    hoverId: () => null,
    pop: () => undefined,
    push: () => undefined,
  } as unknown as AppContext
}

function fakeCanvas2d(): CanvasRenderingContext2D {
  const noop = () => undefined
  const gradient = { addColorStop: noop }
  return new Proxy({ canvas: { width: 320, height: 240 } } as Record<string | symbol, unknown>, {
    get: (target, key) =>
      key in target ? target[key] : key === 'createLinearGradient' ? () => gradient : noop,
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
}

beforeEach(() => {
  painted.length = 0
})

describe('atribución 7(b)', () => {
  it('el texto en inglés es exactamente el de LICENSE (y sale de config/site.json)', () => {
    const credit = attribution(web.site.author, createTranslator('en'))
    expect(credit.text).toBe(licenseAttribution())
    expect(credit.before + credit.label + credit.after).toBe(credit.text)
    expect(credit.href).toBe(web.site.author.url)
  })

  it('en español solo se traduce "Created by"', () => {
    const en = attribution(web.site.author, createTranslator('en')).text
    const es = attribution(web.site.author, createTranslator('es')).text
    expect(es.replace(/^Creado por/, 'Created by')).toBe(en)
  })

  it('usa el autor de la configuración, no uno escrito en el código', () => {
    const credit = attribution(testWebConfig.site.author, createTranslator('en'))
    expect(credit.text).toBe('Created by Tester (example.invalid/tester)')
    expect(displayUrl('https://github.com/x/')).toBe('github.com/x')
  })

  it.each(['en', 'es'] as const)('sale en la pantalla de arranque (%s)', async locale => {
    const { BootScreen } = await import('../src/ui/screens/boot.ts')
    const tr = createTranslator(locale)
    const boot = new BootScreen(fakeContext(tr), {} as World, () => undefined)
    // Hasta la pantalla de título (sin llegar a saltarla sola).
    for (let i = 0; i < 60; i++) boot.update(0.1)
    boot.draw(fakeCanvas2d(), 6)
    expect(painted).toContain(attribution(web.site.author, tr).text)
  })

  it.each(['en', 'es'] as const)('sale en los créditos de la ventana (%s)', async locale => {
    const { CreditsScreen } = await import('../src/ui/screens/menu.ts')
    const tr = createTranslator(locale)
    new CreditsScreen(fakeContext(tr)).draw(fakeCanvas2d(), 0)
    expect(painted).toContain(attribution(web.site.author, tr).text)
  })

  it.each(['en', 'es'] as const)('sale en el pie de la landing con su enlace (%s)', locale => {
    const tr = createTranslator(locale)
    const footer = document.createElement('footer')
    renderFooter(footer, web, tr, () => undefined)
    const credit = attribution(web.site.author, tr)
    expect(footer.textContent).toContain(credit.text)
    const link = footer.querySelector<HTMLAnchorElement>('.attribution a')
    expect(link?.getAttribute('href')).toBe(web.site.author.url)
    expect(link?.textContent).toBe(credit.label)
  })
})
