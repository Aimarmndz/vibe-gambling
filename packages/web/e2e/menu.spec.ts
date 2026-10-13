// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E de los menús v2. Contra la pila real: ESTADÍSTICAS, LOGROS y BANCO con los datos del
// servidor (stats.request, bank.request y hello.achievements). Y las capturas de cada pantalla
// en docs/screenshots/menu-*.png con la temporada de ejemplo de la demo (siempre igual).
import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import {
  API_ROUTES,
  PROTOCOL_VERSION,
  betResponseSchema,
  meResponseSchema,
} from '@vibe-gambling/shared'

import {
  continueToLoan,
  freshLogin,
  linkUrl,
  playTurn,
  screens,
  settle,
  shot,
  waitPhase,
} from './support.ts'
import type { Hooks } from './support.ts'

const live = (page: Page) => page.locator('#live')

async function waitScreen(page: Page, id: string) {
  await page.waitForFunction(
    s => (window as unknown as { __vg?: Hooks }).__vg?.screens().includes(s) ?? false,
    id,
  )
}

/** Abre una casilla del menú principal desde CONTINUAR con las flechas. */
async function openTile(page: Page, keys: string[], id: string) {
  await page.keyboard.press('p')
  await waitScreen(page, 'menu')
  for (const key of keys) await page.keyboard.press(key)
  await page.keyboard.press('x')
  await waitScreen(page, id)
}

/** ○ hasta volver a la mesa (desde una página, la primera vuelve a la rejilla). */
async function closeMenu(page: Page) {
  for (let i = 0; i < 4 && (await screens(page)).length > 1; i++) {
    await page.keyboard.press('o')
    await page.waitForTimeout(150)
  }
  expect(await screens(page)).toEqual(['table'])
}

/** La ventana ya tiene sesión (o la demo ya ha saludado). */
async function waitUser(page: Page) {
  await page.waitForFunction(
    () => ((window as unknown as { __vg?: Hooks }).__vg?.state().user ?? null) !== null,
  )
}

test('menú con datos del servidor: estadísticas, logros y banco', async ({ page, request }) => {
  const token = await freshLogin(request)
  const headers = { authorization: `Bearer ${token}` }
  const me = async () =>
    meResponseSchema.parse(await (await request.get(API_ROUTES.me.path, { headers })).json())

  await page.addInitScript(() => localStorage.setItem('vibe-gambling:tip-seen', '1'))
  await page.goto(`${await linkUrl(request, token)}&noboot`)
  await waitUser(page)
  if ((await screens(page)).includes('pendingNotice')) await page.keyboard.press('o')

  // Todo al 17 (como el mod, por la API) hasta perder: tiradas, número más repetido y ruina.
  for (let i = 0; i < 6 && (await me()).wallet.balance >= 10; i++) {
    const bet = await request.post(API_ROUTES.bet.path, {
      headers,
      data: { v: PROTOCOL_VERSION, amount: 'all-in', target: '17' },
    })
    expect(bet.ok()).toBe(true)
    betResponseSchema.parse(await bet.json())
    // Como `round` de support.ts, sin mirar el texto de aria-live: si sale el 17, la animación de
    // ¡PLENO! anuncia la suya.
    const turn = await playTurn(request, token)
    const end = await turn.end()
    expect(end.status).toBe('resolved')
    await waitPhase(page, 'result', 30_000)
    // Premio, falacia o ON FIRE se cierran; la primera ruina de la temporada (cuenta nueva) se
    // para en BANCARROTA.
    if ((await settle(page, ['fx:bankrupt'])) === 'fx:bankrupt') break
  }
  const broke = await me()
  expect(broke.wallet.balance).toBeLessThan(10)
  // BANCARROTA desemboca en la oferta del préstamo: se rechaza para pedirlo desde el banco.
  await continueToLoan(page)
  await page.keyboard.press('o')
  await page.waitForFunction(
    () => !(window as unknown as { __vg: Hooks }).__vg.screens().includes('loan'),
  )

  // BANCO: sin saldo, la última fila es "✕ PEDIR PRÉSTAMO" y abre la oferta de siempre.
  await openTile(page, ['ArrowDown'], 'bank')
  await expect(live(page)).toContainText(`Deuda ${broke.wallet.debt}`)
  await page.keyboard.press('x')
  await waitScreen(page, 'loan')
  await page.keyboard.press('x')
  await page.waitForFunction(
    () => ((window as unknown as { __vg: Hooks }).__vg.state().shown?.debt ?? 0) > 0,
  )
  await page.waitForTimeout(3500)
  if ((await screens(page)).includes('loan')) await page.keyboard.press('x')
  const loaned = await me()
  expect(loaned.wallet.loans).toBe(broke.wallet.loans + 1)

  // De nuevo en el banco: el historial del servidor trae el préstamo.
  await openTile(page, ['ArrowDown'], 'bank')
  // Cuenta nueva: su primer préstamo, en singular.
  expect(loaned.wallet.loans).toBe(1)
  await expect(live(page)).toContainText('1 préstamo.')
  await closeMenu(page)

  // ESTADÍSTICAS: las tiradas de la temporada, según el servidor.
  await openTile(page, ['ArrowRight', 'ArrowRight'], 'stats')
  const spins = loaned.wallet.spins
  await expect(live(page)).toContainText(`${spins} ${spins === 1 ? 'tirada' : 'tiradas'},`)
  await expect(live(page)).toContainText('Número más repetido')
  await closeMenu(page)

  // LOGROS: el catálogo del hello, con "Primera dosis" y "Primera ruina" conseguidos.
  await openTile(page, ['ArrowRight', 'ArrowRight', 'ArrowRight'], 'achievements')
  const got = (loaned.achievements ?? []).filter(a => a.unlockedAt).length
  expect(got).toBeGreaterThanOrEqual(2)
  await expect(live(page)).toContainText(`${got} de ${loaned.achievements!.length} logros`)
  await closeMenu(page)
})

