// SPDX-License-Identifier: AGPL-3.0-or-later
// Device Flow completo con GitHub mockeado (msw): el servidor habla con GitHub, crea el usuario,
// descarta el token de GitHub y entrega un token de sesión propio.
import {
  devicePollResponseSchema,
  deviceStartResponseSchema,
  opaqueTokenSchema,
} from '@vibe-gambling/shared'
import { eq } from 'drizzle-orm'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { deviceAuths, sessions, users } from '../../src/db/schema.ts'
import { hashToken } from '../../src/lib/tokens.ts'
import { startTestApp } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'
import { TEST_GITHUB_API, TEST_GITHUB_OAUTH } from '../helpers/env.ts'

const GITHUB_TOKEN = 'gho_this_must_never_be_stored_anywhere'

interface Script {
  /** Respuestas de `/login/oauth/access_token`, en orden (la última se repite). */
  token: Array<Record<string, unknown>>
  profile?: Record<string, unknown>
  calls: { code: number; token: number; user: number }
  lastForm?: URLSearchParams
}

let script: Script
let deviceCounter = 0

const github = setupServer(
  http.post(`${TEST_GITHUB_OAUTH}/login/device/code`, async ({ request }) => {
    script.calls.code++
    const form = new URLSearchParams(await request.text())
    if (form.get('client_id') !== 'test-client-id') {
      return HttpResponse.json({ error: 'incorrect_client_credentials' }, { status: 401 })
    }
    deviceCounter++
    return HttpResponse.json({
      device_code: `device-code-${deviceCounter}`,
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.test/login/device',
      expires_in: 900,
      interval: 5,
    })
  }),
  http.post(`${TEST_GITHUB_OAUTH}/login/oauth/access_token`, async ({ request }) => {
    script.calls.token++
    script.lastForm = new URLSearchParams(await request.text())
    const next = script.token.length > 1 ? script.token.shift() : script.token[0]
    return HttpResponse.json(next ?? { error: 'authorization_pending' })
  }),
  http.get(`${TEST_GITHUB_API}/user`, ({ request }) => {
    script.calls.user++
    if (request.headers.get('authorization') !== `Bearer ${GITHUB_TOKEN}`) {
      return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 })
    }
    return HttpResponse.json(
      script.profile ?? {
        id: 777,
        login: 'Octo',
        avatar_url: 'https://avatars.test/777',
        created_at: '2012-03-04T05:06:07Z',
      },
    )
  }),
)

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
  // msw intercepta los sockets nuevos del proceso (también los de Postgres) y rompe su protocolo:
  // se abren antes todas las conexiones del pool, y msw solo ve las peticiones a GitHub.
  await Promise.all(Array.from({ length: 20 }, () => t.db.sql`select pg_sleep(0.05)`))
  github.listen({ onUnhandledFrame: 'bypass' })
})
afterEach(() => github.resetHandlers())
afterAll(async () => {
  await t.close()
  github.close()
})

function fresh(token: Script['token'], profile?: Script['profile']) {
  script = { token, profile, calls: { code: 0, token: 0, user: 0 } }
}

async function deviceStart() {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/device/start',
    payload: { v: 1 },
  })
  expect(res.statusCode, res.body).toBe(200)
  return deviceStartResponseSchema.parse(res.json())
}

async function poll(pollId: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/device/poll',
    payload: { v: 1, pollId },
  })
  expect(res.statusCode, res.body).toBe(200)
  return devicePollResponseSchema.parse(res.json())
}

