// SPDX-License-Identifier: AGPL-3.0-or-later
// Migraciones de la v2 (0001 → 0004) sobre una base de datos con datos de la v1: se aplica solo la
// 0000, se llenan las tablas como las dejaba la v1, se migra y se comprueba que no se pierde nada,
// que los checks nuevos aceptan las filas viejas y que el servidor de la v2 trabaja con ellas
// (estadísticas reconstruidas, reintentos de turnos de la v1, idioma guardado).
import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { turnEndResponseSchema } from '@vibe-gambling/shared'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'

import { createDb } from '../../src/db/client.ts'
import type { DbHandle } from '../../src/db/client.ts'
import { runMigrations } from '../../src/db/migrate.ts'
import { attachWindow, beginServiceTurn, MOD_META, startTestApp } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'
import { withDatabase } from '../helpers/db-url.ts'
import { MIGRATIONS_DIR } from '../helpers/env.ts'

const SEASON = '2026-10'
const PAST = '2026-09'
const USER_A = '00000000-0000-4000-8000-00000000000a'
const USER_B = '00000000-0000-4000-8000-00000000000b'
const USER_C = '00000000-0000-4000-8000-00000000000c'
/** Turno de la v1 ya terminado (su reintento tiene que dar la misma ronda). */
const V1_TURN = 'v1-turn-0003'

let url: string
let handle: DbHandle
let workdir: string

/** Carpeta de migraciones con solo la primera (la v1 tal como se publicó). */
async function v1MigrationsFolder(): Promise<string> {
  const dir = join(workdir, 'drizzle-v1')
  await mkdir(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(
    await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'),
  ) as {
    entries: Array<{ tag: string }>
  }
  const first = journal.entries[0]!
  expect(first.tag).toBe('0000_init')
  await writeFile(
    join(dir, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: [first] }, null, 2),
  )
  await copyFile(join(MIGRATIONS_DIR, `${first.tag}.sql`), join(dir, `${first.tag}.sql`))
  return dir
}

/** Datos como los dejaba la v1: dos temporadas, rondas resueltas, caducadas y abiertas, préstamo. */
async function seedV1(sql: postgres.Sql): Promise<void> {
  await sql`
    insert into seasons (id, starts_at, ends_at, closed_at) values
      (${PAST}, '2026-08-31T22:00:00Z', '2026-09-30T22:00:00Z', '2026-09-30T22:00:05Z'),
      (${SEASON}, '2026-09-30T22:00:00Z', '2026-10-31T23:00:00Z', null)`
  await sql`
    insert into users (id, github_id, login, avatar_url, hidden, locale, last_bets) values
      (${USER_A}, 1, 'veterano', 'https://avatars.test/veterano.png', false, 'es',
        ${JSON.stringify([{ selection: { kind: 'red' }, amount: 10 }])}::jsonb),
      (${USER_B}, 2, 'deudor', 'https://avatars.test/deudor.png', true, 'en', null),
      (${USER_C}, 3, 'jubilado', 'https://avatars.test/jubilado.png', false, null, null)`
  await sql`
    insert into wallets (user_id, season_id, balance, debt, spins, loans, current_streak,
      best_streak, slip) values
      (${USER_A}, ${SEASON}, 1340, 0, 3, 0, 1, 1,
        ${JSON.stringify([{ selection: { kind: 'black' }, amount: 10 }])}::jsonb),
      (${USER_B}, ${SEASON}, 500, 550, 2, 1, -1, 0, '[]'),
      (${USER_C}, ${PAST}, 3000, 0, 9, 0, 2, 4, '[]')`
  // Usuario A: +10, −10, +350 (pleno al 2), en ese orden.
  const resolved = [
    { id: '10000000-0000-4000-8000-000000000001', at: '2026-10-10T10:00:00Z', result: 1, net: 10 },
    { id: '10000000-0000-4000-8000-000000000002', at: '2026-10-10T11:00:00Z', result: 2, net: -10 },
    { id: '10000000-0000-4000-8000-000000000003', at: '2026-10-10T12:00:00Z', result: 2, net: 350 },
  ]
  for (const [i, r] of resolved.entries()) {
    const staked = 10
    await sql`
      insert into rounds (id, user_id, season_id, status, opened_at, resolved_at, reveal_at,
        resolved_by_turn_id, result, source, staked, returned, net, jackpot, git_push_ok,
        test_failed, duration_ms, interest_charged, color_streak_color, color_streak_count)
      values (${r.id}, ${USER_A}, ${SEASON}, 'resolved', ${r.at}, ${r.at}, ${r.at},
        ${`v1-turn-000${i + 1}`}, ${r.result}, 'slip', ${staked}, ${staked + r.net}, ${r.net},
        false, false, false, 1200, 0, null, null)`
    await sql`
      insert into bets (round_id, position, kind, selection, amount, won, payout) values
        (${r.id}, 0, ${i === 2 ? 'straight' : 'red'},
         ${JSON.stringify(i === 2 ? { kind: 'straight', numbers: [2] } : { kind: 'red' })}::jsonb,
         10, ${r.net > 0}, ${r.net > 0 ? staked + r.net : 0})`
    await sql`
      insert into turns (user_id, turn_id, round_id, reused, started_at, ended_at) values
        (${USER_A}, ${`v1-turn-000${i + 1}`}, ${r.id}, false, ${r.at}, ${r.at})`
  }
  // Una caducada y una abierta que lleva días abierta (la v2 tiene que caducarla al tocarla).
  await sql`
    insert into rounds (id, user_id, season_id, status, opened_at, expired_at) values
      ('10000000-0000-4000-8000-000000000004', ${USER_A}, ${SEASON}, 'expired',
        '2026-10-11T10:00:00Z', '2026-10-11T10:20:00Z'),
      ('10000000-0000-4000-8000-000000000005', ${USER_A}, ${SEASON}, 'open',
        '2026-10-12T10:00:00Z', null)`
  // Usuario B: una tirada con intereses y un préstamo.
  await sql`
    insert into rounds (id, user_id, season_id, status, opened_at, resolved_at, reveal_at,
      resolved_by_turn_id, result, source, staked, returned, net, jackpot, git_push_ok,
      test_failed, duration_ms, interest_charged)
    values
      ('20000000-0000-4000-8000-000000000001', ${USER_B}, ${SEASON}, 'resolved',
        '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z', '2026-10-05T10:00:04Z', 'b-1', 3,
        'slip', 1000, 0, -1000, false, false, false, 100, 0),
      ('20000000-0000-4000-8000-000000000002', ${USER_B}, ${SEASON}, 'resolved',
        '2026-10-06T10:00:00Z', '2026-10-06T10:00:00Z', '2026-10-06T10:00:04Z', 'b-2', 0,
        'none', 0, 0, 0, false, false, false, 100, 50)`
  await sql`
    insert into loans (user_id, season_id, amount, interest_per_spin, created_at) values
      (${USER_B}, ${SEASON}, 500, 0.1, '2026-10-05T11:00:00Z')`
  await sql`
    insert into hall_of_ruin (season_id, rank, user_id, net_worth, spins) values
      (${PAST}, 1, ${USER_C}, 3000, 9)`
}

