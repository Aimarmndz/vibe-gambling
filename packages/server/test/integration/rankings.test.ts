// SPDX-License-Identifier: AGPL-3.0-or-later
// Rankings, Salón de la Ruina y cambio de temporada con un reloj falso.
import {
  hallOfRuinResponseSchema,
  leaderboardResponseSchema,
  meResponseSchema,
} from '@vibe-gambling/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hallOfRuin, rounds, seasons, wallets } from '../../src/db/schema.ts'
import { createUser, MOD_META, startTestApp, turnId } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(async () => {
  await t.close()
})

/** Fija el estado de la cartera de octubre de un usuario. */
async function setWallet(userId: string, balance: number, debt: number, spins: number) {
  await t.db.db
    .insert(seasons)
    .values({
      id: '2026-10',
      startsAt: new Date('2026-09-30T22:00:00Z'),
      endsAt: new Date('2026-10-31T23:00:00Z'),
    })
    .onConflictDoNothing()
  await t.db.db
    .insert(wallets)
    .values({ userId, seasonId: '2026-10', balance, debt, spins })
    .onConflictDoUpdate({
      target: [wallets.userId, wallets.seasonId],
      set: { balance, debt, spins },
    })
}

async function board(query: string) {
  const res = await t.app.inject({ method: 'GET', url: `/api/leaderboard${query}` })
  expect(res.statusCode, res.body).toBe(200)
  return leaderboardResponseSchema.parse(res.json())
}

