// SPDX-License-Identifier: AGPL-3.0-or-later
// TIENDA contra Postgres: compras idempotentes, saldo, topes, armado, cada objeto en una tirada
// (en directo, pendiente y GIRAR TODAS), `git revert` con su ventana, el RNG intacto (una tirada,
// o dos con el oráculo), concurrencia, cierre de temporada, borrado de cuenta y orden de los
// mensajes. Config de test (`game.test.json`): saldo 1000, apuesta por defecto 10 al rojo, jackpot
// ×3, seguro 50 % hasta 200, turbo ×2 hasta 100, revert 550 que devuelve hasta 500 en 2 min.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  errorResponseSchema,
  itemArmResponseSchema,
  leaderboardResponseSchema,
  meResponseSchema,
  settingsResponseSchema,
  shopBuyResponseSchema,
  shopResponseSchema,
  turnEndResponseSchema,
} from '@vibe-gambling/shared'
import type { ItemId, ServerMessage, TurnEndResponse } from '@vibe-gambling/shared'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  cosmeticsOwned,
  inventory,
  itemPurchases,
  roundItemEffects,
  rounds,
  users,
  wallets,
} from '../../src/db/schema.ts'
import {
  MOD_META,
  afterBall,
  beginTurn,
  createUser,
  startTestApp,
  turnId,
  webCookie,
} from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'

type Headers = Record<string, string>
const SEASON = '2026-10'

let t: TestApp
beforeAll(async () => {
  t = await startTestApp()
})
afterAll(async () => {
  await t.close()
})

let logins = 0
let requests = 0
const requestId = () => `buy-${Date.now().toString(36)}-${(requests++).toString(36)}`

/** Jugador con la ventana visible (sus turnos se juegan en directo). */
async function player(app: TestApp = t) {
  return createUser(app, `shop${logins++}`, { window: 'visible' })
}

async function buy(headers: Headers, itemId: string, id = requestId(), app: TestApp = t) {
  return app.app.inject({
    method: 'POST',
    url: '/api/shop/buy',
    headers,
    payload: { v: 1, itemId, requestId: id },
  })
}

async function bought(headers: Headers, itemId: ItemId, app: TestApp = t) {
  const res = await buy(headers, itemId, requestId(), app)
  if (res.statusCode !== 200) throw new Error(`compra de ${itemId}: ${res.statusCode} ${res.body}`)
  return shopBuyResponseSchema.parse(res.json())
}

async function arm(headers: Headers, itemId: string, armed = true, app: TestApp = t) {
  return app.app.inject({
    method: 'POST',
    url: '/api/items/arm',
    headers,
    payload: { v: 1, itemId, armed },
  })
}

async function armed(headers: Headers, itemId: string, app: TestApp = t) {
  const res = await arm(headers, itemId, true, app)
  if (res.statusCode !== 200) throw new Error(`armar ${itemId}: ${res.statusCode} ${res.body}`)
  return itemArmResponseSchema.parse(res.json()).inventory
}

/** Un prompt completo en directo: espera a la bola anterior, `turn/start`, `turn/end`. */
async function spin(
  headers: Headers,
  extra: Partial<{ gitPushOk: boolean }> = {},
  app: TestApp = t,
): Promise<TurnEndResponse> {
  afterBall(app)
  const id = turnId()
  await beginTurn(app, headers, id)
  const res = await app.app.inject({
    method: 'POST',
    url: '/api/turn/end',
    headers,
    payload: {
      v: 1,
      turnId: id,
      durationMs: 1500,
      gitPushOk: extra.gitPushOk ?? false,
      testFailed: false,
      ...MOD_META,
    },
  })
  return turnEndResponseSchema.parse(res.json())
}

function resolvedOf(res: TurnEndResponse) {
  if (res.status !== 'resolved') throw new Error(`se esperaba una tirada, llegó ${res.status}`)
  return res
}

