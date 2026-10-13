// SPDX-License-Identifier: AGPL-3.0-or-later
// Antiabuso: las cuentas de GitHub de menos de `leaderboard.minAccountAgeDays` (30 en la config de
// test) juegan, pero no salen en los rankings ni en el Salón de la Ruina hasta cumplirlos. El
// cambio llega solo con el paso del tiempo (reloj inyectado), sin que el jugador haga nada.
import {
  hallOfRuinResponseSchema,
  leaderboardResponseSchema,
  meResponseSchema,
} from '@vibe-gambling/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hallOfRuin, seasons, users, wallets } from '../../src/db/schema.ts'
import { createUser, MOD_META, START, startTestApp, turnId } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'

const DAY = 86_400_000
const SEASON = '2026-10'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
  await t.db.db.insert(seasons).values({
    id: SEASON,
    startsAt: new Date('2026-09-30T22:00:00Z'),
    endsAt: new Date('2026-10-31T23:00:00Z'),
  })
})
afterAll(async () => {
  await t.close()
})

/** Usuario cuya cuenta de GitHub se creó hace `days` días (null: sin dato, cuenta de antes). */
async function player(login: string, days: number | null, netWorth: number, spins = 5) {
  const u = await createUser(t, login)
  const githubCreatedAt = days === null ? null : new Date(t.clock.now().getTime() - days * DAY)
  await t.db.db.update(users).set({ githubCreatedAt }).where(eq(users.id, u.user.id))
  const balance = Math.max(netWorth, 0)
  await t.db.db
    .insert(wallets)
    .values({ userId: u.user.id, seasonId: SEASON, balance, debt: balance - netWorth, spins })
  return u
}

async function board(name: string) {
  const res = await t.app.inject({ method: 'GET', url: `/api/leaderboard?board=${name}` })
  expect(res.statusCode, res.body).toBe(200)
  return leaderboardResponseSchema.parse(res.json())
}

async function me(bearer: Record<string, string>) {
  const res = await t.app.inject({ method: 'GET', url: '/api/me', headers: bearer })
  expect(res.statusCode, res.body).toBe(200)
  return meResponseSchema.parse(res.json())
}

async function hall() {
  const res = await t.app.inject({ method: 'GET', url: '/api/hall-of-ruin' })
  expect(res.statusCode, res.body).toBe(200)
  return hallOfRuinResponseSchema.parse(res.json())
}

