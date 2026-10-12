// SPDX-License-Identifier: AGPL-3.0-or-later
// Utilidades comunes de los E2E contra la pila real: login del "mod" con el Device Flow del GitHub
// falso, enlace de un solo uso, turnos simulados por la API (como el mod), ganchos de inspección
// de la ventana y capturas en docs/screenshots/.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import {
  API_ROUTES,
  PROTOCOL_VERSION,
  deviceStartResponseSchema,
  devicePollResponseSchema,
  linkResponseSchema,
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

export interface Hooks {
  state(): GameState
  screens(): string[]
  spinAll(): SpinAllStatus
  layoutToClient(x: number, y: number): { x: number; y: number }
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
  await expect(page.locator('#live')).toContainText(String(end.round.result))
  return end
}
