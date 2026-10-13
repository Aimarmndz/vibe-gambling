// SPDX-License-Identifier: AGPL-3.0-or-later
// Turnos: idempotencia, ronda compartida entre sesiones, caducidad, duración mínima del turno,
// apuestas automáticas, jackpot del `git push`, intereses y tiempo mínimo de giro.
import { turnEndResponseSchema, turnStartResponseSchema } from '@vibe-gambling/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { rounds, turns } from '../../src/db/schema.ts'
import {
  afterBall,
  beginTurn,
  createUser,
  createWatchingUser,
  MOD_META,
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

async function start(headers: Record<string, string>, id: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/turn/start',
    headers,
    payload: { v: 1, turnId: id, ...MOD_META },
  })
  expect(res.statusCode, res.body).toBe(200)
  return turnStartResponseSchema.parse(res.json())
}

/**
 * Termina un turno como el mod: con su `turn/start` (no hace nada si ya se mandó) y pasada la
 * duración mínima del turno. Los tests de la duración mínima usan `rawEnd`.
 */
async function end(
  headers: Record<string, string>,
  id: string,
  extra: Partial<{ gitPushOk: boolean; testFailed: boolean; durationMs: number }> = {},
) {
  await beginTurn(t, headers, id)
  return rawEnd(headers, id, extra)
}

/** Solo el `turn/end`, sin `turn/start` ni esperar nada. */
async function rawEnd(
  headers: Record<string, string>,
  id: string,
  extra: Partial<{ gitPushOk: boolean; testFailed: boolean; durationMs: number }> = {},
) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/turn/end',
    headers,
    payload: {
      v: 1,
      turnId: id,
      durationMs: 1000,
      gitPushOk: false,
      testFailed: false,
      ...MOD_META,
      ...extra,
    },
  })
  expect(res.statusCode, res.body).toBe(200)
  return turnEndResponseSchema.parse(res.json())
}

async function bet(headers: Record<string, string>, amount: number | 'all-in', target: string) {
  return t.app.inject({
    method: 'POST',
    url: '/api/bet',
    headers,
    payload: { v: 1, amount, target },
  })
}

