// SPDX-License-Identifier: AGPL-3.0-or-later
// Graba el GIF principal del README (`docs/hero.gif`): una sesión INTERACTIVA real de Claude Code
// con el mod cargado (izquierda) y la ventana del juego (derecha), con el mismo reloj. Nada está
// simulado ni montado: el prompt se escribe de verdad en un pseudoterminal, Claude trabaja de
// verdad, la ruleta gira mientras tanto y la bola cae con el resultado que decide el servidor.
//
// Cómo:
//  1. La ventana (Chromium de Playwright) entra como el usuario del GitHub falso con el enlace de un
//     solo uso, salta el arranque, limpia el boleto y apuesta con el teclado (HERO_BETS).
//  2. Se graba la ventana con el screencast de Chromium (cada fotograma con su hora).
//  3. `hero-pty.py` conduce `claude` en un pseudoterminal y guarda cada trozo de salida con su hora.
//  4. Esa salida se reproduce en xterm.js (desde los CDN) respetando los tiempos reales y se
//     fotografía fotograma a fotograma; ffmpeg pone las dos grabaciones lado a lado con un título.
//
// Requisitos: la pila de desarrollo levantada (`docker compose -f deploy/docker-compose.dev.yml up -d
// --build`), `claude` con sesión, el mod logueado contra ese servidor (`/vibe-login` en una sesión
// interactiva con `serverUrl` apuntando a la pila), saldo para las apuestas, `python3`, `ffmpeg` y
// red para cargar xterm.js. La ventana del mod no se abre (autoOpen desactivado): la ventana es la
// de Playwright.
//
// Uso: pnpm --filter @vibe-gambling/web hero:record
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from '@playwright/test'
import type { Page } from '@playwright/test'
import { z } from 'zod'

const env = z
  .object({
    E2E_BASE_URL: z.url(),
    E2E_CLAUDE_BIN: z.string().min(1),
    HERO_PROMPT: z.string().min(1),
    HERO_OUTPUT: z.string().min(1),
    /** Idioma del mod y de la ventana durante la grabación. */
    HERO_LANG: z.enum(['en', 'es', 'fr', 'de']),
    /** Teclas de la ventana para apostar antes del turno, separadas por espacios. */
    HERO_BETS: z.string().min(1),
    /** Ancho total del GIF: la mitad para el terminal y la otra mitad para la ventana (4:3). */
    HERO_WIDTH: z.coerce.number().int().min(480).max(1600),
    HERO_FPS: z.coerce.number().int().min(5).max(30),
    HERO_TERM_COLS: z.coerce.number().int().min(40).max(200),
    HERO_TERM_ROWS: z.coerce.number().int().min(10).max(80),
    HERO_TERM_FONT: z.string().min(1),
    /** Tamaño de letra del terminal en px CSS (se fotografía a ×2 y se reduce). */
    HERO_TERM_FONT_SIZE: z.coerce.number().min(8).max(32),
    HERO_XTERM_JS: z.url(),
    HERO_XTERM_CSS: z.url(),
    HERO_XTERM_UNICODE_JS: z.url(),
    /** Retardo medio entre teclas al escribir el prompt (ms). */
    HERO_KEY_DELAY_MS: z.coerce.number().int().min(10).max(500),
    /** Cuánto antes de empezar a escribir arranca el clip (ms). */
    HERO_LEAD_MS: z.coerce.number().int().min(0).max(10_000),
    /** Cuánto se sigue grabando después del aviso del mod con el resultado (ms). */
    HERO_TAIL_MS: z.coerce.number().int().min(0).max(20_000),
    /**
     * Cuánto se graba la ventana desde `round.resolved`: la caída de la bola (spin.landingMs) y un
     * rato de la pantalla de resultado (ms). El clip acaba en lo último de esto y HERO_TAIL_MS.
     */
    HERO_SETTLE_MS: z.coerce.number().int().min(0).max(30_000),
    /** Fundido final hacia el primer fotograma para que el bucle no salte (ms). */
    HERO_LOOP_FADE_MS: z.coerce.number().int().min(0).max(3000),
    /** Expresión regular del aviso del mod con el resultado (en el idioma de HERO_LANG). */
    HERO_RESULT_PATTERN: z.string().min(1),
    HERO_TITLE: z.string().min(1),
    /** Colores de la paleta del GIF (menos colores, menos peso). */
    HERO_COLORS: z.coerce.number().int().min(16).max(256),
    HERO_TURN_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000),
    HERO_MAX_BYTES: z.coerce.number().int().positive(),
  })
  .parse(process.env)

