// SPDX-License-Identifier: AGPL-3.0-or-later
// Cada prompt es una tirada: `turn/start` al empezar el turno, dos booleanos mientras corre y
// `turn/end` al acabar. Todo en segundo plano y con timeout: el turno nunca espera al casino.

import type { Io } from './io.ts'
import { callApi, debug, isUnauthorized } from './api.ts'
import type { ModConfig } from './config.ts'
import { dailyLimitToast, queuedToast, resultToast } from './format.ts'
import { afterRound, effectsOf } from './items.ts'
import { turnEndBody, turnStartBody } from './payloads.ts'
import { isTurnEnd, isTurnStart } from './responses.ts'
import type { TurnEndView } from './responses.ts'
import { clearSession, loadSession, setStatus, showWallet, toast } from './runtime.ts'
import type { Runtime, StoredSession } from './runtime.ts'
import { markConnected, openWindow } from './window.ts'
import type { WindowState } from './window.ts'

/** Lo que el mod recuerda de un turno en curso: un id propio y dos booleanos. Nada más. */
export interface TurnRecord {
  readonly turnId: string
  gitPushOk: boolean
  testFailed: boolean
  /** Resuelve con la sesión con la que se abrió la ronda, o `null` si no se abrió. */
  readonly started: Promise<StoredSession | null>
}

export interface TurnState {
  /** Turnos del bucle principal en curso, por el id del engine. */
  readonly turns: Map<string, TurnRecord>
  /** El turno principal más reciente (al que se apuntan las llamadas a Bash). */
  active: TurnRecord | null
  readonly window: WindowState
}

/** Abre la ronda en el servidor y, si no hay ventana conectada, la abre. */
async function startRound(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  state: TurnState,
  turnId: string,
): Promise<StoredSession | null> {
  const session = await loadSession(io, config.serverUrl)
  if (session === null) {
    setStatus(io, runtime.messages.statusLogin)
    if (!runtime.loginHintShown) {
      runtime.loginHintShown = true
      toast(io, runtime.messages.loginHint)
    }
    return null
  }
  const os = await runtime.os
  const { pluginVersion } = runtime
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'turnStart',
    guard: isTurnStart,
    timeoutMs: config.turnTimeoutMs,
    token: session.token,
    body: turnStartBody({ turnId, pluginVersion, os }),
  })
  if (!result.ok) {
    if (isUnauthorized(result)) {
      await clearSession(io, config.serverUrl)
      setStatus(io, runtime.messages.statusLogin)
    } else {
      setStatus(io, runtime.messages.statusOffline)
    }
    return null
  }
  if (result.data.windowConnected) {
    markConnected(state.window)
  } else if (config.autoOpen && runtime.isInteractive) {
    // En segundo plano: el enlace y el lanzador del navegador nunca retrasan `turn/end` (que
    // espera a esta promesa). En `claude -p` no hay nadie mirando: no se abre ninguna ventana.
    void openWindow(io, runtime, config, session, state.window, {
      force: false,
      timeoutMs: config.turnTimeoutMs,
    })
  }
  return session
}

/** `turn.start` del bucle principal: apunta el turno y lanza la ronda sin esperarla. */
export function beginTurn(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  state: TurnState,
  engineTurnId: string,
): void {
  const turnId = crypto.randomUUID()
  const started = startRound(io, runtime, config, state, turnId).catch((error: unknown) => {
    debug(io, `turn/start: ${String(error)}`)
    return null
  })
  const record: TurnRecord = { turnId, gitPushOk: false, testFailed: false, started }
  state.turns.set(engineTurnId, record)
  state.active = record
}

/** Enseña el resultado cuando la ventana ya lo ha enseñado (`revealAt`), sin destripar nada. */
function revealResult(io: Io, runtime: Runtime, config: ModConfig, response: TurnEndView): void {
  if (response.status === 'no_round') {
    showWallet(io, runtime, response.wallet)
    return
  }
  if (response.status === 'daily_limit') {
    // Tampoco hay nada que destripar: este prompt no ha tirado.
    const shown = dailyLimitToast(
      response.limit,
      response.reopensAt,
      runtime.locale,
      runtime.messages,
      runtime.lastPhrase,
    )
    if (shown.phrase !== null) runtime.lastPhrase = shown.phrase
    toast(io, shown.text)
    showWallet(io, runtime, response.wallet)
    return
  }
  if (response.status === 'queued') {
    // No hay nada que destripar: la tirada se jugará cuando el jugador la gaste en la ventana.
    const shown = queuedToast(
      response.dropped,
      response.wallet,
      runtime.locale,
      runtime.messages,
      runtime.lastPhrase,
    )
    if (shown.phrase !== null) runtime.lastPhrase = shown.phrase
    toast(io, shown.text)
    showWallet(io, runtime, response.wallet)
    return
  }
  const { round, wallet } = response
  // Se mide con los relojes del servidor (resolvedAt → revealAt) para no depender del reloj local.
  const spinLeft = Date.parse(round.revealAt) - Date.parse(round.resolvedAt)
  const delay = Math.min(config.revealMaxDelayMs, Math.max(0, spinLeft))
  const show = (): void => {
    // Las cargas gastadas se descuentan al enseñar el resultado, no antes: que el casco se gaste
    // (solo al perder) destriparía la tirada.
    const effects = effectsOf(round)
    if (runtime.inventory !== null && effects.length > 0) {
      runtime.inventory = afterRound(runtime.inventory, effects)
    }
    const shown = resultToast(round, wallet, runtime.locale, runtime.messages, runtime.lastPhrase)
    runtime.lastPhrase = shown.phrase
    toast(io, shown.text)
    showWallet(io, runtime, wallet)
  }
  if (delay === 0) show()
  else io.after(delay, show)
}

/** Cierra la ronda en el servidor con la duración y los dos booleanos. */
async function endRound(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  record: TurnRecord,
  durationMs: number,
): Promise<void> {
  const session = await record.started
  if (session === null) return
  const os = await runtime.os
  const { pluginVersion } = runtime
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'turnEnd',
    guard: isTurnEnd,
    timeoutMs: config.turnTimeoutMs,
    token: session.token,
    body: turnEndBody({
      turnId: record.turnId,
      durationMs,
      gitPushOk: record.gitPushOk,
      testFailed: record.testFailed,
      pluginVersion,
      os,
    }),
  })
  if (!result.ok) {
    if (isUnauthorized(result)) {
      await clearSession(io, config.serverUrl)
      setStatus(io, runtime.messages.statusLogin)
    } else {
      setStatus(io, runtime.messages.statusOffline)
    }
    return
  }
  // En `claude -p` no hay nadie mirando: no se programa el toast.
  if (runtime.isInteractive) revealResult(io, runtime, config, result.data)
}

/**
 * `turn.complete` del bucle principal. Devuelve la promesa del envío: la sesión interactiva no la
 * espera; `claude -p` sí (acotada por los timeouts), para que el proceso no acabe antes de enviarla.
 */
export function finishTurn(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  state: TurnState,
  engineTurnId: string,
  durationMs: number,
): Promise<void> | null {
  const record = state.turns.get(engineTurnId)
  if (record === undefined) return null
  state.turns.delete(engineTurnId)
  if (state.active === record) state.active = null
  return endRound(io, runtime, config, record, durationMs).catch((error: unknown) => {
    debug(io, `turn/end: ${String(error)}`)
  })
}