describe('rankings y temporadas', () => {
  it('ordena las tres tablas, excluye a los ocultos y a quien no ha tirado', async () => {
    const a = await createUser(t, 'alice') // −900
    const b = await createUser(t, 'bob') // 5000
    const c = await createUser(t, 'carol') // 100, muchas tiradas
    const d = await createUser(t, 'dave') // oculto, el más arruinado
    const e = await createUser(t, 'erin') // sin tiradas
    await setWallet(a.user.id, 100, 1000, 10)
    await setWallet(b.user.id, 5000, 0, 3)
    await setWallet(c.user.id, 100, 0, 50)
    await setWallet(d.user.id, 0, 99_999, 2)
    await setWallet(e.user.id, 1000, 0, 0)
    await t.services.auth.updateSettings(d.user.id, { hidden: true })

    const broke = await board('?board=broke')
    expect(broke.season).toBe('2026-10')
    expect(broke.rows.map(r => r.login)).toEqual(['alice', 'carol', 'bob'])
    expect(broke.rows[0]).toMatchObject({
      rank: 1,
      netWorth: -900,
      balance: 100,
      debt: 1000,
      spins: 10,
    })
    expect(broke.rows[0]?.profileUrl).toBe('https://github.test/alice')
    expect(broke.players).toBe(3)
    expect(broke.seasons).toEqual(['2026-10'])

    expect((await board('?board=rich')).rows.map(r => r.login)).toEqual(['bob', 'carol', 'alice'])
    expect((await board('?board=spins&limit=2')).rows.map(r => r.login)).toEqual(['carol', 'alice'])

    // Puesto propio en /api/me (null si está oculto).
    const meA = meResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: a.bearer })).json(),
    )
    expect(meA.brokeRank).toBe(1)
    const meD = meResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: d.bearer })).json(),
    )
    expect(meD.brokeRank).toBeNull()

    const bad = await t.app.inject({ method: 'GET', url: '/api/leaderboard?board=poorest' })
    expect(bad.statusCode).toBe(400)
    const unknown = await t.app.inject({ method: 'GET', url: '/api/leaderboard?season=1999-01' })
    expect(unknown.statusCode).toBe(404)
  })

  it('cierra octubre a las 00:00 del 1 de noviembre en Europe/Madrid y guarda el Salón', async () => {
    const z = await createUser(t, 'zed')
    await setWallet(z.user.id, 0, 50_000, 7)
    // Una ronda a medias en octubre: caducará con el cierre.
    const id = turnId()
    await t.app.inject({
      method: 'POST',
      url: '/api/turn/start',
      headers: z.bearer,
      payload: { v: 1, turnId: id, ...MOD_META },
    })

    // 23:59:59 en Madrid (CET, UTC+1): aún es octubre.
    t.clock.set('2026-10-31T22:59:59Z')
    const before = await t.services.seasons.tick()
    expect(before).toMatchObject({ ran: true, closed: [], current: '2026-10' })

    t.clock.set('2026-10-31T23:00:00Z')
    const [first, second] = await Promise.all([
      t.services.seasons.tick(),
      t.services.seasons.tick(),
    ])
    // Dos pasadas a la vez: el cerrojo hace que solo una cierre la temporada.
    expect([...(first?.closed ?? []), ...(second?.closed ?? [])]).toEqual(['2026-10'])
    expect(first?.current).toBe('2026-11')

    const [oct] = await t.db.db.select().from(seasons).where(eq(seasons.id, '2026-10'))
    expect(oct?.closedAt).not.toBeNull()
    const [nov] = await t.db.db.select().from(seasons).where(eq(seasons.id, '2026-11'))
    expect(nov?.startsAt.toISOString()).toBe('2026-10-31T23:00:00.000Z')

    // Salón: top 3 (hallOfRuinSize de test) de arruinados no ocultos: zed, alice, carol.
    const hall = await t.db.db.select().from(hallOfRuin).where(eq(hallOfRuin.seasonId, '2026-10'))
    expect(hall).toHaveLength(3)
    const res = hallOfRuinResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/hall-of-ruin' })).json(),
    )
    expect(res.seasons[0]?.seasonId).toBe('2026-10')
    expect(res.seasons[0]?.rows.map(r => [r.rank, r.login])).toEqual([
      [1, 'zed'],
      [2, 'alice'],
      [3, 'carol'],
    ])

    // La ronda abierta de octubre ha caducado sin tirada.
    const open = await t.db.db.select().from(rounds).where(eq(rounds.userId, z.user.id))
    expect(open.map(r => r.status)).toEqual(['expired'])

    // Noviembre empieza de cero, sin crear la cartera hasta que haga falta.
    const meRes = await t.app.inject({ method: 'GET', url: '/api/me', headers: z.bearer })
    expect(meRes.statusCode, meRes.body).toBe(200)
    const me = meResponseSchema.parse(meRes.json())
    expect(me.wallet).toMatchObject({ seasonId: '2026-11', balance: 1000, debt: 0, spins: 0 })
    expect(me.round).toBeNull()
    expect(
      await t.db.db.select().from(wallets).where(eq(wallets.seasonId, '2026-11')),
    ).toHaveLength(0)

    // El ranking por defecto ya es el de noviembre; el de octubre sigue consultable.
    expect((await board('')).season).toBe('2026-11')
    expect((await board('?season=2026-10')).rows[0]?.login).toBe('zed')
    expect((await board('')).seasons).toEqual(['2026-11', '2026-10'])
  })

  it('ocultarse también te saca del Salón de la Ruina (y los puestos se renumeran)', async () => {
    const res1 = hallOfRuinResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/hall-of-ruin' })).json(),
    )
    const alice = res1.seasons[0]?.rows.find(r => r.login === 'alice')
    expect(alice).toBeDefined()
    const [row] = await t.db.db.select().from(hallOfRuin).where(eq(hallOfRuin.rank, 1))
    if (!row) throw new Error('sin salón')
    await t.services.auth.updateSettings(row.userId, { hidden: true })
    const res2 = hallOfRuinResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/hall-of-ruin' })).json(),
    )
    expect(res2.seasons[0]?.rows.map(r => [r.rank, r.login])).toEqual([
      [1, 'alice'],
      [2, 'carol'],
    ])
  })
})
