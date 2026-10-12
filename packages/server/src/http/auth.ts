// SPDX-License-Identifier: AGPL-3.0-or-later
// Autenticación de las peticiones: `Authorization: Bearer` (mod) o cookie de sesión (web).
import { opaqueTokenSchema } from '@vibe-gambling/shared'
import type { RouteAuth } from '@vibe-gambling/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'

import type { Config } from '../config.ts'
import { AppError } from '../lib/errors.ts'
import { hashToken } from '../lib/tokens.ts'
import type { AuthService, Authenticated } from '../services/auth.ts'
import { isAllowedOrigin, originOf } from './security.ts'

type Credential = { via: 'bearer' | 'cookie'; token: string }

/** Credencial que trae la petición (sin comprobarla). Una cabecera mal formada es un error. */
export function credentialOf(request: FastifyRequest, cookieName: string): Credential | null {
  const header = request.headers.authorization
  if (typeof header === 'string' && header.length > 0) {
    const match = /^Bearer\s+(\S+)$/i.exec(header)
    if (!match?.[1]) throw new AppError('unauthorized', 'Malformed Authorization header.')
    return { via: 'bearer', token: match[1] }
  }
  const cookie = request.cookies[cookieName]
  return cookie ? { via: 'cookie', token: cookie } : null
}

/** Clave del rate limit por token (hash: el token nunca se guarda en memoria en claro). */
export function tokenKeyOf(request: FastifyRequest, cookieName: string): string | null {
  try {
    const credential = credentialOf(request, cookieName)
    return credential ? hashToken(credential.token) : null
  } catch {
    // Cabecera mal formada: se cuenta solo por IP; la petición fallará igualmente con 401.
    return null
  }
}

export async function lookup(
  auth: AuthService,
  credential: Credential | null,
): Promise<Authenticated | null> {
  if (!credential || !opaqueTokenSchema.safeParse(credential.token).success) return null
  return auth.authenticate(credential.token)
}

/**
 * Crea el `preHandler` de autenticación para un tipo de ruta:
 * `mod` exige la sesión del mod (Bearer), `web` la de la ventana (cookie) y `any` cualquiera.
 */
export function makeRequireAuth(config: Config, auth: AuthService) {
  const cookieName = config.env.SESSION_COOKIE_NAME
  return (kind: Exclude<RouteAuth, 'public'>) =>
    async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
      const credential = credentialOf(request, cookieName)
      const found = await lookup(auth, credential)
      if (!found || !credential) throw new AppError('unauthorized', 'Log in first (/vibe-login).')
      const expected = kind === 'mod' ? 'bearer' : kind === 'web' ? 'cookie' : credential.via
      if (
        credential.via !== expected ||
        found.session.kind !== (expected === 'bearer' ? 'mod' : 'web')
      ) {
        throw new AppError('forbidden', 'This session cannot do that.')
      }
      // Defensa en profundidad contra CSRF (además de SameSite=Strict): las mutaciones con
      // cookie tienen que venir de nuestra propia web.
      const safe = request.method === 'GET' || request.method === 'HEAD'
      const origin = originOf(request)
      if (
        credential.via === 'cookie' &&
        !safe &&
        origin !== null &&
        !isAllowedOrigin(config, origin)
      ) {
        throw new AppError('forbidden', 'Cross-origin request refused.')
      }
      request.auth = found
      request.authVia = credential.via
    }
}

/** Atajo tipado para los handlers que van detrás de `requireAuth`. */
export function authOf(request: FastifyRequest): Authenticated {
  if (!request.auth) throw new AppError('unauthorized', 'Log in first (/vibe-login).')
  return request.auth
}
