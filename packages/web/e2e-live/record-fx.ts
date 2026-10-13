// SPDX-License-Identifier: AGPL-3.0-or-later
// Graba los GIF cortos de las animaciones de espectáculo (`docs/fx-megawin.gif` y
// `docs/fx-bank.gif`) con el modo demo forzado (`/play?demo&fx=…`): la caída de la bola y el MEGA
// WIN, y la ventanilla del Ludo-Crédito con su secuencia. Es una partida de mentira en el
// navegador, sin cuenta ni Claude Code.
//
// Requisitos: una web servida en FX_BASE_URL (el servidor de la pila de desarrollo o Vite) y
// `ffmpeg` en el PATH.
//
// Uso: pnpm --filter @vibe-gambling/web fx:record
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { z } from 'zod'

const env = z
  .object({
    FX_BASE_URL: z.url(),
    FX_GIF_MEGA: z.string().min(1),
    FX_GIF_BANK: z.string().min(1),
    /** Ancho del GIF en píxeles (el alto sale del 4:3). */
    FX_GIF_WIDTH: z.coerce.number().int().min(160).max(960),
    FX_GIF_FPS: z.coerce.number().int().min(5).max(30),
    /** Tope de tamaño de cada GIF (bytes): si se pasa, falla en vez de dejar uno enorme. */
    FX_GIF_MAX_BYTES: z.coerce.number().int().positive(),
  })
  .parse(process.env)

const repo = resolve(import.meta.dirname, '../../..')

/** Evalúa una expresión sobre los ganchos `window.__vg` de la ventana (false si aún no están). */
const check = (page: Page, expr: string) =>
  page
    .evaluate(`(() => { const vg = window.__vg; return vg ? Boolean(${expr}) : false })()`)
    .catch(() => false) as Promise<boolean>

/** Graba una animación: `play` mueve la página y devuelve desde qué segundo del vídeo cortar. */
async function record(
  browser: Browser,
  kind: string,
  output: string,
  play: (page: Page, since: () => number) => Promise<number>,
): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), `vibe-fx-${kind}-`))
  try {
    const context = await browser.newContext({
      viewport: { width: 640, height: 480 },
      locale: 'es-ES',
      recordVideo: { dir: tmp, size: { width: 640, height: 480 } },
    })
    const started = Date.now()
    const since = () => (Date.now() - started) / 1000
    const page = await context.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('vibe-gambling:tip-seen', '1')
      localStorage.setItem(
        'vibe-gambling:prefs',
        JSON.stringify({ sound: false, crt: false, quality: 'high', locale: 'es' }),
      )
    })
    await page.goto(new URL(`/play?demo&noboot&fx=${kind}`, env.FX_BASE_URL).toString())
    const from = await play(page, since)
    const until = since()
    await context.close()
    const video = readdirSync(tmp).find(f => f.endsWith('.webm'))
    if (!video) throw new Error('Playwright no dejó vídeo')
    const out = resolve(repo, output)
    const filters = `fps=${env.FX_GIF_FPS},scale=${env.FX_GIF_WIDTH}:-1:flags=neighbor`
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      from.toFixed(2),
      '-to',
      until.toFixed(2),
      '-i',
      join(tmp, video),
      '-filter_complex',
      `${filters},split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
      out,
    ])
    const bytes = statSync(out).size
    if (bytes > env.FX_GIF_MAX_BYTES)
      throw new Error(`${output} ocupa ${bytes} bytes (tope ${env.FX_GIF_MAX_BYTES})`)
    console.log(`[fx] GIF en ${output} (${Math.round(bytes / 1024)} KiB)`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function waitFor(page: Page, expr: string, what: string): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (await check(page, expr)) return
    await page.waitForTimeout(50)
  }
  throw new Error(`no llegó: ${what}`)
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  try {
    // MEGA WIN: desde que la bola empieza a caer hasta el final del hold.
    await record(browser, 'mega', env.FX_GIF_MEGA, async (page, since) => {
      await waitFor(page, "vg.state().phase === 'landing'", 'la caída')
      const from = since() + 1.5
      await waitFor(page, "vg.fx().current === 'fx:prize'", 'el premio')
      await waitFor(page, "vg.fx().current !== 'fx:prize'", 'el final')
      return from
    })
    // Ludo-Crédito: la oferta, ✕ ACEPTAR y la secuencia entera.
    await record(browser, 'bank', env.FX_GIF_BANK, async (page, since) => {
      await waitFor(page, "vg.screens().includes('loan')", 'la oferta')
      const from = since()
      await page.waitForTimeout(1500)
      await page.keyboard.press('x')
      await page.waitForTimeout(4200)
      return from
    })
  } finally {
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error(`[fx] FALLO: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
