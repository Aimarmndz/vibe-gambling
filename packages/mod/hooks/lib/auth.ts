// SPDX-License-Identifier: AGPL-3.0-or-later
// Login con GitHub por Device Flow, mediado por el servidor: el mod enseña el código y consulta
// en segundo plano (con `$.clock`, respetando `interval` y `slow_down`) sin bloquear la sesión.

import type { Io } from './io.ts'
import { callApi, debug } from './api.ts'
import type { ModConfig } from './config.ts'
import { devicePollBody, emptyBody } from './payloads.ts'
import { isDevicePoll, isDeviceStart } from './responses.ts'
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
}

export function createAuthState(): AuthState {
  return { flow: null }
}

/** Para el polling en curso (logout, cambio de servidor, recarga). */
export function cancelLogin(state: AuthState): void {
  state.flow?.timer?.cancel()
  state.flow = null
}

function schedule(
  io: Io,
  runtime: Runtime,
  config: ModConfig,
  state: AuthState,
  flow: LoginFlow,
  seconds: number,
): void {
  flow.timer = io.after(seconds * 1000, () => {
    void poll(io, runtime, config, state, flow, seconds)
  })
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
      // Un fallo de red no corta el login: se vuelve a intentar al siguiente intervalo.
      schedule(io, runtime, config, state, flow, interval)
      return
    }
    const answer = result.data
    switch (answer.status) {
      case 'pending':
      case 'slow_down':
        // Con `slow_down` el servidor ya manda el intervalo nuevo (más largo).
        schedule(io, runtime, config, state, flow, answer.interval)
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
        const session = { token: answer.token, login: answer.user.login }
        await saveSession(io, flow.serverUrl, session)
        toast(
          io,
          `${runtime.messages.loginWelcome(answer.user.login)} ${runtime.messages.loginPublicNotice}`,
        )
        await refreshMe(io, runtime, config, session, config.commandTimeoutMs)
        return
      }
    }
  } catch (error) {
    debug(io, `device/poll: ${String(error)}`)
    if (state.flow === flow) schedule(io, runtime, config, state, flow, interval)
  }
}

/** `/vibe-login`: pide el código y empieza a consultar. Devuelve el texto del comando. */
export async function startLogin(
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
    userCode: start.userCode,
    verificationUri: start.verificationUri,
    deadline: (await io.now()) + start.expiresIn * 1000,
    timer: null,
  }
  state.flow = flow
  schedule(io, runtime, config, state, flow, start.interval)
  return runtime.messages.loginPrompt(
    start.verificationUri,
    start.userCode,
    Math.max(1, Math.round(start.expiresIn / 60)),
  )
}
