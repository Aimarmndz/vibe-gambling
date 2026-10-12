// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E de la ventana contra la pila real: login del "mod" con el Device Flow del GitHub falso,
// enlace de un solo uso, arranque → mesa → apostar con teclado y ratón → turno simulado por la
// API (como el mod) → resultado y saldo → préstamo → memory card → ranking → landing.
// Guarda las capturas en docs/screenshots/.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import {
  API_ROUTES,
  PROTOCOL_VERSION,
  deviceStartResponseSchema,
  devicePollResponseSchema,
  linkResponseSchema,
  turnEndResponseSchema,
  turnStartResponseSchema,
  webConfigSchema,
} from '@vibe-gambling/shared'
import type { GameState } from '../src/game/state.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
const shots = resolve(here, '../../../docs/screenshots')
const pluginVersion = (
  JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { version: string }
).version

interface Hooks {
  state(): GameState
  screens(): string[]
  layoutToClient(x: number, y: number): { x: number; y: number }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function modLogin(request: APIRequestContext): Promise<string> {
  const start = deviceStartResponseSchema.parse(
    await (
      await request.post(API_ROUTES.deviceStart.path, { data: { v: PROTOCOL_VERSION } })
    ).json(),
  )
  for (let i = 0; i < 20; i++) {
    await sleep(start.interval * 1000 + 600)
    const poll = devicePollResponseSchema.parse(
      await (
        await request.post(API_ROUTES.devicePoll.path, {
          data: { v: PROTOCOL_VERSION, pollId: start.pollId },
        })
      ).json(),
    )
    if (poll.status === 'ok') return poll.token
    if (poll.status === 'expired' || poll.status === 'denied')
      throw new Error(`login ${poll.status}`)
  }
  throw new Error('el Device Flow no terminó')
}

async function linkUrl(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.post(API_ROUTES.link.path, {
    data: { v: PROTOCOL_VERSION },
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.ok()).toBe(true)
  return linkResponseSchema.parse(await res.json()).url
}

let turnSeq = 0
async function playTurn(request: APIRequestContext, token: string) {
  const turnId = `e2e-turn-${Date.now().toString(36)}-${turnSeq++}`
  const headers = { authorization: `Bearer ${token}` }
  const start = turnStartResponseSchema.parse(
    await (
      await request.post(API_ROUTES.turnStart.path, {
        headers,
        data: { v: PROTOCOL_VERSION, turnId, pluginVersion, os: 'linux' },
      })
    ).json(),
  )
  return {
    start,
    end: async () =>
      turnEndResponseSchema.parse(
        await (
          await request.post(API_ROUTES.turnEnd.path, {
            headers,
            data: {
              v: PROTOCOL_VERSION,
              turnId,
              durationMs: 1200,
              gitPushOk: false,
              testFailed: false,
              pluginVersion,
              os: 'linux',
            },
          })
        ).json(),
      ),
  }
}

const vg = (page: Page) => page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.state())
const screens = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.screens())

async function waitPhase(page: Page, phase: GameState['phase'], timeout = 20_000) {
  await page.waitForFunction(
    p => (window as unknown as { __vg?: Hooks }).__vg?.state().phase === p,
    phase,
    {
      timeout,
    },
  )
}

async function clickLayout(page: Page, x: number, y: number) {
  const p = await page.evaluate(
    ([lx, ly]) => (window as unknown as { __vg: Hooks }).__vg.layoutToClient(lx!, ly!),
    [x, y],
  )
  await page.mouse.click(p.x, p.y)
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: resolve(shots, `${name}.png`), fullPage })
}

/** Juega una ronda completa: abre turno, comprueba que gira, la cierra y espera el resultado. */
async function round(page: Page, request: APIRequestContext, token: string, capture?: string) {
  const turn = await playTurn(request, token)
  expect(turn.start.windowConnected).toBe(true)
  await waitPhase(page, 'spinning')
  if (capture) await shot(page, `${capture}-spinning`)
  const end = await turn.end()
  expect(end.status).toBe('resolved')
  if (end.status !== 'resolved') throw new Error('sin ronda')
  // El resultado no se enseña antes de revealAt.
  const early = await page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.state().phase)
  if (Date.now() < Date.parse(end.round.revealAt)) expect(early).not.toBe('result')
  await waitPhase(page, 'result')
  expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(end.round.revealAt) - 50)
  const state = await vg(page)
  expect(state.lastRound?.result).toBe(end.round.result)
  expect(state.shown?.balance).toBe(end.wallet.balance)
  await expect(page.locator('#live')).toContainText(String(end.round.result))
  return end
}

test('la ventana juega una ronda de verdad contra el servidor', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  const token = await modLogin(request)

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
  await page.keyboard.press('x')
  // Primera apertura: "cómo se juega" (el giro lo lanza un prompt en Claude Code).
  await page.waitForFunction(() =>
    (window as unknown as { __vg?: Hooks }).__vg?.screens().includes('tip'),
  )
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
  await page.keyboard.press('x')
  await waitPhase(page, 'idle')

  // Memory card (menú → MEMORY CARD) y ranking (menú → CLASIFICACIÓN).
  await page.keyboard.press('p')
  await page.waitForTimeout(200)
  await shot(page, 'menu')
  // CONTINUAR · CÓMO SE GIRA · CLASIFICACIÓN · MEMORY CARD…
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('x')
  await page.waitForTimeout(400)
  expect(await screens(page)).toContain('memoryCard')
  await shot(page, 'memory-card')
  await page.keyboard.press('o')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('x')
  await page.waitForTimeout(1200)
  expect(await screens(page)).toContain('leaderboard')
  await shot(page, 'leaderboard')
  await page.keyboard.press('o')
  await page.keyboard.press('o')

  // Arruinarse: todo al 17 hasta perder; entonces aparece el Ludo-Crédito Express.
  await page.keyboard.press('6')
  let broke = false
  for (let i = 0; i < 6 && !broke; i++) {
    await clickLayout(page, 5.5, 1.5)
    await page.waitForFunction(
      () => (window as unknown as { __vg: Hooks }).__vg.state().slip.total > 0,
    )
    await round(page, request, token)
    await page.waitForTimeout(700)
    await page.keyboard.press('x')
    await page.waitForTimeout(800)
    broke = (await vg(page)).shown!.balance < 10
  }
  expect(broke).toBe(true)
  await page.waitForFunction(() =>
    (window as unknown as { __vg: Hooks }).__vg.screens().includes('loan'),
  )
  await page.waitForTimeout(300)
  await shot(page, 'loan')
  await page.keyboard.press('x')
  await page.waitForFunction(
    () => ((window as unknown as { __vg: Hooks }).__vg.state().shown?.debt ?? 0) > 0,
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

test('landing con el ranking y página de privacidad', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#install-command')).not.toBeEmpty()
  await expect(page.locator('#board-rows tr').first()).toBeVisible()
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
  await expect(sections).toContainText(instance.hosting.es)
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