async function shop(headers: Headers, app: TestApp = t) {
  const res = await app.app.inject({ method: 'GET', url: '/api/shop', headers })
  return shopResponseSchema.parse(res.json()).shop
}

function errorOf(res: { statusCode: number; json(): unknown }) {
  return { status: res.statusCode, error: errorResponseSchema.parse(res.json()).error }
}

async function setBalance(userId: string, balance: number, app: TestApp = t) {
  const season = app.services.game.currentSeason().id
  // La cartera se crea perezosa (con la primera compra o tirada): aquí se crea o se pisa.
  await app.db.db
    .insert(wallets)
    .values({ userId, seasonId: season, balance })
    .onConflictDoUpdate({ target: [wallets.userId, wallets.seasonId], set: { balance } })
}

async function placeBet(headers: Headers, amount: number, target: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/bet',
    headers,
    payload: { v: 1, amount, target },
  })
  if (res.statusCode !== 200) throw new Error(`apuesta: ${res.statusCode} ${res.body}`)
}

const types = (list: readonly ServerMessage[]) => list.map(m => m.type)

describe('comprar', () => {
  it('es idempotente por requestId: el reintento no cobra dos veces', async () => {
    const { user, bearer, window } = await player()
    const id = requestId()
    const first = shopBuyResponseSchema.parse((await buy(bearer, 'rabbit_foot', id)).json())
    const again = shopBuyResponseSchema.parse((await buy(bearer, 'rabbit_foot', id)).json())
    expect(first).toMatchObject({ itemId: 'rabbit_foot', price: 77, refund: 0, fresh: true })
    expect(again).toMatchObject({ itemId: 'rabbit_foot', price: 77, fresh: false })
    expect(again.wallet.balance).toBe(1000 - 77)
    expect(again.inventory.items).toEqual([{ id: 'rabbit_foot', charges: 37, armed: false }])
    const rows = await t.db.db.select().from(itemPurchases).where(eq(itemPurchases.userId, user.id))
    expect(rows).toHaveLength(1)
    // Un solo aviso a las ventanas (y el logro de la primera compra, detrás).
    const notices = window!.received.filter(m => m.type === 'inventory')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ event: 'bought' })
    expect(types(window!.received).slice(-2)).toEqual(['inventory', 'achievement.unlocked'])
    expect(window!.received.at(-1)).toMatchObject({
      achievement: { id: 'first_purchase' },
    })
  })

  it('una compra suma cargas a las que ya tenía', async () => {
    const { bearer } = await player()
    await bought(bearer, 'oracle')
    const second = await bought(bearer, 'oracle')
    expect(second.inventory.items).toEqual([{ id: 'oracle', charges: 20, armed: false }])
  })

  it('sin saldo no compra (ni cambia nada) y la tienda ofrece el préstamo', async () => {
    const { user, bearer } = await player()
    await setBalance(user.id, 76)
    expect(errorOf(await buy(bearer, 'rabbit_foot'))).toEqual({
      status: 422,
      error: 'insufficient_funds',
    })
    const s = await shop(bearer)
    expect(s.inventory.items).toEqual([])
    expect(s.canBorrow).toBe(false) // 76 llega a la ficha mínima (10)
    await setBalance(user.id, 5)
    expect((await shop(bearer)).canBorrow).toBe(true)
  })

  it('respeta el tope por temporada', async () => {
    const { bearer } = await player()
    for (let i = 0; i < 3; i++) await bought(bearer, 'streak_helmet')
    expect(errorOf(await buy(bearer, 'streak_helmet'))).toEqual({ status: 409, error: 'conflict' })
    const item = (await shop(bearer)).items.find(i => i.id === 'streak_helmet')
    expect(item).toMatchObject({ bought: 3, maxPerSeason: 3, charges: 3, price: 150 })
  })

  it('un cosmético se compra una vez y se puede equipar; sin tenerlo, no', async () => {
    const { bearer } = await player()
    const equip = (felt: string) =>
      t.app.inject({
        method: 'POST',
        url: '/api/me/settings',
        headers: bearer,
        payload: { v: 1, felt },
      })
    expect(errorOf(await equip('vaporwave'))).toEqual({ status: 409, error: 'conflict' })
    await bought(bearer, 'felt_vaporwave')
    expect(errorOf(await buy(bearer, 'felt_vaporwave'))).toEqual({ status: 409, error: 'conflict' })
    const res = await equip('vaporwave')
    expect(settingsResponseSchema.parse(res.json()).user.felt).toBe('vaporwave')
    const me = meResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: bearer })).json(),
    )
    expect(me.user).toMatchObject({ felt: 'vaporwave', chipSkin: 'classic' })
    expect(me.inventory?.cosmetics).toEqual({
      felts: ['classic', 'vaporwave'],
      chips: ['classic'],
      felt: 'vaporwave',
      chipSkin: 'classic',
    })
    // El clásico siempre se puede volver a poner.
    expect((await equip('classic')).statusCode).toBe(200)
  })

  it('el antiabuso de compras seguidas (purchaseCooldownMs) responde rate_limited', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vibe-items-'))
    try {
      const fixture = fileURLToPath(new URL('../fixtures/game.test.json', import.meta.url))
      const cfg = JSON.parse(await readFile(fixture, 'utf8')) as {
        items: { purchaseCooldownMs: number }
      }
      cfg.items.purchaseCooldownMs = 5000
      const path = join(dir, 'game.json')
      await writeFile(path, JSON.stringify(cfg))
      const own = await startTestApp({ env: { GAME_CONFIG_PATH: path } })
      try {
        const { bearer } = await player(own)
        await bought(bearer, 'oracle', own)
        expect(errorOf(await buy(bearer, 'oracle', requestId(), own))).toEqual({
          status: 429,
          error: 'rate_limited',
        })
        own.clock.advance(5000)
        expect((await buy(bearer, 'oracle', requestId(), own)).statusCode).toBe(200)
      } finally {
        await own.close()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('armar', () => {
  it('sin cargas no; como mucho maxArmed; desarmar siempre', async () => {
    const { bearer } = await player()
    expect(errorOf(await arm(bearer, 'turbo'))).toEqual({ status: 409, error: 'conflict' })
    for (const id of ['rabbit_foot', 'oracle', 'insurance', 'turbo', 'streak_helmet'] as const) {
      await bought(bearer, id)
    }
    for (const id of ['rabbit_foot', 'oracle', 'insurance', 'turbo']) await armed(bearer, id)
    expect(errorOf(await arm(bearer, 'streak_helmet'))).toEqual({ status: 409, error: 'conflict' })
    // Volver a armar uno ya armado no cuenta dos veces.
    expect((await arm(bearer, 'oracle')).statusCode).toBe(200)
    const after = itemArmResponseSchema.parse((await arm(bearer, 'oracle', false)).json())
    expect(after.inventory.items.find(i => i.id === 'oracle')?.armed).toBe(false)
    expect((await arm(bearer, 'streak_helmet')).statusCode).toBe(200)
    // Un id que no es un consumible no pasa el esquema.
    expect((await arm(bearer, 'revert')).statusCode).toBe(400)
  })
})

describe('una tirada con objetos', () => {
  it('RNG: una sola tirada sin oráculo; con oráculo, dos, y la predicción va primero', async () => {
    const { bearer } = await player()
    let calls = 0
    const real = t.rng.pocket.bind(t.rng)
    t.rng.pocket = () => {
      calls++
      return real()
    }
    try {
      t.rng.fix(2)
      calls = 0
      resolvedOf(await spin(bearer))
      expect(calls).toBe(1)

      await bought(bearer, 'oracle')
      await armed(bearer, 'oracle')
      t.rng.fix(17)
      t.rng.push(5, 17)
      calls = 0
      const res = resolvedOf(await spin(bearer))
      expect(calls).toBe(2)
      expect(res.round.result).toBe(17)
      expect(res.round.items).toEqual([
        { itemId: 'oracle', kind: 'prediction', amount: 0, prediction: 5, hit: false },
      ])
      expect(res.round.itemNet).toBe(0)
    } finally {
      t.rng.pocket = real
    }
  })

  it('seguro: devuelve la mitad de la exterior perdida, aparte del neto oficial', async () => {
    const { user, bearer, window } = await player()
    await bought(bearer, 'insurance')
    await armed(bearer, 'insurance')
    t.rng.fix(2) // negro: el rojo por defecto (10) pierde
    const res = resolvedOf(await spin(bearer))
    expect(res.round).toMatchObject({ net: -10, itemNet: 5, staked: 10 })
    expect(res.round.items).toEqual([{ itemId: 'insurance', kind: 'refund', amount: 5 }])
    expect(res.wallet.balance).toBe(1000 - 350 - 10 + 5)
    const [row] = await t.db.db.select().from(rounds).where(eq(rounds.id, res.round.roundId))
    expect(row).toMatchObject({ net: -10, itemNet: 5, netWorthAfter: 1000 - 350 - 5 })
    // round.resolved → inventory (cargas gastadas) → logros.
    const tail = types(window!.received).slice(-3)
    expect(tail[0]).toBe('round.resolved')
    expect(tail[1]).toBe('inventory')
    expect(
      window!.received.find(m => m.type === 'inventory' && m.event === 'consumed'),
    ).toMatchObject({ inventory: { items: [{ id: 'insurance', charges: 4, armed: true }] } })
    // Con el 0 también cubre; sin apuesta exterior ni actúa ni gasta.
    await placeBet(bearer, 50, '17')
    const pleno = resolvedOf(await spin(bearer))
    expect(pleno.round.items).toEqual([])
    const [inv] = await t.db.db
      .select()
      .from(inventory)
      .where(and(eq(inventory.userId, user.id), eq(inventory.itemId, 'insurance')))
    expect(inv?.charges).toBe(4)
  })

  it('turbo: ×2 al único pleno ganador; con el jackpot (×3) ni actúa ni gasta', async () => {
    const { bearer } = await player()
    await bought(bearer, 'turbo')
    await bought(bearer, 'turbo')
    await armed(bearer, 'turbo')
    await placeBet(bearer, 100, '17')
    t.rng.fix(17)
    const res = resolvedOf(await spin(bearer))
    expect(res.round).toMatchObject({ net: 3500, itemNet: 3500 })
    expect(res.round.items).toEqual([{ itemId: 'turbo', kind: 'boost', amount: 3500 }])
    expect(res.round.spectacle?.tier).toBe('straight')
    // Con PUSH TO PROD el jackpot ya paga ×3: el turbo se queda en el bolsillo.
    await placeBet(bearer, 10, '17')
    const pushed = resolvedOf(await spin(bearer, { gitPushOk: true }))
    expect(pushed.round.jackpot).toBe(true)
    expect(pushed.round.items).toEqual([])
    expect((await shop(bearer)).inventory.items).toEqual([{ id: 'turbo', charges: 1, armed: true }])
  })

  it('pata de conejo: nada (con estilo) y el Placebómetro lo cuenta', async () => {
    const { bearer } = await player()
    await bought(bearer, 'rabbit_foot')
    await armed(bearer, 'rabbit_foot')
    t.rng.fix(1) // rojo: gana
    const won = resolvedOf(await spin(bearer))
    expect(won.round.items).toEqual([{ itemId: 'rabbit_foot', kind: 'placebo', amount: 0 }])
    expect(won.round.itemNet).toBe(0)
    await arm(bearer, 'rabbit_foot', false)
    t.rng.fix(2)
    resolvedOf(await spin(bearer))
    const meter = (await shop(bearer)).placebometer
    expect(meter).toEqual({
      spent: 77,
      recovered: 0,
      net: -77,
      rabbit: { with: { rounds: 1, won: 1 }, without: { rounds: 1, won: 0 } },
      oracle: { predictions: 0, hits: 0 },
    })
  })

  it('casco: la racha no se rompe, queda con asterisco y se ve en el ranking', async () => {
    const { user, bearer } = await player()
    await bought(bearer, 'streak_helmet')
    await armed(bearer, 'streak_helmet')
    t.rng.fix(1)
    resolvedOf(await spin(bearer))
    const second = resolvedOf(await spin(bearer))
    expect(second.round.items).toEqual([]) // ganando no se gasta
    t.rng.fix(2)
    const lost = resolvedOf(await spin(bearer))
    expect(lost.round.items).toEqual([{ itemId: 'streak_helmet', kind: 'shield', amount: 0 }])
    expect(lost.wallet).toMatchObject({ currentStreak: 2, streakAsterisk: true })
    t.rng.fix(1)
    const third = resolvedOf(await spin(bearer))
    // ON FIRE (onFireAt 3) con asterisco: "Racha con asterisco", no "ON FIRE".
    expect(third.wallet).toMatchObject({ currentStreak: 3, streakAsterisk: true })
    const got = await t.db.db.query.achievements.findMany({
      where: (a, { eq: is }) => is(a.userId, user.id),
    })
    const ids = got.map(a => a.achievementId)
    expect(ids).toContain('asterisk_streak')
    expect(ids).not.toContain('on_fire')
    // El ranking enseña el asterisco (`3*`).
    const board = leaderboardResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/leaderboard?board=spins&limit=100' })).json(),
    )
    expect(board.rows.find(r => r.login === user.login)).toMatchObject({
      currentStreak: 3,
      streakAsterisk: true,
    })
    // Se rompe de verdad (sin casco): adiós asterisco.
    await arm(bearer, 'streak_helmet', false)
    t.rng.fix(2)
    const broke = resolvedOf(await spin(bearer))
    expect(broke.wallet).toMatchObject({ currentStreak: -1, streakAsterisk: false })
  })

  it('tiradas pendientes y GIRAR TODAS: los objetos se aplican tirada a tirada', async () => {
    const { user, bearer, window } = await player()
    await bought(bearer, 'insurance')
    await armed(bearer, 'insurance')
    window!.setVisible(false)
    t.rng.fix(2)
    for (let i = 0; i < 3; i++) {
      afterBall(t)
      const id = turnId()
      await beginTurn(t, bearer, id)
      await t.app.inject({
        method: 'POST',
        url: '/api/turn/end',
        headers: bearer,
        payload: {
          v: 1,
          turnId: id,
          durationMs: 1500,
          gitPushOk: false,
          testFailed: false,
          ...MOD_META,
        },
      })
    }
    window!.setVisible(true)
    window!.received.length = 0
    for (let i = 0; i < 3; i++) {
      afterBall(t)
      const spent = await t.services.game.spendPending(user.id, {
        quick: true,
        requestId: requestId(),
      })
      expect(spent.round.items).toEqual([{ itemId: 'insurance', kind: 'refund', amount: 5 }])
    }
    expect((await shop(bearer)).inventory.items).toEqual([
      { id: 'insurance', charges: 2, armed: true },
    ])
    // Cada GIRAR: round.started, round.resolved y el bolsillo, en ese orden.
    expect(types(window!.received).filter(x => x !== 'achievement.unlocked')).toEqual([
      'round.started',
      'round.resolved',
      'inventory',
      'round.started',
      'round.resolved',
      'inventory',
      'round.started',
      'round.resolved',
      'inventory',
    ])
  })
})

describe('git revert HEAD~1', () => {
  it('devuelve la pérdida de la última ronda (con su tope), solo tras enseñarla y una vez', async () => {
    const { user, bearer } = await player()
    await setBalance(user.id, 5000)
    await placeBet(bearer, 1000, 'red')
    t.rng.fix(2)
    // La bola aún cae: nada que revertir (no se destripa el resultado).
    afterBall(t)
    const id = turnId()
    await beginTurn(t, bearer, id)
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/turn/end',
      headers: bearer,
      payload: {
        v: 1,
        turnId: id,
        durationMs: 1500,
        gitPushOk: false,
        testFailed: false,
        ...MOD_META,
      },
    })
    expect(turnEndResponseSchema.parse(res.json()).status).toBe('resolved')
    expect(errorOf(await buy(bearer, 'revert'))).toEqual({ status: 409, error: 'conflict' })
    afterBall(t)
    const s = await shop(bearer)
    expect(s.inventory.revert).toMatchObject({ refund: 500 })
    const reverted = await bought(bearer, 'revert')
    expect(reverted).toMatchObject({ itemId: 'revert', price: 550, refund: 500 })
    expect(reverted.wallet.balance).toBe(4000 - 550 + 500)
    expect(reverted.inventory.revert).toBeNull()
    // La pérdida (1000) pasaba del tope (500): "git revert --no-regrets".
    const ach = await t.db.db.query.achievements.findMany({
      where: (a, { eq: is }) => is(a.userId, user.id),
    })
    expect(ach.map(a => a.achievementId)).toContain('revert_regret')
    // Queda como una línea más de la ronda, que no cambia su neto oficial.
    const [effect] = await t.db.db
      .select()
      .from(roundItemEffects)
      .innerJoin(rounds, eq(rounds.id, roundItemEffects.roundId))
      .where(and(eq(roundItemEffects.itemId, 'revert'), eq(rounds.userId, user.id)))
    expect(effect?.round_item_effects).toMatchObject({ kind: 'revert', amount: 500 })
    expect(effect?.rounds).toMatchObject({ net: -1000 })
    // Una vez por temporada.
    resolvedOf(await spin(bearer))
    afterBall(t)
    expect(errorOf(await buy(bearer, 'revert'))).toEqual({ status: 409, error: 'conflict' })
  })

  it('con la ventana cerrada, una ganancia o la siguiente ya resuelta, no hay nada que revertir', async () => {
    const { user, bearer } = await player()
    await setBalance(user.id, 2000)
    t.rng.fix(2)
    resolvedOf(await spin(bearer))
    afterBall(t)
    t.clock.advance(t.config.game.items.revert.windowMs)
    expect(errorOf(await buy(bearer, 'revert'))).toEqual({ status: 409, error: 'conflict' })
    // Pierde y luego gana: revert mira solo la última (la ganada).
    resolvedOf(await spin(bearer))
    t.rng.fix(1)
    resolvedOf(await spin(bearer))
    afterBall(t)
    expect((await shop(bearer)).inventory.revert).toBeNull()
    expect(errorOf(await buy(bearer, 'revert'))).toEqual({ status: 409, error: 'conflict' })
  })

  it('sin doble reembolso: con el seguro, revert devuelve solo lo que queda de la pérdida', async () => {
    const { user, bearer } = await player()
    await setBalance(user.id, 3000)
    await bought(bearer, 'insurance')
    await armed(bearer, 'insurance')
    await placeBet(bearer, 100, 'red')
    t.rng.fix(2)
    const lost = resolvedOf(await spin(bearer))
    expect(lost.round).toMatchObject({ net: -100, itemNet: 50 })
    afterBall(t)
    expect((await bought(bearer, 'revert')).refund).toBe(50)
  })
})

