// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E de la ventana contra la pila real: login del "mod" con el Device Flow del GitHub falso,
// enlace de un solo uso, arranque → mesa → apostar con teclado y ratón → turno simulado por la
// API (como el mod) → resultado y saldo → préstamo → memory card → ranking → landing.
// Guarda las capturas en docs/screenshots/.
import { expect, test } from '@playwright/test'
import {
  API_ROUTES,
  meResponseSchema,
  spinAllStopReason,
  forLocale,
  webConfigSchema,
} from '@vibe-gambling/shared'
import {
  clickLayout,
  continueToLoan,
  freshLogin,
  linkUrl,
  playTurn,
  round,
  screens,
  settle,
  shot,
  skipToResult,
  vg,
  waitPhase,
} from './support.ts'
import type { Hooks } from './support.ts'

test('la ventana juega una ronda de verdad contra el servidor', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const token = await freshLogin(request)

  // Sin sesión: pantalla que explica cómo entrar.
  // Contexto nuevo (sin cookies) con la misma configuración que el principal.
  const fresh = () =>
    browser.newPage({ baseURL, viewport: { width: 960, height: 720 }, locale: 'es-ES' })
  const anon = await fresh()
  await anon.goto('/play?noboot')
  await anon.waitForFunction(() =>
    (window as unknown as { __vg?: Hooks }).__vg?.screens().includes('message'),
  )
  await anon.waitForTimeout(400)
  await shot(anon, 'login-required')
  await anon.close()

  // Enlace de un solo uso: la web lo canjea y lo quita de la URL.
  const url = await linkUrl(request, token)
  await page.goto(url)
  await page.waitForTimeout(2600)
  await shot(page, 'boot')
  await page.waitForTimeout(1800)
  await shot(page, 'boot-licensed')
  await page.waitForTimeout(1500)
  await shot(page, 'boot-title')
  // Primera apertura: "cómo se juega" (el giro lo lanza un prompt en Claude Code).
  // En un runner lento el arranque puede ir por detrás de las esperas fijas: se pulsa ✕ solo
  // mientras el consejo no haya salido, comprobándolo antes de cada pulsación.
  await expect
    .poll(
      async () => {
        if ((await screens(page)).includes('tip')) return true
        await page.keyboard.press('x')
        return false
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(true)
  await page.waitForTimeout(300)
  await shot(page, 'tip')
  await page.keyboard.press('x')
  await page.waitForFunction(
    () => (window as unknown as { __vg?: Hooks }).__vg?.state().user !== null,
  )
  expect(await screens(page)).not.toContain('tip')
  expect(page.url()).not.toContain('code=')
  await page.waitForTimeout(500)
  await shot(page, 'table')

  // Apostar con el teclado (cursor en el 17, una a la derecha → 20) y con el ratón (al rojo).
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('x')
  await page.waitForFunction(
    () => (window as unknown as { __vg: Hooks }).__vg.state().slip.bets.length === 1,
  )
  // Sin botón de girar: la primera ficha avisa de que se jugará con el próximo prompt.
  await expect(page.locator('#live')).toContainText('próximo prompt')
  await clickLayout(page, 5, 4.5)
  await page.waitForFunction(
    () => (window as unknown as { __vg: Hooks }).__vg.state().slip.bets.length === 2,
  )
  const slip = (await vg(page)).slip
  expect(slip.bets.map(b => b.selection.kind).sort()).toEqual(['red', 'straight'])
  await page.mouse.move(10, 10)
  await page.waitForTimeout(300)
  await shot(page, 'bet')

  // Turno de Claude simulado por la API, como lo haría el mod.
  await round(page, request, token, 'round')
  await page.waitForTimeout(600)
  await shot(page, 'result')
  // Cierra el resultado y espera a lo que vaya después sobre la mesa (falacia, ON FIRE).
  await settle(page)

  // Memory card (menú → MEMORY CARD) y ranking (menú → CLASIFICACIÓN).
  await page.keyboard.press('p')
  await page.waitForTimeout(200)
  await shot(page, 'menu')
  // Rejilla de 5×2: MEMORY CARD es la segunda de la fila de abajo.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('x')
  await page.waitForTimeout(400)
  expect(await screens(page)).toContain('memoryCard')
  await shot(page, 'memory-card')
  // Vuelta a la rejilla y a CLASIFICACIÓN (la última de la fila de arriba).
  await page.keyboard.press('o')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('x')
  await page.waitForTimeout(1200)
  expect(await screens(page)).toContain('leaderboard')
  await shot(page, 'leaderboard')
  await page.keyboard.press('o')
  await page.keyboard.press('o')

  // Arruinarse: todo al 17 hasta perder (si sale el 17, ¡PLENO! y otra vez). Con la cuenta nueva
  // es la primera ruina de la temporada: BANCARROTA — CONTINUE? y ✕ lleva al Ludo-Crédito Express.
  await page.keyboard.press('6')
  let broke = false
  let stoppedAt = ''
  for (let i = 0; i < 6 && !broke; i++) {
    // La cámara vuelve al tapete tras cada resultado: si el clic llega mientras se mueve, cae fuera
    // de la casilla. Se repite (comprobando antes de cada clic) hasta que la apuesta está puesta.
    await expect
      .poll(
        async () => {
          if ((await vg(page)).slip.total > 0) return true
          await clickLayout(page, 5.5, 1.5)
          return false
        },
        { timeout: 30_000, intervals: [600] },
      )
      .toBe(true)
    await round(page, request, token)
    await page.waitForTimeout(700)
    stoppedAt = await settle(page, ['fx:bankrupt', 'loan'])
    broke = (await vg(page)).shown!.balance < 10
  }
  expect(broke).toBe(true)
  expect(stoppedAt).toBe('fx:bankrupt')
  // Sin esperar los 9 s de la cuenta atrás.
  await continueToLoan(page)
  await page.waitForTimeout(300)
  await shot(page, 'loan')
  // Cuenta nueva: es su primer préstamo.
  expect((await vg(page)).shown!.loans).toBe(0)
  await page.keyboard.press('x')
  await page.waitForFunction(
    () => ((window as unknown as { __vg: Hooks }).__vg.state().shown?.loans ?? 0) === 1,
  )
  const after = await vg(page)
  expect(after.shown!.balance).toBeGreaterThanOrEqual(10)

  // Sin CRT (ajuste guardado en el navegador): mesa y resultado con los píxeles limpios.
  await page.evaluate(() =>
    localStorage.setItem(
      'vibe-gambling:prefs',
      JSON.stringify({ sound: true, crt: false, quality: 'high', locale: 'es' }),
    ),
  )
  await page.reload()
  await page.waitForFunction(
    () => (window as unknown as { __vg?: Hooks }).__vg?.state().user !== null,
  )
  await page.keyboard.press('2')
  await clickLayout(page, 6.5, 4.5)
  await page.waitForFunction(
    () => (window as unknown as { __vg: Hooks }).__vg.state().slip.total > 0,
  )
  await page.waitForTimeout(400)
  await shot(page, 'table-no-crt')
  await round(page, request, token)
  await page.waitForTimeout(600)
  await shot(page, 'result-no-crt')

  // Un enlace ya usado no vale dos veces.
  const reused = await fresh()
  await reused.goto(url)
  await reused.waitForFunction(() =>
    (window as unknown as { __vg?: Hooks }).__vg?.screens().includes('message'),
  )
  await reused.close()
})

test('tiradas pendientes: se acumulan con la ventana cerrada y se gastan con GIRAR y GIRAR TODAS', async ({
  page,
  request,
}) => {
  const token = await freshLogin(request)
  const headers = { authorization: `Bearer ${token}` }
  const web = webConfigSchema.parse(await (await request.get('/config.json')).json())
  const me = async () =>
    meResponseSchema.parse(await (await request.get(API_ROUTES.me.path, { headers })).json())
  const before = (await me()).wallet

  // 1. Sin ninguna ventana abierta, cada turno (como lo manda el mod) se guarda.
  const QUEUED = 6
  for (let i = 0; i < QUEUED; i++) {
    const turn = await playTurn(request, token)
    expect(turn.start.windowConnected).toBe(false)
    const end = await turn.end()
    expect(end.status).toBe('queued')
    if (end.status !== 'queued') throw new Error('debía guardarse')
    expect(end.dropped).toBe(false)
    expect(end.wallet.pendingSpins).toBe(before.pendingSpins + i + 1)
  }
  const pending = before.pendingSpins + QUEUED
  expect((await me()).wallet).toMatchObject({ pendingSpins: pending, spins: before.spins })

  // 2. Al abrir la ventana: aviso con el contador; ✕ lleva a la pantalla de tiradas pendientes.
  await page.addInitScript(() => localStorage.setItem('vibe-gambling:tip-seen', '1'))
  await page.goto(`${await linkUrl(request, token)}&noboot`)
  await page.waitForFunction(() =>
    (window as unknown as { __vg?: Hooks }).__vg?.screens().includes('pendingNotice'),
  )
  expect((await vg(page)).wallet?.pendingSpins).toBe(pending)
  await expect(page.locator('#live')).toContainText(`${pending} TIRADAS`)
  await page.waitForTimeout(500)
  await shot(page, 'pending-notice')
  await page.keyboard.press('x')
  await page.waitForFunction(() =>
    (window as unknown as { __vg: Hooks }).__vg.screens().includes('pending'),
  )
  await page.waitForTimeout(400)
  await shot(page, 'pending-screen')
  await page.keyboard.press('o')
  await page.waitForTimeout(600)
  expect(await screens(page)).not.toContain('pending')
  await shot(page, 'pending-hud')

  // 3. GIRAR una (tecla G): el servidor la tira y llega como cualquier ronda.
  await page.keyboard.press('g')
  await waitPhase(page, 'landing')
  expect((await vg(page)).wallet?.pendingSpins).toBe(pending - 1)
  await waitPhase(page, 'result')
  await skipToResult(page)
  await page.waitForTimeout(400)
  await shot(page, 'pending-result')
  await settle(page)
  expect((await me()).wallet).toMatchObject({ pendingSpins: pending - 1, spins: before.spins + 1 })

  const spinAll = () => page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.spinAll())
  const startSpinAll = async () => {
    // Desde la mesa quieta (sin resultado, falacia, BANCARROTA ni oferta del préstamo encima).
    await settle(page)
    // Menú → TIRADAS → □ TODAS.
    await page.keyboard.press('p')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('x')
    await page.waitForFunction(() =>
      (window as unknown as { __vg: Hooks }).__vg.screens().includes('pending'),
    )
    await page.keyboard.press('z')
    await page.waitForFunction(() => (window as unknown as { __vg: Hooks }).__vg.spinAll().running)
  }

  // 4. GIRAR TODAS y pararla con ○ en cuanto haya gastado una (si no se ha parado sola antes).
  await startSpinAll()
  await page.waitForFunction(
    () => (window as unknown as { __vg: Hooks }).__vg.spinAll().spun >= 1,
    undefined,
    { timeout: 30_000 },
  )
  await shot(page, 'pending-spin-all')
  await page.keyboard.press('o')
  const first = await spinAll()
  expect(first.running).toBe(false)
  expect(['user', 'bigWin', 'green', 'broke', 'empty']).toContain(first.ended)

  // 5. Otra vez GIRAR TODAS, hasta que se pare sola (no quedan, premio gordo, verde o bancarrota).
  await page.waitForFunction(() => {
    const vgh = (window as unknown as { __vg: Hooks }).__vg
    return vgh.state().phase === 'idle' || vgh.state().phase === 'result'
  })
  await settle(page)
  let left = (await vg(page)).wallet?.pendingSpins ?? 0
  while (left > 0) {
    await startSpinAll()
    await page.waitForFunction(
      () => !(window as unknown as { __vg: Hooks }).__vg.spinAll().running,
      undefined,
      { timeout: 120_000 },
    )
    const status = await spinAll()
    const state = await vg(page)
    if (status.ended !== 'empty') {
      // Se paró sola: el motivo es el de las reglas de shared con la última tirada.
      expect(status.ended).not.toBe('error')
      expect(state.lastRound ?? state.pending).not.toBeNull()
      const last = (state.pending ?? state.lastRound)!
      expect(spinAllStopReason(last, state.wallet!, web.game)).toBe(status.ended)
    }
    await settle(page)
    left = (await vg(page)).wallet?.pendingSpins ?? 0
  }
  await settle(page)

  // 6. El servidor está de acuerdo: ninguna pendiente y todas cuentan como tiradas.
  const after = (await me()).wallet
  expect(after.pendingSpins).toBe(0)
  expect(after.spins).toBe(before.spins + pending)
})

