// SPDX-License-Identifier: AGPL-3.0-or-later
// HTTP general: meta, /config.json, /healthz, cabeceras de seguridad, estáticos, límites,
// rate limit (por IP real y por token) y logs sin datos personales.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import { metaResponseSchema, webConfigSchema } from '@vibe-gambling/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../../src/app.ts'
import { loggerOptions } from '../../src/logger.ts'
import { createTestDb } from '../helpers/db.ts'
import type { DbHandle } from '../../src/db/client.ts'
import { createUser, startTestApp } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'
import { testConfig } from '../helpers/env.ts'

let db: DbHandle
let dist: string

beforeAll(async () => {
  db = await createTestDb()
  dist = mkdtempSync(join(tmpdir(), 'vibe-web-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(
    join(dist, 'index.html'),
    [
      '<!doctype html><title>landing</title>',
      '<meta property="og:url" content="/" />',
      '<meta property="og:image" content="/og.png" />',
      '<meta name="twitter:image" content="/og.png" />',
    ].join('\n'),
  )
  writeFileSync(join(dist, 'play.html'), '<!doctype html><title>play</title>')
  writeFileSync(join(dist, 'privacy.html'), '<!doctype html><title>privacy</title>')
  writeFileSync(join(dist, 'invite.html'), '<!doctype html><title>invite</title>')
  writeFileSync(join(dist, 'assets', 'main-abc123.js'), 'console.log(1)')
  writeFileSync(join(dist, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(dist, '.secret'), 'nope')
})
afterAll(async () => {
  await db.close(5)
  rmSync(dist, { recursive: true, force: true })
})

describe('rutas públicas', () => {
  let t: TestApp
  beforeAll(async () => {
    t = await startTestApp({ db, env: { WEB_DIST_DIR: dist } })
  })
  afterAll(async () => t.close())

  it('/api/meta', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/meta' })
    expect(metaResponseSchema.parse(res.json())).toEqual({
      v: 1,
      protocol: 1,
      name: 'Test Casino',
      isOfficial: false,
      serverVersion: expect.any(String),
      publicUrl: 'https://vibe.test',
    })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('/config.json cumple webConfigSchema y sale de la configuración', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/config.json' })
    const cfg = webConfigSchema.parse(res.json())
    expect(cfg.game.chips).toEqual([10, 50, 100])
    expect(cfg.site.author.name).toBe('Test Author')
    expect(cfg.instanceName).toBe('Test Casino')
    // Los datos de la instancia para /privacy salen de site.json, no de la oficial.
    expect(cfg.site.instance.operator.name).toBe('Test Operator')
    expect(cfg.site.instance.networkProxy).toBeNull()
    expect(cfg.site.instance.backupRetentionDays).toBeNull()
    // Y lo que solo sabe el servidor, de su entorno.
    expect(cfg.privacy).toEqual({
      imageOrigins: ['https://avatars.test'],
      modSessionTtlSeconds: 31_536_000,
      webSessionTtlSeconds: 3600,
      linkCodeTtlSeconds: 60,
      // La ventana del límite por IP (RATE_LIMIT_IP_WINDOW_MS de test), en segundos.
      ipMemorySeconds: 60,
    })
  })

  it('/healthz comprueba la base de datos', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('CSP estricta y cabeceras de seguridad', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/' })
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("connect-src 'self' wss://vibe.test")
    expect(csp).toContain("img-src 'self' data: https://avatars.test")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('upgrade-insecure-requests')
    expect(res.headers['strict-transport-security']).toContain('max-age=')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    // CORS cerrado: nunca se anuncia otro origen.
    const cors = await t.app.inject({
      method: 'OPTIONS',
      url: '/api/meta',
      headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
    })
    expect(cors.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('sirve las páginas, con caché larga para /assets y corta para el HTML', async () => {
    for (const [url, title] of [
      ['/', 'landing'],
      ['/play?code=abc', 'play'],
      ['/privacy', 'privacy'],
      // La invitación sale igual con cualquier código: la página pregunta a la API si existe.
      ['/r/ABCD2345', 'invite'],
      ['/r/no-existe', 'invite'],
    ] as const) {
      const res = await t.app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(200)
      expect(res.body).toContain(`<title>${title}</title>`)
      expect(res.headers['cache-control']).toBe('no-cache')
    }
    const asset = await t.app.inject({ method: 'GET', url: '/assets/main-abc123.js' })
    expect(asset.statusCode).toBe(200)
    expect(asset.headers['cache-control']).toBe('public, max-age=999, immutable')
    const icon = await t.app.inject({ method: 'GET', url: '/favicon.svg' })
    expect(icon.headers['cache-control']).toBe('public, max-age=120')
    expect((await t.app.inject({ method: 'GET', url: '/.secret' })).statusCode).not.toBe(200)
    expect((await t.app.inject({ method: 'GET', url: '/../package.json' })).statusCode).not.toBe(
      200,
    )
  })

  it('la landing sale con og:url, og:image y twitter:image absolutos (PUBLIC_URL)', async () => {
    for (const url of ['/', '/index.html']) {
      const res = await t.app.inject({ method: 'GET', url })
      expect(res.statusCode, url).toBe(200)
      expect(res.headers['content-type']).toMatch(/^text\/html/)
      expect(res.body).toContain('<meta property="og:url" content="https://vibe.test/" />')
      expect(res.body).toContain('<meta property="og:image" content="https://vibe.test/og.png" />')
      expect(res.body).toContain('<meta name="twitter:image" content="https://vibe.test/og.png" />')
      expect(res.body).not.toContain('content="/og.png"')
      // Mismas cabeceras que el resto del HTML: CSP estricta y sin caché larga.
      expect(String(res.headers['content-security-policy'])).toContain("script-src 'self'")
      expect(res.headers['cache-control']).toBe('no-cache')
    }
  })

  it('el HTML se revalida con ETag (304 si no cambió)', async () => {
    const first = await t.app.inject({ method: 'GET', url: '/' })
    const etag = String(first.headers.etag)
    expect(etag).toMatch(/^"[\w-]+"$/)
    const again = await t.app.inject({
      method: 'GET',
      url: '/',
      headers: { 'if-none-match': etag },
    })
    expect(again.statusCode).toBe(304)
    expect(again.body).toBe('')
    expect(again.headers['cache-control']).toBe('no-cache')
  })

  it('404 en JSON con el formato de error', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ v: 1, error: 'not_found', message: expect.any(String) })
  })

  it('límite de tamaño del cuerpo → 413 payload_too_large', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/device/poll',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ v: 1, pollId: 'x'.repeat(10_000) }),
    })
    expect(res.statusCode).toBe(413)
    expect(res.json()).toMatchObject({ v: 1, error: 'payload_too_large' })
  })

  it('JSON roto → 400 invalid_request', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/device/poll',
      headers: { 'content-type': 'application/json' },
      payload: '{"v":',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ v: 1, error: 'invalid_request' })
  })
})

