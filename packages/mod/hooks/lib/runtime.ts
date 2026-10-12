// SPDX-License-Identifier: AGPL-3.0-or-later
// Estado del mod durante una carga del módulo: configuración, idioma, SO, versión y sesión.
// Lo que debe sobrevivir entre sesiones (el token) vive en `$.store`; el resto se recalcula.
import type { Io } from './io.ts'

/** Opciones del `userConfig` tal y como las entrega el engine. */
export type PluginOptions = Readonly<Record<string, unknown>>

import { OS_VALUES } from '../generated/protocol.ts'
import type { Locale, Os } from '../generated/protocol.ts'
import { callApi, debug, isUnauthorized } from './api.ts'
import { parseConfig } from './config.ts'
import type { ModConfig } from './config.ts'
import { statusText } from './format.ts'
import { MESSAGES, localeFromEnv } from './messages.ts'
import type { Messages } from './messages.ts'
import { isMe } from './responses.ts'
import type { MeView, WalletView } from './responses.ts'

/** Sesión del mod en un servidor: el token y el login (para confirmar el borrado de cuenta). */
export interface StoredSession {
  readonly token: string
  readonly login: string
}

export interface Runtime {
  /** `null` si las opciones no son válidas (el mod se queda quieto y lo dice). */
  readonly config: ModConfig | null
  readonly configErrors: readonly string[]
  locale: Locale
  messages: Messages
  /** Se rellena en `session.start`. */
  os: Promise<Os>
  pluginVersion: Promise<string | null>
  isInteractive: boolean
  /** Para no repetir la última frase del toast. */
  lastPhrase: string | null
  /** El aviso de cómo entrar ya se enseñó en esta carga. */
  loginHintShown: boolean
}

export function createRuntime(options: PluginOptions): Runtime {
  const parsed = parseConfig(options)
  return {
    config: parsed.ok ? parsed.config : null,
    configErrors: parsed.ok ? [] : parsed.errors,
    locale: 'en',
    messages: MESSAGES.en,
    os: Promise.resolve('other'),
    pluginVersion: Promise.resolve(null),
    isInteractive: false,
    lastPhrase: null,
    loginHintShown: false,
  }
}

/** Idioma: el de la opción `language` o, en `auto`, el del sistema. */
export async function resolveLocale(io: Io, runtime: Runtime): Promise<Locale> {
  const choice = runtime.config?.language ?? 'auto'
  if (choice !== 'auto') return choice
  return localeFromEnv([
    await io.env('LC_ALL'),
    await io.env('LC_MESSAGES'),
    await io.env('LANG'),
    await io.env('LANGUAGE'),
  ])
}

/**
 * SO genérico, lo único que el mod cuenta del ordenador: `OS=Windows_NT` en Windows y, si no,
 * `uname -s` (Darwin / Linux). Cualquier otra cosa es `other`.
 */
export async function detectOs(io: Io, timeoutMs: number): Promise<Os> {
  try {
    if ((await io.env('OS')) === 'Windows_NT') return 'win32'
    const { exitCode, stdout } = await io.run(['uname', '-s'], timeoutMs)
    if (exitCode !== 0) return 'other'
    const name = stdout.trim().toLowerCase()
    return OS_VALUES.find(os => os === name) ?? 'other'
  } catch (error) {
    debug(io, `no he podido averiguar el SO: ${String(error)}`)
    return 'other'
  }
}

/** Versión del plugin: la del propio `plugin.json` (una sola fuente de verdad). */
export async function readPluginVersion(io: Io): Promise<string | null> {
  try {
    const manifest: unknown = JSON.parse(
      String(await io.readText(`${io.pluginRoot}/.claude-plugin/plugin.json`)),
    )
    const version =
      typeof manifest === 'object' && manifest !== null && 'version' in manifest
        ? manifest.version
        : null
    return typeof version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}/.test(version)
      ? version
      : null
  } catch (error) {
    debug(io, `no he podido leer la versión del plugin: ${String(error)}`)
    return null
  }
}

/** Valor por defecto de una opción, leído del `userConfig` del manifiesto. */
export async function manifestDefault(io: Io, key: string): Promise<unknown> {
  try {
    const manifest: unknown = JSON.parse(
      String(await io.readText(`${io.pluginRoot}/.claude-plugin/plugin.json`)),
    )
    if (typeof manifest !== 'object' || manifest === null || !('userConfig' in manifest))
      return null
    const fields = manifest.userConfig
    if (typeof fields !== 'object' || fields === null || !(key in fields)) return null
    const field: unknown = (fields as Record<string, unknown>)[key]
    return typeof field === 'object' && field !== null && 'default' in field ? field.default : null
  } catch (error) {
    debug(io, `no he podido leer el manifiesto: ${String(error)}`)
    return null
  }
}

// ------------------------------------------------------------------ sesión en `$.store`

/** Clave del token: una por servidor, así cambiar de servidor no mezcla sesiones. */
function sessionKey(serverUrl: string): string {
  return `session:${serverUrl}`
}

export async function loadSession(io: Io, serverUrl: string): Promise<StoredSession | null> {
  try {
    const value: unknown = await io.storeGet(sessionKey(serverUrl))
    if (
      typeof value === 'object' &&
      value !== null &&
      'token' in value &&
      'login' in value &&
      typeof value.token === 'string' &&
      typeof value.login === 'string' &&
      value.token !== ''
    ) {
      return { token: value.token, login: value.login }
    }
    return null
  } catch (error) {
    debug(io, `no he podido leer la sesión guardada: ${String(error)}`)
    return null
  }
}

export async function saveSession(
  io: Io,
  serverUrl: string,
  session: StoredSession,
): Promise<void> {
  await io.storeSet(sessionKey(serverUrl), { token: session.token, login: session.login })
}

export async function clearSession(io: Io, serverUrl: string): Promise<void> {
  try {
    await io.storeDelete(sessionKey(serverUrl))
  } catch (error) {
    debug(io, `no he podido borrar la sesión guardada: ${String(error)}`)
  }
}

// ------------------------------------------------------------------ status line

export function setStatus(io: Io, text: string | undefined): void {
  try {
    io.status(text)
  } catch (error) {
    debug(io, `no he podido poner la status line: ${String(error)}`)
  }
}

export function showWallet(io: Io, runtime: Runtime, wallet: WalletView): void {
  setStatus(io, statusText(wallet, runtime.locale, runtime.messages))
}

export function toast(io: Io, text: string): void {
  try {
    io.toast(text)
  } catch (error) {
    debug(io, `no he podido enseñar el toast: ${String(error)}`)
  }
}

/**
 * Pide `/api/me` y pone el saldo en la status line. Si la sesión ya no vale, la olvida;
 * si el servidor no responde, "offline". Devuelve los datos si llegaron.
 */
export async function refreshMe(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  session: StoredSession,
  timeoutMs: number,
): Promise<MeView | null> {
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'me',
    guard: isMe,
    timeoutMs,
    token: session.token,
  })
  if (result.ok) {
    showWallet(io, runtime, result.data.wallet)
    return result.data
  }
  if (isUnauthorized(result)) {
    await clearSession(io, config.serverUrl)
    setStatus(io, runtime.messages.statusLogin)
  } else {
    setStatus(io, runtime.messages.statusOffline)
  }
  return null
}
