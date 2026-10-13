// SPDX-License-Identifier: AGPL-3.0-or-later
// El GitHub falso cumple lo justo del Device Flow para desarrollo y E2E.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildFakeGitHub } from '../../src/fake-github/app.ts'

const env = {
  FAKE_GITHUB_HOST: '127.0.0.1',
  FAKE_GITHUB_PORT: 0,
  FAKE_GITHUB_PUBLIC_URL: 'http://fake.test',
  FAKE_GITHUB_CLIENT_ID: 'fake-client',
  FAKE_GITHUB_USER_ID: 31337,
  FAKE_GITHUB_USER_LOGIN: 'fake-dev',
  FAKE_GITHUB_USER_CREATED_AT: '2016-02-29T08:30:00Z',
  FAKE_GITHUB_INTERVAL_SECONDS: 1,
  FAKE_GITHUB_EXPIRES_IN_SECONDS: 60,
  LOG_LEVEL: 'silent' as const,
}
const app = buildFakeGitHub(env, false)

beforeAll(async () => app.ready())
afterAll(async () => app.close())

const form = (body: Record<string, string>) => ({
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
  payload: new URLSearchParams(body).toString(),
})

describe('GitHub falso', () => {
  it('device code → pending → token → /user', async () => {
    const code = await app.inject({
      method: 'POST',
      url: '/login/device/code',
      ...form({ client_id: 'fake-client', scope: '' }),
    })
    const { device_code, user_code, verification_uri, interval } = code.json()
    expect(user_code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/)
    expect(verification_uri).toBe('http://fake.test/login/device')
    expect(interval).toBe(1)
    const grant = {
      client_id: 'fake-client',
      device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }
    const first = await app.inject({
      method: 'POST',
      url: '/login/oauth/access_token',
      ...form(grant),
    })
    expect(first.json()).toEqual({ error: 'authorization_pending' })
    const second = await app.inject({
      method: 'POST',
      url: '/login/oauth/access_token',
      ...form(grant),
    })
    const token = second.json().access_token as string
    expect(token).toMatch(/^gho_fake_/)
    const user = await app.inject({
      method: 'GET',
      url: '/user',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(user.json()).toEqual({
      id: 31337,
      login: 'fake-dev',
      avatar_url: 'http://fake.test/avatars/31337.svg',
      created_at: '2016-02-29T08:30:00Z',
    })
    const avatar = await app.inject({ method: 'GET', url: '/avatars/31337.svg' })
    expect(avatar.headers['content-type']).toContain('image/svg+xml')
  })

  it('rechaza client_id ajenos, códigos desconocidos y tokens falsos', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/login/device/code', ...form({ client_id: 'x' }) }))
        .statusCode,
    ).toBe(401)
    const grant = {
      client_id: 'fake-client',
      device_code: 'nope',
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }
    expect(
      (
        await app.inject({ method: 'POST', url: '/login/oauth/access_token', ...form(grant) })
      ).json(),
    ).toEqual({ error: 'incorrect_device_code' })
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/login/oauth/access_token',
          ...form({ ...grant, grant_type: 'x' }),
        })
      ).json(),
    ).toEqual({ error: 'unsupported_grant_type' })
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/user',
          headers: { authorization: 'Bearer gho_fake_nope' },
        })
      ).statusCode,
    ).toBe(401)
  })
})