describe('sin build de la web', () => {
  it('arranca igual y solo sirve la API', async () => {
    const t = await startTestApp({ db })
    try {
      expect((await t.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200)
      expect((await t.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(503)
    } finally {
      await t.close()
    }
  })

  it('las páginas dan un HTML legible (503) en vez del JSON de la API', async () => {
    const t = await startTestApp({ db })
    try {
      for (const url of ['/play?code=abc', '/', '/privacy', '/r/abcdabcd']) {
        const res = await t.app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })
        expect(res.statusCode, url).toBe(503)
        expect(res.headers['content-type']).toMatch(/^text\/html/)
        expect(res.body).toContain('<!doctype html>')
        expect(res.body).not.toContain('abc')
      }
      // La API sigue respondiendo en JSON.
      const api = await t.app.inject({ method: 'GET', url: '/api/nada' })
      expect(api.headers['content-type']).toMatch(/^application\/json/)
    } finally {
      await t.close()
    }
  })
})

describe('rate limit', () => {
  it('por IP: al pasarse, 429 rate_limited con Retry-After', async () => {
    const t = await startTestApp({ db, env: { RATE_LIMIT_IP_MAX: '3' } })
    try {
      const codes = []
      for (let i = 0; i < 5; i++)
        codes.push((await t.app.inject({ method: 'GET', url: '/api/meta' })).statusCode)
      expect(codes).toEqual([200, 200, 200, 429, 429])
      const res = await t.app.inject({ method: 'GET', url: '/api/meta' })
      expect(res.json()).toMatchObject({ v: 1, error: 'rate_limited' })
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
      // Los estáticos y /healthz no cuentan.
      expect((await t.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200)
    } finally {
      await t.close()
    }
  })

  it('por token: cada sesión tiene su cupo', async () => {
    const t = await startTestApp({ db, env: { RATE_LIMIT_TOKEN_MAX: '2' } })
    try {
      const a = await createUser(t)
      const b = await createUser(t)
      const me = (headers: Record<string, string>) =>
        t.app.inject({ method: 'GET', url: '/api/me', headers }).then(r => r.statusCode)
      expect([await me(a.bearer), await me(a.bearer), await me(a.bearer)]).toEqual([200, 200, 429])
      expect(await me(b.bearer)).toBe(200)
    } finally {
      await t.close()
    }
  })

  it('CF-Connecting-IP solo se cree si la conexión llega de un rango de confianza', async () => {
    const trusted = await startTestApp({
      db,
      env: { RATE_LIMIT_IP_MAX: '1', TRUST_PROXY_CIDRS: '127.0.0.0/8' },
    })
    try {
      // inject llega desde 127.0.0.1 (de confianza): cada IP real tiene su propio cupo.
      const call = (ip: string) =>
        trusted.app
          .inject({ method: 'GET', url: '/api/meta', headers: { 'cf-connecting-ip': ip } })
          .then(r => r.statusCode)
      expect([
        await call('203.0.113.1'),
        await call('203.0.113.2'),
        await call('203.0.113.1'),
      ]).toEqual([200, 200, 429])
    } finally {
      await trusted.close()
    }
    const untrusted = await startTestApp({
      db,
      env: { RATE_LIMIT_IP_MAX: '1', TRUST_PROXY_CIDRS: '173.245.48.0/20' },
    })
    try {
      // Desde fuera de los rangos la cabecera se ignora: inventarse IPs no sirve de nada.
      const call = (ip: string) =>
        untrusted.app
          .inject({ method: 'GET', url: '/api/meta', headers: { 'cf-connecting-ip': ip } })
          .then(r => r.statusCode)
      expect([await call('203.0.113.1'), await call('203.0.113.2')]).toEqual([200, 429])
    } finally {
      await untrusted.close()
    }
  })
})

describe('logs', () => {
  it('no registran IPs, cabeceras, tokens ni la query de /play', async () => {
    const lines: string[] = []
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk))
        done()
      },
    })
    const config = testConfig({ WEB_DIST_DIR: dist, LOG_LEVEL: 'debug' })
    const { app, services } = await buildApp({
      config,
      db: db.db,
      logger: { ...loggerOptions('debug'), stream },
    })
    try {
      await app.ready()
      const [user] = await db.sql<{ id: string }[]>`
        insert into users (github_id, login, avatar_url) values (99, 'logcheck', 'https://avatars.test/x')
        returning id`
      const token = await services.auth.createSession(user?.id ?? '', 'mod')
      await app.inject({ method: 'GET', url: '/play?code=SUPERSECRETCODE123' })
      await app.inject({
        method: 'GET',
        url: '/api/me',
        headers: {
          authorization: `Bearer ${token}`,
          'cf-connecting-ip': '198.51.100.77',
          'user-agent': 'SpyAgent',
        },
      })
      await app.inject({ method: 'GET', url: '/api/leaderboard?season=1999-01' })
      const all = lines.join('')
      expect(all).toContain('"route":"/play"')
      expect(all).not.toContain('SUPERSECRETCODE123')
      expect(all).not.toContain(token)
      expect(all).not.toContain('198.51.100.77')
      expect(all).not.toContain('127.0.0.1')
      expect(all).not.toContain('SpyAgent')
      expect(all).not.toContain('1999-01')
    } finally {
      await app.close()
    }
  })
})