describe('concurrencia', () => {
  it('compras, armados y tiradas a la vez no descuadran ni el saldo ni las cargas', async () => {
    const { user, bearer } = await player()
    await setBalance(user.id, 100_000)
    await bought(bearer, 'insurance')
    await armed(bearer, 'insurance')
    t.rng.fix(2)
    for (let i = 0; i < 6; i++) {
      afterBall(t)
      const id = turnId()
      await beginTurn(t, bearer, id)
      await Promise.all([
        t.app.inject({
          method: 'POST',
          url: '/api/turn/end',
          headers: bearer,
          payload: {
            v: 1,
            turnId: id,
            durationMs: 1500,
            gitPushOk: false,
            testFailed: false,
            ...MOD_META,
          },
        }),
        buy(bearer, 'insurance'),
        arm(bearer, 'insurance'),
      ])
    }
    const purchases = await t.db.db
      .select()
      .from(itemPurchases)
      .where(eq(itemPurchases.userId, user.id))
    const played = await t.db.db
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, user.id), eq(rounds.status, 'resolved')))
    const effects = await t.db.db
      .select()
      .from(roundItemEffects)
      .innerJoin(rounds, eq(rounds.id, roundItemEffects.roundId))
      .where(eq(rounds.userId, user.id))
    const [wallet] = await t.db.db.select().from(wallets).where(eq(wallets.userId, user.id))
    const [inv] = await t.db.db.select().from(inventory).where(eq(inventory.userId, user.id))
    const spentCoins = purchases.reduce((acc, p) => acc + p.price, 0)
    const flow = played.reduce((acc, r) => acc + (r.net ?? 0) + (r.itemNet ?? 0), 0)
    expect(wallet?.balance).toBe(100_000 - spentCoins + flow)
    // Cargas: 5 por compra (tope 5 compras), menos una por cada ronda con seguro.
    expect(purchases.length).toBeLessThanOrEqual(5)
    expect(inv?.charges).toBe(purchases.length * 5 - effects.length)
  })
})

