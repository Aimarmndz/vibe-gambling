// SPDX-License-Identifier: AGPL-3.0-or-later
// Tope diario de tiradas contra Postgres real: la tirada del tope sí y la siguiente no, en directo
// y gastando pendientes; la mesa reabre a las 00:00 de la zona horaria de la temporada (también
// el día del cambio de hora); idempotencia y concurrencia en el borde.
import { dayAt, seasonAt, turnEndResponseSchema } from '@vibe-gambling/shared'
import type { TurnEndResponse } from '@vibe-gambling/shared'
import { and, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { rounds } from '../../src/db/schema.ts'
import { AppError } from '../../src/lib/errors.ts'
import { ensureSeason } from '../../src/services/game.ts'
import {
  afterBall,
  beginTurn,
  createUser,
  MOD_META,
  START,
  startTestApp,
  turnId,
} from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(async () => {
  await t.close()
})

type Headers = Record<string, string>

/** Un prompt como lo manda el mod: `turn/start`, la duración mínima y `turn/end`. */
async function end(headers: Headers, id = turnId()): Promise<TurnEndResponse> {
  await beginTurn(t, headers, id)
  return rawEnd(headers, id)
}

async function rawEnd(headers: Headers, id: string): Promise<TurnEndResponse> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/turn/end',
    headers,
    payload: { v: 1, turnId: id, durationMs: 1, gitPushOk: false, testFailed: false, ...MOD_META },
  })
  expect(res.statusCode, res.body).toBe(200)
  return turnEndResponseSchema.parse(res.json())
}

/**
 * Mete de golpe `n` tiradas ya jugadas en `at` (más rápido que jugarlas una a una: el tope por
 * defecto son miles). Solo cuenta lo que mira el tope: ronda resuelta y cuándo.
 */
async function seed(userId: string, n: number, at: Date): Promise<void> {
  const season = seasonAt(at, t.config.game.season.timeZone, t.config.game.season.startDay)
  await ensureSeason(t.db.db, season)
  const rows = Array.from({ length: n }, () => ({
    userId,
    seasonId: season.id,
    status: 'resolved' as const,
    openedAt: at,
    resolvedAt: at,
    revealAt: at,
    result: 1,
    source: 'none' as const,
    staked: 0,
    returned: 0,
    net: 0,
  }))
  for (let i = 0; i < rows.length; i += 1000) {
    await t.db.db.insert(rounds).values(rows.slice(i, i + 1000))
  }
}

async function spinsToday(userId: string): Promise<number> {
  const [row] = await t.db.db
    .select({ n: count() })
    .from(rounds)
    .where(and(eq(rounds.userId, userId), eq(rounds.status, 'resolved')))
  return row?.n ?? 0
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error.code
    throw error
  }
  return 'ok'
}

let seq = 0
const requestId = () => `daily-${(seq++).toString(36)}`

/** Medianoche siguiente en la zona de la temporada (cuando reabre la mesa). */
const reopensAt = (now: Date) => dayAt(now, t.config.game.season.timeZone).endsAt

