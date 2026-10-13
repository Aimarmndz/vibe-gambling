// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E de la pila completa con un turno REAL de Claude Code (.plan/09, "E2E de la pila completa").
//
// Requisitos: la pila de desarrollo levantada (`docker compose -f deploy/docker-compose.dev.yml up -d`),
// `claude` instalado y con sesión, y el mod logueado contra ese servidor (una vez, `/vibe-login`
// en una sesión interactiva con `serverUrl` apuntando a la pila). No corre en el CI porque necesita
// una cuenta de Claude.
//
// Pasos:
//  1. La "ventana" (Chromium de Playwright) entra como el usuario del GitHub falso con el enlace
//     de un solo uso, igual que la que abre el mod.
//  2. `claude -p … --plugin-dir packages/mod` hace un turno real.
//  3. La ventana recibe `round.started` y después `round.resolved`, y la base de datos tiene la
//     ronda resuelta por ese turno.
//  4. Con el servidor parado, el turno de Claude Code termina igual de rápido y sin errores.
//
// Uso: pnpm --filter @vibe-gambling/web test:e2e:claude
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from '@playwright/test'
import { z } from 'zod'

const env = z
  .object({
    E2E_BASE_URL: z.url(),
    E2E_COMPOSE_FILE: z.string().min(1),
    E2E_CLAUDE_BIN: z.string().min(1),
    E2E_SCREENSHOT: z.string().min(1),
    /** Margen máximo que puede añadir el mod a un turno con el servidor caído (ms). */
    E2E_MAX_EXTRA_MS: z.coerce.number().int().positive(),
  })
  .parse(process.env)

const repo = resolve(import.meta.dirname, '../../..')
const modDir = join(repo, 'packages/mod')
const compose = ['compose', '-f', resolve(repo, env.E2E_COMPOSE_FILE)]

function log(msg: string): void {
  console.log(`[e2e-claude] ${msg}`)
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

/** Un turno real de Claude Code con el mod cargado. Devuelve duración y salida. */
function claudeTurn(settingsPath: string): { ms: number; code: number | null; out: string } {
  const t0 = Date.now()
  const run = spawnSync(
    env.E2E_CLAUDE_BIN,
    [
      '-p',
      'Responde solo con la palabra: hola',
      '--plugin-dir',
      modDir,
      '--settings',
      settingsPath,
    ],
    { cwd: repo, encoding: 'utf8', timeout: 180_000 },
  )
  return { ms: Date.now() - t0, code: run.status, out: `${run.stdout}${run.stderr}` }
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'vibe-e2e-'))
  const settingsPath = join(tmp, 'settings.json')
  writeFileSync(
    settingsPath,
    JSON.stringify({
      pluginConfigs: { 'vibe-gambling': { options: { serverUrl: env.E2E_BASE_URL } } },
    }),
  )
  const browser = await chromium.launch()
  try {
    // 1. La ventana entra como el usuario del GitHub falso.
    const token = await login()
    const link = await api<{ url: string }>('/api/auth/link', { v: 1 }, token)
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } })
    const frames: { type: string; at: number; body: Record<string, unknown> }[] = []
    page.on('websocket', ws =>
      ws.on('framereceived', frame => {
        const body = JSON.parse(String(frame.payload)) as Record<string, unknown>
        frames.push({ type: String(body.type), at: Date.now(), body })
      }),
    )
    await page.goto(`${link.url}&nogpuwarn`)
    await waitFor(() => frames.some(f => f.type === 'hello'), 20_000, 'hello de la ventana')
    const user = (frames.find(f => f.type === 'hello')?.body.user as { login: string }).login
    log(`ventana conectada como ${user}`)
    // Salta el arranque para que la mesa quede a la vista.
    await page.keyboard.press('x')
    await page.keyboard.press('x')

    // 2. Turno real de Claude Code.
    const before = Number(psql(`select count(*) from rounds where status = 'resolved'`))
    const turn = claudeTurn(settingsPath)
    log(`turno de Claude Code: ${turn.ms} ms, salida ${JSON.stringify(turn.out.trim())}`)
    if (turn.code !== 0) throw new Error(`claude -p terminó con ${turn.code}`)

    // 3. La ventana recibe el inicio y el final de la ronda, en ese orden.
    await waitFor(() => frames.some(f => f.type === 'round.resolved'), 20_000, 'round.resolved')
    const started = frames.find(f => f.type === 'round.started')
    const resolved = frames.find(f => f.type === 'round.resolved')
    if (!started || !resolved || started.at > resolved.at)
      throw new Error('round.started tiene que llegar antes que round.resolved')
    const round = resolved.body.round as { roundId: string; result: number; revealAt: string }
    const row = psql(
      `select r.status || ' ' || r.result || ' ' || (t.turn_id is not null) from rounds r ` +
        `left join turns t on t.round_id = r.id where r.id = '${round.roundId}' limit 1`,
    )
    const after = Number(psql(`select count(*) from rounds where status = 'resolved'`))
    log(`ronda ${round.roundId}: ${row} (resueltas ${before} → ${after})`)
    if (row !== `resolved ${round.result} true` || after !== before + 1)
      throw new Error(`la base de datos no cuadra: ${row}`)
    await page.waitForTimeout(Math.max(0, Date.parse(round.revealAt) - Date.now()) + 6_000)
    await page.screenshot({ path: resolve(repo, env.E2E_SCREENSHOT) })
    log(`captura en ${env.E2E_SCREENSHOT}`)

    // 4. Con el servidor parado, el turno sigue igual de rápido y sin errores.
    execFileSync('docker', [...compose, 'stop', 'server'], { stdio: 'ignore' })
    try {
      const down = claudeTurn(settingsPath)
      log(`turno con el servidor caído: ${down.ms} ms, salida ${JSON.stringify(down.out.trim())}`)
      if (down.code !== 0) throw new Error(`claude -p terminó con ${down.code} sin servidor`)
      if (down.ms > turn.ms + env.E2E_MAX_EXTRA_MS)
        throw new Error(`el mod alargó el turno: ${down.ms} ms frente a ${turn.ms} ms`)
      if (/error|exception|vibe-gambling/i.test(down.out))
        throw new Error('la salida enseña errores del mod')
    } finally {
      execFileSync('docker', [...compose, 'start', 'server'], { stdio: 'ignore' })
    }
    await waitFor(
      async () =>
        (await fetch(new URL('/healthz', env.E2E_BASE_URL)).catch(() => null))?.ok ?? false,
      60_000,
      'servidor de vuelta',
    )
    log('OK')
  } finally {
    await browser.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

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

main().catch((error: unknown) => {
  console.error(`[e2e-claude] FALLO: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
