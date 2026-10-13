// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E de las tiradas pendientes con turnos REALES de Claude Code (.plan/12 §1 y §6).
//
// Requisitos: los de claude-turn.ts (pila de desarrollo levantada, `claude` con sesión y el mod
// logueado contra ese servidor como el usuario del GitHub falso) y **ninguna ventana del juego
// abierta** para ese usuario. No corre en el CI porque necesita una cuenta de Claude.
//
// Pasos:
//  1. Con la ventana cerrada, `E2E_PENDING_TURNS` turnos de `claude -p … --plugin-dir packages/mod`.
//  2. La base de datos tiene esas tiradas pendientes (rondas `deferred`) del usuario.
//  3. La ventana (Chromium de Playwright) entra con el enlace de un solo uso: aviso con el
//     contador, GIRAR una (tecla G) y GIRAR TODAS (menú) hasta vaciar la cola.
//  4. La base de datos tiene esas rondas resueltas (gastadas con un `spend_request_id`) y ninguna
//     pendiente.
//
// Uso: pnpm --filter @vibe-gambling/web test:e2e:pending
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from '@playwright/test'
import type { Page } from '@playwright/test'
import { z } from 'zod'

const env = z
  .object({
    E2E_BASE_URL: z.url(),
    E2E_COMPOSE_FILE: z.string().min(1),
    E2E_CLAUDE_BIN: z.string().min(1),
    E2E_PENDING_TURNS: z.coerce.number().int().min(2).max(20),
    E2E_PENDING_PROMPT: z.string().min(1),
    E2E_PENDING_SCREENSHOT: z.string().min(1),
  })
  .parse(process.env)

const repo = resolve(import.meta.dirname, '../../..')
const modDir = join(repo, 'packages/mod')
const compose = ['compose', '-f', resolve(repo, env.E2E_COMPOSE_FILE)]

function log(msg: string): void {
  console.log(`[e2e-pending] ${msg}`)
}

async function api<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(new URL(path, env.E2E_BASE_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

/** Device Flow contra el GitHub falso: da un token del mismo usuario que usa el mod. */
async function login(): Promise<string> {
  const start = await api<{ pollId: string; interval: number }>('/api/auth/device/start', { v: 1 })
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, start.interval * 1000))
    const poll = await api<{ status: string; token?: string }>('/api/auth/device/poll', {
      v: 1,
      pollId: start.pollId,
    })
    if (poll.status === 'ok' && poll.token) return poll.token
    if (poll.status !== 'pending' && poll.status !== 'slow_down') throw new Error(poll.status)
  }
  throw new Error('el Device Flow no terminó')
}

function psql(query: string): string {
  return execFileSync(
    'docker',
    [...compose, 'exec', '-T', 'postgres', 'psql', '-U', 'vibe', '-d', 'vibe', '-tAc', query],
    { encoding: 'utf8' },
  ).trim()
}

/** Id del usuario en la base de datos (el login es el del GitHub falso; ya validado). */
function userIdOf(login: string): string {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) throw new Error(`login raro: ${login}`)
  const id = psql(`select id from users where login = '${login}'`)
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`no encuentro al usuario ${login}`)
  return id
}

function countRounds(userId: string, where: string): number {
  return Number(psql(`select count(*) from rounds where user_id = '${userId}' and ${where}`))
}

function claudeTurn(settingsPath: string): { ms: number; code: number | null; out: string } {
  const t0 = Date.now()
  const run = spawnSync(
    env.E2E_CLAUDE_BIN,
    ['-p', env.E2E_PENDING_PROMPT, '--plugin-dir', modDir, '--settings', settingsPath],
    { cwd: repo, encoding: 'utf8', timeout: 180_000 },
  )
  return { ms: Date.now() - t0, code: run.status, out: `${run.stdout}${run.stderr}` }
}

interface Hooks {
  state(): {
    phase: string
    wallet: { pendingSpins: number; spins: number } | null
    user: unknown
  }
  screens(): string[]
  spinAll(): { running: boolean; spun: number; ended: string | null }
}

/** Estado de la ventana (vacío mientras la página aún no ha arrancado el juego). */
const hooks = (page: Page) =>
  page.evaluate(() => {
    const vg = (window as unknown as { __vg?: Hooks }).__vg
    if (!vg) {
      return {
        state: { phase: 'loading', wallet: null, user: null },
        screens: [] as string[],
        spinAll: { running: false, spun: 0, ended: null },
      }
    }
    return { state: vg.state(), screens: vg.screens(), spinAll: vg.spinAll() }
  })

async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await check()) return
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`timeout esperando ${what}`)
}

