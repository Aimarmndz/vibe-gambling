// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E de la TIENDA en la demo ("Prueba antes de no comprar"): comprar la Pata de Conejo™, armarla,
// girar y ver "+∞%"; el Placebómetro con datos; el ARMARIO (comprar y ponerse un tapete y unas
// fichas) y la mesa vestida. Capturas para el README: menu-shop(-en) y menu-pocket(-en). Con
// `E2E_REVIEW_SHOTS=<carpeta>` guarda además las de revisión (armario, mesa y resultado).
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

import { screens, settle, shot, skipToResult, waitPhase } from './support.ts'
import type { Hooks } from './support.ts'

const live = (page: Page) => page.locator('#live')
const reviewDir = process.env.E2E_REVIEW_SHOTS

async function review(page: Page, name: string) {
  if (!reviewDir) return
  mkdirSync(reviewDir, { recursive: true })
  await page.screenshot({ path: resolve(reviewDir, `${name}.png`) })
}

type Demo = {
  setWallet(balance: number, debt?: number): void
  turn(o: {
    result?: number
    thinkMs?: number
    minSpinMs?: number
    landingMs?: number
  }): Promise<void>
}

async function waitScreen(page: Page, id: string) {
  await page.waitForFunction(
    s => (window as unknown as { __vg?: Hooks }).__vg?.screens().includes(s) ?? false,
    id,
  )
}

/** La demo en un idioma, en PAUSA (solo gira cuando se pide) y con monedas de sobra. */
async function demoIn(browser: Browser, locale: string) {
  const context = await browser.newContext({ locale, viewport: { width: 960, height: 720 } })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => localStorage.setItem('vibe-gambling:tip-seen', '1'))
  await page.goto('/play?demo=manual&noboot&nogpuwarn')
  await page.waitForFunction(
    () => ((window as unknown as { __vg?: Hooks }).__vg?.state().user ?? null) !== null,
  )
  await page.evaluate(() => (window as unknown as { __vgDemo: Demo }).__vgDemo.setWallet(20_000))
  return { context, page, errors }
}

/** START → TIENDA (la última casilla: ↓ y ← desde CONTINUAR). */
async function openShop(page: Page) {
  await page.keyboard.press('p')
  await waitScreen(page, 'menu')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('x')
  await waitScreen(page, 'shop')
}

async function closeMenu(page: Page) {
  for (let i = 0; i < 4 && (await screens(page)).length > 1; i++) {
    await page.keyboard.press('o')
    await page.waitForTimeout(150)
  }
  expect(await screens(page)).toEqual(['table'])
}

/** Cargas de un consumible en el bolsillo que enseña la ventana. */
const charges = (page: Page, id: string) =>
  page.evaluate(
    item =>
      (window as unknown as { __vg: Hooks }).__vg
        .state()
        .shownInventory?.items.find(i => i.id === item)?.charges ?? 0,
    id,
  )

/** ✕ y espera a que la compra llegue al bolsillo (la tienda tiene un respiro entre compras). */
async function buy(page: Page, check: () => Promise<boolean>) {
  await page.waitForTimeout(1100)
  await page.keyboard.press('x')
  await expect.poll(check, { timeout: 5000 }).toBe(true)
}

/** Una tirada de la demo, rápida, hasta volver a la mesa. Devuelve lo que anunció el resultado. */
async function spin(page: Page, result?: number): Promise<string> {
  await page.evaluate(
    r =>
      (window as unknown as { __vgDemo: Demo }).__vgDemo.turn({
        result: r ?? undefined,
        thinkMs: 0,
        minSpinMs: 300,
        landingMs: 300,
      }),
    result ?? null,
  )
  await waitPhase(page, 'result', 30_000)
  await skipToResult(page)
  await page.waitForTimeout(300)
  const text = (await live(page).textContent()) ?? ''
  await settle(page)
  return text
}