describe('Device Flow', () => {
  it('flujo completo: pending → slow_down → ok, respetando el intervalo de GitHub', async () => {
    fresh([
      { error: 'authorization_pending' },
      { error: 'slow_down', interval: 10 },
      { access_token: GITHUB_TOKEN, token_type: 'bearer', scope: '' },
    ])
    const start = await deviceStart()
    expect(start).toMatchObject({ userCode: 'ABCD-1234', interval: 5, expiresIn: 900 })
    expect(opaqueTokenSchema.safeParse(start.pollId).success).toBe(true)
    // El device_code nunca sale del servidor.
    expect(JSON.stringify(start)).not.toContain('device-code')

    expect(await poll(start.pollId)).toEqual({ v: 1, status: 'pending', interval: 5 })
    expect(script.lastForm?.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
    // Demasiado pronto: no se molesta a GitHub.
    expect(await poll(start.pollId)).toEqual({ v: 1, status: 'pending', interval: 5 })
    expect(script.calls.token).toBe(1)

    t.clock.advance(5000)
    expect(await poll(start.pollId)).toEqual({ v: 1, status: 'slow_down', interval: 10 })
    t.clock.advance(5000)
    expect((await poll(start.pollId)).status).toBe('pending')
    expect(script.calls.token).toBe(2)

    t.clock.advance(5000)
    const ok = await poll(start.pollId)
    if (ok.status !== 'ok') throw new Error(`esperaba ok y llegó ${ok.status}`)
    expect(ok.isNew).toBe(true)
    expect(ok.user).toMatchObject({
      login: 'Octo',
      avatarUrl: 'https://avatars.test/777',
      profileUrl: 'https://github.test/Octo',
      hidden: false,
      // Cuenta de GitHub de 2012: ya sale en el ranking.
      newAccount: null,
    })
    // Se guarda la fecha de creación de la cuenta de GitHub (regla antiabuso del ranking).
    const [stored] = await t.db.db.select().from(users).where(eq(users.githubId, 777))
    expect(stored?.githubCreatedAt?.toISOString()).toBe('2012-03-04T05:06:07.000Z')

    // El token de sesión funciona contra /api/me…
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${ok.token}` },
    })
    expect(me.statusCode).toBe(200)
    // …se guarda solo como hash, y el de GitHub no está en ninguna parte.
    const [session] = await t.db.db.select().from(sessions)
    expect(session?.tokenHash).toBe(hashToken(ok.token))
    expect(session?.kind).toBe('mod')
    const dump = await t.db.sql`
      select row_to_json(t)::text as row from (
        select * from users) t
      union all select row_to_json(s)::text from sessions s
      union all select row_to_json(d)::text from device_auths d`
    for (const { row } of dump) {
      expect(row).not.toContain(GITHUB_TOKEN)
      expect(row).not.toContain(ok.token)
    }
    // El login a medias desaparece y el pollId ya no sirve.
    expect(await t.db.db.select().from(deviceAuths)).toHaveLength(0)
    expect(await poll(start.pollId)).toEqual({ v: 1, status: 'expired' })
  })

  it('un segundo login del mismo usuario actualiza login y avatar (isNew = false)', async () => {
    fresh([{ access_token: GITHUB_TOKEN }], {
      id: 777,
      login: 'OctoRenamed',
      avatar_url: 'https://avatars.test/new',
      created_at: '2012-03-04T05:06:07Z',
    })
    const start = await deviceStart()
    const ok = await poll(start.pollId)
    if (ok.status !== 'ok') throw new Error('esperaba ok')
    expect(ok.isNew).toBe(false)
    expect(ok.user.login).toBe('OctoRenamed')
    expect(await t.db.db.select().from(users)).toHaveLength(1)
  })

  it('una cuenta de antes de la regla (sin fecha) la recibe en su próximo login', async () => {
    await t.db.db.update(users).set({ githubCreatedAt: null }).where(eq(users.githubId, 777))
    // Cuenta de GitHub de hace 10 días: a partir de ahora espera a cumplir los 30.
    const created = new Date(t.clock.now().getTime() - 10 * 86_400_000)
    fresh([{ access_token: GITHUB_TOKEN }], {
      id: 777,
      login: 'OctoRenamed',
      avatar_url: 'https://avatars.test/new',
      created_at: created.toISOString(),
    })
    const ok = await poll((await deviceStart()).pollId)
    if (ok.status !== 'ok') throw new Error('esperaba ok')
    expect(ok.user.newAccount).toEqual({
      minAgeDays: 30,
      rankedFrom: new Date(created.getTime() + 30 * 86_400_000).toISOString(),
    })
    const [stored] = await t.db.db.select().from(users).where(eq(users.githubId, 777))
    expect(stored?.githubCreatedAt?.toISOString()).toBe(created.toISOString())
  })

  it('una cuenta nueva de GitHub entra y juega, con la fecha en que saldrá en el ranking', async () => {
    const created = new Date(t.clock.now().getTime() - 2 * 86_400_000)
    fresh([{ access_token: GITHUB_TOKEN }], {
      id: 888,
      login: 'Fresh',
      avatar_url: 'https://avatars.test/888',
      created_at: created.toISOString(),
    })
    const ok = await poll((await deviceStart()).pollId)
    if (ok.status !== 'ok') throw new Error('esperaba ok')
    expect(ok.isNew).toBe(true)
    expect(ok.user.newAccount).toEqual({
      minAgeDays: 30,
      rankedFrom: new Date(created.getTime() + 30 * 86_400_000).toISOString(),
    })
  })

  it('sin una fecha de creación válida en el perfil, el login falla sin crear el usuario', async () => {
    fresh([{ access_token: GITHUB_TOKEN }], {
      id: 999,
      login: 'NoDate',
      avatar_url: 'https://avatars.test/999',
      created_at: 'not a date',
    })
    const start = await deviceStart()
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/device/poll',
      payload: { v: 1, pollId: start.pollId },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ v: 1, error: 'github_unavailable' })
    expect(await t.db.db.select().from(users).where(eq(users.githubId, 999))).toHaveLength(0)
  })

  it('access_denied y expired_token terminan el login', async () => {
    fresh([{ error: 'access_denied' }])
    const denied = await deviceStart()
    expect(await poll(denied.pollId)).toEqual({ v: 1, status: 'denied' })
    expect(await poll(denied.pollId)).toEqual({ v: 1, status: 'expired' })

    fresh([{ error: 'expired_token' }])
    const expired = await deviceStart()
    expect(await poll(expired.pollId)).toEqual({ v: 1, status: 'expired' })
  })

  it('caduca por tiempo sin preguntar a GitHub', async () => {
    fresh([{ error: 'authorization_pending' }])
    const start = await deviceStart()
    t.clock.advance(901_000)
    expect(await poll(start.pollId)).toEqual({ v: 1, status: 'expired' })
    expect(script.calls.token).toBe(0)
  })

  it('pollId desconocido = expirado; pollId mal formado = 400', async () => {
    expect(await poll('A'.repeat(43))).toEqual({ v: 1, status: 'expired' })
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/auth/device/poll',
      payload: { v: 1, pollId: 'nope' },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json()).toMatchObject({ v: 1, error: 'invalid_request' })
  })

  it('GitHub caído o con errores de configuración → 502 github_unavailable', async () => {
    fresh([{ error: 'device_flow_disabled' }])
    const start = await deviceStart()
    t.clock.advance(10_000)
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/device/poll',
      payload: { v: 1, pollId: start.pollId },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ v: 1, error: 'github_unavailable' })

    github.use(http.post(`${TEST_GITHUB_OAUTH}/login/device/code`, () => HttpResponse.error()))
    const down = await t.app.inject({
      method: 'POST',
      url: '/api/auth/device/start',
      payload: { v: 1 },
    })
    expect(down.statusCode).toBe(502)
    expect(down.json()).toMatchObject({ v: 1, error: 'github_unavailable' })
  })
})