describe('tope diario', () => {
  it('la tirada número dailySpinLimit sí; la siguiente no tira ni se guarda', async () => {
    t.clock.set(START)
    const limit = t.config.game.dailySpinLimit
    const { user, bearer, window } = await createUser(t, undefined, { window: 'visible' })
    if (!window) throw new Error('sin ventana')
    await seed(user.id, limit - 1, new Date(Date.parse(START) - 60_000))

    const last = await end(bearer)
    expect(last.status).toBe('resolved')
    expect(await spinsToday(user.id)).toBe(limit)
    afterBall(t)

    window.received.length = 0
    const id = turnId()
    const over = await end(bearer, id)
    // 12:00 UTC del 15 de octubre = 14:00 en Madrid: reabre a las 00:00 del 16 (22:00 UTC).
    expect(over).toMatchObject({ status: 'daily_limit', reopensAt: '2026-10-15T22:00:00.000Z' })
    expect(over.wallet).toMatchObject({ pendingSpins: 0 })
    expect(await spinsToday(user.id)).toBe(limit)
    // La ventana vio empezar la ronda (turn/start) y recibe el aviso, que también la cierra.
    expect(window.received.map(m => m.type)).toEqual(['round.started', 'daily_limit'])
    expect(window.received[1]).toMatchObject({ reopensAt: '2026-10-15T22:00:00.000Z' })
    const open = await t.db.db
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, user.id), eq(rounds.status, 'open')))
    expect(open).toHaveLength(0)
    // El reintento dice lo mismo, sin volver a avisar a la ventana.
    expect(await rawEnd(bearer, id)).toEqual(over)
    expect(window.received).toHaveLength(2)

    // Sin ventana visible tampoco se guarda como pendiente.
    window.setVisible(false)
    expect(await end(bearer)).toMatchObject({ status: 'daily_limit', wallet: { pendingSpins: 0 } })
  })

  it('las pendientes gastadas cuentan, y GIRAR se rechaza con daily_limit', async () => {
    t.clock.set(START)
    const limit = t.config.game.dailySpinLimit
    const { user, bearer, window } = await createUser(t, undefined, { window: 'hidden' })
    if (!window) throw new Error('sin ventana')
    expect((await end(bearer)).status).toBe('queued')
    expect((await end(bearer)).status).toBe('queued')
    await seed(user.id, limit - 1, new Date(Date.parse(START) - 60_000))
    const game = t.services.game
    afterBall(t)
    expect(await codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() }))).toBe(
      'ok',
    )
    afterBall(t)
    window.received.length = 0
    expect(await codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() }))).toBe(
      'daily_limit',
    )
    expect(window.received.map(m => m.type)).toEqual(['daily_limit'])
    expect(window.received[0]).toMatchObject({ wallet: { pendingSpins: 1 } })
    expect(await spinsToday(user.id)).toBe(limit)
    // La pendiente sigue ahí para mañana.
    t.clock.set(reopensAt(t.clock.now()))
    expect(await codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() }))).toBe(
      'ok',
    )
  })

  it('reabre a las 00:00 de Madrid, también el día del cambio de hora (25 h)', async () => {
    const limit = t.config.game.dailySpinLimit
    const { user, bearer } = await createUser(t, undefined, { window: 'visible' })
    // 25 de octubre de 2026: a las 03:00 (CEST) vuelve a ser las 02:00 (CET). El día dura 25 h:
    // de 2026-10-24T22:00Z a 2026-10-25T23:00Z.
    const dayStart = new Date('2026-10-24T22:00:00.000Z')
    const dayEnd = new Date('2026-10-25T23:00:00.000Z')
    expect(dayAt(new Date('2026-10-25T12:00:00Z'), 'Europe/Madrid')).toEqual({
      startsAt: dayStart,
      endsAt: dayEnd,
    })
    // Lo del día anterior (23:59 del 24 en Madrid) no cuenta.
    await seed(user.id, 5, new Date(dayStart.getTime() - 60_000))
    await seed(user.id, limit, dayStart)

    // 23:30 del 25 en Madrid (ya en CET) = 22:30 UTC: cerrada hasta las 00:00 del 26 (23:00 UTC).
    t.clock.set('2026-10-25T22:30:00.000Z')
    expect(await end(bearer)).toMatchObject({
      status: 'daily_limit',
      reopensAt: dayEnd.toISOString(),
    })
    // Dos sesiones comparten la ronda: la que termina 1 ms antes de medianoche sigue cerrada (y
    // deja la ronda abierta para la otra)…
    const id = turnId()
    const next = turnId()
    t.clock.set(new Date(dayEnd.getTime() - 60_000))
    await t.services.game.turnStart(user.id, id)
    await t.services.game.turnStart(user.id, next)
    t.clock.set(new Date(dayEnd.getTime() - 1))
    expect((await rawEnd(bearer, id)).status).toBe('daily_limit')
    // …y la que termina a las 00:00 en punto ya tira.
    t.clock.set(dayEnd)
    expect((await rawEnd(bearer, next)).status).toBe('resolved')
    t.clock.set(START)
  })

  it('en el borde, turnos y GIRAR a la vez: nunca pasa del tope', async () => {
    t.clock.set(START)
    const limit = t.config.game.dailySpinLimit
    const { user, bearer, window } = await createUser(t, undefined, { window: 'hidden' })
    if (!window) throw new Error('sin ventana')
    for (let i = 0; i < 3; i++) expect((await end(bearer)).status).toBe('queued')
    await seed(user.id, limit - 1, new Date(Date.parse(START) - 60_000))
    window.setVisible(true)
    afterBall(t)
    const ids = Array.from({ length: 5 }, () => turnId())
    await Promise.all(ids.map(id => t.services.game.turnStart(user.id, id)))
    t.clock.advance(t.config.game.turn.minDurationMs)
    const game = t.services.game
    const [turnsDone, spends] = await Promise.all([
      Promise.all(ids.map(id => rawEnd(bearer, id))),
      Promise.all(
        Array.from({ length: 5 }, () =>
          codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() })),
        ),
      ),
    ])
    const spun =
      turnsDone.filter(r => r.status === 'resolved').length + spends.filter(c => c === 'ok').length
    expect(spun).toBe(1)
    expect(await spinsToday(user.id)).toBe(limit)
    // Pasada la bola, ya no queda nada que tirar hoy.
    afterBall(t)
    expect((await end(bearer)).status).toBe('daily_limit')
    expect(await codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() }))).toBe(
      'daily_limit',
    )
  })
})
