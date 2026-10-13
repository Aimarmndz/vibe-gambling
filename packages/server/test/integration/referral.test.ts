// SPDX-License-Identifier: AGPL-3.0-or-later
// Programa de Afiliados Piramidal (legalmente distinto) contra Postgres: códigos, página pública,
// canje con todas sus reglas, activación con comisión (una sola vez, con tope por temporada),
// concurrencia y borrado de cuentas. Config de test: bono 500, comisión 1000, activación con 3
// tiradas, plazo de 7 días o 5 tiradas, tope de 2 comisiones por temporada, GitHub de 30 días.
import {
  referralLookupResponseSchema,
  referralRedeemResponseSchema,
  referralResponseSchema,
  serverMessageSchema,
} from '@vibe-gambling/shared'
import type { ReferralRedeemResponse, ServerMessage } from '@vibe-gambling/shared'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { achievements, referrals, rounds, seasons, users, wallets } from '../../src/db/schema.ts'
import {
  MOD_META,
  afterBall,
  attachWindow,
  beginTurn,
  createUser,
  startTestApp,
  turnId,
  webCookie,
} from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'

const DAY = 86_400_000
const SEASON = '2026-10'

/** Códigos que da el generador de este archivo (después, aleatorios); para probar colisiones. */
const forcedCodes: string[] = []
let t: TestApp

beforeAll(async () => {
  const fallback = { n: 0 }
  t = await startTestApp({
    generateReferralCode: () => {
      const next = forcedCodes.shift()
      if (next) return next
      // Códigos únicos y válidos (alfabeto sin 0/1/I/L/O/U).
      const alphabet = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
      let n = fallback.n++
      let code = ''
      for (let i = 0; i < 8; i++) {
        code += alphabet[n % alphabet.length]
        n = Math.floor(n / alphabet.length)
      }
      return code
    },
  })
  await t.db.db.insert(seasons).values({
    id: SEASON,
    startsAt: new Date('2026-09-30T22:00:00Z'),
    endsAt: new Date('2026-10-31T23:00:00Z'),
  })
})
afterAll(async () => {
  await t.close()
})

let logins = 0

/** Jugador con cuenta de vibe creada "ahora" (reloj de test) y GitHub de `githubDays` días. */
async function player(opts: { githubDays?: number; vibeDays?: number; window?: boolean } = {}) {
  const u = await createUser(t, `ref${logins++}`)
  const now = t.clock.now().getTime()
  await t.db.db
    .update(users)
    .set({
      createdAt: new Date(now - (opts.vibeDays ?? 0) * DAY),
      githubCreatedAt: new Date(now - (opts.githubDays ?? 365) * DAY),
    })
    .where(eq(users.id, u.user.id))
  const window = opts.window ? attachWindow(t, u.user.id) : null
  return { ...u, window }
}
type Player = Awaited<ReturnType<typeof player>>

async function status(p: Player) {
  const res = await t.app.inject({ method: 'GET', url: '/api/referral', headers: p.bearer })
  expect(res.statusCode, res.body).toBe(200)
  return referralResponseSchema.parse(res.json()).referral
}

async function redeem(p: Player, code: string): Promise<ReferralRedeemResponse> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/referral/redeem',
    headers: p.bearer,
    payload: { v: 1, code },
  })
  expect(res.statusCode, res.body).toBe(200)
  return referralRedeemResponseSchema.parse(res.json())
}

async function lookup(code: string) {
  const res = await t.app.inject({
    method: 'GET',
    url: `/api/referral/lookup?code=${encodeURIComponent(code)}`,
  })
  expect(res.statusCode, res.body).toBe(200)
  return referralLookupResponseSchema.parse(res.json())
}

async function balance(userId: string): Promise<number> {
  const [row] = await t.db.db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(
      and(eq(wallets.userId, userId), eq(wallets.seasonId, t.services.game.currentSeason().id)),
    )
  return row?.balance ?? t.config.game.startingBalance
}

