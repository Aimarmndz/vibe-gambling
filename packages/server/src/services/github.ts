// SPDX-License-Identifier: AGPL-3.0-or-later
// Cliente mínimo de GitHub para el Device Flow. Las URLs base salen de la configuración,
// así que en desarrollo y en los tests apuntan a un GitHub falso.
// Docs: https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
import { z } from 'zod'

import { AppError } from '../lib/errors.ts'

export interface GitHubOptions {
  clientId: string
  oauthBaseUrl: string
  apiBaseUrl: string
  timeoutMs: number
  userAgent: string
}

export interface DeviceCode {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type TokenPoll =
  | { kind: 'token'; accessToken: string }
  | { kind: 'pending' }
  | { kind: 'slow_down'; interval: number | null }
  | { kind: 'expired' }
  | { kind: 'denied' }

export interface GitHubProfile {
  id: number
  login: string
  avatarUrl: string
}

const deviceCodeSchema = z.object({
  device_code: z.string().min(1).max(200),
  user_code: z.string().min(4).max(20),
  verification_uri: z.url(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
})

const tokenSchema = z.union([
  z.object({ access_token: z.string().min(1).max(500) }),
  z.object({ error: z.string().max(100), interval: z.number().int().positive().optional() }),
])

const profileSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(39),
  avatar_url: z.url(),
})

/** Lo que GitHub añade al intervalo con cada `slow_down` (regla del propio Device Flow). */
const SLOW_DOWN_STEP_SECONDS = 5

export function slowDownInterval(current: number, suggested: number | null): number {
  return suggested ?? current + SLOW_DOWN_STEP_SECONDS
}

export class GitHubClient {
  readonly #o: GitHubOptions

  constructor(options: GitHubOptions) {
    this.#o = options
  }

  async requestDeviceCode(): Promise<DeviceCode> {
    // Sin scopes: solo hace falta el perfil público.
    const body = await this.#post('/login/device/code', { client_id: this.#o.clientId, scope: '' })
    const parsed = deviceCodeSchema.safeParse(body)
    if (!parsed.success) {
      throw new AppError('github_unavailable', 'GitHub refused to start the login.')
    }
    return {
      deviceCode: parsed.data.device_code,
      userCode: parsed.data.user_code,
      verificationUri: parsed.data.verification_uri,
      expiresIn: parsed.data.expires_in,
      interval: parsed.data.interval,
    }
  }

  async pollAccessToken(deviceCode: string): Promise<TokenPoll> {
    const body = await this.#post('/login/oauth/access_token', {
      client_id: this.#o.clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    })
    const parsed = tokenSchema.safeParse(body)
    if (!parsed.success) throw new AppError('github_unavailable', 'Unexpected answer from GitHub.')
    const data = parsed.data
    if ('access_token' in data) return { kind: 'token', accessToken: data.access_token }
    switch (data.error) {
      case 'authorization_pending':
        return { kind: 'pending' }
      case 'slow_down':
        return { kind: 'slow_down', interval: data.interval ?? null }
      case 'expired_token':
      case 'incorrect_device_code':
        return { kind: 'expired' }
      case 'access_denied':
        return { kind: 'denied' }
      default:
        // `unsupported_grant_type`, `incorrect_client_credentials`, `device_flow_disabled`…:
        // es un fallo de configuración del servidor, no del usuario.
        throw new AppError('github_unavailable', `GitHub login failed (${data.error}).`)
    }
  }

  /** Perfil público. El token se usa solo para esta llamada y luego se olvida. */
  async fetchProfile(accessToken: string): Promise<GitHubProfile> {
    const response = await this.#fetch(`${this.#o.apiBaseUrl}/user`, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
        'user-agent': this.#o.userAgent,
      },
    })
    const parsed = profileSchema.safeParse(await this.#json(response))
    if (!parsed.success) throw new AppError('github_unavailable', 'Unexpected GitHub profile.')
    return { id: parsed.data.id, login: parsed.data.login, avatarUrl: parsed.data.avatar_url }
  }

  async #post(path: string, form: Record<string, string>): Promise<unknown> {
    const response = await this.#fetch(`${this.#o.oauthBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': this.#o.userAgent,
      },
      body: new URLSearchParams(form).toString(),
    })
    return this.#json(response)
  }

  async #fetch(url: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(this.#o.timeoutMs) })
    } catch (error) {
      throw new AppError('github_unavailable', 'GitHub is not answering. Try again in a minute.', {
        cause: error,
      })
    }
    // GitHub contesta los errores del Device Flow con 200 y `error` en el cuerpo; el resto de
    // estados son fallos de verdad.
    if (!response.ok) {
      await response.body?.cancel()
      throw new AppError('github_unavailable', `GitHub answered ${response.status}.`)
    }
    return response
  }

  async #json(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch (error) {
      throw new AppError('github_unavailable', 'GitHub sent something that is not JSON.', {
        cause: error,
      })
    }
  }
}
