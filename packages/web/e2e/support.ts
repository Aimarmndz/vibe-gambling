// SPDX-License-Identifier: AGPL-3.0-or-later
// Utilidades comunes de los E2E contra la pila real: login del "mod" con el Device Flow del GitHub
// falso, enlace de un solo uso, turnos simulados por la API (como el mod), ganchos de inspección
// de la ventana y capturas en docs/screenshots/.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from '@playwright/test'
import type { APIRequestContext, Browser, Page } from '@playwright/test'
import {
  API_ROUTES,
  PROTOCOL_VERSION,
  deviceStartResponseSchema,
  devicePollResponseSchema,
  linkResponseSchema,
  meResponseSchema,
  turnEndResponseSchema,
  turnStartResponseSchema,
} from '@vibe-gambling/shared'
import type { SpinAllStatus } from '../src/game/spinAll.ts'
import type { GameState } from '../src/game/state.ts'

const here = fileURLToPath(new URL('.', import.meta.url))
export const shots = resolve(here, '../../../docs/screenshots')
const pluginVersion = (
  JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as { version: string }
).version
/** Duración mínima de un turno: la pila del E2E usa `config/game.json` (playwright.config.ts). */
const minTurnMs = (
  JSON.parse(readFileSync(resolve(here, '../../../config/game.json'), 'utf8')) as {
    turn: { minDurationMs: number }
  }
).turn.minDurationMs

export interface Hooks {
  state(): GameState
  screens(): string[]
  spinAll(): SpinAllStatus
  layoutToClient(x: number, y: number): { x: number; y: number }
  /** Animación de espectáculo en curso (`fx:…`, `wait:…`) y pasos que quedan de la secuencia. */
  fx(): { current: string | null; queued: string[] }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function modLogin(request: APIRequestContext): Promise<string> {
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

/**
 * Login del "mod" con una cuenta recién creada. El GitHub falso da el mismo usuario en toda la
 * ejecución, así que lo que deja un E2E (deuda, la bancarrota de la temporada, rachas de color,
 * logros, idioma) cambiaba lo que veía el siguiente: se borra la cuenta (como el jugador, con
 * `POST /api/me/delete`) y se vuelve a entrar. Cada test empieza con el saldo inicial y limpio.
 */
export async function freshLogin(request: APIRequestContext): Promise<string> {
  const old = await modLogin(request)
  const headers = { authorization: `Bearer ${old}` }
  const me = meResponseSchema.parse(
    await (await request.get(API_ROUTES.me.path, { headers })).json(),
  )
  const deleted = await request.post(API_ROUTES.deleteAccount.path, {
    headers,
    data: { v: PROTOCOL_VERSION, confirm: me.user.login },
  })
  expect(deleted.ok()).toBe(true)
  const token = await modLogin(request)
  const fresh = meResponseSchema.parse(
    await (
      await request.get(API_ROUTES.me.path, { headers: { authorization: `Bearer ${token}` } })
    ).json(),
  )
  expect(fresh.wallet).toMatchObject({ spins: 0, debt: 0, loans: 0, pendingSpins: 0 })
  return token
}

export async function linkUrl(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.post(API_ROUTES.link.path, {
    data: { v: PROTOCOL_VERSION },
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.ok()).toBe(true)
  return linkResponseSchema.parse(await res.json()).url
}

let turnSeq = 0
export async function playTurn(request: APIRequestContext, token: string) {
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
  const startedAt = Date.now()
  return {
    start,
    end: async () => {
      // Como un prompt de verdad: un turno más corto que el mínimo no da tirada.
      const left = startedAt + minTurnMs - Date.now()
      if (left > 0) await sleep(left)
      return turnEndResponseSchema.parse(
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
      )
    },
  }
}

export const vg = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.state())
export const screens = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vg: Hooks }).__vg.screens())

export async function waitPhase(page: Page, phase: GameState['phase'], timeout = 20_000) {
  await page.waitForFunction(
    p => (window as unknown as { __vg?: Hooks }).__vg?.state().phase === p,
    phase,
    {
      timeout,
    },
  )
}

export async function clickLayout(page: Page, x: number, y: number) {
  const p = await page.evaluate(
    ([lx, ly]) => (window as unknown as { __vg: Hooks }).__vg.layoutToClient(lx!, ly!),
    [x, y],
  )
  await page.mouse.click(p.x, p.y)
}