/** Deja la mesa quieta: cierra el resultado o el préstamo si están en pantalla. */
async function settle(page: Page): Promise<void> {
  await waitFor(
    async () => {
      const h = await hooks(page)
      if (h.spinAll.running) return false
      if (h.screens.includes('loan')) await page.keyboard.press('o')
      else if (h.state.phase === 'result') await page.keyboard.press('x')
      return h.state.phase === 'idle' && h.screens.at(-1) === 'table'
    },
    60_000,
    'la mesa quieta',
  )
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'vibe-e2e-pending-'))
  const settingsPath = join(tmp, 'settings.json')
  writeFileSync(
    settingsPath,
    JSON.stringify({
      pluginConfigs: { 'vibe-gambling': { options: { serverUrl: env.E2E_BASE_URL } } },
    }),
  )
  const browser = await chromium.launch()
  try {
    const token = await login()
    const me = (await (
      await fetch(new URL('/api/me', env.E2E_BASE_URL), {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { user: { login: string } }
    const userId = userIdOf(me.user.login)
    const before = {
      deferred: countRounds(userId, `status = 'deferred'`),
      spent: countRounds(userId, `spend_request_id is not null`),
    }
    log(`usuario ${me.user.login}: ${before.deferred} pendientes y ${before.spent} gastadas antes`)

    // 1-2. Turnos reales con la ventana cerrada: se guardan.
    for (let i = 0; i < env.E2E_PENDING_TURNS; i++) {
      const turn = claudeTurn(settingsPath)
      log(`turno ${i + 1}: ${turn.ms} ms, salida ${JSON.stringify(turn.out.trim())}`)
      if (turn.code !== 0) throw new Error(`claude -p terminó con ${turn.code}`)
    }
    const queued = countRounds(userId, `status = 'deferred'`)
    // Puede haber pendientes de antes (otra ejecución a medias): se gastan todas.
    log(`pendientes en la base de datos: ${before.deferred} → ${queued}`)
    log(
      psql(
        `select r.status || ' · turno ' || r.resolved_by_turn_id || ' · push ' || r.git_push_ok || ` +
          `' · tests ' || r.test_failed || ' · ' || to_char(r.deferred_at, 'HH24:MI:SS') ` +
          `from rounds r where r.user_id = '${userId}' and r.status = 'deferred' ` +
          `order by r.deferred_at desc limit ${env.E2E_PENDING_TURNS}`,
      ),
    )
    if (queued !== before.deferred + env.E2E_PENDING_TURNS) {
      throw new Error(`esperaba ${before.deferred + env.E2E_PENDING_TURNS} pendientes`)
    }

    // 3. La ventana: aviso, GIRAR una y GIRAR TODAS.
    const link = await api<{ url: string }>('/api/auth/link', { v: 1 }, token)
    const page = await browser.newPage({ viewport: { width: 960, height: 720 }, locale: 'es-ES' })
    await page.addInitScript(() => localStorage.setItem('vibe-gambling:tip-seen', '1'))
    await page.goto(`${link.url}&noboot&nogpuwarn`)
    await waitFor(
      async () => (await hooks(page)).screens.includes('pendingNotice'),
      30_000,
      'el aviso de tiradas pendientes',
    )
    log(`aviso al abrir: ${(await hooks(page)).state.wallet?.pendingSpins} pendientes`)
    await page.keyboard.press('o')
    await settle(page)
    await page.keyboard.press('g')
    await waitFor(async () => (await hooks(page)).state.phase === 'result', 30_000, 'GIRAR')
    log(`GIRAR: quedan ${(await hooks(page)).state.wallet?.pendingSpins}`)
    // Que termine de entrar el disco con el número antes de la captura.
    await page.waitForTimeout(600)
    await page.screenshot({ path: resolve(repo, env.E2E_PENDING_SCREENSHOT) })
    await settle(page)

    for (let pass = 1; ((await hooks(page)).state.wallet?.pendingSpins ?? 0) > 0; pass++) {
      if (pass > 50) throw new Error('GIRAR TODAS no termina')
      // Menú → TIRADAS PENDIENTES → GIRAR TODAS.
      // Menú → TIRADAS (segunda casilla de la rejilla) → □ TODAS.
      await page.keyboard.press('p')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('x')
      await waitFor(async () => (await hooks(page)).screens.includes('pending'), 5000, 'pantalla')
      await page.keyboard.press('z')
      await waitFor(async () => (await hooks(page)).spinAll.running, 5000, 'GIRAR TODAS')
      await waitFor(async () => !(await hooks(page)).spinAll.running, 180_000, 'que se pare')
      const h = await hooks(page)
      log(
        `GIRAR TODAS (pasada ${pass}): ${h.spinAll.spun} tiradas, parada por ${h.spinAll.ended}, ` +
          `quedan ${h.state.wallet?.pendingSpins}`,
      )
      if (h.spinAll.ended === 'error') throw new Error('GIRAR TODAS se paró por un error')
      await settle(page)
    }

    // 4. La base de datos: todas gastadas.
    const left = countRounds(userId, `status = 'deferred'`)
    const spent = countRounds(userId, `spend_request_id is not null`)
    log(`pendientes ${queued} → ${left}; gastadas ${before.spent} → ${spent}`)
    log(
      psql(
        `select r.status || ' · ' || r.result || ' ' || r.source || ' · neto ' || r.net || ` +
          `' · turno ' || r.resolved_by_turn_id || ' · giro ' || ` +
          `extract(epoch from (r.reveal_at - r.opened_at))::int || ' s' ` +
          `from rounds r where r.user_id = '${userId}' and r.spend_request_id is not null ` +
          `order by r.resolved_at desc limit ${queued}`,
      ),
    )
    if (left !== 0 || spent !== before.spent + queued) {
      throw new Error('la base de datos no cuadra')
    }
    log('OK')
  } finally {
    await browser.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(`[e2e-pending] FALLO: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