async function countAll(sql: postgres.Sql): Promise<Record<string, number>> {
  const tables = ['users', 'seasons', 'wallets', 'rounds', 'bets', 'turns', 'loans', 'hall_of_ruin']
  const out: Record<string, number> = {}
  for (const table of tables) {
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`
    out[table] = row!.n
  }
  return out
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'vibe-migrations-'))
  const adminUrl = inject('pgAdminUrl')
  const name = `vibe_t_mig_${randomBytes(4).toString('hex')}`
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create database "${name}"`)
  await admin.end()
  url = withDatabase(adminUrl, name)
  await runMigrations({
    url,
    migrationsFolder: await v1MigrationsFolder(),
    connectTimeoutSeconds: 10,
  })
  handle = createDb({ url, poolMax: 10, connectTimeoutSeconds: 10 })
  await seedV1(handle.sql)
})

afterAll(async () => {
  await handle.close(5)
  await rm(workdir, { recursive: true, force: true })
})

describe('migraciones de la v2 sobre datos de la v1', () => {
  let before: Record<string, number>
  let t: TestApp

  it('0001 → 0004 se aplican sin perder ninguna fila ni ningún valor', async () => {
    const sql = handle.sql
    before = await countAll(sql)
    const snapshot = await sql`
      select id, status, result, net, staked, returned, resolved_at, opened_at, interest_charged
      from rounds order by id`
    await runMigrations({ url, migrationsFolder: MIGRATIONS_DIR, connectTimeoutSeconds: 10 })
    // Dos veces: la segunda no hace nada.
    await runMigrations({ url, migrationsFolder: MIGRATIONS_DIR, connectTimeoutSeconds: 10 })

    expect(await countAll(sql)).toEqual(before)
    expect(
      await sql`
        select id, status, result, net, staked, returned, resolved_at, opened_at, interest_charged
        from rounds order by id`,
    ).toEqual(snapshot)
    const applied = await sql<{ n: number }[]>`
      select count(*)::int as n from drizzle.__drizzle_migrations`
    expect(applied[0]!.n).toBe(5)

    // Columnas nuevas vacías en las filas viejas; los idiomas guardados siguen ahí.
    const [cols] = await sql<{ n: number }[]>`
      select count(*)::int as n from rounds
      where deferred_at is not null or spend_request_id is not null or spin_number is not null
        or streak_after is not null or net_worth_after is not null or went_broke is not null`
    expect(cols!.n).toBe(0)
    const locales = await sql<{ login: string; locale: string | null }[]>`
      select login, locale from users order by login`
    expect(locales).toEqual([
      { login: 'deudor', locale: 'en' },
      { login: 'jubilado', locale: null },
      { login: 'veterano', locale: 'es' },
    ])
    const [broke] = await sql<{ n: number }[]>`
      select count(*)::int as n from wallets where broke_at is not null`
    expect(broke!.n).toBe(0)
    // 0004: los usuarios de antes no tienen la fecha de creación de GitHub (se rellena en su
    // próximo login; mientras tanto cuentan como antiguos para el ranking).
    const [dated] = await sql<{ n: number }[]>`
      select count(*)::int as n from users where github_created_at is not null`
    expect(dated!.n).toBe(0)

    // Los checks nuevos están y funcionan.
    await expect(sql`update users set locale = 'xx_YY' where id = ${USER_C}`).rejects.toThrow(
      /users_locale_check/,
    )
    await expect(
      sql`update rounds set status = 'deferred' where id = '10000000-0000-4000-8000-000000000004'`,
    ).rejects.toThrow(/rounds_deferred_check/)
    await expect(
      sql`update rounds set status = 'perdida' where id = '10000000-0000-4000-8000-000000000004'`,
    ).rejects.toThrow(/rounds_status_check/)
  })

  it('el servidor de la v2 trabaja con las filas de la v1', async () => {
    t = await startTestApp({ db: handle })
    try {
      // Estado: la ronda abierta de hace días no se enseña; la última es el pleno de la v1.
      const state = await t.services.game.state(USER_A)
      expect(state.user.locale).toBe('es')
      expect(state.round).toBeNull()
      expect(state.lastRound).toMatchObject({ result: 2, net: 350 })
      expect(state.lastRound?.spectacle).toMatchObject({ tier: 'straight', fire: 'none' })
      expect(state.wallet).toMatchObject({ spins: 3, balance: 1340, pendingSpins: 0 })

      // Reintento de un turn/end de la v1: la misma ronda, sin tirar otra vez.
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/turn/end',
        headers: { authorization: `Bearer ${await t.services.auth.createSession(USER_A, 'mod')}` },
        payload: {
          v: 1,
          turnId: V1_TURN,
          durationMs: 10,
          gitPushOk: false,
          testFailed: false,
          ...MOD_META,
        },
      })
      expect(res.statusCode, res.body).toBe(200)
      const replay = turnEndResponseSchema.parse(res.json())
      expect(replay).toMatchObject({ status: 'resolved', round: { result: 2, net: 350 } })

      // Estadísticas reconstruidas a partir de los netos de la v1.
      const s = await t.services.stats.stats(USER_A)
      expect(s.series).toEqual([
        { spin: 0, netWorth: 1000 },
        { spin: 1, netWorth: 1010 },
        { spin: 2, netWorth: 1000 },
        { spin: 3, netWorth: 1350 },
      ])

      // Dos tiradas de la v2 en la misma temporada: las más recientes van primero en ÚLTIMAS.
      const window = attachWindow(t, USER_A)
      t.rng.fix(5)
      for (const id of ['v2-turn-0001', 'v2-turn-0002']) {
        await beginServiceTurn(t, USER_A, id)
        const r = await t.services.game.turnEnd(USER_A, {
          v: 1,
          turnId: id,
          durationMs: 10,
          gitPushOk: false,
          testFailed: false,
          ...MOD_META,
        })
        expect(r.status).toBe('resolved')
        t.clock.advance(5000)
      }
      window.detach()
      const after = await t.services.stats.stats(USER_A)
      expect(after.spins).toBe(5)
      expect(after.recent.map(r => r.result)).toEqual([5, 5, 2, 2])
      expect(after.series.at(-1)?.spin).toBe(5)

      // Banco del deudor de la v1: el préstamo y los intereses, con la deuda acumulada.
      const bank = await t.services.stats.bank(USER_B)
      expect(bank).toMatchObject({ debt: 550, loans: 1 })
      expect(bank.history.map(e => [e.kind, e.amount, e.debtAfter])).toEqual([
        ['interest', 50, 550],
        ['loan', 500, 500],
      ])
      const marks = await t.services.stats.stats(USER_B)
      expect(marks.loanMarks).toEqual([1])

      // El Salón de la Ruina de la temporada pasada sigue intacto.
      const [hall] = await handle.sql<{ n: number }[]>`
        select count(*)::int as n from hall_of_ruin where season_id = ${PAST}`
      expect(hall!.n).toBe(1)
    } finally {
      await t.app.close()
    }
  })
})