describe('turnos', () => {
  it('turn/start y turn/end son idempotentes por (usuario, turnId)', async () => {
    const { user, bearer } = await createWatchingUser(t)
    const id = turnId()
    const a = await start(bearer, id)
    const b = await start(bearer, id)
    expect(b.round).toEqual(a.round)
    expect(a.reused).toBe(false)
    // Tiene la ventana abierta (y visible): la tirada se juega en directo.
    expect(a.windowConnected).toBe(true)

    t.rng.fix(17)
    const first = await end(bearer, id)
    const again = await end(bearer, id)
    expect(first.status).toBe('resolved')
    expect(again).toEqual(first)

    const all = await t.db.db.select().from(rounds).where(eq(rounds.userId, user.id))
    expect(all).toHaveLength(1)
    expect(first.status === 'resolved' && first.wallet.spins).toBe(1)
  })

  it('dos sesiones de Claude Code a la vez comparten la ronda abierta', async () => {
    const { user, bearer } = await createWatchingUser(t)
    const second = await t.services.auth.createSession(user.id, 'mod')
    const bearer2 = { authorization: `Bearer ${second}` }
    const idA = turnId()
    const idB = turnId()
    const a = await start(bearer, idA)
    const b = await start(bearer2, idB)
    expect(b.reused).toBe(true)
    expect(b.round.roundId).toBe(a.round.roundId)

    const endA = await end(bearer, idA)
    expect(endA.status).toBe('resolved')
    // El otro turno ya no tiene ronda: la resolvió la otra sesión.
    const endB = await end(bearer2, idB)
    expect(endB.status).toBe('no_round')
    expect(endB.wallet.spins).toBe(1)
  })

  it('una ronda abierta más de round.staleAfterMs caduca sin tirada', async () => {
    const { user, bearer } = await createWatchingUser(t)
    const id = turnId()
    const opened = await start(bearer, id)
    t.clock.advance(t.config.game.round.staleAfterMs + 1)
    try {
      const res = await end(bearer, id)
      expect(res.status).toBe('no_round')
      expect(res.wallet.spins).toBe(0)
      const [row] = await t.db.db.select().from(rounds).where(eq(rounds.id, opened.round.roundId))
      expect(row?.status).toBe('expired')
      // Un turno nuevo abre otra ronda (la caducada no se reutiliza).
      const next = await start(bearer, turnId())
      expect(next.round.roundId).not.toBe(opened.round.roundId)
      expect(next.reused).toBe(false)
      const open = await t.db.db.select().from(rounds).where(eq(rounds.userId, user.id))
      expect(open.filter(r => r.status === 'open')).toHaveLength(1)
    } finally {
      t.clock.set('2026-10-15T12:00:00Z')
    }
  })

  it('turn/end sin turn/start no es una tirada: no hay duración que medir', async () => {
    // El mod nunca lo manda (si su `turn/start` falla, no hay `turn/end`): solo un script.
    const { user, bearer, window } = await createWatchingUser(t)
    const id = turnId()
    const res = await rawEnd(bearer, id, { durationMs: 60_000 })
    expect(res).toMatchObject({ status: 'no_round', wallet: { spins: 0, pendingSpins: 0 } })
    // Ni ronda, ni turno, ni nada para la ventana; y el reintento dice lo mismo.
    expect(await t.db.db.select().from(rounds).where(eq(rounds.userId, user.id))).toHaveLength(0)
    expect(await t.db.db.select().from(turns).where(eq(turns.userId, user.id))).toHaveLength(0)
    expect(window?.received).toEqual([])
    expect(await rawEnd(bearer, id)).toEqual(res)
  })

  it('revealAt respeta el giro mínimo y la caída: max(openedAt + minSpinMs, resolvedAt + landingMs)', async () => {
    const { bearer } = await createWatchingUser(t)
    const quick = turnId()
    await start(bearer, quick)
    t.clock.advance(1000)
    const fast = await end(bearer, quick)
    if (fast.status !== 'resolved') throw new Error('debía resolverse')
    expect(Date.parse(fast.round.revealAt) - Date.parse(fast.round.openedAt)).toBe(
      t.config.game.spin.minSpinMs,
    )

    const slow = turnId()
    await start(bearer, slow)
    t.clock.advance(t.config.game.spin.minSpinMs * 3)
    const late = await end(bearer, slow)
    if (late.status !== 'resolved') throw new Error('debía resolverse')
    // Claude tardó más que el giro: el resultado no se enseña hasta que la bola termina de caer
    // (si no, el toast del mod lo destriparía mientras la ventana aún lo está animando).
    expect(Date.parse(late.round.revealAt) - Date.parse(late.round.resolvedAt)).toBe(
      t.config.game.spin.landingMs,
    )
  })

  it('duración mínima: justo por debajo no hay tirada (ni pendiente); justo en el mínimo, sí', async () => {
    const min = t.config.game.turn.minDurationMs
    const { user, bearer, window } = await createWatchingUser(t)
    const warn = vi.spyOn(t.app.log, 'warn')
    try {
      const short = turnId()
      const opened = await start(bearer, short)
      t.clock.advance(min - 1)
      // El `durationMs` del cliente no cuenta: el servidor mide con su reloj.
      const res = await rawEnd(bearer, short, { durationMs: 60_000 })
      expect(res).toMatchObject({ status: 'no_round', wallet: { spins: 0, pendingSpins: 0 } })
      // La ronda se cierra sin tirar y la ventana deja de verla girar.
      const [row] = await t.db.db.select().from(rounds).where(eq(rounds.id, opened.round.roundId))
      expect(row).toMatchObject({ status: 'expired', result: null, deferredAt: null })
      expect(window?.received.map(m => m.type)).toEqual(['round.started', 'round.expired'])
      // En el log: el hecho y la duración, sin datos personales.
      expect(warn).toHaveBeenCalledTimes(1)
      const [fields] = warn.mock.calls[0] as unknown as [Record<string, unknown>]
      expect(fields).toEqual({ event: 'turn_too_short', elapsedMs: min - 1, minDurationMs: min })
      // El reintento responde lo mismo, sin tirar.
      t.clock.advance(min)
      expect(await rawEnd(bearer, short)).toEqual(res)

      const exact = turnId()
      await start(bearer, exact)
      t.clock.advance(min)
      expect((await rawEnd(bearer, exact)).status).toBe('resolved')
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
    const all = await t.db.db.select().from(rounds).where(eq(rounds.userId, user.id))
    expect(all.map(r => r.status).sort()).toEqual(['expired', 'resolved'])
  })

  it('duración mínima sin ventana: un turno corto no se guarda como pendiente', async () => {
    const { bearer } = await createUser(t)
    const id = turnId()
    await start(bearer, id)
    t.clock.advance(t.config.game.turn.minDurationMs - 1)
    expect(await rawEnd(bearer, id)).toMatchObject({
      status: 'no_round',
      wallet: { pendingSpins: 0, spins: 0 },
    })
  })

  it('un turno corto no cierra la ronda que comparte con otro turno aún abierto', async () => {
    const { bearer } = await createWatchingUser(t)
    const long = turnId()
    const short = turnId()
    const a = await start(bearer, long)
    t.clock.advance(t.config.game.turn.minDurationMs)
    await start(bearer, short)
    expect((await rawEnd(bearer, short)).status).toBe('no_round')
    // La ronda sigue abierta para el otro turno, que ya pasó el mínimo y la tira.
    const res = await rawEnd(bearer, long)
    if (res.status !== 'resolved') throw new Error('debía resolverse')
    expect(res.round.roundId).toBe(a.round.roundId)
  })

  it('sin boleto: primero la apuesta por defecto, luego se repite la última', async () => {
    const { bearer } = await createWatchingUser(t)
    t.rng.fix(1) // rojo
    const first = await end(bearer, turnId())
    if (first.status !== 'resolved') throw new Error('debía resolverse')
    expect(first.round.source).toBe('default')
    expect(first.round.bets).toEqual([
      { selection: { kind: 'red' }, amount: 10, won: true, payout: 20 },
    ])
    expect(first.wallet.balance).toBe(1010)

    // Apuesta propia de 50 al negro; luego otra ronda sin apostar repite esa (cada una cuando
    // ya ha caído la bola de la anterior: si no, se guardaría como pendiente).
    expect((await bet(bearer, 50, 'negro')).statusCode).toBe(200)
    afterBall(t)
    t.rng.fix(1)
    const own = await end(bearer, turnId())
    if (own.status !== 'resolved') throw new Error('debía resolverse')
    expect(own.round.source).toBe('slip')
    expect(own.wallet.balance).toBe(960)

    afterBall(t)
    t.rng.fix(2) // negro
    const repeat = await end(bearer, turnId())
    if (repeat.status !== 'resolved') throw new Error('debía resolverse')
    expect(repeat.round.source).toBe('repeat')
    expect(repeat.round.staked).toBe(50)
    expect(repeat.wallet.balance).toBe(1010)
    expect(repeat.wallet.currentStreak).toBe(1)
  })

  it('sin saldo para repetir, la ruleta gira sin apuesta', async () => {
    const { bearer } = await createWatchingUser(t)
    expect((await bet(bearer, 'all-in', 'red')).statusCode).toBe(200)
    t.rng.fix(2) // negro: lo pierde todo
    const lost = await end(bearer, turnId())
    expect(lost.wallet.balance).toBe(0)
    afterBall(t)
    const none = await end(bearer, turnId())
    if (none.status !== 'resolved') throw new Error('debía resolverse')
    expect(none.round.source).toBe('none')
    expect(none.round.bets).toEqual([])
    expect(none.wallet.spins).toBe(2)
    // Una ronda sin apuesta no rompe la racha.
    expect(none.wallet.currentStreak).toBe(lost.wallet.currentStreak)
  })

  it('jackpot dev: con git push la ganancia se multiplica', async () => {
    const { bearer } = await createWatchingUser(t)
    expect((await bet(bearer, 100, '17')).statusCode).toBe(200)
    t.rng.fix(17)
    const res = await end(bearer, turnId(), { gitPushOk: true })
    if (res.status !== 'resolved') throw new Error('debía resolverse')
    const mult = t.config.game.jackpot.gitPushMultiplier
    expect(res.round.jackpot).toBe(true)
    expect(res.round.gitPushOk).toBe(true)
    expect(res.round.returned).toBe(100 + 100 * 35 * mult)
    expect(res.wallet.balance).toBe(900 + 100 + 100 * 35 * mult)
  })

  it('el git push no da jackpot si se pierde', async () => {
    const { bearer } = await createWatchingUser(t)
    expect((await bet(bearer, 100, '17')).statusCode).toBe(200)
    t.rng.fix(18)
    const res = await end(bearer, turnId(), { gitPushOk: true })
    if (res.status !== 'resolved') throw new Error('debía resolverse')
    expect(res.round.jackpot).toBe(false)
    expect(res.round.testFailed).toBe(false)
  })

  it('la racha de color se calcula sobre las tiradas del usuario', async () => {
    const { bearer } = await createWatchingUser(t)
    for (const n of [1, 3, 5]) {
      afterBall(t)
      t.rng.fix(n)
      const res = await end(bearer, turnId())
      if (res.status !== 'resolved') throw new Error('debía resolverse')
      expect(res.round.colorStreak?.color).toBe('red')
    }
    afterBall(t)
    t.rng.fix(7)
    const res = await end(bearer, turnId())
    if (res.status !== 'resolved') throw new Error('debía resolverse')
    expect(res.round.colorStreak).toEqual({ color: 'red', count: 4 })
  })

  it('rechaza turnos sin sesión o con una sesión web', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/turn/start',
      payload: { v: 1, turnId: turnId(), ...MOD_META },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ v: 1, error: 'unauthorized' })

    const { user } = await createWatchingUser(t)
    const web = await t.services.auth.createSession(user.id, 'web')
    const asBearer = await t.app.inject({
      method: 'POST',
      url: '/api/turn/start',
      headers: { authorization: `Bearer ${web}` },
      payload: { v: 1, turnId: turnId(), ...MOD_META },
    })
    expect(asBearer.statusCode).toBe(403)
  })

  it('rechaza campos de más en turn/end (privacidad)', async () => {
    const { bearer } = await createWatchingUser(t)
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/turn/end',
      headers: bearer,
      payload: {
        v: 1,
        turnId: turnId(),
        durationMs: 1,
        gitPushOk: false,
        testFailed: false,
        ...MOD_META,
        prompt: 'mi código secreto',
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ v: 1, error: 'invalid_request' })
  })
})
