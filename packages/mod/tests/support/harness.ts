// SPDX-License-Identifier: AGPL-3.0-or-later
// Mundo falso bajo el mod para los tests: un casino HTTP en memoria, reloj, store, entorno,
// procesos y archivos. Registra todo lo que el mod pide para poder comprobarlo después.
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { PLUGIN_VERSION } from '../../hooks/generated/manifest.ts'

/** Configuración de test (la de producción vive en el manifiesto). */
export const SERVER = 'https://casino.test'
export const TEST_OPTIONS = {
  serverUrl: SERVER,
  autoOpen: true,
  language: 'en',
  turnTimeoutMs: 1500,
  commandTimeoutMs: 3000,
  windowReopenCooldownMs: 60000,
  windowSize: '800,600',
  launchTimeoutMs: 2000,
  revealMaxDelayMs: 30000,
} as const

/** La versión que el mod manda en cada turno: la de `plugin.json`, generada en el mod. */
export { PLUGIN_VERSION }
export const TOKEN = 'T'.repeat(43)
export const LOGIN = 'octocat'
export const SESSION_KEY = `session:${SERVER}`
export const LOGGED_IN = { [SESSION_KEY]: { token: TOKEN, login: LOGIN } }

export interface SentRequest {
  readonly url: string
  readonly path: string
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly rawBody: string | undefined
  readonly body: unknown
}

export interface Reply {
  readonly status?: number
  readonly json?: unknown
  /** Cuerpo tal cual (HTML de un proxy, JSON roto…), en vez de `json`. */
  readonly raw?: string
  /** Tarda este tiempo (en el reloj falso) en contestar. */
  readonly delayMs?: number
  /** No contesta nunca. */
  readonly hang?: boolean
  /** La conexión falla. */
  readonly fail?: boolean
}

export type Route = Reply | ((request: SentRequest) => Reply)

export interface WorldOptions {
  readonly routes?: Readonly<Record<string, Route>>
  readonly store?: Readonly<Record<string, unknown>>
  readonly env?: Readonly<Record<string, string>>
  /** Lo que contesta `uname -s` (si no hay `OS=Windows_NT`). */
  readonly uname?: string
  /** Archivos que existen (para buscar navegadores). */
  readonly files?: readonly string[]
  /** Código de salida del lanzador del navegador. */
  readonly launchExit?: number
  /** El lanzador del navegador (cualquier orden que no sea `uname`) se cuelga hasta su timeout. */
  readonly launchHang?: boolean
  /** `uname -s` se cuelga hasta su timeout. */
  readonly unameHang?: boolean
  /** Comandos cuyo `$.command.register` rechaza el engine (p. ej. un nombre ya ocupado). */
  readonly registerDeny?: readonly string[]
  /** Respuesta a `$.config.set` (deny si se da). */
  readonly configDeny?: string
}

export interface World {
  readonly clock: MockClock
  readonly requests: SentRequest[]
  readonly toasts: string[]
  readonly statuses: (string | undefined)[]
  readonly logs: string[]
  readonly runs: string[][]
  readonly registered: string[]
  readonly configSets: { key: string; value: unknown }[]
  readonly store: Map<string, unknown>
  /** Rutas por las que el mod ha preguntado a `$.fs.exists`. */
  readonly checked: string[]
  /** Peticiones a una ruta concreta. */
  readonly to: (path: string) => SentRequest[]
  readonly lastStatus: () => string | undefined
}

/**
 * ¿La ruta que llega a `fs.exists` es la del archivo falso? El engine resuelve la ruta con las
 * reglas del SO que ejecuta el test, no con las del SO falso: en un host POSIX `C:\\…` es relativa
 * a la sesión (`/sesión/C:\\…`), y en Windows `/Users/…` cuelga de la unidad actual
 * (`D:\\Users\\…`). Se comparan sin unidad y con `/` como separador.
 */
export function isSameFakePath(resolved: string, file: string): boolean {
  const slashes = (path: string): string => path.replaceAll('\\', '/')
  const withoutDrive = (path: string): string => slashes(path).replace(/^[A-Za-z]:(?=\/)/, '')
  return (
    withoutDrive(resolved) === withoutDrive(file) || slashes(resolved).endsWith(`/${slashes(file)}`)
  )
}