describe('cuentas de GitHub nuevas fuera del ranking', () => {
  let young: Awaited<ReturnType<typeof player>>
  let old: Awaited<ReturnType<typeof player>>
  let legacy: Awaited<ReturnType<typeof player>>

  it('la de 29 días no sale en ningún tablero; la de 31 y la de antes de la regla, sí', async () => {
    // La nueva es la más arruinada, la más rica no y la que más tira: estaría arriba en las tres.
    young = await player('young29', 29, -50_000, 99)
    old = await player('old31', 31, -100)
    legacy = await player('legacy', null, 500)
    expect(t.clock.now().toISOString()).toBe(new Date(START).toISOString())

    for (const name of ['broke', 'rich', 'spins']) {
      const res = await board(name)
      expect(res.rows.map(r => r.login).sort()).toEqual(['legacy', 'old31'])
      // El recuento de jugadores tampoco la cuenta.
      expect(res.players).toBe(2)
    }
    expect((await board('broke')).rows.map(r => [r.rank, r.login])).toEqual([
      [1, 'old31'],
      [2, 'legacy'],
    ])

    // Juega con normalidad: puede abrir y cerrar turnos como cualquiera.
    const id = turnId()
    const start = await t.app.inject({
      method: 'POST',
      url: '/api/turn/start',
      headers: young.bearer,
      payload: { v: 1, turnId: id, ...MOD_META },
    })
    expect(start.statusCode, start.body).toBe(200)
  })

  it('/api/me no da un puesto falso: brokeRank null y la fecha en que saldrá', async () => {
    const youngMe = await me(young.bearer)
    expect(youngMe.brokeRank).toBeNull()
    expect(youngMe.user.newAccount).toEqual({
      minAgeDays: 30,
      rankedFrom: new Date(new Date(START).getTime() + DAY).toISOString(), // 29 + 1 = 30 días
    })
    const oldMe = await me(old.bearer)
    expect(oldMe.brokeRank).toBe(1)
    expect(oldMe.user.newAccount).toBeNull()
    // Sin dato (cuenta de antes de la regla): cuenta como antigua.
    const legacyMe = await me(legacy.bearer)
    expect(legacyMe.brokeRank).toBe(2)
    expect(legacyMe.user.newAccount).toBeNull()
  })

  it('sale sola al cumplir los 30 días (justo en el instante, ni un milisegundo antes)', async () => {
    t.clock.advance(DAY - 1)
    expect((await board('broke')).rows.map(r => r.login)).not.toContain('young29')
    expect((await me(young.bearer)).brokeRank).toBeNull()

    t.clock.advance(1)
    const broke = await board('broke')
    expect(broke.rows.map(r => [r.rank, r.login])).toEqual([
      [1, 'young29'],
      [2, 'old31'],
      [3, 'legacy'],
    ])
    expect(broke.players).toBe(3)
    expect((await board('spins')).rows[0]?.login).toBe('young29')
    const youngMe = await me(young.bearer)
    expect(youngMe.brokeRank).toBe(1)
    expect(youngMe.user.newAccount).toBeNull()
  })

  it('el Salón de la Ruina no guarda las cuentas nuevas al cerrar la temporada', async () => {
    // Al cierre (1 de noviembre, 00:00 en Madrid) esta cuenta tendrá 29 días.
    const closeAt = new Date('2026-10-31T23:00:00Z')
    const newbie = await createUser(t, 'newbie')
    await t.db.db
      .update(users)
      .set({ githubCreatedAt: new Date(closeAt.getTime() - 29 * DAY) })
      .where(eq(users.id, newbie.user.id))
    await t.db.db
      .insert(wallets)
      .values({ userId: newbie.user.id, seasonId: SEASON, balance: 0, debt: 999_999, spins: 3 })

    t.clock.set(closeAt)
    const tick = await t.services.seasons.tick()
    expect(tick.closed).toEqual([SEASON])

    // Top 3 (hallOfRuinSize de test) sin la cuenta nueva, aunque era la más arruinada.
    const stored = await t.db.db
      .select({ userId: hallOfRuin.userId, rank: hallOfRuin.rank })
      .from(hallOfRuin)
      .where(eq(hallOfRuin.seasonId, SEASON))
    expect(stored.map(r => r.userId)).not.toContain(newbie.user.id)
    expect(stored).toHaveLength(3)
    expect((await hall()).seasons[0]?.rows.map(r => [r.rank, r.login])).toEqual([
      [1, 'young29'],
      [2, 'old31'],
      [3, 'legacy'],
    ])

    // Ni siquiera cuando cumple los 30 días: el Salón es la foto del cierre.
    t.clock.advance(2 * DAY)
    expect((await hall()).seasons[0]?.rows.map(r => r.login)).not.toContain('newbie')
  })

  it('al leer el Salón se vuelve a mirar: una cuenta sin dato que al volver resulta nueva sale', async () => {
    // "legacy" entró en el Salón sin fecha (contaba como antigua). Al volver a iniciar sesión,
    // GitHub dice que su cuenta es de hace 3 días: sale del Salón y se renumera, como al ocultarse.
    await t.db.db
      .update(users)
      .set({ githubCreatedAt: new Date(t.clock.now().getTime() - 3 * DAY) })
      .where(eq(users.id, legacy.user.id))
    expect((await hall()).seasons[0]?.rows.map(r => [r.rank, r.login])).toEqual([
      [1, 'young29'],
      [2, 'old31'],
    ])
    // Y vuelve cuando cumple los 30 días.
    t.clock.advance(27 * DAY)
    expect((await hall()).seasons[0]?.rows.map(r => r.login)).toContain('legacy')
  })

  it('borrar la cuenta borra también la fecha de creación de GitHub', async () => {
    const [before] = await t.db.db
      .select({ githubCreatedAt: users.githubCreatedAt })
      .from(users)
      .where(eq(users.id, old.user.id))
    expect(before?.githubCreatedAt).toBeInstanceOf(Date)
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/me/delete',
      headers: old.bearer,
      payload: { v: 1, confirm: 'old31' },
    })
    expect(res.statusCode, res.body).toBe(200)
    expect(await t.db.db.select().from(users).where(eq(users.id, old.user.id))).toHaveLength(0)
    const dump = await t.db
      .sql`select github_created_at from users where github_id = ${old.user.githubId}`
    expect(dump).toHaveLength(0)
  })
})