test('demo: comprar la pata, armarla, girar y ver +∞%; Placebómetro y armario', async ({
  browser,
}) => {
  const { context, page, errors } = await demoIn(browser, 'es-ES')
  // Dos tiradas sin objetos: el Placebómetro tendrá con qué comparar.
  await spin(page, 2)
  await spin(page, 1)

  await openShop(page)
  await expect(live(page)).toContainText('TIENDA. PATA DE CONEJO™.')
  await buy(page, async () => (await charges(page, 'rabbit_foot')) > 0)
  await page.keyboard.press('ArrowDown')
  await buy(page, async () => (await charges(page, 'oracle')) > 0)
  await page.keyboard.press('ArrowDown')
  await buy(page, async () => (await charges(page, 'insurance')) > 0)
  await expect(live(page)).toContainText('SEGURO TODO RIESGO')
  await page.waitForTimeout(1300)
  await shot(page, 'menu-shop')

  // BOLSILLO: armar la pata, el oráculo y el seguro.
  await page.keyboard.press('ArrowRight')
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('x')
    await page.keyboard.press('ArrowDown')
  }
  await page.waitForFunction(
    () =>
      ((window as unknown as { __vg: Hooks }).__vg.state().shownInventory?.items ?? []).filter(
        i => i.armed,
      ).length === 3,
  )
  await closeMenu(page)
  await page.waitForTimeout(600)
  await review(page, 'table-armed-es')

  // Girar con la pata armada: la ronda lo dice y sale "+∞%".
  const said = await spin(page, 7)
  expect(said).toContain('+∞% SUERTE')
  expect(said).toContain('LA IA DIJO')
  expect(said).toContain('SEGURO')
  expect(await charges(page, 'rabbit_foot')).toBeGreaterThan(0)
  // El resultado con sus líneas de objeto (otra tirada, para capturarlo quieto).
  await page.evaluate(() =>
    (window as unknown as { __vgDemo: Demo }).__vgDemo.turn({
      result: 0,
      thinkMs: 0,
      minSpinMs: 300,
      landingMs: 300,
    }),
  )
  await waitPhase(page, 'result', 30_000)
  await expect.poll(async () => (await screens(page)).at(-1), { timeout: 20_000 }).toBe('result')
  await page.waitForTimeout(700)
  await review(page, 'result-items-es')
  await settle(page)
  await spin(page, 19)

  // BOLSILLO con el Placebómetro con datos.
  await openShop(page)
  await page.keyboard.press('ArrowRight')
  await expect(live(page)).toContainText('BOLSILLO.')
  await page.waitForTimeout(1300)
  await shot(page, 'menu-pocket')

  // ARMARIO: comprar y ponerse el tapete vaporwave y los disquetes.
  await page.keyboard.press('ArrowRight')
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
  await buy(page, async () =>
    page.evaluate(() =>
      (
        (window as unknown as { __vg: Hooks }).__vg.state().shownInventory?.cosmetics.felts ?? []
      ).includes('vaporwave'),
    ),
  )
  await page.keyboard.press('x')
  await page.waitForFunction(
    () => (window as unknown as { __vg: Hooks }).__vg.state().user?.felt === 'vaporwave',
  )
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await buy(page, async () =>
    page.evaluate(() =>
      (
        (window as unknown as { __vg: Hooks }).__vg.state().shownInventory?.cosmetics.chips ?? []
      ).includes('floppy'),
    ),
  )
  await page.keyboard.press('x')
  await page.waitForFunction(
    () => (window as unknown as { __vg: Hooks }).__vg.state().user?.chipSkin === 'floppy',
  )
  await page.waitForTimeout(1300)
  await review(page, 'wardrobe-es')
  await closeMenu(page)
  // La mesa vestida, con fichas puestas (✕ en el tapete, dos fichas distintas).
  await page.keyboard.press('x')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('z')
  await page.keyboard.press('x')
  await page.waitForTimeout(1200)
  await review(page, 'table-skins-es')
  expect(errors).toEqual([])
  await context.close()

  // En inglés: la tienda y el bolsillo con datos.
  const en = await demoIn(browser, 'en-GB')
  await spin(en.page, 2)
  await openShop(en.page)
  await expect(live(en.page)).toContainText("SHOP. RABBIT'S FOOT™.")
  await buy(en.page, async () => (await charges(en.page, 'rabbit_foot')) > 0)
  await en.page.keyboard.press('ArrowDown')
  await en.page.keyboard.press('ArrowDown')
  await buy(en.page, async () => (await charges(en.page, 'insurance')) > 0)
  await en.page.waitForTimeout(1300)
  await shot(en.page, 'menu-shop-en')
  await en.page.keyboard.press('ArrowRight')
  await en.page.keyboard.press('x')
  await en.page.keyboard.press('ArrowDown')
  await en.page.keyboard.press('x')
  await closeMenu(en.page)
  const enSaid = await spin(en.page, 0)
  expect(enSaid).toContain('+∞% LUCK')
  expect(enSaid).toContain('INSURANCE')
  await en.page.evaluate(() =>
    (window as unknown as { __vgDemo: Demo }).__vgDemo.turn({
      result: 13,
      thinkMs: 0,
      minSpinMs: 300,
      landingMs: 300,
    }),
  )
  await expect.poll(async () => (await screens(en.page)).at(-1), { timeout: 30_000 }).toBe('result')
  await en.page.waitForTimeout(700)
  await review(en.page, 'result-items-en')
  await settle(en.page)
  await openShop(en.page)
  await en.page.keyboard.press('ArrowRight')
  await en.page.waitForTimeout(1300)
  await shot(en.page, 'menu-pocket-en')
  await en.page.keyboard.press('ArrowRight')
  await en.page.keyboard.press('ArrowDown')
  await en.page.waitForTimeout(1300)
  await review(en.page, 'wardrobe-en')
  expect(en.errors).toEqual([])
  await en.context.close()
})
