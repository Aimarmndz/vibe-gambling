// SPDX-License-Identifier: AGPL-3.0-or-later
// El test de privacidad: intercepta todas las peticiones del mod y falla si cualquiera lleva
// algo más que lo permitido, o cualquier rastro del prompt, la respuesta, los comandos, las
// rutas o los nombres de archivo de la sesión (en la URL, las cabeceras o el cuerpo).
import { expect, test } from 'claude-code/testing'

import {
  LOGGED_IN,
  PLUGIN_VERSION,
  SERVER,
  TEST_OPTIONS,
  TOKEN,
  bash,
  bashTool,
  happyCasino,
  playTurn,
  startSession,
  world,
} from './support/harness.ts'
import type { SentRequest } from './support/harness.ts'

/** Campos permitidos en el cuerpo de cada ruta (lista propia del test, no la del código). */
const ALLOWED_BODY: Readonly<Record<string, readonly string[]>> = {
  '/api/turn/start': ['v', 'turnId', 'pluginVersion', 'os'],
  '/api/turn/end': ['v', 'turnId', 'durationMs', 'gitPushOk', 'testFailed', 'pluginVersion', 'os'],
  '/api/auth/link': ['v'],
  '/api/me': [],
}
const ALLOWED_HEADERS = new Set(['accept', 'content-type', 'authorization'])

/** Marcadores únicos que no pueden salir del ordenador. */
const MARKERS = [
  'PROMPT-7c1f3a',
  'ANSWER-92be0d',
  'BASHCMD-4d8e21',
  'STDOUT-0a9c77',
  'CWD-e5b6f0',
  'FILE-31d2aa',
  'REPO-ff0942',
]

function leaks(request: SentRequest): string[] {
  const everything = [request.url, JSON.stringify(request.headers), request.rawBody ?? ''].join(
    '\n',
  )
  return MARKERS.filter(marker => everything.includes(marker))
}

function checkRequest(request: SentRequest): void {
  const url = new URL(request.url)
  expect(`${url.origin}`, request.url).toBe(SERVER)
  expect(url.search, `query in ${request.url}`).toBe('')
  expect(Object.keys(ALLOWED_BODY), `unexpected route ${url.pathname}`).toContain(url.pathname)
  for (const header of Object.keys(request.headers)) {
    expect(ALLOWED_HEADERS.has(header.toLowerCase()), `header ${header}`).toBe(true)
  }
  if (request.headers.authorization !== undefined) {
    expect(request.headers.authorization).toBe(`Bearer ${TOKEN}`)
  }
  const allowed = ALLOWED_BODY[url.pathname] ?? []
  if (request.body !== undefined) {
    expect(typeof request.body === 'object' && request.body !== null).toBe(true)
    for (const key of Object.keys(request.body as object)) {
      expect(allowed, `field ${key} in ${url.pathname}`).toContain(key)
    }
  }
  expect(leaks(request), `leak in ${url.pathname}`).toEqual([])
}

test(
  'a full session sends nothing but the allowed fields, and no trace of the work',
  { options: TEST_OPTIONS },
  async ($, on) => {
    bashTool(on)
    const w = world(on, {
      routes: happyCasino(false),
      store: LOGGED_IN,
      files: ['/usr/bin/chromium'],
      env: { HOME: '/home/CWD-e5b6f0' },
    })
    await startSession($, w, { cwd: '/home/player/REPO-ff0942/CWD-e5b6f0' })

    await playTurn($, w, {
      prompt: 'PROMPT-7c1f3a: fix the bug in src/FILE-31d2aa.ts and push',
      answer: 'ANSWER-92be0d: done, pushed to REPO-ff0942',
      durationMs: 4321,
      bash: [
        { command: 'cat src/FILE-31d2aa.ts # BASHCMD-4d8e21', stdout: 'STDOUT-0a9c77' },
        {
          command: 'pnpm test -- FILE-31d2aa # BASHCMD-4d8e21',
          exitCode: 1,
          stdout: 'STDOUT-0a9c77',
        },
        { command: 'git push origin BASHCMD-4d8e21', stderr: 'To REPO-ff0942\n a..b main -> main' },
      ],
    })
    // Una llamada fuera de cualquier turno y otra herramienta con una ruta.
    await bash($, { command: 'echo BASHCMD-4d8e21', stdout: 'STDOUT-0a9c77' })
    await $.tool.call({ tool: 'Read', file_path: '/home/player/REPO-ff0942/FILE-31d2aa.ts' })
    await playTurn($, w, { prompt: 'PROMPT-7c1f3a again' })
    await w.clock.advance(10_000)

    expect(w.requests.length).toBeGreaterThan(0)
    for (const request of w.requests) checkRequest(request)

    const [start] = w.to('/api/turn/start')
    expect(start?.body).toEqual({
      v: 1,
      turnId: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
      pluginVersion: PLUGIN_VERSION,
      os: 'linux',
    })
    const [end] = w.to('/api/turn/end')
    expect(end?.body).toEqual({
      v: 1,
      turnId: (start?.body as { turnId: string }).turnId,
      durationMs: 4321,
      gitPushOk: true,
      testFailed: true,
      pluginVersion: PLUGIN_VERSION,
      os: 'linux',
    })

    // El navegador recibe la URL del servidor, nada de la sesión.
    for (const argv of w.runs) expect(MARKERS.filter(m => argv.join(' ').includes(m))).toEqual([])
  },
)

test(
  "the turn id is the mod's own, never the engine's",
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN })
    await startSession($, w)
    const engineTurnId = await playTurn($, w)
    for (const request of w.requests) expect(request.rawBody ?? '').not.toContain(engineTurnId)
    const ids = new Set(
      [...w.to('/api/turn/start'), ...w.to('/api/turn/end')].map(
        r => (r.body as { turnId: string }).turnId,
      ),
    )
    expect(ids.size).toBe(1)
  },
)

test(
  'only the generic OS name is sent (darwin, win32, other)',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: happyCasino(true), store: LOGGED_IN, uname: 'Darwin' })
    await startSession($, w)
    await playTurn($, w)
    expect(w.to('/api/turn/start')[0]?.body).toMatchObject({ os: 'darwin' })
  },
)

test('an exotic OS is reported as "other"', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: happyCasino(true), store: LOGGED_IN, uname: 'FreeBSD' })
  await startSession($, w)
  await playTurn($, w)
  expect(w.to('/api/turn/start')[0]?.body).toMatchObject({ os: 'other' })
})
