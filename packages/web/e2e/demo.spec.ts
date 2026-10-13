// SPDX-License-Identifier: AGPL-3.0-or-later
// La demo (`/play?demo`) gira sola, pero se puede pausar (A) y girar a mano (G), con el teclado o
// pulsando sus filas en el panel; la preferencia se recuerda.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  closePlayContext,
  newPlayPage,
  playReady,
  screens,
  settle,
  skipToResult,
  vg,
  waitPhase,
} from './support.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
/** Los tiempos de la demo salen de la misma configuración que la build (config/web.json). */
const demoCfg = (
  JSON.parse(readFileSync(resolve(here, '../../../config/web.json'), 'utf8')) as {
    demo: { pauseMs: number; thinkMs: number }
  }
).demo

interface DemoHooks {
  setAuto(on: boolean): void
  isAuto(): boolean
}

const isAuto = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vgDemo: DemoHooks }).__vgDemo.isAuto())

/**
 * Pulsa un punto de la pantalla virtual de 320×240. A 960×720 y sin CRT la imagen ocupa la ventana
 * entera a ×3 exacto.
 */
async function tapVirtual(page: Page, x: number, y: number): Promise<void> {
  const box = (await page.locator('#screen').boundingBox())!
  await page.mouse.click(box.x + (x * box.width) / 320, box.y + (y * box.height) / 240)
}

/** Fila AUTO/PAUSA del panel de la demo (bajo el panel de racha, sin tiradas pendientes). */
const AUTO_ROW = { x: 222 + 47, y: 4 + 29 + 3 + 8 }

test.describe('demo: AUTO y PAUSA', () => {
  test('pausa con A, no abre rondas, G gira una a mano y A la reanuda', async ({ browser }) => {
    const page = await newPlayPage(browser)
    await page.goto('/play?demo&noboot&nogpuwarn')
    await playReady(page)
    expect(await isAuto(page)).toBe(true)

    // A: PAUSA (antes de que salga el primer turno automático).
    await page.keyboard.press('a')
    expect(await isAuto(page)).toBe(false)
    await expect(page.locator('#live')).toContainText('pausa')

    // Pasa más de un turno automático entero y no se abre ninguna ronda.
    const until = Date.now() + demoCfg.pauseMs + demoCfg.thinkMs + 1500
    while (Date.now() < until) {
      const s = await vg(page)
      expect(s.phase).toBe('idle')
      expect(s.round).toBeNull()
      await page.waitForTimeout(250)
    }
    expect((await vg(page)).wallet?.spins).toBe(0)

    // G: una tirada ahora, que se abre y se resuelve; sigue en PAUSA.
    await page.keyboard.press('g')
    await waitPhase(page, 'spinning', 5_000)
    await waitPhase(page, 'result', demoCfg.thinkMs + 20_000)
    await skipToResult(page)
    expect((await vg(page)).lastRound).not.toBeNull()
    await settle(page)
    expect((await vg(page)).wallet?.spins).toBe(1)
    expect(await isAuto(page)).toBe(false)

    // Con la ronda resuelta y en PAUSA, nada más gira solo.
    await page.waitForTimeout(demoCfg.pauseMs + 1000)
    expect((await vg(page)).wallet?.spins).toBe(1)

    // A otra vez: AUTO, y la siguiente sale sola.
    await page.keyboard.press('a')
    expect(await isAuto(page)).toBe(true)
    await expect(page.locator('#live')).toContainText('automático')
    await waitPhase(page, 'spinning', demoCfg.pauseMs + 5_000)
    await closePlayContext(page)
  })

  test('en AUTO, G pasa a PAUSA; la fila del panel también se pulsa; y se recuerda', async ({
    browser,
  }) => {
    const page = await newPlayPage(browser)
    await page.goto('/play?demo&noboot&nogpuwarn')
    await playReady(page)
    expect(await isAuto(page)).toBe(true)
    // Apostar no cambia de modo.
    await page.keyboard.press('x')
    await expect.poll(async () => (await vg(page)).slip.total).toBeGreaterThan(0)
    expect(await isAuto(page)).toBe(true)
    // Girar a mano, sí: quien gira quiere llevar el control.
    await page.keyboard.press('g')
    await expect.poll(() => isAuto(page)).toBe(false)
    await expect(page.locator('#live')).toContainText('Tú mandas')
    await waitPhase(page, 'spinning', 5_000)
    await settle(page)

    // Con el ratón: la fila AUTO/PAUSA del panel (cuando la cámara ha vuelto a la mesa: durante
    // el viaje el HUD está escondido).
    expect(await screens(page)).toEqual(['table'])
    await page.waitForTimeout(1500)
    await tapVirtual(page, AUTO_ROW.x, AUTO_ROW.y)
    await expect.poll(() => isAuto(page)).toBe(true)
    await tapVirtual(page, AUTO_ROW.x, AUTO_ROW.y)
    await expect.poll(() => isAuto(page)).toBe(false)

    // Se recuerda al volver a abrir la demo.
    await page.reload()
    await playReady(page)
    expect(await isAuto(page)).toBe(false)
    // `?demo=manual` (los tests) nunca gira sola, diga lo que diga la preferencia.
    await page.evaluate(() => (window as unknown as { __vgDemo: DemoHooks }).__vgDemo.setAuto(true))
    await page.goto('/play?demo=manual&noboot&nogpuwarn')
    await playReady(page)
    expect(await isAuto(page)).toBe(false)
    await closePlayContext(page)
  })
})
