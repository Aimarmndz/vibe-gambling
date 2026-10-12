// SPDX-License-Identifier: AGPL-3.0-or-later
// Graba el GIF del README (`docs/demo.gif`) con un turno REAL de Claude Code: la ventana del juego
// (Chromium de Playwright, logueada como el usuario del GitHub falso) apuesta, `claude -p` trabaja
// con el mod cargado y la ruleta gira hasta que la bola cae. Nada está simulado.
//
// Requisitos: los mismos que `claude-turn.ts` (pila de desarrollo, `claude` con sesión, mod logueado)
// y `ffmpeg` en el PATH.
//
// Uso: pnpm --filter @vibe-gambling/web demo:record
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from '@playwright/test'
import { z } from 'zod'

const env = z
  .object({
    E2E_BASE_URL: z.url(),
    E2E_CLAUDE_BIN: z.string().min(1),
    DEMO_PROMPT: z.string().min(1),
    DEMO_OUTPUT: z.string().min(1),
    /** Ancho del GIF en píxeles (el alto sale del 4:3). */
    DEMO_WIDTH: z.coerce.number().int().min(160).max(960),
    DEMO_FPS: z.coerce.number().int().min(5).max(30),
  })
  .parse(process.env)

const repo = resolve(import.meta.dirname, '../../..')

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

async function login(): Promise<string> {
  const start = await api<{ pollId: string; interval: number }>('/api/auth/device/start', { v: 1 })
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, start.interval * 1000))
    const poll = await api<{ status: string; token?: string }>('/api/auth/device/poll', {
      v: 1,
      pollId: start.pollId,
    })
    if (poll.status === 'ok' && poll.token) return poll.token
  }
  throw new Error('el Device Flow no terminó')
}

/** Lanza `claude -p` sin bloquear y resuelve cuando termina. */
function claudeTurn(settingsPath: string): Promise<number | null> {
  return new Promise(done => {
    const child = spawn(
      env.E2E_CLAUDE_BIN,
      [
        '-p',
        env.DEMO_PROMPT,
        '--plugin-dir',
        join(repo, 'packages/mod'),
        '--settings',
        settingsPath,
      ],
      { cwd: repo, stdio: 'ignore' },
    )
    child.on('exit', code => done(code))
  })
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'vibe-demo-'))
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
    const link = await api<{ url: string }>('/api/auth/link', { v: 1 }, token)
    // Primero se entra sin grabar (arranque y consejo inicial) y luego se graba solo la jugada.
    const setup = await browser.newContext({ viewport: { width: 960, height: 720 } })
    const first = await setup.newPage()
    await first.goto(link.url)
    // Arranque y consejo de "Cómo se juega" fuera de la grabación (se recuerda en el navegador).
    for (let i = 0; i < 5; i++) {
      await first.waitForTimeout(700)
      await first.keyboard.press('x')
    }
    await first.waitForTimeout(500)
    const state = await setup.storageState()
    await setup.close()

    const context = await browser.newContext({
      viewport: { width: 960, height: 720 },
      storageState: state,
      recordVideo: { dir: tmp, size: { width: 960, height: 720 } },
    })
    const page = await context.newPage()
    let resolvedAt = 0
    let revealAt = 0
    page.on('websocket', ws =>
      ws.on('framereceived', frame => {
        const body = JSON.parse(String(frame.payload)) as {
          type?: string
          round?: { revealAt?: string }
        }
        if (body.type === 'round.resolved') {
          resolvedAt = Date.now()
          revealAt = Date.parse(body.round?.revealAt ?? '') || Date.now()
        }
      }),
    )
    await page.goto(new URL('/play', env.E2E_BASE_URL).toString())
    // Salta el arranque y cierra el consejo si aparece.
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(700)
      await page.keyboard.press('x')
    }
    await page.waitForTimeout(800)
    // Unas fichas al rojo con el teclado (el cursor empieza en el tapete).
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(400)
    await page.keyboard.press('x')
    await page.waitForTimeout(1200)

    const code = await claudeTurn(settingsPath)
    if (code !== 0) throw new Error(`claude -p terminó con ${code}`)
    for (let i = 0; i < 100 && resolvedAt === 0; i++) await page.waitForTimeout(200)
    if (resolvedAt === 0) throw new Error('la ventana no recibió round.resolved')
    // Deja ver la caída de la bola y el resultado.
    await page.waitForTimeout(Math.max(0, revealAt - Date.now()) + 6_500)
    await context.close()

    const video = readdirSync(tmp).find(f => f.endsWith('.webm'))
    if (!video) throw new Error('Playwright no dejó vídeo')
    const out = resolve(repo, env.DEMO_OUTPUT)
    const filters = `fps=${env.DEMO_FPS},scale=${env.DEMO_WIDTH}:-1:flags=neighbor`
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      join(tmp, video),
      '-filter_complex',
      `${filters},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
      out,
    ])
    console.log(`[demo] GIF en ${env.DEMO_OUTPUT}`)
  } finally {
    await browser.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(`[demo] FALLO: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
