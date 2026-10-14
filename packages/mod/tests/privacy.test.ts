// SPDX-License-Identifier: AGPL-3.0-or-later
// El test de privacidad: intercepta todas las peticiones del mod y falla si cualquiera lleva
// algo más que lo permitido, o cualquier rastro del prompt, la respuesta, los comandos, las
// rutas o los nombres de archivo de la sesión (en la URL, las cabeceras o el cuerpo).
import { expect, test } from 'claude-code/testing'

import {
  LOGGED_IN,
  LOGIN,
  SESSION_KEY,
  command,
  meReply,
  queuedReply,
  turnStartReply,
  PLUGIN_VERSION,
  SERVER,
  TEST_OPTIONS,
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
  '/api/meta': [],
  '/api/auth/device/start': ['v'],
  '/api/auth/device/poll': ['v', 'pollId'],
  '/api/auth/logout': ['v'],
  '/api/bet': ['v', 'amount', 'target'],
  '/api/me/settings': ['v', 'hidden'],
  '/api/me/delete': ['v', 'confirm'],
  '/api/referral': [],
  '/api/referral/redeem': ['v', 'code'],
  '/api/shop': [],
  '/api/shop/buy': ['v', 'itemId', 'requestId'],
  '/api/items/arm': ['v', 'itemId', 'armed'],
}
/** Rutas que no llevan cuerpo (GET). */
const NO_BODY = new Set(['/api/me', '/api/meta', '/api/referral', '/api/shop'])
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

