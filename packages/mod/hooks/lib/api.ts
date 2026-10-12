// SPDX-License-Identifier: AGPL-3.0-or-later
// Cliente HTTP del mod: `$.http.fetch` con timeout, errores explícitos y nada más que lo
// imprescindible en la petición (método, JSON y, si hay sesión, `Authorization`).

import type { Io } from './io.ts'
import { API_ROUTES } from '../generated/protocol.ts'
import type { ApiRouteName, ErrorCode } from '../generated/protocol.ts'
import { errorCodeOf } from './responses.ts'

export type ApiFailure =
  | { readonly ok: false; readonly reason: 'timeout' | 'offline' | 'invalid' }
  | {
      readonly ok: false
      readonly reason: 'http'
      readonly status: number
      readonly error: ErrorCode | null
      readonly message: string | null
    }

export type ApiResult<T> = { readonly ok: true; readonly data: T } | ApiFailure

export interface ApiRequest<T> {
  readonly baseUrl: string
  readonly route: ApiRouteName
  readonly guard: (value: unknown) => value is T
  readonly timeoutMs: number
  readonly token?: string | undefined
  readonly body?: object | undefined
}

const TIMED_OUT = Symbol('timeout')

/**
 * Espera `promise` como mucho `ms` milisegundos con un temporizador de `$.clock` (el entorno del
 * mod no tiene `setTimeout`). Si vence, resuelve `TIMED_OUT`; el temporizador se cancela siempre.
 */
export async function withTimeout<T>(
  io: Io,
  promise: Promise<T>,
  ms: number,
): Promise<T | typeof TIMED_OUT> {
  let timer: { cancel: () => void } | undefined
  const expired = new Promise<typeof TIMED_OUT>(resolve => {
    timer = io.after(ms, () => resolve(TIMED_OUT))
  })
  try {
    return await Promise.race([promise, expired])
  } finally {
    timer?.cancel()
  }
}

/** Escribe en el log de depuración del engine (`claude --debug`), nunca en pantalla. */
export function debug(io: Io, text: string): void {
  try {
    io.log(text)
  } catch {
    // El propio log ha fallado: no hay otro sitio donde dejarlo y nunca debe romper un hook.
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** Llama a una ruta de la API. Nunca lanza: devuelve el dato o el motivo del fallo. */
export async function callApi<T>(io: Io, request: ApiRequest<T>): Promise<ApiResult<T>> {
  const route = API_ROUTES[request.route]
  const headers: Record<string, string> = { accept: 'application/json' }
  if (request.body !== undefined) headers['content-type'] = 'application/json'
  if (request.token !== undefined) headers.authorization = `Bearer ${request.token}`
  const init = {
    method: route.method,
    headers,
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  }
  try {
    const response = await withTimeout(
      io,
      io.fetch(`${request.baseUrl}${route.path}`, init),
      request.timeoutMs,
    )
    if (response === TIMED_OUT) {
      debug(io, `${route.path}: sin respuesta en ${request.timeoutMs} ms`)
      return { ok: false, reason: 'timeout' }
    }
    let data: unknown = null
    try {
      data = response.text === '' ? null : JSON.parse(response.text)
    } catch (error) {
      debug(io, `${route.path}: respuesta que no es JSON (${response.status}): ${errorText(error)}`)
      return { ok: false, reason: 'invalid' }
    }
    if (!response.ok) {
      const message =
        typeof data === 'object' && data !== null && 'message' in data
          ? String(data.message).slice(0, 200)
          : null
      debug(io, `${route.path}: HTTP ${response.status}`)
      return {
        ok: false,
        reason: 'http',
        status: response.status,
        error: errorCodeOf(data),
        message,
      }
    }
    if (!request.guard(data)) {
      debug(io, `${route.path}: la respuesta no tiene la forma esperada`)
      return { ok: false, reason: 'invalid' }
    }
    return { ok: true, data }
  } catch (error) {
    debug(io, `${route.path}: ${errorText(error)}`)
    return { ok: false, reason: 'offline' }
  }
}

/** ¿El servidor ha dicho que la sesión no vale? */
export function isUnauthorized(result: ApiFailure): boolean {
  return result.reason === 'http' && (result.status === 401 || result.error === 'unauthorized')
}
