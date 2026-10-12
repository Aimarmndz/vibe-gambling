// SPDX-License-Identifier: AGPL-3.0-or-later
// Enlace de un solo uso, cookie de sesión, logout, ajustes y borrado de cuenta.
import {
  LOCALES,
  linkResponseSchema,
  meResponseSchema,
  redeemResponseSchema,
} from '@vibe-gambling/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  hallOfRuin,
  linkCodes,
  loans,
  rounds,
  seasons,
  sessions,
  turns,
  users,
  wallets,
} from '../../src/db/schema.ts'
import { createUser, MOD_META, startTestApp, turnId } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'
import { TEST_PUBLIC_URL } from '../helpers/env.ts'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(async () => {
  await t.close()
})

async function link(bearer: Record<string, string>) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/link',
    headers: bearer,
    payload: { v: 1 },
  })
  expect(res.statusCode, res.body).toBe(200)
  const body = linkResponseSchema.parse(res.json())
  const url = new URL(body.url)
  return { ...body, url, code: url.searchParams.get('code') ?? '' }
}

function redeem(code: string, origin: string = TEST_PUBLIC_URL) {
  return t.app.inject({
    method: 'POST',
    url: '/api/auth/redeem',
    headers: { origin },
    payload: { v: 1, code },
  })
}

describe('enlace de un solo uso', () => {
  it('abre /play con un código que se canjea una vez por una cookie segura', async () => {
    const { bearer } = await createUser(t, 'linker')
    const l = await link(bearer)
    expect(l.url.origin).toBe(TEST_PUBLIC_URL)
    expect(l.url.pathname).toBe('/play')
    expect(l.expiresIn).toBe(60)

    const res = await redeem(l.code)
    expect(res.statusCode, res.body).toBe(200)
    expect(redeemResponseSchema.parse(res.json()).user.login).toBe('linker')
    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toMatch(/^test_session=[A-Za-z0-9_-]{43};/)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=3600')

    // La cookie sirve para /api/me…
    const session = cookie.split(';')[0] ?? ''
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: session } })
    expect(me.statusCode).toBe(200)
    meResponseSchema.parse(me.json())

    // …y el código ya no sirve.
    const again = await redeem(l.code)
    expect(again.statusCode).toBe(401)
    expect(again.json()).toMatchObject({ v: 1, error: 'unauthorized' })
  })

  it('caduca a los LINK_CODE_TTL_SECONDS', async () => {
    const { bearer } = await createUser(t)
    const l = await link(bearer)
    t.clock.advance(60_000)
    try {
      expect((await redeem(l.code)).statusCode).toBe(401)
    } finally {
      t.clock.set('2026-10-15T12:00:00Z')
    }
  })

  it('solo se guarda el hash del código', async () => {
    const { bearer, user } = await createUser(t)
    const l = await link(bearer)
    const rows = await t.db.db.select().from(linkCodes).where(eq(linkCodes.userId, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.codeHash).not.toBe(l.code)
    expect(rows[0]?.codeHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rechaza el canje desde otro origen', async () => {
    const { bearer } = await createUser(t)
    const l = await link(bearer)
    const res = await redeem(l.code, 'https://evil.test')
    expect(res.statusCode).toBe(403)
    // El código sigue sin usar.
    expect((await redeem(l.code)).statusCode).toBe(200)
  })

  it('la sesión web no puede pedir enlaces ni turnos (rutas del mod)', async () => {
    const { user } = await createUser(t)
    const web = await t.services.auth.createSession(user.id, 'web')
    const cookie = `test_session=${web}`
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/link',
      headers: { cookie, origin: TEST_PUBLIC_URL },
      payload: { v: 1 },
    })
    expect(res.statusCode).toBe(403)
  })

  it('mutaciones con cookie desde otro origen → 403 (CSRF)', async () => {
    const { user } = await createUser(t)
    const web = await t.services.auth.createSession(user.id, 'web')
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/me/settings',
      headers: { cookie: `test_session=${web}`, origin: 'https://evil.test' },
      payload: { v: 1, hidden: true },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ error: 'forbidden' })
  })
})

