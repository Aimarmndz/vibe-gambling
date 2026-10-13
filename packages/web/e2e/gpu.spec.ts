// SPDX-License-Identifier: AGPL-3.0-or-later
// Aviso de WebGL por software (`?gpu=software` fuerza la detección): sale una vez por sesión, se
// cierra con Escape sin que la tecla llegue al juego, "No volver a mostrar" se recuerda tras
// recargar y `?nogpuwarn` (el resto de los E2E, cuyos navegadores dibujan por software) lo calla.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { closePlayContext, newPlayPage, playReady, screens } from './support.ts'

test.describe('aviso de aceleración por hardware', () => {
  const dialog = (page: Page) => page.locator('#gpu-warning')

  test('sale una vez por sesión, Escape lo cierra y "no volver a mostrar" se recuerda', async ({
    browser,
  }) => {
    const page = await newPlayPage(browser)
    await page.goto('/play?demo=manual&noboot&gpu=software')
    await playReady(page)
    await expect(dialog(page)).toBeVisible()
    await expect(page.locator('#gpu-title')).toHaveText('TU NAVEGADOR DIBUJA A MANO')
    await expect(page.locator('#gpu-steps li')).toHaveCount(3)
    await expect(page.locator('#gpu-ok')).toBeFocused()
    // Tab se queda dentro del aviso (modal).
    await page.keyboard.press('Tab')
    await expect(page.locator('#gpu-never')).toBeFocused()
    // Escape lo cierra sin abrir el menú del juego, y el foco vuelve a la ventana.
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await page.waitForTimeout(300)
    expect(await screens(page)).toEqual(['table'])
    await expect(page.locator('#screen')).toBeFocused()

    // Una vez por sesión: al recargar ya no sale.
    await page.reload()
    await playReady(page)
    await page.waitForTimeout(800)
    await expect(dialog(page)).toBeHidden()

    // Otra pestaña (otra sesión): sale; "No volver a mostrar" lo cierra y lo guarda.
    const other = await page.context().newPage()
    await other.goto('/play?demo=manual&noboot&gpu=software')
    await playReady(other)
    await expect(dialog(other)).toBeVisible()
    await other.locator('#gpu-never').click()
    await expect(dialog(other)).toBeHidden()
    const saved = await other.evaluate(
      () => JSON.parse(localStorage.getItem('vibe-gambling:prefs') ?? '{}') as unknown,
    )
    expect(saved).toMatchObject({ gpuWarning: false })

    // Ni al recargar ni en otra pestaña nueva.
    await other.reload()
    await playReady(other)
    const third = await page.context().newPage()
    await third.goto('/play?demo=manual&noboot&gpu=software')
    await playReady(third)
    await third.waitForTimeout(800)
    await expect(dialog(other)).toBeHidden()
    await expect(dialog(third)).toBeHidden()
    await closePlayContext(page)
  })

  test('en inglés, con ENTENDIDO; y `nogpuwarn` (los E2E) no lo enseña', async ({ browser }) => {
    const page = await newPlayPage(browser, 'en')
    await page.goto('/play?demo=manual&noboot&gpu=software')
    await playReady(page)
    await expect(dialog(page)).toBeVisible()
    await expect(page.locator('#gpu-title')).toHaveText('YOUR BROWSER IS DRAWING BY HAND')
    await expect(page.locator('#gpu-steps')).not.toContainText('chrome://')
    await page.locator('#gpu-ok').click()
    await expect(dialog(page)).toBeHidden()
    // "Entendido" no guarda nada.
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem('vibe-gambling:prefs') ?? '{}') as unknown,
    )
    expect(saved).not.toMatchObject({ gpuWarning: false })

    const quiet = await page.context().newPage()
    await quiet.goto('/play?demo=manual&noboot&gpu=software&nogpuwarn')
    await playReady(quiet)
    await quiet.waitForTimeout(800)
    await expect(dialog(quiet)).toBeHidden()
    await closePlayContext(page)
  })
})
