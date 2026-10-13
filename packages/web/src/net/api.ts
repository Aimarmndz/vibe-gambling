// SPDX-License-Identifier: AGPL-3.0-or-later
// Llamadas HTTP de la web, todas al propio dominio y validadas con los esquemas de shared.
import {
  API_ROUTES,
  PROTOCOL_VERSION,
  errorResponseSchema,
  hallOfRuinResponseSchema,
  leaderboardResponseSchema,
  meResponseSchema,
  okResponseSchema,
  redeemResponseSchema,
} from '@vibe-gambling/shared'
import type {
  ErrorCode,
  HallOfRuinResponse,
  LeaderboardBoard,
  LeaderboardResponse,
  MeResponse,
} from '@vibe-gambling/shared'
import type { z } from 'zod'

export class ApiError extends Error {
  override name = 'ApiError'
  readonly status: number
  readonly code: ErrorCode | null

  constructor(status: number, code: ErrorCode | null, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<z.output<T>> {
  let response: Response
  try {
    response = await fetchImpl(path, {
      credentials: 'same-origin',
      ...init,
      headers: { accept: 'application/json', ...(init.headers ?? {}) },
    })
  } catch (error) {
    throw new ApiError(0, null, `sin conexión con el servidor: ${String(error)}`)
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Cuerpo vacío o no JSON: se trata abajo según el código de estado.
  }
  if (!response.ok) {
    const err = errorResponseSchema.safeParse(body)
    throw new ApiError(
      response.status,
      err.success ? err.data.error : null,
      err.success ? err.data.message : `HTTP ${response.status}`,
    )
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError(response.status, null, `respuesta fuera de contrato en ${path}`)
  }
  return parsed.data
}

/** Canjea el código de un solo uso de `/play?code=…` por la cookie de sesión. */
export function redeemCode(code: string, fetchImpl?: typeof fetch) {
  return request(
    API_ROUTES.redeem.path,
    redeemResponseSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: PROTOCOL_VERSION, code }),
    },
    fetchImpl,
  )
}

/** Cierra la sesión de esta ventana (la cookie). El servidor avisa por el WebSocket con `bye`. */
export function logout(fetchImpl?: typeof fetch) {
  return request(
    API_ROUTES.logout.path,
    okResponseSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: PROTOCOL_VERSION }),
    },
    fetchImpl,
  )
}

export function fetchMe(fetchImpl?: typeof fetch): Promise<MeResponse> {
  return request(API_ROUTES.me.path, meResponseSchema, {}, fetchImpl)
}

export function fetchLeaderboard(
  args: { board: LeaderboardBoard; season?: string; limit: number },
  fetchImpl?: typeof fetch,
): Promise<LeaderboardResponse> {
  const query = new URLSearchParams({ board: args.board, limit: String(args.limit) })
  if (args.season) query.set('season', args.season)
  return request(
    `${API_ROUTES.leaderboard.path}?${query.toString()}`,
    leaderboardResponseSchema,
    {},
    fetchImpl,
  )
}

export function fetchHallOfRuin(fetchImpl?: typeof fetch): Promise<HallOfRuinResponse> {
  return request(API_ROUTES.hallOfRuin.path, hallOfRuinResponseSchema, {}, fetchImpl)
}

/** Lee el código de un solo uso de la URL y lo quita sin recargar (que no quede en el historial). */
export function takeCodeFromUrl(loc: Location, hist: History): string | null {
  const url = new URL(loc.href)
  const code = url.searchParams.get('code')
  if (code === null) return null
  url.searchParams.delete('code')
  hist.replaceState(hist.state, '', `${url.pathname}${url.search}${url.hash}`)
  return code
}
