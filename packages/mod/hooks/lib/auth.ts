// SPDX-License-Identifier: AGPL-3.0-or-later
// Login con GitHub por Device Flow, mediado por el servidor: el mod enseña el código y consulta
// en segundo plano (con `$.clock`, respetando `interval` y `slow_down`) sin bloquear la sesión.

import type { Io } from './io.ts'
import { callApi, debug } from './api.ts'
import type { ModConfig } from './config.ts'
import { devicePollBody, emptyBody } from './payloads.ts'
import { TEXT_LIMITS } from '../generated/protocol.ts'
import { cleanText, isDevicePoll, isDeviceStart } from './responses.ts'
import { refreshMe, saveSession, setStatus, toast } from './runtime.ts'
import type { Runtime } from './runtime.ts'

interface LoginFlow {
  readonly serverUrl: string
  readonly pollId: string
  readonly userCode: string
  readonly verificationUri: string
  readonly deadline: number
  timer: { cancel: () => void } | null
}

export interface AuthState {
  flow: LoginFlow | null
  /** Petición de código en vuelo: un segundo `/vibe-login` a la vez espera a la misma. */
  starting: Promise<string> | null
}

export function createAuthState(): AuthState {
  return { flow: null, starting: null }
}

/** Para el polling en curso (logout, cambio de servidor, recarga). */
export function cancelLogin(state: AuthState): void {
  state.flow?.timer?.cancel()
  state.flow = null
}

/**
 * Programa la siguiente consulta a `seconds` segundos, pero nunca más allá de la caducidad del
 * código: con un intervalo absurdo del servidor, el aviso de "caducado" llega igual a su hora.
 */
async function schedule(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  state: AuthState,
  flow: LoginFlow,
  seconds: number,
): Promise<void> {
  const left = Math.max(0, flow.deadline - (await io.now()))
  if (state.flow !== flow) return
  flow.timer = io.after(Math.min(seconds * 1000, left), () => {
    void poll(io, runtime, config, state, flow, seconds)
  })
}

/** ¿Un error HTTP del polling es pasajero (se reintenta) o definitivo (se acaba el login)? */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function poll(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  state: AuthState,
  flow: LoginFlow,
  interval: number,
): Promise<void> {
  if (state.flow !== flow) return
  try {
    if ((await io.now()) >= flow.deadline) {
      state.flow = null
      toast(io, runtime.messages.loginExpired)
      return
    }
    const result = await callApi(io, {
      baseUrl: flow.serverUrl,
      route: 'devicePoll',
      guard: isDevicePoll,
      timeoutMs: config.commandTimeoutMs,
      body: devicePollBody(flow.pollId),
    })
    if (state.flow !== flow) return
    if (!result.ok) {
      if (result.reason !== 'http' || isRetryableStatus(result.status)) {
        // Un fallo de red, un 5xx o un 429 no cortan el login: se reintenta al siguiente intervalo.
        await schedule(io, runtime, config, state, flow, interval)
        return
      }
      // Un 4xx no se arregla esperando: se acaba el login y se dice por qué.
      state.flow = null
      toast(io, runtime.messages.loginFailed(result.message ?? `HTTP ${result.status}`))
      return
    }
    const answer = result.data
    switch (answer.status) {
      case 'pending':
      case 'slow_down':
        // Con `slow_down` el servidor ya manda el intervalo nuevo (más largo).
        await schedule(io, runtime, config, state, flow, answer.interval)
        return
      case 'expired':
        state.flow = null
        toast(io, runtime.messages.loginExpired)
        return
      case 'denied':
        state.flow = null
        toast(io, runtime.messages.loginDenied)
        return
      case 'ok': {
        state.flow = null
        const session = {
          token: answer.token,
          login: cleanText(answer.user.login, TEXT_LIMITS.login),
        }
        await saveSession(io, flow.serverUrl, session)
        toast(
          io,
          `${runtime.messages.loginWelcome(session.login)} ${runtime.messages.loginPublicNotice}`,
        )
        await refreshMe(io, runtime, config, session, config.commandTimeoutMs)
        return
      }
    }
  } catch (error) {
    debug(io, `device/poll: ${String(error)}`)
    if (state.flow === flow) {
      await schedule(io, runtime, config, state, flow, interval).catch((failure: unknown) => {
        debug(io, `device/poll: no he podido reprogramar la consulta: ${String(failure)}`)
      })
    }
  }
}

/**
 * `/vibe-login`: pide el código y empieza a consultar. Devuelve el texto del comando. Dos
 * `/vibe-login` a la vez comparten la misma petición: si no, se enseñarían dos códigos y solo se
 * consultaría el segundo.
 */
export async function startLogin(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  state: AuthState,
): Promise<string> {
  if (state.starting !== null) return state.starting
  const starting = requestCode(io, runtime, config, state)
  state.starting = starting
  try {
    return await starting
  } finally {
    state.starting = null
  }
}

async function requestCode(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  state: AuthState,
): Promise<string> {
  const current = state.flow
  if (
    current !== null &&
    current.serverUrl === config.serverUrl &&
    (await io.now()) < current.deadline
  ) {
    return runtime.messages.loginInProgress(current.verificationUri, current.userCode)
  }
  cancelLogin(state)
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'deviceStart',
    guard: isDeviceStart,
    timeoutMs: config.commandTimeoutMs,
    body: emptyBody(),
  })
  if (!result.ok) {
    if (result.reason !== 'http') setStatus(io, runtime.messages.statusOffline)
    return result.reason === 'http'
      ? runtime.messages.serverError(result.message ?? String(result.status))
      : runtime.messages.offline
  }
  const start = result.data
  const flow: LoginFlow = {
    serverUrl: config.serverUrl,
    pollId: start.pollId,
    // Lo que se enseña en el terminal: el código sin caracteres de control y la URL normalizada
    // (el parser codifica cualquier carácter raro; el guard ya exige http(s)).
    userCode: cleanText(start.userCode, TEXT_LIMITS.userCode),
    verificationUri: new URL(start.verificationUri).href,
    deadline: (await io.now()) + start.expiresIn * 1000,
    timer: null,
  }
  state.flow = flow
  await schedule(io, runtime, config, state, flow, start.interval)
  return runtime.messages.loginPrompt(
    flow.verificationUri,
    flow.userCode,
    Math.max(1, Math.round(start.expiresIn / 60)),
  )
}
