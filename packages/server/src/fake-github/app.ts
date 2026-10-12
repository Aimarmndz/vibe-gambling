// SPDX-License-Identifier: AGPL-3.0-or-later
// GitHub falso para desarrollo, tests y E2E. Implementa lo justo del Device Flow:
// `/login/device/code`, `/login/oauth/access_token` (autoriza a partir del segundo poll) y
// `GET /user`. NUNCA se usa en producción: solo aparece en el compose de desarrollo.
import { randomBytes } from 'node:crypto'

import Fastify from 'fastify'
import type { FastifyInstance, FastifyServerOptions } from 'fastify'

import type { FakeGitHubEnv } from '../config.ts'

interface PendingCode {
  userCode: string
  expiresAt: number
  polls: number
  accessToken: string | null
}

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

/** Avatar SVG generado a partir del id (sin imágenes con derechos de nadie). */
function avatarSvg(id: number): string {
  const hue = (id * 47) % 360
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="hsl(${hue} 60% 20%)"/><rect x="2" y="2" width="4" height="4" fill="hsl(${hue} 80% 60%)"/></svg>`
}

export function buildFakeGitHub(
  env: FakeGitHubEnv,
  logger: FastifyServerOptions['logger'],
): FastifyInstance {
  const app = Fastify({ logger })
  const codes = new Map<string, PendingCode>()
  const tokens = new Set<string>()

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  )

  const field = (body: unknown, name: string): string | undefined => {
    const value = (body as Record<string, unknown> | null)?.[name]
    return typeof value === 'string' ? value : undefined
  }

  app.post('/login/device/code', async (request, reply) => {
    if (field(request.body, 'client_id') !== env.FAKE_GITHUB_CLIENT_ID) {
      return reply.code(401).send({ error: 'incorrect_client_credentials' })
    }
    const deviceCode = randomBytes(20).toString('hex')
    const userCode =
      `${randomBytes(2).toString('hex')}-${randomBytes(2).toString('hex')}`.toUpperCase()
    codes.set(deviceCode, {
      userCode,
      expiresAt: Date.now() + env.FAKE_GITHUB_EXPIRES_IN_SECONDS * 1000,
      polls: 0,
      accessToken: null,
    })
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${env.FAKE_GITHUB_PUBLIC_URL}/login/device`,
      expires_in: env.FAKE_GITHUB_EXPIRES_IN_SECONDS,
      interval: env.FAKE_GITHUB_INTERVAL_SECONDS,
    }
  })

  app.post('/login/oauth/access_token', async request => {
    if (field(request.body, 'client_id') !== env.FAKE_GITHUB_CLIENT_ID) {
      return { error: 'incorrect_client_credentials' }
    }
    if (field(request.body, 'grant_type') !== GRANT_TYPE) return { error: 'unsupported_grant_type' }
    const deviceCode = field(request.body, 'device_code') ?? ''
    const pending = codes.get(deviceCode)
    if (!pending) return { error: 'incorrect_device_code' }
    if (pending.expiresAt <= Date.now()) {
      codes.delete(deviceCode)
      return { error: 'expired_token' }
    }
    pending.polls++
    // Primer poll: el usuario "aún no ha metido el código"; a partir del segundo, autorizado.
    if (pending.polls < 2) return { error: 'authorization_pending' }
    const token = `gho_fake_${randomBytes(18).toString('hex')}`
    tokens.add(token)
    codes.delete(deviceCode)
    return { access_token: token, token_type: 'bearer', scope: '' }
  })

  app.get('/user', async (request, reply) => {
    const match = /^(?:Bearer|token)\s+(\S+)$/i.exec(request.headers.authorization ?? '')
    if (!match?.[1] || !tokens.has(match[1])) {
      return reply.code(401).send({ message: 'Bad credentials' })
    }
    return {
      id: env.FAKE_GITHUB_USER_ID,
      login: env.FAKE_GITHUB_USER_LOGIN,
      avatar_url: `${env.FAKE_GITHUB_PUBLIC_URL}/avatars/${env.FAKE_GITHUB_USER_ID}.svg`,
    }
  })

  app.get<{ Params: { id: string } }>('/avatars/:id.svg', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10)
    reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=3600')
    return avatarSvg(Number.isSafeInteger(id) && id > 0 ? id : 1)
  })

  // Página de verificación de pega: en el falso no hace falta escribir el código.
  app.get('/login/device', async (_request, reply) =>
    reply
      .type('text/plain; charset=utf-8')
      .send('Fake GitHub: no need to type the code, the login is approved on the next poll.\n'),
  )

  app.get('/healthz', async () => ({ ok: true }))
  return app
}
