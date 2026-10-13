// SPDX-License-Identifier: AGPL-3.0-or-later
// Humo en Chromium, Firefox y WebKit contra la pila real (servidor compilado con su CSP de verdad):
// landing y privacidad sin violaciones de CSP ni errores, la atribución de LICENSE en el pie,
// metadatos Open Graph absolutos, y una ronda completa en /play?demo (apostar con el teclado y
// ver el resultado). También: movimiento reducido (sin tembleque ni CRT), audio solo tras un
// gesto, sonido silenciable y aviso decente sin WebGL2.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { GameState } from '../src/game/state.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const site = JSON.parse(readFileSync(resolve(here, '../../../config/site.json'), 'utf8')) as {
  author: { name: string; url: string }
}
const attributionEn = `Created by ${site.author.name} (${site.author.url.replace(/^https?:\/\//, '')})`

interface Hooks {
  state(): GameState
  screens(): string[]
  render(): { crt: boolean; snap: boolean; muted: boolean; audio: boolean }
}

/**
 * Origen de los avatares de esta ejecución. La base de datos de desarrollo es compartida: puede
 * tener usuarios de la pila de docker-compose con avatares de otro GitHub falso, que la CSP de este
 * servidor (CSP_IMG_ORIGINS) bloquea con razón. Esas imágenes ajenas no cuentan como fallo.
 */
const ownAvatars = process.env.E2E_FAKE_GITHUB_URL ?? ''
const foreignAvatar = (violation: string) =>
  violation.startsWith('img-src ') &&
  !violation.includes(ownAvatars) &&
  /\/avatars\//.test(violation)

interface Watch {
  csp: string[]
  errors: string[]
}

/** Apunta las violaciones de CSP (evento del documento) y los errores de la página. */
/**
 * WebKit informa de un `style-src-attr` "inline" por cada `<select>` aunque la página no tenga ni
 * un atributo `style`: lo pone su propio árbol interno del control (se reproduce con una página
 * vacía con solo un `<select>` y `style-src 'self'`). No es nuestro y no se puede evitar sin
 * quitar el control nativo, que es el más accesible.
 */
const webkitSelect = (violation: string) =>
  violation.startsWith('style-src-attr inline ') && violation.endsWith('<select>')

async function watch(page: Page, browserName: string): Promise<Watch> {
  const w: Watch = { csp: [], errors: [] }
  await page.exposeFunction('__cspViolation', (text: string) => {
    if (foreignAvatar(text)) return
    if (browserName === 'webkit' && webkitSelect(text)) return
    w.csp.push(text)
  })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', e => {
      const report = (window as unknown as { __cspViolation(text: string): void }).__cspViolation
      const target = e.target instanceof Element ? e.target.tagName.toLowerCase() : ''
      const where = `${location.pathname} ${e.sourceFile}:${e.lineNumber} <${target}>`
      report(`${e.effectiveDirective || e.violatedDirective} ${e.blockedURI} ${where}`)
    })
  })
  page.on('pageerror', e => w.errors.push(e.message))
  page.on('console', m => {
    if (m.type() !== 'error') return
    // Las violaciones de CSP ya se cuentan, con su elemento, por el evento de arriba (cada motor
    // las escribe en la consola con otro formato). Aquí van el resto de errores.
    if (/Content Security Policy/i.test(m.text())) return
    w.errors.push(m.text())
  })
  return w
}

const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.state())
const screens = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.screens())
const render = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.render())

async function openDemo(page: Page, query = 'demo=manual&noboot') {
  await page.goto(`/play?${query}&nogpuwarn`)
  await page.waitForFunction(() => (window as unknown as { __vg?: Hooks }).__vg?.state().user)
}

test.describe('humo', () => {
  test('landing y privacidad: sin violaciones de CSP, con atribución y OG absoluto', async ({
    page,
    baseURL,
    browserName,
  }) => {
    const w = await watch(page, browserName)
    await page.goto('/')
    await expect(page.locator('#install-command')).not.toBeEmpty()
    await expect(page.locator('#footer .attribution')).toBeVisible()
    // En inglés tal cual LICENSE; en español solo cambia "Created by".
    const credit = (await page.locator('#footer .attribution').textContent()) ?? ''
    expect(credit.replace(/^Creado por/, 'Created by')).toBe(attributionEn)
    await expect(page.locator('#footer .attribution a')).toHaveAttribute('href', site.author.url)
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      `${baseURL}/og.png`,
    )
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
      'content',
      `${baseURL}/og.png`,
    )
    await page.goto('/privacy')
    await expect(page.locator('#sections h2')).toHaveCount(9)
    await expect(page.locator('#footer .attribution')).toBeVisible()
    expect(w.csp).toEqual([])
    expect(w.errors).toEqual([])
  })

  test('demo: apostar con el teclado y ver el resultado', async ({ page, browserName }) => {
    const w = await watch(page, browserName)
    await openDemo(page)
    // Primera apertura: "cómo se juega" explica que el giro lo lanza Claude Code.
    expect(await screens(page)).toContain('tip')
    await expect(page.locator('#live')).toContainText('Claude Code')
    expect((await render(page)).audio).toBe(false)
    await page.keyboard.press('x')
    expect(await screens(page)).not.toContain('tip')
    // La primera tecla es un gesto: ya puede haber audio.
    expect((await render(page)).audio).toBe(true)
    await page.keyboard.press('x')
    await page.waitForFunction(
      () => (window as unknown as { __vg: Hooks }).__vg.state().slip.total > 0,
    )
    // Sin botón de girar: se avisa de cuándo se juega la apuesta. La demo manual (los tests) está en
    // PAUSA, así que dice cómo se gira a mano.
    await expect(page.locator('#live')).toContainText(/pulsa G para girar|press G to spin/)
    // Turno simulado (en la demo no hay servidor): Claude "piensa" y la bola cae.
    await page.evaluate(() => {
      void (window as unknown as { __vgDemo: { turn(o: object): Promise<void> } }).__vgDemo.turn({
        thinkMs: 1200,
      })
    })
    await page.waitForFunction(
      () => (window as unknown as { __vg: Hooks }).__vg.state().phase === 'spinning',
    )
    await page.waitForFunction(
      () => (window as unknown as { __vg: Hooks }).__vg.state().phase === 'result',
      null,
      { timeout: 30_000 },
    )
    const s = await state(page)
    expect(s.lastRound?.result).toBeGreaterThanOrEqual(0)
    await expect(page.locator('#live')).toContainText(String(s.lastRound!.result))
    // M silencia (preferencia guardada) y se puede volver a activar.
    await page.keyboard.press('m')
    expect((await render(page)).muted).toBe(true)
    await page.keyboard.press('m')
    expect((await render(page)).muted).toBe(false)
    expect(w.csp).toEqual([])
    expect(w.errors).toEqual([])
  })

  test('movimiento reducido: sin tembleque ni CRT', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await openDemo(page)
    expect(await render(page)).toMatchObject({ crt: false, snap: false })
    await context.close()
  })

  test('sin WebGL2: aviso legible en vez de una pantalla negra', async ({ page, browserName }) => {
    const w = await watch(page, browserName)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args) {
        if (args[0] === 'webgl2') return null
        return (original as (...a: unknown[]) => RenderingContext | null).apply(this, args)
      } as typeof original
    })
    await page.goto('/play?demo&nogpuwarn')
    await expect(page.locator('#fallback')).toBeVisible()
    await expect(page.locator('#fallback-title')).not.toBeEmpty()
    await expect(page.locator('#screen')).toBeHidden()
    expect(w.csp).toEqual([])
  })
})