/** Abre la demo con la temporada de ejemplo, en el idioma del navegador. */
async function showcase(browser: Browser, locale: string) {
  const context = await browser.newContext({ locale, viewport: { width: 960, height: 720 } })
  const page = await context.newPage()
  await page.addInitScript(() => localStorage.setItem('vibe-gambling:tip-seen', '1'))
  await page.goto('/play?demo=manual&noboot')
  await waitUser(page)
  return { context, page }
}

async function seed(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { __vgDemo: { showcase(): void } }).__vgDemo.showcase(),
  )
  await page.waitForFunction(
    () => ((window as unknown as { __vg: Hooks }).__vg.state().wallet?.pendingSpins ?? 0) > 0,
  )
}

/** Captura una casilla del menú (con el barrido terminado y lo animado ya quieto). */
async function capture(page: Page, keys: string[], id: string, name: string, after: string[] = []) {
  await openTile(page, keys, id)
  for (const key of after) await page.keyboard.press(key)
  await page.waitForTimeout(1300)
  await shot(page, name)
  await closeMenu(page)
}

test('capturas de cada pantalla del menú (demo, temporada de ejemplo)', async ({ browser }) => {
  const { context, page } = await showcase(browser, 'es-ES')
  // Tiradas pendientes vacía, antes de la temporada de ejemplo.
  await capture(page, ['ArrowRight'], 'pending', 'menu-pending-empty')
  await seed(page)
  // Menú principal con TIRADAS elegida (como la maqueta).
  await page.keyboard.press('p')
  await waitScreen(page, 'menu')
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(1300)
  await expect(live(page)).toContainText('TIRADAS')
  await shot(page, 'menu-main')
  await closeMenu(page)
  await capture(page, ['ArrowRight'], 'pending', 'menu-pending')
  await capture(page, ['ArrowRight', 'ArrowRight'], 'stats', 'menu-stats')
  await capture(
    page,
    ['ArrowRight', 'ArrowRight', 'ArrowRight'],
    'achievements',
    'menu-achievements',
    ['ArrowDown'],
  )
  await capture(page, ['ArrowLeft'], 'leaderboard', 'menu-ranking')
  await capture(page, ['ArrowDown'], 'bank', 'menu-bank')
  await capture(page, ['ArrowDown', 'ArrowRight'], 'memoryCard', 'menu-memory')
  await capture(page, ['ArrowDown', 'ArrowRight', 'ArrowRight'], 'settings', 'menu-settings', [
    'ArrowDown',
    'ArrowDown',
  ])
  await capture(page, ['ArrowDown', 'ArrowLeft', 'ArrowLeft'], 'howTo', 'menu-help', [
    'ArrowRight',
    'ArrowRight',
  ])
  await capture(page, ['ArrowDown', 'ArrowLeft'], 'credits', 'menu-credits')

  // GIRAR TODAS con las pendientes de ejemplo: progreso y últimas sobre la ruleta.
  await openTile(page, ['ArrowRight'], 'pending')
  await page.keyboard.press('z')
  await page.waitForFunction(
    () => (window as unknown as { __vg: Hooks }).__vg.spinAll().spun >= 2,
    undefined,
    { timeout: 60_000 },
  )
  await page.waitForFunction(
    () => (window as unknown as { __vg: Hooks }).__vg.state().phase === 'landing',
    undefined,
    { timeout: 30_000 },
  )
  await page.waitForTimeout(500)
  await shot(page, 'menu-pending-all')
  await page.keyboard.press('o')
  expect(
    (await page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.spinAll())).running,
  ).toBe(false)
  await context.close()

  // En inglés: el menú principal y los logros.
  const en = await showcase(browser, 'en-GB')
  await seed(en.page)
  await en.page.keyboard.press('p')
  await waitScreen(en.page, 'menu')
  await en.page.keyboard.press('ArrowRight')
  await en.page.waitForTimeout(1300)
  await expect(live(en.page)).toContainText('SPINS')
  await shot(en.page, 'menu-main-en')
  await closeMenu(en.page)
  await capture(
    en.page,
    ['ArrowRight', 'ArrowRight', 'ArrowRight'],
    'achievements',
    'menu-achievements-en',
    ['ArrowDown'],
  )
  await en.context.close()
})
