// SPDX-License-Identifier: AGPL-3.0-or-later
// Estado del mod durante una carga del módulo: configuración, idioma, SO, versión y sesión.
// Lo que debe sobrevivir entre sesiones (el token) vive en `$.store`; el resto se recalcula.
import type { Io } from './io.ts'

/** Opciones del `userConfig` tal y como las entrega el engine. */
export type PluginOptions = Readonly<Record<string, unknown>>

import { PLUGIN_VERSION, USER_CONFIG_DEFAULTS } from '../generated/manifest.ts'
import type { UserConfigKey } from '../generated/manifest.ts'
import { OS_VALUES } from '../generated/protocol.ts'
import type { Locale, Os } from '../generated/protocol.ts'
import { callApi, debug, isUnauthorized } from './api.ts'
import { parseConfig } from './config.ts'
import type { ModConfig } from './config.ts'
import { statusText } from './format.ts'
import { armedGlyphs, inventoryOf } from './items.ts'
import type { InventoryView } from './items.ts'
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
  /** La de `plugin.json`, generada en `generated/manifest.ts` (una sola fuente de verdad). */
  readonly pluginVersion: string
  isInteractive: boolean
  /** Para no repetir la última frase del toast. */
  lastPhrase: string | null
  /** El aviso de cómo entrar ya se enseñó en esta carga. */
  loginHintShown: boolean
  /**
   * Último bolsillo de la TIENDA que mandó el servidor (null: no lo sabemos o no hay tienda). Sale
   * en la status line como glifos de lo armado.
   */
  inventory: InventoryView | null
  /** Última cartera enseñada en la status line (para repintarla al armar un objeto). */
  lastWallet: WalletView | null
}

export function createRuntime(options: PluginOptions): Runtime {
  const parsed = parseConfig(options)
  return {
    config: parsed.ok ? parsed.config : null,
    configErrors: parsed.ok ? [] : parsed.errors,
    locale: 'en',
    messages: MESSAGES.en,
    os: Promise.resolve('other'),
    pluginVersion: PLUGIN_VERSION,
    isInteractive: false,
    lastPhrase: null,
    loginHintShown: false,
    inventory: null,
    lastWallet: null,
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

/**
 * Valor por defecto de una opción, el del `userConfig` del manifiesto. Sale de
 * `generated/manifest.ts` (generado de `plugin.json`): el mod no lee su manifiesto del disco.
 */
export function manifestDefault<K extends UserConfigKey>(key: K): (typeof USER_CONFIG_DEFAULTS)[K] {
  return USER_CONFIG_DEFAULTS[key]
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
  runtime.lastWallet = wallet
  setStatus(
    io,
    statusText(wallet, runtime.locale, runtime.messages, armedGlyphs(runtime.inventory)),
  )
}

/** Repinta la status line con la última cartera (p. ej. tras armar un objeto). */
export function refreshStatus(io: Io, runtime: Runtime): void {
  if (runtime.lastWallet !== null) showWallet(io, runtime, runtime.lastWallet)
}

/** Guarda el bolsillo que manda el servidor (si lo manda y tiene la forma esperada). */
export function rememberInventory(runtime: Runtime, raw: unknown): InventoryView | null {
  const inventory = inventoryOf(raw)
  if (inventory !== null) runtime.inventory = inventory
  return inventory
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
    // Un servidor sin tienda no manda el bolsillo: entonces no hay nada armado que enseñar.
    runtime.inventory = inventoryOf(result.data.inventory)
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