test('landing con el ranking y página de privacidad', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#install-command')).not.toBeEmpty()
  await expect(page.locator('#board-rows tr').first()).toBeVisible()
  // Antiabuso: la regla de las cuentas de GitHub nuevas, con los días de config/game.json.
  const web0 = webConfigSchema.parse(await (await page.request.get('/config.json')).json())
  await expect(page.locator('#board-note')).toBeVisible()
  await expect(page.locator('#board-note')).toContainText(
    `menos de ${web0.game.minAccountAgeDays} días juegan`,
  )
  await expect(page.locator('#footer')).toContainText('Aimar')
  await page.waitForTimeout(2500)
  await shot(page, 'landing', true)
  await page.goto('/privacy')
  await expect(page.locator('#sections h2')).toHaveCount(9)
  // Lo que depende de la instancia sale de /config.json (site.json y el entorno del servidor).
  const web = webConfigSchema.parse(await (await page.request.get('/config.json')).json())
  const { instance } = web.site
  const sections = page.locator('#sections')
  await expect(
    sections.getByRole('link', { name: instance.operator.name }).first(),
  ).toHaveAttribute('href', instance.operator.url)
  await expect(sections).toContainText(forLocale(instance.hosting, 'es'))
  if (instance.networkProxy) await expect(sections).toContainText(instance.networkProxy)
  for (const origin of web.privacy.imageOrigins) {
    await expect(sections).toContainText(new URL(origin).host)
  }
  if (instance.backupRetentionDays !== null) {
    await expect(sections).toContainText(`${instance.backupRetentionDays} días`)
  }
  await expect(sections.getByRole('link', { name: instance.contact.label })).toHaveAttribute(
    'href',
    instance.contact.url,
  )
  await shot(page, 'privacy', true)
})