export function world(on: On, options: WorldOptions = {}): World {
  const clock = mock.clock(on, { now: Date.parse('2026-10-12T20:00:00.000Z') })
  // Store propio (en vez de mock.store) para poder mirarlo desde los tests.
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  mock.env(on, { LANG: 'en_US.UTF-8', HOME: '/home/player', ...(options.env ?? {}) })

  const requests: SentRequest[] = []
  const toasts: string[] = []
  const statuses: (string | undefined)[] = []
  const logs: string[] = []
  const runs: string[][] = []
  const registered: string[] = []
  const configSets: { key: string; value: unknown }[] = []
  const files = new Set(options.files ?? [])
  const checked: string[] = []

  on('http.fetch', async (_$, e) => {
    const url = new URL(e.url)
    const rawBody = e.init?.body
    const request: SentRequest = {
      url: e.url,
      path: url.pathname,
      method: e.init?.method ?? 'GET',
      headers: { ...(e.init?.headers ?? {}) },
      rawBody,
      body: rawBody === undefined ? undefined : JSON.parse(rawBody),
    }
    requests.push(request)
    const route = options.routes?.[url.pathname]
    const reply: Reply =
      route === undefined
        ? { status: 404, json: { v: 1, error: 'not_found', message: 'no such route' } }
        : typeof route === 'function'
          ? route(request)
          : route
    if (reply.hang === true) await new Promise(() => {})
    if (reply.delayMs !== undefined) await clock.sleep(reply.delayMs)
    if (reply.fail === true) return { deny: 'connection refused' }
    const status = reply.status ?? 200
    return {
      value: {
        status,
        ok: status >= 200 && status < 300,
        headers: { 'content-type': 'application/json' },
        text: reply.raw ?? (reply.json === undefined ? '' : JSON.stringify(reply.json)),
      },
    }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => {
    if (options.registerDeny?.includes(e.name) === true) return { deny: `/${e.name} is taken` }
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', async (_$, e) => {
    runs.push([...e.argv])
    const isUname = e.argv[0] === 'uname'
    if ((isUname && options.unameHang === true) || (!isUname && options.launchHang === true)) {
      // Como el engine: la orden colgada se corta al vencer su `timeoutMs` y la llamada falla.
      await clock.sleep(e.init?.timeoutMs ?? 30_000)
      return { deny: `${e.argv[0]} timed out` }
    }
    const stdout = e.argv[0] === 'uname' ? `${options.uname ?? 'Linux'}\n` : ''
    const exitCode = e.argv[0] === 'uname' ? 0 : (options.launchExit ?? 0)
    return {
      value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  // El mod no lee archivos (su versión y sus valores por defecto van generados en el código):
  // si alguna vez lo hiciera, el test lo vería en vez de leer el disco de verdad.
  on('fs.read', (_$, e) => ({ deny: `unexpected read of ${e.path}` }))
  on('fs.exists', (_$, e) => {
    checked.push(e.path)
    return { value: [...files].some(file => isSameFakePath(e.path, file)) }
  })
  on('config.set', (_$, e) => {
    configSets.push({ key: e.key, value: e.value })
    return options.configDeny === undefined ? { value: e.value } : { deny: options.configDeny }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))

  return {
    clock,
    requests,
    toasts,
    statuses,
    logs,
    runs,
    registered,
    configSets,
    store,
    checked,
    to: path => requests.filter(request => request.path === path),
    lastStatus: () => statuses.at(-1),
  }
}

/** Arranca la sesión (interactiva por defecto) y deja que termine lo que lanzó. */
export async function startSession(
  $: Engine,
  w: World,
  options: { readonly interactive?: boolean; readonly cwd?: string } = {},
): Promise<void> {
  const interactive = options.interactive ?? true
  await $.session.start({
    cwd: options.cwd ?? '/home/player/project',
    surface: interactive ? 'terminal' : null,
    isInteractive: interactive,
  })
  await w.clock.settle()
}

export interface BashCall {
  readonly command: string
  readonly exitCode?: number
  readonly stdout?: string
  readonly stderr?: string
  /** La orden sigue en segundo plano (`run_in_background` o cortada por su timeout). */
  readonly backgroundTaskId?: string
}

/** Cómo deben terminar las próximas llamadas a Bash (en orden). */
const bashOutcomes: Omit<BashCall, 'command'>[] = []

/** Contesta las llamadas a Bash desde abajo, como lo haría la herramienta. */
export function bashTool(on: On): void {
  on('tool.call', (_$, e) => {
    const call = bashOutcomes.shift() ?? {}
    if (e.tool !== 'Bash') return { result: {} }
    if ((call.exitCode ?? 0) !== 0) {
      const text = `Exit code ${call.exitCode}`
      return { isError: true, result: text, text }
    }
    return {
      result: {
        stdout: call.stdout ?? '',
        stderr: call.stderr ?? '',
        interrupted: false,
        ...(call.backgroundTaskId === undefined ? {} : { backgroundTaskId: call.backgroundTaskId }),
      },
    }
  })
}

/** Lanza una llamada a Bash como la haría el modelo. */
export async function bash($: Engine, call: BashCall): Promise<void> {
  const { command, ...outcome } = call
  bashOutcomes.push(outcome)
  await $.tool.call({ tool: 'Bash', command })
}

/** Ejecuta un comando como si lo escribiera la persona (`/name args`). */
export function command($: Engine, name: string, args = '') {
  return $.command.run({
    command: name,
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })
}

let turnCounter = 0

/** Un turno completo del bucle principal: prompt, llamadas a Bash y final. */
export async function playTurn(
  $: Engine,
  w: World,
  turn: {
    readonly prompt?: string
    readonly bash?: readonly BashCall[]
    readonly durationMs?: number
    readonly answer?: string
  } = {},
): Promise<string> {
  turnCounter += 1
  const turnId = `engine-turn-${turnCounter}`
  await $.turn.start({ text: turn.prompt ?? 'say hi', turnId })
  await w.clock.settle()
  for (const call of turn.bash ?? []) await bash($, call)
  await $.turn.complete({
    answer: turn.answer ?? 'hi',
    durationMs: turn.durationMs ?? 1234,
    isAborted: false,
    turnId,
    reason: 'answer',
  })
  await w.clock.settle()
  return turnId
}

// ------------------------------------------------------------------ respuestas del casino

export function wallet(overrides: Record<string, unknown> = {}) {
  return {
    seasonId: '2026-10',
    balance: 1000,
    debt: 0,
    netWorth: 1000,
    spins: 3,
    loans: 0,
    currentStreak: 0,
    bestStreak: 1,
    pendingSpins: 0,
    ...overrides,
  }
}

export function turnStartReply(windowConnected: boolean): Reply {
  return {
    json: {
      v: 1,
      round: {
        roundId: '7d9f0c1e-1d2b-4c3a-9e8f-0a1b2c3d4e5f',
        openedAt: '2026-10-12T20:00:00.000Z',
      },
      reused: false,
      windowConnected,
    },
  }
}

export function resolvedReply(
  round: Record<string, unknown> = {},
  walletOverrides: Record<string, unknown> = {},
): Reply {
  return {
    json: {
      v: 1,
      status: 'resolved',
      round: {
        roundId: '7d9f0c1e-1d2b-4c3a-9e8f-0a1b2c3d4e5f',
        openedAt: '2026-10-12T20:00:00.000Z',
        resolvedAt: '2026-10-12T20:00:02.000Z',
        result: 17,
        color: 'black',
        bets: [{ selection: { kind: 'black' }, amount: 100, won: true, payout: 200 }],
        source: 'slip',
        staked: 100,
        returned: 200,
        net: 100,
        jackpot: false,
        gitPushOk: false,
        testFailed: false,
        interestCharged: 0,
        colorStreak: { color: 'black', count: 1 },
        revealAt: '2026-10-12T20:00:06.000Z',
        ...round,
      },
      wallet: wallet({ balance: 1100, netWorth: 1100, ...walletOverrides }),
    },
  }
}

/** Turno sin ventana visible: el servidor guarda la tirada (o la descarta por el tope). */
export function queuedReply(
  pendingSpins: number,
  dropped = false,
  walletOverrides: Record<string, unknown> = {},
): Reply {
  return {
    json: {
      v: 1,
      status: 'queued',
      dropped,
      wallet: wallet({ pendingSpins, ...walletOverrides }),
    },
  }
}

export function meReply(overrides: Record<string, unknown> = {}): Reply {
  return {
    json: {
      v: 1,
      user: {
        login: LOGIN,
        avatarUrl: 'https://avatars.test/octocat',
        profileUrl: 'https://github.test/octocat',
        hidden: false,
        locale: null,
        createdAt: '2026-10-01T00:00:00.000Z',
      },
      wallet: wallet(),
      slip: { bets: [], total: 0 },
      round: null,
      brokeRank: 42,
      ...overrides,
    },
  }
}

export const linkReply: Reply = {
  json: { v: 1, url: `${SERVER}/play?code=${'C'.repeat(43)}`, expiresIn: 60 },
}

/** Rutas de un casino que funciona: turno, ventana, saldo. */
export function happyCasino(windowConnected = false): Record<string, Route> {
  return {
    '/api/me': meReply(),
    '/api/turn/start': turnStartReply(windowConnected),
    '/api/turn/end': resolvedReply(),
    '/api/auth/link': linkReply,
  }
}
