// SPDX-License-Identifier: AGPL-3.0-or-later
// Abre la ventana del juego: enlace de un solo uso → navegador Chromium en modo app → o, si no
// hay, el navegador por defecto. Una sola vez: si ya se abrió hace poco y aún no conectó, espera.

import type { Io } from './io.ts'
import { callApi, debug } from './api.ts'
import { findBrowser, isSafeWindowUrl, launchCommand } from './browser.ts'
import type { BrowserCandidate } from './browser.ts'
import { originOf } from './config.ts'
import type { ModConfig } from './config.ts'
import { emptyBody } from './payloads.ts'
import { isLink } from './responses.ts'
import type { Runtime, StoredSession } from './runtime.ts'

export type OpenResult = 'opened' | 'skipped' | 'failed'

/** Estado de la apertura durante esta carga del módulo. */
export interface WindowState {
  /** Cuándo se intentó abrir por última vez sin que la ventana llegara a conectar. */
  lastOpenAt: number | null
  /** Hay una apertura en curso (dos turnos a la vez no abren dos ventanas). */
  opening: boolean
  /** Navegador encontrado (se busca una vez por carga). `undefined` = aún no se ha buscado. */
  browser: BrowserCandidate | null | undefined
}

export function createWindowState(): WindowState {
  return { lastOpenAt: null, opening: false, browser: undefined }
}

/** El servidor dice que hay una ventana conectada: la próxima vez que no la haya, se abre ya. */
export function markConnected(state: WindowState): void {
  state.lastOpenAt = null
}

async function locateBrowser(io: Io, state: WindowState, runtime: Runtime) {
  if (state.browser !== undefined) return state.browser
  const os = await runtime.os
  const env = {
    home: await io.env('HOME'),
    programFiles: await io.env('ProgramFiles'),
    programFilesX86: await io.env('ProgramFiles(x86)'),
    localAppData: await io.env('LOCALAPPDATA'),
  }
  state.browser = await findBrowser(os, env, async path => {
    try {
      return await io.exists(path)
    } catch (error) {
      debug(io, `no he podido comprobar ${path}: ${String(error)}`)
      return false
    }
  })
  return state.browser
}

/**
 * Abre la ventana. Con `force` (el comando `/roulette`) ignora la espera entre aperturas.
 * Nunca lanza.
 */
export async function openWindow(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  session: StoredSession,
  state: WindowState,
  options: { readonly force: boolean; readonly timeoutMs: number },
): Promise<OpenResult> {
  if (state.opening) return 'skipped'
  state.opening = true
  try {
    const now = await io.now()
    if (
      !options.force &&
      state.lastOpenAt !== null &&
      now - state.lastOpenAt < config.windowReopenCooldownMs
    ) {
      return 'skipped'
    }
    state.lastOpenAt = now

    const link = await callApi(io, {
      baseUrl: config.serverUrl,
      route: 'link',
      guard: isLink,
      timeoutMs: options.timeoutMs,
      token: session.token,
      body: emptyBody(),
    })
    if (!link.ok) return 'failed'
    if (!isSafeWindowUrl(link.data.url, originOf(config.serverUrl))) {
      debug(io, 'el servidor ha devuelto un enlace que no es de su origen; no lo abro')
      return 'failed'
    }

    const os = await runtime.os
    const browser = await locateBrowser(io, state, runtime)
    const argv = launchCommand(os, browser, link.data.url, config.windowSize)
    if (argv === null) {
      debug(io, `no sé abrir un navegador en este SO (${os})`)
      return 'failed'
    }
    const { exitCode, stderr } = await io.run(argv, config.launchTimeoutMs)
    if (exitCode !== 0) {
      debug(io, `el lanzador del navegador ha salido con ${exitCode}: ${stderr.slice(0, 200)}`)
      return 'failed'
    }
    return 'opened'
  } catch (error) {
    debug(io, `no he podido abrir la ventana: ${String(error)}`)
    return 'failed'
  } finally {
    state.opening = false
  }
}