function checkRequest(request: SentRequest, origin = SERVER): void {
  const url = new URL(request.url)
  expect(`${url.origin}`, request.url).toBe(origin)
  expect(url.search, `query in ${request.url}`).toBe('')
  expect(Object.keys(ALLOWED_BODY), `unexpected route ${url.pathname}`).toContain(url.pathname)
  for (const header of Object.keys(request.headers)) {
    expect(ALLOWED_HEADERS.has(header.toLowerCase()), `header ${header}`).toBe(true)
  }
  if (request.headers.authorization !== undefined) {
    expect(request.headers.authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/)
  }
  const allowed = ALLOWED_BODY[url.pathname] ?? []
  if (NO_BODY.has(url.pathname)) expect(request.rawBody, `body in ${url.pathname}`).toBeUndefined()
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

/** Todo lo que no puede aparecer en el log de depuración (aunque no salga del ordenador). */
function logLeaks(logs: readonly string[]): string[] {
  return MARKERS.filter(marker => logs.some(line => line.includes(marker)))
}

const POLL_ID = 'P'.repeat(43)
const meta = {
  json: {
    v: 1,
    protocol: 1,
    name: 'Casino',
    isOfficial: true,
    serverVersion: '1',
    publicUrl: SERVER,
  },
}

test(
  'every command, the login and /vibe-server send only their own fields',
  { options: TEST_OPTIONS },
  async ($, on) => {
    bashTool(on)
    const user = (meReply().json as { user: unknown }).user
    const w = world(on, {
      routes: {
        ...happyCasino(false),
        '/api/meta': meta,
        '/api/bet': {
          json: {
            v: 1,
            slip: { bets: [], total: 50 },
            wallet: { balance: 950, debt: 0, netWorth: 950, spins: 3 },
            forRound: 'next',
          },
        },
        '/api/me/settings': { json: { v: 1, user } },
        '/api/me/delete': { json: { v: 1, ok: true } },
        '/api/referral': {
          json: {
            v: 1,
            referral: {
              code: 'ABCD2345',
              url: 'https://casino.test/r/ABCD2345',
              invited: 0,
              activated: 0,
              waiting: 0,
              earned: 0,
              season: { seasonId: '2026-10', commissions: 0, cap: 10 },
              invitedBy: null,
              canRedeem: true,
              redeemUntil: '2026-10-20T12:00:00.000Z',
              rules: {
                welcomeBonus: 500,
                commission: 1000,
                activationSpins: 50,
                redeemWindowDays: 7,
                redeemMaxSpins: 100,
                maxCommissionsPerSeason: 10,
                minAccountAgeDays: 30,
              },
            },
          },
        },
        '/api/referral/redeem': { json: { v: 1, status: 'rejected', reason: 'cycle' } },
        '/api/auth/logout': { json: { v: 1, ok: true } },
        '/api/auth/device/start': {
          json: {
            v: 1,
            pollId: POLL_ID,
            userCode: 'WDJB-MJHT',
            verificationUri: 'https://github.test/login/device',
            expiresIn: 900,
            interval: 5,
          },
        },
        '/api/auth/device/poll': {
          json: { v: 1, status: 'ok', token: 'N'.repeat(43), user, isNew: false },
        },
      },
      files: ['/usr/bin/chromium'],
      env: { HOME: '/home/CWD-e5b6f0' },
    })
    await startSession($, w, { cwd: '/home/player/REPO-ff0942/CWD-e5b6f0' })

    // Sin sesión: login por Device Flow mientras corre un turno con trabajo "secreto".
    await $.turn.start({ text: 'PROMPT-7c1f3a', turnId: 'priv-1' })
    await command($, 'vibe-login')
    await w.clock.advance(5_000)
    expect(w.store.get(SESSION_KEY)).toBeDefined()
    await playTurn($, w, {
      prompt: 'PROMPT-7c1f3a in FILE-31d2aa',
      answer: 'ANSWER-92be0d',
      bash: [
        { command: 'pnpm test FILE-31d2aa # BASHCMD-4d8e21', exitCode: 1, stdout: 'STDOUT-0a9c77' },
      ],
    })
    for (const [name, args] of [
      ['roulette', ''],
      ['bet', '50 red'],
      ['apostar', '1.000 17'],
      ['all-in', ''],
      ['balance', ''],
      ['vibe-hide', ''],
      ['vibe-show', ''],
      ['vibe-server', ''],
      ['vibe-server', 'https://casino.test'],
      ['vibe-invite', ''],
      ['vibe-invitar', ''],
      ['vibe-redeem', 'abcd-2345'],
      ['vibe-canjear', 'https://casino.test/r/zzzz9999'],
      ['vibe-redeem', 'PROMPT-7c1f3a'],
      ['vibe-delete-account', ''],
      ['vibe-delete-account', 'someone-else'],
      ['vibe-delete-account', LOGIN],
      ['vibe-login', ''],
      ['vibe-logout', ''],
    ] as const) {
      await command($, name, args)
    }
    await w.clock.advance(60_000)

    expect(w.requests.length).toBeGreaterThan(10)
    for (const request of w.requests) checkRequest(request)
    expect(w.to('/api/bet').map(r => r.body)).toEqual([
      { v: 1, amount: 50, target: 'red' },
      { v: 1, amount: 1000, target: '17' },
      { v: 1, amount: 'all-in', target: 'red' },
    ])
    expect(w.to('/api/me/delete').map(r => r.body)).toEqual([{ v: 1, confirm: LOGIN }])
    // El canje lleva solo el código, ya normalizado; uno que no es un código no sale.
    expect(w.to('/api/referral/redeem').map(r => r.body)).toEqual([
      { v: 1, code: 'ABCD2345' },
      { v: 1, code: 'ZZZZ9999' },
    ])
    expect(w.to('/api/referral')).toHaveLength(2)
    expect(logLeaks(w.logs)).toEqual([])
    for (const argv of w.runs) expect(MARKERS.filter(m => argv.join(' ').includes(m))).toEqual([])
  },
)

test(
  'when everything fails, neither the requests nor the debug log carry the work',
  { options: TEST_OPTIONS },
  async ($, on) => {
    bashTool(on)
    let calls = 0
    const w = world(on, {
      routes: {
        '/api/me': { status: 500, json: { v: 1, error: 'internal', message: 'boom' } },
        '/api/turn/start': () =>
          ++calls === 1
            ? { status: 503, json: { v: 1, error: 'internal', message: 'busy' } }
            : turnStartReply(false),
        '/api/turn/end': { hang: true },
        '/api/auth/link': { fail: true },
        '/api/bet': { status: 502, raw: '<html><body>Bad gateway</body></html>' },
        '/api/meta': { status: 401, json: { v: 1, error: 'unauthorized', message: 'no' } },
      },
      store: LOGGED_IN,
      files: ['/usr/bin/chromium'],
      launchExit: 1,
    })
    await startSession($, w, { cwd: '/home/player/REPO-ff0942/CWD-e5b6f0' })
    for (let i = 0; i < 2; i++) {
      await playTurn($, w, {
        prompt: 'PROMPT-7c1f3a FILE-31d2aa',
        answer: 'ANSWER-92be0d',
        bash: [
          { command: 'git push origin BASHCMD-4d8e21', exitCode: 1, stderr: 'STDOUT-0a9c77' },
          { command: 'npx vitest FILE-31d2aa', exitCode: 1, stdout: 'STDOUT-0a9c77' },
        ],
      })
      await w.clock.advance(TEST_OPTIONS.turnTimeoutMs)
    }
    await command($, 'bet', '10 PROMPT-7c1f3a')
    await command($, 'vibe-server', 'https://REPO-ff0942.test')
    await command($, 'roulette')
    await w.clock.advance(60_000)

    for (const request of w.requests) {
      // `/bet` lleva la casilla que la persona escribe a mano, y `/vibe-server` va al servidor
      // que ella elige: ahí el marcador es suyo, no del trabajo de la sesión.
      if (request.path === '/api/bet' || new URL(request.url).hostname === 'repo-ff0942.test')
        continue
      checkRequest(request)
    }
    expect(logLeaks(w.logs)).toEqual([])
    expect(w.logs.length).toBeGreaterThan(0)
  },
)

test(
  'with the window closed (queued and dropped spins) nothing new leaves the computer',
  { options: TEST_OPTIONS },
  async ($, on) => {
    bashTool(on)
    let pending = 99
    const w = world(on, {
      routes: {
        ...happyCasino(false),
        // El servidor guarda la tirada y, a la segunda, ya está en el tope.
        '/api/turn/end': () => {
          pending = Math.min(100, pending + 1)
          return queuedReply(pending, pending === 100 && pending > 99)
        },
      },
      store: LOGGED_IN,
      files: ['/usr/bin/chromium'],
      env: { HOME: '/home/CWD-e5b6f0' },
    })
    await startSession($, w, { cwd: '/home/player/REPO-ff0942/CWD-e5b6f0' })
    for (let i = 0; i < 2; i++) {
      await playTurn($, w, {
        prompt: 'PROMPT-7c1f3a: push it',
        answer: 'ANSWER-92be0d',
        bash: [
          {
            command: 'git push origin BASHCMD-4d8e21',
            stderr: 'To REPO-ff0942\n a..b main -> main',
          },
          { command: 'pnpm test FILE-31d2aa', exitCode: 1, stdout: 'STDOUT-0a9c77' },
        ],
      })
    }
    await w.clock.advance(10_000)
    expect(w.toasts).toHaveLength(2)
    for (const request of w.requests) checkRequest(request)
    const ends = w.to('/api/turn/end')
    expect(ends).toHaveLength(2)
    for (const end of ends) {
      expect(Object.keys(end.body as object).sort()).toEqual(
        ['durationMs', 'gitPushOk', 'os', 'pluginVersion', 'testFailed', 'turnId', 'v'].sort(),
      )
      expect(end.body).toMatchObject({ gitPushOk: true, testFailed: true })
    }
    // Ni el toast ni la status line repiten nada del trabajo.
    for (const text of [...w.toasts, w.lastStatus() ?? '']) {
      expect(MARKERS.filter(marker => text.includes(marker))).toEqual([])
    }
  },
)
test(
  'the shop commands send only the item, a random request id and the armed flag',
  { options: TEST_OPTIONS },
  async ($, on) => {
    bashTool(on)
    const pocket = {
      seasonId: '2026-10',
      enabled: true,
      maxArmed: 4,
      items: [{ id: 'rabbit_foot', charges: 37, armed: true }],
      cosmetics: {
        felts: ['classic'],
        chips: ['classic'],
        felt: 'classic',
        chipSkin: 'classic',
      },
      revert: null,
    }
    const w = world(on, {
      routes: {
        ...happyCasino(true),
        '/api/shop': {
          json: {
            v: 1,
            shop: {
              seasonId: '2026-10',
              seasonEndsAt: '2026-10-31T23:00:00.000Z',
              items: [],
              inventory: pocket,
              placebometer: {
                spent: 0,
                recovered: 0,
                net: 0,
                rabbit: {
                  with: { rounds: 0, won: 0 },
                  without: { rounds: 0, won: 0 },
                },
                oracle: { predictions: 0, hits: 0 },
              },
              canBorrow: false,
            },
          },
        },
        '/api/shop/buy': request => ({
          json: {
            v: 1,
            itemId: (request.body as { itemId: string }).itemId,
            price: 77,
            refund: 0,
            fresh: true,
            wallet: { balance: 923, debt: 0, netWorth: 923, spins: 3 },
            inventory: pocket,
          },
        }),
        '/api/items/arm': { json: { v: 1, inventory: pocket } },
      },
      store: LOGGED_IN,
      env: { HOME: '/home/CWD-e5b6f0' },
    })
    await startSession($, w, { cwd: '/home/player/REPO-ff0942/CWD-e5b6f0' })
    await playTurn($, w, {
      prompt: 'PROMPT-7c1f3a buy me luck for FILE-31d2aa',
      answer: 'ANSWER-92be0d',
      bash: [{ command: 'git push origin BASHCMD-4d8e21', stderr: 'To REPO-ff0942' }],
    })
    for (const [name, args] of [
      ['vibe-shop', ''],
      ['vibe-tienda', ''],
      ['vibe-shop', 'buy pata'],
      ['vibe-shop', 'comprar git revert'],
      ['vibe-shop', 'buy PROMPT-7c1f3a'],
      ['vibe-use', 'rabbit'],
      ['vibe-usar', 'seguro off'],
      ['vibe-use', 'FILE-31d2aa'],
    ] as const) {
      await command($, name, args)
    }
    await w.clock.advance(10_000)
    for (const request of w.requests) checkRequest(request)
    expect(w.to('/api/shop')).toHaveLength(2)
    const buys = w.to('/api/shop/buy').map(r => r.body as Record<string, unknown>)
    expect(buys.map(b => b.itemId)).toEqual(['rabbit_foot', 'revert'])
    for (const body of buys) expect(body.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(w.to('/api/items/arm').map(r => r.body)).toEqual([
      { v: 1, itemId: 'rabbit_foot', armed: true },
      { v: 1, itemId: 'insurance', armed: false },
    ])
    expect(logLeaks(w.logs)).toEqual([])
  },
)
