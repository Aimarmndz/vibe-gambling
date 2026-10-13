// SPDX-License-Identifier: AGPL-3.0-or-later
// Cliente de GitHub del Device Flow contra un GitHub mockeado con msw.
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { AppError } from '../../src/lib/errors.ts'
import { GitHubClient, slowDownInterval } from '../../src/services/github.ts'

const OAUTH = 'https://gh.unit.test'
const API = 'https://api.gh.unit.test'
const server = setupServer()
const client = new GitHubClient({
  clientId: 'unit-client',
  oauthBaseUrl: OAUTH,
  apiBaseUrl: API,
  timeoutMs: 300,
  userAgent: 'unit-test/1.0',
})

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function tokenAnswer(body: Record<string, unknown>) {
  server.use(http.post(`${OAUTH}/login/oauth/access_token`, () => HttpResponse.json(body)))
}

describe('GitHubClient', () => {
  it('pide el código de dispositivo sin scopes y con el client_id', async () => {
    let form: URLSearchParams | null = null
    server.use(
      http.post(`${OAUTH}/login/device/code`, async ({ request }) => {
        form = new URLSearchParams(await request.text())
        expect(request.headers.get('accept')).toBe('application/json')
        return HttpResponse.json({
          device_code: 'dc',
          user_code: 'WXYZ-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        })
      }),
    )
    expect(await client.requestDeviceCode()).toEqual({
      deviceCode: 'dc',
      userCode: 'WXYZ-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    })
    expect(form!.get('client_id')).toBe('unit-client')
    expect(form!.get('scope')).toBe('')
  })

  it('traduce las respuestas del polling', async () => {
    tokenAnswer({ error: 'authorization_pending' })
    expect(await client.pollAccessToken('dc')).toEqual({ kind: 'pending' })
    tokenAnswer({ error: 'slow_down', interval: 15 })
    expect(await client.pollAccessToken('dc')).toEqual({ kind: 'slow_down', interval: 15 })
    tokenAnswer({ error: 'slow_down' })
    expect(await client.pollAccessToken('dc')).toEqual({ kind: 'slow_down', interval: null })
    tokenAnswer({ error: 'expired_token' })
    expect(await client.pollAccessToken('dc')).toEqual({ kind: 'expired' })
    tokenAnswer({ error: 'incorrect_device_code' })
    expect(await client.pollAccessToken('dc')).toEqual({ kind: 'expired' })
    tokenAnswer({ error: 'access_denied' })
    expect(await client.pollAccessToken('dc')).toEqual({ kind: 'denied' })
    tokenAnswer({ access_token: 'gho_x', token_type: 'bearer' })
    expect(await client.pollAccessToken('dc')).toEqual({ kind: 'token', accessToken: 'gho_x' })
  })

  it('los errores de configuración, de red o de formato son github_unavailable', async () => {
    tokenAnswer({ error: 'incorrect_client_credentials' })
    await expect(client.pollAccessToken('dc')).rejects.toMatchObject({ code: 'github_unavailable' })
    tokenAnswer({ weird: true })
    await expect(client.pollAccessToken('dc')).rejects.toBeInstanceOf(AppError)
    server.use(
      http.post(`${OAUTH}/login/device/code`, () => new HttpResponse('boom', { status: 500 })),
    )
    await expect(client.requestDeviceCode()).rejects.toMatchObject({ code: 'github_unavailable' })
    server.use(
      http.post(`${OAUTH}/login/device/code`, () => new HttpResponse('<html>', { status: 200 })),
    )
    await expect(client.requestDeviceCode()).rejects.toMatchObject({ code: 'github_unavailable' })
    server.use(http.post(`${OAUTH}/login/device/code`, () => HttpResponse.error()))
    await expect(client.requestDeviceCode()).rejects.toMatchObject({ code: 'github_unavailable' })
  })

  it('respeta el timeout', async () => {
    server.use(
      http.post(`${OAUTH}/login/device/code`, async () => {
        await new Promise(resolve => setTimeout(resolve, 2000))
        return HttpResponse.json({})
      }),
    )
    await expect(client.requestDeviceCode()).rejects.toMatchObject({ code: 'github_unavailable' })
  })

  it('pide el perfil con el token y User-Agent, y se queda con id, login, avatar y fecha de alta', async () => {
    server.use(
      http.get(`${API}/user`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer gho_x')
        expect(request.headers.get('user-agent')).toBe('unit-test/1.0')
        return HttpResponse.json({
          id: 5,
          login: 'octo',
          avatar_url: 'https://avatars.test/5',
          created_at: '2011-01-25T18:44:36Z',
          email: 'private@example.com',
          name: 'Private Name',
        })
      }),
    )
    expect(await client.fetchProfile('gho_x')).toEqual({
      id: 5,
      login: 'octo',
      avatarUrl: 'https://avatars.test/5',
      createdAt: new Date('2011-01-25T18:44:36Z'),
    })
  })

  it('acepta created_at con milisegundos o con desfase horario', async () => {
    for (const [raw, iso] of [
      ['2020-02-29T23:59:59.500Z', '2020-02-29T23:59:59.500Z'],
      ['2020-03-01T01:00:00+02:00', '2020-02-29T23:00:00.000Z'],
    ]) {
      server.use(
        http.get(`${API}/user`, () =>
          HttpResponse.json({
            id: 5,
            login: 'octo',
            avatar_url: 'https://a.test/5',
            created_at: raw,
          }),
        ),
      )
      expect((await client.fetchProfile('gho_x')).createdAt.toISOString()).toBe(iso)
    }
  })

  it.each([
    ['sin created_at', undefined],
    ['created_at nulo', null],
    ['created_at que no es fecha', 'yesterday'],
    ['solo el día', '2011-01-25'],
    ['día imposible', '2011-02-30T00:00:00Z'],
    ['un número', 1296000000],
  ])('rechaza un perfil %s (sin fecha no se aplica la regla del ranking)', async (_, created) => {
    server.use(
      http.get(`${API}/user`, () =>
        HttpResponse.json({
          id: 5,
          login: 'octo',
          avatar_url: 'https://avatars.test/5',
          ...(created === undefined ? {} : { created_at: created }),
        }),
      ),
    )
    await expect(client.fetchProfile('gho_x')).rejects.toMatchObject({ code: 'github_unavailable' })
  })

  it('rechaza un perfil cuyo avatar no es http(s) (acabaría en un src de la web)', async () => {
    server.use(
      http.get(`${API}/user`, () =>
        HttpResponse.json({
          id: 5,
          login: 'octo',
          avatar_url: 'javascript:alert(1)',
          created_at: '2011-01-25T18:44:36Z',
        }),
      ),
    )
    await expect(client.fetchProfile('gho_x')).rejects.toMatchObject({ code: 'github_unavailable' })
  })

  it('slow_down: usa el intervalo que dice GitHub o suma 5 s', () => {
    expect(slowDownInterval(5, 12)).toBe(12)
    expect(slowDownInterval(5, null)).toBe(10)
  })
})