export async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: resolve(shots, `${name}.png`), fullPage })
}

const top = async (page: Page) => (await screens(page)).at(-1) ?? ''

/**
 * Espera a la pantalla de resultado: PUSH TO PROD, ¡VERDE! y los premios gordos van antes y se
 * saltan con ✕, como haría el jugador (la primera pulsación lleva al final, la segunda cierra).
 */
export async function skipToResult(page: Page) {
  await expect
    .poll(
      async () => {
        const id = await top(page)
        if (id === 'result') return true
        if (id.startsWith('fx:')) await page.keyboard.press('x')
        return false
      },
      { timeout: 30_000, intervals: [250] },
    )
    .toBe(true)
}

/**
 * Vuelve a la mesa quieta: cierra el resultado y espera a que acabe lo que va después sobre la
 * mesa (falacia, ON FIRE). Se para (y lo devuelve) si sale una de las pantallas de `stopAt`
 * (p. ej. BANCARROTA o la oferta del préstamo); si no, ✕ cierra el espectáculo y ○ sale de
 * BANCARROTA y de la oferta sin pedir el préstamo.
 */
export async function settle(page: Page, stopAt: readonly string[] = []): Promise<string> {
  let stoppedAt = ''
  await expect
    .poll(
      async () => {
        const now = await page.evaluate(() => {
          const v = (window as unknown as { __vg: Hooks }).__vg
          return { phase: v.state().phase, screens: v.screens(), fx: v.fx() }
        })
        const id = now.screens.at(-1) ?? ''
        if (stopAt.includes(id)) {
          stoppedAt = id
          return true
        }
        if (id === 'fx:bankrupt' || id === 'loan') await page.keyboard.press('o')
        else if (id === 'result' || id.startsWith('fx:')) await page.keyboard.press('x')
        return (
          now.phase === 'idle' &&
          id === 'table' &&
          now.fx.current === null &&
          now.fx.queued.length === 0
        )
      },
      { timeout: 60_000, intervals: [300] },
    )
    .toBe(true)
  return stoppedAt
}

/** BANCARROTA — CONTINUE?: ✕ salta a la cuenta atrás y otra ✕ abre la oferta del préstamo. */
export async function continueToLoan(page: Page) {
  await expect
    .poll(
      async () => {
        if ((await screens(page)).includes('loan')) return true
        await page.keyboard.press('x')
        return false
      },
      { timeout: 20_000, intervals: [400] },
    )
    .toBe(true)
}

/** Juega una ronda completa: abre turno, comprueba que gira, la cierra y espera el resultado. */
export async function round(
  page: Page,
  request: APIRequestContext,
  token: string,
  capture?: string,
) {
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
  await skipToResult(page)
  await expect(page.locator('#live')).toContainText(String(end.round.result))
  return end
}

/** Errores de cada página (se comprueban al cerrar su contexto con `closePlayContext`). */
const pageErrors = new WeakMap<Page, string[]>()

export async function closePlayContext(page: Page): Promise<void> {
  for (const p of page.context().pages()) expect(pageErrors.get(p) ?? []).toEqual([])
  await page.context().close()
}

/** Contexto nuevo, sin CRT (el ratón apunta en línea recta) ni "cómo se juega". */
export async function newPlayPage(browser: Browser, locale = 'es'): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 960, height: 720 },
    locale: locale === 'es' ? 'es-ES' : 'en-US',
  })
  context.on('page', p => {
    const errors: string[] = []
    pageErrors.set(p, errors)
    p.on('pageerror', e => errors.push(e.message))
  })
  // Solo la primera vez: lo que guarde la propia ventana tiene que sobrevivir a las recargas.
  await context.addInitScript(loc => {
    // También corre en about:blank (sin localStorage) al abrir cada pestaña.
    if (!location.protocol.startsWith('http')) return
    localStorage.setItem('vibe-gambling:tip-seen', '1')
    if (!localStorage.getItem('vibe-gambling:prefs')) {
      localStorage.setItem(
        'vibe-gambling:prefs',
        JSON.stringify({ sound: false, crt: false, quality: 'high', locale: loc }),
      )
    }
  }, locale)
  return context.newPage()
}

/** Espera a que la ventana tenga usuario (el `hello` de la demo o del servidor). */
export async function playReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __vg?: { state(): GameState } }).__vg?.state().user,
  )
}
