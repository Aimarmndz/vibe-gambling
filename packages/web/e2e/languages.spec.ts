// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E de los idiomas (locales/): el selector de banderas de Ajustes cambia el idioma de la ventana
// al momento y lo guarda en el servidor, y el de la landing y /privacy cambia la página y se
// recuerda. Capturas: settings-language, table-fr, result-de y landing-de.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  API_ROUTES,
  PROTOCOL_VERSION,
  forLocale,
  meResponseSchema,
  webConfigSchema,
} from '@vibe-gambling/shared'

import { freshLogin, linkUrl, round, screens, shot, waitPhase } from './support.ts'
import type { Hooks } from './support.ts'

const htmlLang = (page: Page) => page.locator('html')

async function waitScreen(page: Page, id: string) {
  await page.waitForFunction(
    s => (window as unknown as { __vg?: Hooks }).__vg?.screens().includes(s) ?? false,
    id,
  )
}

/** START → AJUSTES (rejilla: fila de abajo, tercera casilla) → fila IDIOMA. */
async function openLanguageRow(page: Page) {
  await page.keyboard.press('p')
  await waitScreen(page, 'menu')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('x')
  await waitScreen(page, 'settings')
  // SONIDO · VOLUMEN · FILTRO CRT · CALIDAD · IDIOMA
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
}

async function closeMenus(page: Page) {
  await page.keyboard.press('o')
  await page.keyboard.press('o')
  await page.waitForFunction(() => {
    const ids = (window as unknown as { __vg: Hooks }).__vg.screens()
    return !ids.includes('menu') && !ids.includes('settings')
  })
}

test('Ajustes: las banderas cambian la ventana a francés y alemán al momento y se guarda', async ({
  page,
  request,
}) => {
  const token = await freshLogin(request)
  const headers = { authorization: `Bearer ${token}` }
  const serverLocale = async () =>
    meResponseSchema.parse(await (await request.get(API_ROUTES.me.path, { headers })).json()).user
      .locale

  // El navegador del E2E pide español: es el idioma inicial (nada guardado todavía).
  await page.goto(`${await linkUrl(request, token)}&noboot`)
  await waitScreen(page, 'tip')
  await expect(htmlLang(page)).toHaveAttribute('lang', 'es')
  await page.keyboard.press('x')
  await page.waitForFunction(
    () => (window as unknown as { __vg?: Hooks }).__vg?.state().user !== null,
  )

  // ES → FR con →: el idioma cambia sin recargar y el servidor lo guarda (settings.update).
  await openLanguageRow(page)
  await page.keyboard.press('ArrowRight')
  await expect(htmlLang(page)).toHaveAttribute('lang', 'fr')
  await expect.poll(serverLocale).toBe('fr')
  await expect(page.locator('#screen')).toHaveAttribute('aria-label', /flèches/)
  await page.waitForTimeout(400)
  await shot(page, 'settings-language')

  // FR → DE y vuelta a FR con ←.
  await page.keyboard.press('ArrowRight')
  await expect(htmlLang(page)).toHaveAttribute('lang', 'de')
  await expect.poll(serverLocale).toBe('de')
  await page.keyboard.press('ArrowLeft')
  await expect(htmlLang(page)).toHaveAttribute('lang', 'fr')
  await expect.poll(serverLocale).toBe('fr')

  // La mesa en francés.
  await closeMenus(page)
  // Sin los avisos de "ajustes guardados" (uno por cambio, cada uno en su idioma) encima.
  await page.waitForTimeout(3600)
  await shot(page, 'table-fr')

  // A alemán y una ronda entera: el resultado sale en alemán.
  await openLanguageRow(page)
  await page.keyboard.press('ArrowRight')
  await expect(htmlLang(page)).toHaveAttribute('lang', 'de')
  await expect.poll(serverLocale).toBe('de')
  await closeMenus(page)
  await round(page, request, token)
  await page.waitForTimeout(600)
  await expect(page.locator('#live')).toContainText('Ergebnis')
  await shot(page, 'result-de')
  await page.keyboard.press('x')
  await waitPhase(page, 'idle')

  // Se recuerda en el navegador al volver a abrir la ventana.
  await page.reload()
  await page.waitForFunction(
    () => (window as unknown as { __vg?: Hooks }).__vg?.state().user !== null,
  )
  await expect(htmlLang(page)).toHaveAttribute('lang', 'de')
  expect(await screens(page)).not.toContain('settings')

  // El usuario del GitHub falso es el mismo en toda la ejecución: se deja sin idioma elegido para
  // que los demás E2E (en español, el del navegador) no hereden el alemán.
  const reset = await request.post(API_ROUTES.settings.path, {
    headers,
    data: { v: PROTOCOL_VERSION, locale: null },
  })
  expect(reset.ok()).toBe(true)
  expect(await serverLocale()).toBeNull()
})

test('landing y /privacy: el selector de banderas cambia el idioma y se recuerda', async ({
  page,
}) => {
  await page.goto('/')
  await expect(htmlLang(page)).toHaveAttribute('lang', 'es')
  const picker = page.locator('.topnav [data-lang-picker]')
  await expect(picker).toHaveAttribute('role', 'group')
  await expect(picker.locator('button')).toHaveCount(4)
  // Cada botón dice su idioma en ese idioma (lang + aria-label) y lleva su bandera.
  for (const [name, lang] of [
    ['English', 'en'],
    ['Español', 'es-ES'],
    ['Français', 'fr-FR'],
    ['Deutsch', 'de-DE'],
  ] as const) {
    const button = picker.getByRole('button', { name, exact: true })
    await expect(button).toHaveAttribute('lang', lang)
    await expect(button.locator('canvas.flag')).toHaveCount(1)
  }
  await expect(picker.getByRole('button', { name: 'Español' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await picker.getByRole('button', { name: 'Deutsch' }).click()
  await expect(htmlLang(page)).toHaveAttribute('lang', 'de')
  await expect(page.locator('.headline')).toContainText('JEDER')
  await expect(picker.getByRole('button', { name: 'Deutsch' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(picker.getByRole('button', { name: 'Español' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(page.locator('#footer')).toContainText('Check dein Spiel')
  await expect(page.locator('#board-rows tr').first()).toBeVisible()
  await page.waitForTimeout(2500)
  await shot(page, 'landing-de', true)

  // Se recuerda y /privacy sale en alemán; desde allí, a francés.
  await page.goto('/privacy')
  await expect(htmlLang(page)).toHaveAttribute('lang', 'de')
  await expect(page.locator('h1')).toHaveText('Datenschutz')
  await page.locator('[data-lang-picker]').getByRole('button', { name: 'Français' }).click()
  await expect(htmlLang(page)).toHaveAttribute('lang', 'fr')
  await expect(page.locator('h1')).toHaveText('Confidentialité')
  const web = webConfigSchema.parse(await (await page.request.get('/config.json')).json())
  await expect(page.locator('#sections')).toContainText(forLocale(web.site.instance.hosting, 'fr'))
  await expect(page.locator('#footer')).toContainText('Joueurs Info Service')
})