/** Tiradas resueltas metidas a mano (ahora), para no jugar decenas de turnos. */
async function playedSpins(userId: string, n: number): Promise<void> {
  const now = t.clock.now()
  for (let i = 0; i < n; i++) {
    await t.db.db.insert(rounds).values({
      userId,
      seasonId: SEASON,
      status: 'resolved',
      openedAt: now,
      resolvedAt: now,
      revealAt: now,
      result: 17,
      source: 'none',
      staked: 0,
      returned: 0,
      net: 0,
      jackpot: false,
      gitPushOk: false,
      testFailed: false,
      interestCharged: 0,
    })
  }
}

/** Un prompt de verdad (turn/start + turn/end) con la ventana visible: tirada en directo. */
async function liveSpin(p: Player): Promise<void> {
  const id = turnId()
  await beginTurn(t, p.bearer, id)
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/turn/end',
    headers: p.bearer,
    payload: { v: 1, turnId: id, durationMs: 1, gitPushOk: false, testFailed: false, ...MOD_META },
  })
  expect(res.statusCode, res.body).toBe(200)
  expect(res.json().status).toBe('resolved')
  afterBall(t)
}

const commissionsOf = (received: ServerMessage[]) =>
  received.filter(m => m.type === 'referral.commission')

describe('código y página pública', () => {
  it('se crea la primera vez, siempre es el mismo y tiene enlace /r/<código>', async () => {
    const a = await player()
    const first = await status(a)
    expect(first.code).toMatch(/^[2-9A-HJKMNP-TV-Z]{8}$/)
    expect(first.url).toBe(`${t.config.env.PUBLIC_URL}/r/${first.code}`)
    expect(first).toMatchObject({
      invited: 0,
      activated: 0,
      waiting: 0,
      earned: 0,
      season: { seasonId: SEASON, commissions: 0, cap: 2 },
      invitedBy: null,
      canRedeem: true,
      rules: {
        welcomeBonus: 500,
        commission: 1000,
        activationSpins: 3,
        redeemWindowDays: 7,
        redeemMaxSpins: 5,
        maxCommissionsPerSeason: 2,
        minAccountAgeDays: 30,
      },
    })
    expect((await status(a)).code).toBe(first.code)
    // También con la cookie de la ventana (la pantalla AFILIADOS usa el WebSocket, pero vale igual).
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/referral',
      headers: { cookie: await webCookie(t, a.user.id) },
    })
    expect(referralResponseSchema.parse(res.json()).referral.code).toBe(first.code)
  })

  it('diez peticiones a la vez crean un solo código', async () => {
    const a = await player()
    const codes = await Promise.all(Array.from({ length: 10 }, () => status(a)))
    expect(new Set(codes.map(c => c.code)).size).toBe(1)
  })

  it('si el código aleatorio ya es de otro, se prueba con otro', async () => {
    const a = await player()
    const taken = (await status(a)).code
    const b = await player()
    forcedCodes.push(taken, 'QQQQ2222')
    expect((await status(b)).code).toBe('QQQQ2222')
  })

  it('la consulta pública dice quién invita, salvo si está oculto; los códigos raros no existen', async () => {
    const a = await player()
    const { code } = await status(a)
    expect(await lookup(code)).toEqual({
      v: 1,
      found: true,
      inviter: {
        login: a.user.login,
        avatarUrl: a.user.avatarUrl,
        profileUrl: `${t.config.env.GITHUB_WEB_BASE_URL}/${a.user.login}`,
      },
    })
    // Como lo escribe una persona (minúsculas, guion) o la URL entera.
    expect((await lookup(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`)).found).toBe(true)
    await t.db.db.update(users).set({ hidden: true }).where(eq(users.id, a.user.id))
    expect(await lookup(code)).toEqual({ v: 1, found: true, inviter: null })
    for (const raw of ['ZZZZZZZZ', 'nope', '<script>alert(1)</script>', '0000OOOO']) {
      expect(await lookup(raw)).toEqual({ v: 1, found: false, inviter: null })
    }
    const tooLong = await t.app.inject({
      method: 'GET',
      url: `/api/referral/lookup?code=${'A'.repeat(65)}`,
    })
    expect(tooLong.statusCode).toBe(400)
  })

  it('solo el mod canjea; la consulta del estado pide sesión', async () => {
    const a = await player()
    const anon = await t.app.inject({ method: 'GET', url: '/api/referral' })
    expect(anon.statusCode).toBe(401)
    const web = await t.app.inject({
      method: 'POST',
      url: '/api/referral/redeem',
      headers: { cookie: await webCookie(t, a.user.id), origin: t.config.env.PUBLIC_URL },
      payload: { v: 1, code: 'QQQQ2222' },
    })
    expect(web.statusCode).toBe(403)
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/referral/redeem',
      headers: a.bearer,
      payload: { v: 1, code: 'qqqq2222' },
    })
    expect(bad.statusCode).toBe(400)
    const extra = await t.app.inject({
      method: 'POST',
      url: '/api/referral/redeem',
      headers: a.bearer,
      payload: { v: 1, code: 'QQQQ2222', referrer: 'me' },
    })
    expect(extra.statusCode).toBe(400)
  })
})

describe('canje', () => {
  it('bono de bienvenida en la cartera de la temporada, aviso a la ventana y una sola vez', async () => {
    const inviter = await player()
    const invitee = await player({ window: true })
    const other = await player()
    const { code } = await status(inviter)

    const done = await redeem(invitee, code)
    expect(done).toMatchObject({
      status: 'redeemed',
      bonus: 500,
      wallet: { seasonId: SEASON, balance: 1500 },
      inviter: { login: inviter.user.login },
    })
    expect(await balance(invitee.user.id)).toBe(1500)
    const wallets = invitee.window!.received.filter(m => m.type === 'wallet')
    expect(wallets.at(-1)).toMatchObject({ wallet: { balance: 1500 } })
    for (const m of invitee.window!.received) serverMessageSchema.parse(m)

    // Una vez en la vida: ni el mismo código ni otro.
    expect(await redeem(invitee, code)).toEqual({
      v: 1,
      status: 'rejected',
      reason: 'already_redeemed',
    })
    expect(await redeem(invitee, (await status(other)).code)).toMatchObject({
      reason: 'already_redeemed',
    })
    expect(await balance(invitee.user.id)).toBe(1500)

    expect(await status(invitee)).toMatchObject({
      canRedeem: false,
      invitedBy: { bonus: 500, activated: false },
    })
    expect(await status(inviter)).toMatchObject({ invited: 1, activated: 0, waiting: 1 })
  })

  it('con el invitador oculto, el canje no dice quién era', async () => {
    const inviter = await player()
    await t.db.db.update(users).set({ hidden: true }).where(eq(users.id, inviter.user.id))
    const invitee = await player()
    expect(await redeem(invitee, (await status(inviter)).code)).toMatchObject({
      status: 'redeemed',
      inviter: null,
    })
  })

  it('rechazos: código que no existe, el tuyo, un ciclo de dos, fuera de plazo, demasiadas tiradas', async () => {
    const a = await player()
    const b = await player()
    const codeA = (await status(a)).code
    const codeB = (await status(b)).code

    expect(await redeem(a, 'ZZZZ9999')).toMatchObject({ reason: 'not_found' })
    expect(await redeem(a, codeA)).toMatchObject({ reason: 'own_code' })
    expect(await redeem(b, codeA)).toMatchObject({ status: 'redeemed' })
    // A no puede canjear el código de quien canjeó el suyo.
    expect(await redeem(a, codeB)).toMatchObject({ reason: 'cycle' })
    expect(await balance(a.user.id)).toBe(1000)

    const veteran = await player({ vibeDays: 7 })
    expect(await redeem(veteran, codeA)).toMatchObject({ reason: 'too_late' })
    const almost = await player({ vibeDays: 6 })
    expect((await status(almost)).canRedeem).toBe(true)

    const grinder = await player()
    await playedSpins(grinder.user.id, 5)
    expect((await status(grinder)).canRedeem).toBe(false)
    expect(await redeem(grinder, codeA)).toMatchObject({ reason: 'too_many_spins' })
    const four = await player()
    await playedSpins(four.user.id, 4)
    expect(await redeem(four, codeA)).toMatchObject({ status: 'redeemed' })

    // Ningún rechazo ha creado filas.
    const rows = await t.db.db.select().from(referrals).where(eq(referrals.referrerId, a.user.id))
    expect(rows.map(r => r.inviteeId).sort()).toEqual([b.user.id, four.user.id].sort())
  })

  it('canjes cruzados a la vez: solo entra uno, el otro es un ciclo', async () => {
    for (let round = 0; round < 5; round++) {
      const a = await player()
      const b = await player()
      const [codeA, codeB] = [(await status(a)).code, (await status(b)).code]
      const results = await Promise.all([redeem(a, codeB), redeem(b, codeA)])
      expect(results.map(r => (r.status === 'redeemed' ? 'redeemed' : r.reason)).sort()).toEqual([
        'cycle',
        'redeemed',
      ])
    }
  })

  it('cinco canjes a la vez de la misma cuenta: un solo bono', async () => {
    const invitee = await player()
    const codes = await Promise.all(
      Array.from({ length: 5 }, async () => (await status(await player())).code),
    )
    const results = await Promise.all(codes.map(code => redeem(invitee, code)))
    expect(results.filter(r => r.status === 'redeemed')).toHaveLength(1)
    expect(await balance(invitee.user.id)).toBe(1500)
  })
})

describe('activación y comisión', () => {
  it('tras las tiradas de activación, quien invitó cobra una vez, con aviso y logro', async () => {
    const inviter = await player({ window: true })
    const invitee = await player({ window: true })
    await redeem(invitee, (await status(inviter)).code)

    await liveSpin(invitee)
    await liveSpin(invitee)
    expect(commissionsOf(inviter.window!.received)).toEqual([])
    expect(await balance(inviter.user.id)).toBe(1000)

    await liveSpin(invitee)
    expect(await balance(inviter.user.id)).toBe(2000)
    const got = inviter.window!.received.filter(
      m => m.type === 'referral.commission' || m.type === 'achievement.unlocked',
    )
    expect(got.map(m => m.type)).toEqual(['referral.commission', 'achievement.unlocked'])
    expect(got[0]).toMatchObject({
      amount: 1000,
      capped: false,
      commissions: 1,
      cap: 2,
      wallet: { balance: 2000 },
    })
    expect(got[1]).toMatchObject({ achievement: { id: 'influencer' } })
    for (const m of inviter.window!.received) serverMessageSchema.parse(m)
    // El invitado no recibe nada de la comisión.
    expect(commissionsOf(invitee.window!.received)).toEqual([])

    // Más tiradas no pagan otra vez.
    await liveSpin(invitee)
    await t.services.referrals.settle(invitee.user.id)
    expect(await balance(inviter.user.id)).toBe(2000)
    expect(commissionsOf(inviter.window!.received)).toHaveLength(1)
    expect(await status(inviter)).toMatchObject({
      invited: 1,
      activated: 1,
      waiting: 0,
      earned: 1000,
      season: { commissions: 1 },
    })
    expect((await status(invitee)).invitedBy).toMatchObject({ activated: true })
  })

  it('solo cuentan las tiradas desde el canje', async () => {
    const inviter = await player()
    const invitee = await player()
    await playedSpins(invitee.user.id, 4)
    t.clock.advance(1000)
    await redeem(invitee, (await status(inviter)).code)
    await t.services.referrals.settle(invitee.user.id)
    expect(await balance(inviter.user.id)).toBe(1000)
    await playedSpins(invitee.user.id, 3)
    await t.services.referrals.settle(invitee.user.id)
    expect(await balance(inviter.user.id)).toBe(2000)
  })

  it('con la cuenta de GitHub demasiado nueva espera a que cumpla los días', async () => {
    const inviter = await player()
    const invitee = await player({ githubDays: 10 })
    await redeem(invitee, (await status(inviter)).code)
    await playedSpins(invitee.user.id, 3)
    await t.services.referrals.settle(invitee.user.id)
    expect(await balance(inviter.user.id)).toBe(1000)
    t.clock.advance(20 * DAY)
    await t.services.referrals.settle(invitee.user.id)
    expect(await balance(inviter.user.id)).toBe(2000)
    t.clock.set(new Date('2026-10-15T12:00:00Z'))
  })

  it('tope por temporada: la tercera activación no paga, y el logro de la pirámide', async () => {
    const inviter = await player({ window: true })
    const { code } = await status(inviter)
    const invitees = [await player(), await player(), await player()]
    for (const invitee of invitees) {
      await redeem(invitee, code)
      await playedSpins(invitee.user.id, 3)
      await t.services.referrals.settle(invitee.user.id)
    }
    expect(await balance(inviter.user.id)).toBe(3000)
    expect(commissionsOf(inviter.window!.received).map(m => [m.amount, m.capped])).toEqual([
      [1000, false],
      [1000, false],
      [0, true],
    ])
    const ids = inviter
      .window!.received.filter(m => m.type === 'achievement.unlocked')
      .map(m => m.achievement.id)
    expect(ids).toEqual(['influencer', 'pyramid_boss'])
    expect(await status(inviter)).toMatchObject({
      invited: 3,
      activated: 3,
      earned: 2000,
      season: { commissions: 2, cap: 2 },
    })
  })

  it('diez revisiones a la vez pagan una sola comisión', async () => {
    const inviter = await player()
    const invitee = await player()
    await redeem(invitee, (await status(inviter)).code)
    await playedSpins(invitee.user.id, 3)
    await Promise.all(
      Array.from({ length: 10 }, () => t.services.referrals.settle(invitee.user.id)),
    )
    expect(await balance(inviter.user.id)).toBe(2000)
  })

  it('cadena y ciclo de tres jugando a la vez: sin interbloqueos y cada uno cobra lo suyo', async () => {
    const [a, b, c] = [await player(), await player(), await player()]
    // A invita a B, B a C y C a A (ciclo de tres: permitido, cada uno canjea una vez).
    await redeem(b, (await status(a)).code)
    await redeem(c, (await status(b)).code)
    await redeem(a, (await status(c)).code)
    for (const p of [a, b, c]) await playedSpins(p.user.id, 3)
    await Promise.all(
      [a, b, c].flatMap(p => [1, 2, 3].map(() => t.services.referrals.settle(p.user.id))),
    )
    // Cada uno: 1000 + 500 de bono + 1000 de comisión.
    for (const p of [a, b, c]) expect(await balance(p.user.id)).toBe(2500)
  })
})

describe('borrado de cuentas', () => {
  async function deleteAccount(p: Player) {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/me/delete',
      headers: p.bearer,
      payload: { v: 1, confirm: p.user.login },
    })
    expect(res.statusCode, res.body).toBe(200)
  }

  it('el invitado borrado deja de ser de nadie, pero sigue contando para el tope', async () => {
    const inviter = await player()
    const { code } = await status(inviter)
    const first = await player()
    await redeem(first, code)
    await playedSpins(first.user.id, 3)
    await t.services.referrals.settle(first.user.id)
    await deleteAccount(first)

    const rows = await t.db.db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerId, inviter.user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ inviteeId: null, commission: 1000 })
    expect(await status(inviter)).toMatchObject({
      invited: 1,
      earned: 1000,
      season: { commissions: 1 },
    })

    // Dos invitados más: el segundo ya choca con el tope aunque el primero se haya ido.
    for (const _ of [1, 2]) {
      const next = await player()
      await redeem(next, code)
      await playedSpins(next.user.id, 3)
      await t.services.referrals.settle(next.user.id)
    }
    expect(await balance(inviter.user.id)).toBe(3000)
  })

  it('quien invitó se borra: el invitado sigue sin poder canjear otro; con los dos, la fila se va', async () => {
    const inviter = await player()
    const invitee = await player()
    await redeem(invitee, (await status(inviter)).code)
    await deleteAccount(inviter)
    const [row] = await t.db.db
      .select()
      .from(referrals)
      .where(eq(referrals.inviteeId, invitee.user.id))
    expect(row).toMatchObject({ referrerId: null })
    expect(await redeem(invitee, (await status(await player())).code)).toMatchObject({
      reason: 'already_redeemed',
    })
    // Sin nadie a quien pagar, la activación no hace nada (ni falla).
    await playedSpins(invitee.user.id, 3)
    await t.services.referrals.settle(invitee.user.id)

    await deleteAccount(invitee)
    const left = await t.db.db.select().from(referrals).where(eq(referrals.id, row!.id))
    expect(left).toEqual([])
    // Ni rastro del código ni de los logros de las cuentas borradas.
    const gone = await t.db.db
      .select()
      .from(achievements)
      .where(eq(achievements.userId, invitee.user.id))
    expect(gone).toEqual([])
  })
})