describe('temporadas y cuentas', () => {
  it('el cierre de temporada vacía el bolsillo y conserva cosméticos y compras', async () => {
    const own = await startTestApp()
    try {
      const { user, bearer, window } = await player(own)
      await bought(bearer, 'oracle', own)
      await bought(bearer, 'chips_floppy', own)
      own.clock.set('2026-10-31T23:00:00Z')
      expect((await own.services.seasons.tick()).closed).toEqual([SEASON])
      expect(await own.db.db.select().from(inventory).where(eq(inventory.userId, user.id))).toEqual(
        [],
      )
      expect(
        await own.db.db.select().from(cosmeticsOwned).where(eq(cosmeticsOwned.userId, user.id)),
      ).toHaveLength(1)
      expect(
        await own.db.db.select().from(itemPurchases).where(eq(itemPurchases.userId, user.id)),
      ).toHaveLength(2)
      expect(window!.received.at(-1)).toMatchObject({
        type: 'inventory',
        event: 'expired',
        inventory: { seasonId: '2026-11', items: [] },
      })
      const s = await shop(bearer, own)
      expect(s.inventory.cosmetics.chips).toEqual(['classic', 'floppy'])
      expect(s.items.find(i => i.id === 'oracle')?.bought).toBe(0)
    } finally {
      await own.close()
    }
  })

  it('borrar la cuenta borra compras, bolsillo, cosméticos y efectos en cascada', async () => {
    const { user, bearer } = await player()
    await bought(bearer, 'rabbit_foot')
    await armed(bearer, 'rabbit_foot')
    await bought(bearer, 'felt_dark_mode')
    resolvedOf(await spin(bearer))
    const cookie = await webCookie(t, user.id)
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/me/delete',
      headers: { cookie },
      payload: { v: 1, confirm: user.login },
    })
    expect(res.statusCode).toBe(200)
    expect(await t.db.db.select().from(users).where(eq(users.id, user.id))).toEqual([])
    for (const table of [itemPurchases, inventory, cosmeticsOwned]) {
      expect(await t.db.db.select().from(table).where(eq(table.userId, user.id))).toEqual([])
    }
    const orphans = await t.db.db
      .select()
      .from(roundItemEffects)
      .innerJoin(rounds, eq(rounds.id, roundItemEffects.roundId))
      .where(eq(rounds.userId, user.id))
    expect(orphans).toEqual([])
  })
})