describe('logout', () => {
  it('revoca solo la sesión con la que se llama', async () => {
    const { user, bearer } = await createUser(t)
    const other = await t.services.auth.createSession(user.id, 'mod')
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: bearer,
      payload: { v: 1 },
    })
    expect(res.json()).toEqual({ v: 1, ok: true })
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: bearer })
    expect(me.statusCode).toBe(401)
    const stillIn = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${other}` },
    })
    expect(stillIn.statusCode).toBe(200)
  })

  it('con cookie, además la borra', async () => {
    const { user } = await createUser(t)
    const web = await t.services.auth.createSession(user.id, 'web')
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: `test_session=${web}`, origin: TEST_PUBLIC_URL },
      payload: { v: 1 },
    })
    expect(res.statusCode).toBe(200)
    expect(String(res.headers['set-cookie'])).toMatch(/test_session=;.*Expires=Thu, 01 Jan 1970/)
  })

  it('cabeceras de autorización raras → 401', async () => {
    for (const authorization of [
      'Basic abc',
      'Bearer',
      'Bearer short',
      `Bearer ${'x'.repeat(43)}`,
    ]) {
      const res = await t.app.inject({ method: 'GET', url: '/api/me', headers: { authorization } })
      expect(res.statusCode).toBe(401)
    }
  })

  it('las sesiones caducan', async () => {
    const { bearer } = await createUser(t)
    t.clock.advance(Number(t.config.env.MOD_SESSION_TTL_SECONDS) * 1000 + 1)
    try {
      expect(
        (await t.app.inject({ method: 'GET', url: '/api/me', headers: bearer })).statusCode,
      ).toBe(401)
    } finally {
      t.clock.set('2026-10-15T12:00:00Z')
    }
  })
})

describe('ajustes', () => {
  it('ocultarse y cambiar de idioma (POST canónico y PATCH)', async () => {
    const { bearer } = await createUser(t)
    const a = await t.app.inject({
      method: 'POST',
      url: '/api/me/settings',
      headers: bearer,
      payload: { v: 1, hidden: true },
    })
    expect(a.json().user).toMatchObject({ hidden: true, locale: null })
    const b = await t.app.inject({
      method: 'PATCH',
      url: '/api/me/settings',
      headers: bearer,
      payload: { v: 1, locale: 'es' },
    })
    expect(b.json().user).toMatchObject({ hidden: true, locale: 'es' })
    const empty = await t.app.inject({
      method: 'PATCH',
      url: '/api/me/settings',
      headers: bearer,
      payload: { v: 1 },
    })
    expect(empty.statusCode).toBe(400)
  })

  it('acepta cualquier idioma registrado en locales/ (fr, de…) y rechaza los demás', async () => {
    const { bearer } = await createUser(t)
    const set = (locale: unknown) =>
      t.app.inject({
        method: 'PATCH',
        url: '/api/me/settings',
        headers: bearer,
        payload: { v: 1, locale },
      })
    for (const locale of LOCALES) {
      const res = await set(locale)
      expect(res.statusCode, locale).toBe(200)
      expect(res.json().user.locale).toBe(locale)
    }
    expect((await set('fr')).json().user.locale).toBe('fr')
    expect((await set('de')).json().user.locale).toBe('de')
    for (const bad of ['xx', 'klingon', 'FR', 'de-DE', '']) {
      expect((await set(bad)).statusCode, bad).toBe(400)
    }
    const me = await t.app.inject({ method: 'GET', url: '/api/me', headers: bearer })
    expect(me.json().user.locale).toBe('de')
    expect((await set(null)).json().user.locale).toBeNull()
  })
})

describe('borrado de cuenta', () => {
  async function playSomething(bearer: Record<string, string>) {
    const id = turnId()
    await t.app.inject({
      method: 'POST',
      url: '/api/turn/start',
      headers: bearer,
      payload: { v: 1, turnId: id, ...MOD_META },
    })
    await t.app.inject({
      method: 'POST',
      url: '/api/turn/end',
      headers: bearer,
      payload: {
        v: 1,
        turnId: id,
        durationMs: 5,
        gitPushOk: false,
        testFailed: false,
        ...MOD_META,
      },
    })
  }

  it('pide repetir el login y luego lo borra todo en cascada', async () => {
    const { user, bearer } = await createUser(t, 'Doomed-Dev')
    await playSomething(bearer)
    await link(bearer)
    await t.db.db
      .insert(seasons)
      .values({
        id: '2020-01',
        startsAt: new Date('2020-01-01'),
        endsAt: new Date('2020-02-01'),
        closedAt: new Date('2020-02-01'),
      })
      .onConflictDoNothing()
    await t.db.db
      .insert(hallOfRuin)
      .values({ seasonId: '2020-01', rank: 1, userId: user.id, netWorth: -5, spins: 3 })

    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/me/delete',
      headers: bearer,
      payload: { v: 1, confirm: 'someone-else' },
    })
    expect(wrong.statusCode).toBe(400)

    const ok = await t.app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer,
      payload: { v: 1, confirm: 'doomed-dev' },
    })
    expect(ok.json()).toEqual({ v: 1, ok: true })

    for (const table of [sessions, linkCodes, wallets, rounds, turns, loans, hallOfRuin]) {
      const left = await t.db.db.select().from(table).where(eq(table.userId, user.id))
      expect(left).toHaveLength(0)
    }
    expect(await t.db.db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0)
    expect(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: bearer })).statusCode,
    ).toBe(401)
  })
})