const repo = resolve(import.meta.dirname, '../../..')
const web = resolve(import.meta.dirname, '..')
/** Ventana del juego: el tamaño por defecto del mod (960×720), reducido en el GIF. */
const WINDOW = { width: 960, height: 720 }
/** Alto de la franja del título, en px del GIF. */
const TITLE_HEIGHT = 32

function log(msg: string): void {
  console.log(`[hero] ${msg}`)
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

const topScreen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __vg?: { screens(): string[] } }).__vg?.screens())

/** Entra a la mesa: salta el arranque y el consejo de la primera vez. */
async function toTable(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(700)
    const screens = await topScreen(page)
    if (screens?.length === 1 && screens[0] === 'table') return
    await page.keyboard.press('x')
  }
  throw new Error('la ventana no llegó a la mesa')
}

interface PtyLog {
  cols: number
  rows: number
  marks: { typing: number; submit: number; result: number; end: number }
  chunks: [number, string][]
}

/** Conduce Claude Code en el pseudoterminal (hero-pty.py) y devuelve su grabación. */
function driveClaude(tmp: string, settingsPath: string): Promise<PtyLog> {
  const out = join(tmp, 'pty.json')
  const config = join(tmp, 'pty-config.json')
  writeFileSync(
    config,
    JSON.stringify({
      claude: env.E2E_CLAUDE_BIN,
      cwd: repo,
      args: ['--plugin-dir', join(repo, 'packages/mod'), '--settings', settingsPath],
      cols: env.HERO_TERM_COLS,
      rows: env.HERO_TERM_ROWS,
      prompt: env.HERO_PROMPT,
      out,
      keyDelayMs: env.HERO_KEY_DELAY_MS,
      readyTimeoutS: 60,
      turnTimeoutS: env.HERO_TURN_TIMEOUT_MS / 1000,
      tailS: env.HERO_TAIL_MS / 1000,
      resultPattern: env.HERO_RESULT_PATTERN,
    }),
  )
  return new Promise((done, fail) => {
    const child = spawn('python3', ['-I', join(import.meta.dirname, 'hero-pty.py'), config], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let stdout = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.on('error', fail)
    child.on('exit', code => {
      if (code !== 0) return fail(new Error(`hero-pty.py terminó con ${code}`))
      log(`terminal: ${stdout.trim()}`)
      done(JSON.parse(readFileSync(out, 'utf8')) as PtyLog)
    })
  })
}

/** Página de xterm.js para reproducir la salida grabada. */
function terminalPage(cols: number, rows: number): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${env.HERO_XTERM_CSS}">
<script src="${env.HERO_XTERM_JS}"></script>
<script src="${env.HERO_XTERM_UNICODE_JS}"></script>
<style>html,body{margin:0;background:#08070d}#t{padding:8px;display:inline-block}</style>
</head><body><div id="t"></div><script>
const term = new Terminal({ cols: ${cols}, rows: ${rows}, allowProposedApi: true,
  fontFamily: ${JSON.stringify(env.HERO_TERM_FONT)}, fontSize: ${env.HERO_TERM_FONT_SIZE},
  lineHeight: 1.1, cursorBlink: false, theme: { background: '#08070d' } })
term.loadAddon(new Unicode11Addon.Unicode11Addon())
term.unicode.activeVersion = '11'
term.open(document.getElementById('t'))
window.feed = b64 => new Promise(done => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  term.write(bytes, () => requestAnimationFrame(() => requestAnimationFrame(done)))
})
</script></body></html>`
}

/** Franja del título con la fuente del juego. */
function titlePage(width: number): string {
  // La página es about:blank: la fuente va dentro como data URL.
  const font = `data:font/woff2;base64,${readFileSync(join(web, 'public/fonts/polygone12.woff2')).toString('base64')}`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:P;src:url('${font}') format('woff2')}
html,body{margin:0;background:#08070d}
div{width:${width}px;height:${TITLE_HEIGHT}px;display:flex;align-items:center;justify-content:center;
font:12px P;color:#9aa0c8;-webkit-font-smoothing:none}
</style></head><body><div>${env.HERO_TITLE.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))}</div></body></html>`
}

async function main(): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'vibe-hero-'))
  const settingsPath = join(tmp, 'settings.json')
  writeFileSync(
    settingsPath,
    JSON.stringify({
      pluginConfigs: {
        'vibe-gambling': {
          options: { serverUrl: env.E2E_BASE_URL, autoOpen: false, language: env.HERO_LANG },
        },
      },
    }),
  )
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  try {
    // 1. La ventana entra y apuesta.
    const token = await login()
    const link = await api<{ url: string }>('/api/auth/link', { v: 1 }, token)
    const context = await browser.newContext({ viewport: WINDOW, locale: env.HERO_LANG })
    const page = await context.newPage()
    const events: { type: string; at: number; body: Record<string, unknown> }[] = []
    page.on('websocket', ws =>
      ws.on('framereceived', frame => {
        const body = JSON.parse(String(frame.payload)) as Record<string, unknown>
        events.push({ type: String(body.type), at: Date.now(), body })
      }),
    )
    await page.goto(link.url)
    await toTable(page)
    for (const key of env.HERO_BETS.split(/\s+/)) {
      await page.keyboard.press(key)
      await page.waitForTimeout(220)
    }
    // Deja que se vayan los avisos de la apuesta para empezar con la mesa limpia.
    await page.waitForTimeout(4000)

    // 2. Screencast de la ventana: cada fotograma lleva la hora del navegador (epoch, s).
    const frames: { t: number; data: string }[] = []
    const cdp = await context.newCDPSession(page)
    cdp.on('Page.screencastFrame', frame => {
      frames.push({ t: frame.metadata.timestamp ?? Date.now() / 1000, data: frame.data })
      cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch((e: unknown) => {
        log(`ack del screencast falló: ${String(e)}`)
      })
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 })

    // 3. El turno real en Claude Code.
    const pty = await driveClaude(tmp, settingsPath)
    const resolved = events.find(e => e.type === 'round.resolved')
    if (!events.some(e => e.type === 'round.started') || !resolved)
      throw new Error('la ventana no recibió round.started y round.resolved')
    const settled = resolved.at + env.HERO_SETTLE_MS
    await page.waitForTimeout(Math.max(0, settled - Date.now()))
    await cdp.send('Page.stopScreencast')
    const round = resolved.body.round as { result: number; revealAt: string }
    log(`ronda resuelta: ${round.result}; ${frames.length} fotogramas de la ventana`)
    // Segundos desde que se mandó el prompt: el aviso del mod no puede adelantarse a revealAt.
    const since = (t: number) => (t - pty.marks.submit).toFixed(2)
    log(
      `desde el envío: round.resolved ${since(resolved.at / 1000)} s, ` +
        `revealAt ${since(Date.parse(round.revealAt) / 1000)} s, aviso del mod ${since(pty.marks.result)} s`,
    )
    if (pty.marks.result * 1000 < Date.parse(round.revealAt))
      throw new Error('el mod enseñó el resultado antes de revealAt')
    await context.close()

    // 4. Fotogramas del clip, con el mismo reloj para las dos mitades.
    const start = pty.marks.typing - env.HERO_LEAD_MS / 1000
    const end = Math.max(pty.marks.end, settled / 1000)
    const count = Math.floor((end - start) * env.HERO_FPS)
    const half = Math.floor(env.HERO_WIDTH / 2)
    const paneH = Math.round((half * 3) / 4)
    const termDir = join(tmp, 'term')
    const gameDir = join(tmp, 'game')
    mkdirSync(termDir)
    mkdirSync(gameDir)

    // 4a. Terminal: xterm.js reproduce la salida hasta cada instante y se fotografía.
    const termPage = await browser.newPage({ deviceScaleFactor: 2 })
    await termPage.setContent(terminalPage(pty.cols, pty.rows), { waitUntil: 'networkidle' })
    const box = termPage.locator('#t')
    let next = 0
    const feedUntil = async (t: number) => {
      const parts: string[] = []
      while (next < pty.chunks.length && pty.chunks[next]![0] <= t) {
        parts.push(pty.chunks[next]![1])
        next++
      }
      if (parts.length === 0) return
      const batch = Buffer.concat(parts.map(p => Buffer.from(p, 'base64'))).toString('base64')
      await termPage.evaluate(
        b64 => (window as unknown as { feed(b: string): Promise<void> }).feed(b64),
        batch,
      )
    }
    await feedUntil(start)
    for (let i = 0; i < count; i++) {
      await feedUntil(start + i / env.HERO_FPS)
      await box.screenshot({ path: join(termDir, `${String(i).padStart(5, '0')}.png`) })
    }
    await termPage.close()

    // 4b. Ventana: en cada instante, el último fotograma pintado (el screencast solo manda cambios).
    frames.sort((a, b) => a.t - b.t)
    const list: string[] = []
    let f = 0
    let written = -1
    for (let i = 0; i < count; i++) {
      const t = start + i / env.HERO_FPS
      while (f + 1 < frames.length && frames[f + 1]!.t <= t) f++
      const file = join(gameDir, `${String(f).padStart(5, '0')}.jpg`)
      if (f !== written) writeFileSync(file, Buffer.from(frames[f]!.data, 'base64'))
      written = f
      list.push(`file '${file}'`, `duration ${1 / env.HERO_FPS}`)
    }
    list.push(list.at(-2)!)
    writeFileSync(join(tmp, 'game.txt'), `${list.join('\n')}\n`)

    // 4c. Título.
    const titleShot = await browser.newPage({ viewport: { width: half * 2, height: TITLE_HEIGHT } })
    await titleShot.setContent(titlePage(half * 2))
    await titleShot.evaluate(() => document.fonts.ready)
    await titleShot.screenshot({ path: join(tmp, 'title.png') })
    await titleShot.close()

    // 5. Composición y GIF: terminal a la izquierda, ventana a la derecha y fundido al principio.
    const fps = env.HERO_FPS
    const seconds = count / fps
    const fade = env.HERO_LOOP_FADE_MS / 1000
    const out = resolve(repo, env.HERO_OUTPUT)
    const scale = `scale=${half}:${paneH}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${half}:${paneH}:(ow-iw)/2:(oh-ih)/2:color=0x08070d`
    const loop =
      fade > 0
        ? `[v]split[a][b];[b]trim=end_frame=1,loop=loop=${Math.ceil(fade * fps)}:size=1,setpts=N/${fps}/TB[first];` +
          `[a][first]xfade=transition=fade:duration=${fade}:offset=${(seconds - fade).toFixed(3)}[w];`
        : '[v]null[w];'
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-loop',
      '1',
      '-framerate',
      String(fps),
      '-i',
      join(tmp, 'title.png'),
      '-framerate',
      String(fps),
      '-i',
      join(termDir, '%05d.png'),
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(tmp, 'game.txt'),
      '-filter_complex',
      `[1]${scale},setsar=1[t];[2]fps=${fps},${scale},setsar=1[g];` +
        `[t][g]hstack[row];[0]setsar=1[title];[title][row]vstack=shortest=1,trim=end_frame=${count},setpts=N/${fps}/TB[v];` +
        loop +
        `[w]split[p1][p2];[p1]palettegen=max_colors=${env.HERO_COLORS}:stats_mode=diff[pal];` +
        `[p2][pal]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
      '-loop',
      '0',
      out,
    ])
    const bytes = statSync(out).size
    log(`GIF en ${env.HERO_OUTPUT}: ${count} fotogramas, ${seconds.toFixed(1)} s, ${bytes} bytes`)
    if (bytes > env.HERO_MAX_BYTES)
      throw new Error(`el GIF pesa ${bytes} bytes (máximo ${env.HERO_MAX_BYTES})`)
  } finally {
    await browser.close()
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(`[hero] FALLO: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
