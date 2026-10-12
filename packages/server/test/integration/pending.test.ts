// SPDX-License-Identifier: AGPL-3.0-or-later
// Tiradas pendientes contra Postgres real: se guardan con la ventana cerrada u oculta, se juegan
// en directo con una visible, tope y descarte, idempotencia, gastar (una y en modo rápido), ritmo,
// concurrencia, jackpot conservado y caducidad al cerrar la temporada.
import { meResponseSchema, turnEndResponseSchema } from '@vibe-gambling/shared'
import type { ServerMessage, TurnEndResponse } from '@vibe-gambling/shared'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hallOfRuin, rounds, wallets } from '../../src/db/schema.ts'
import { AppError } from '../../src/lib/errors.ts'
import { attachWindow, createUser, MOD_META, START, startTestApp, turnId } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(async () => {
  await t.close()
})

type Headers = Record<string, string>

async function start(headers: Headers, id: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/turn/start',
    headers,
    payload: { v: 1, turnId: id, ...MOD_META },
  })
  expect(res.statusCode, res.body).toBe(200)
}

async function end(
  headers: Headers,
  id = turnId(),
  extra: Partial<{ gitPushOk: boolean; testFailed: boolean }> = {},
  app: TestApp = t,
): Promise<TurnEndResponse> {
  const res = await app.app.inject({
    method: 'POST',
    url: '/api/turn/end',
    headers,
    payload: {
      v: 1,
      turnId: id,
      durationMs: 1500,
      gitPushOk: false,
      testFailed: false,
      ...MOD_META,
      ...extra,
    },
  })
  expect(res.statusCode, res.body).toBe(200)
  return turnEndResponseSchema.parse(res.json())
}

async function bet(headers: Headers, amount: number | 'all-in', target: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/bet',
    headers,
    payload: { v: 1, amount, target },
  })
  expect(res.statusCode, res.body).toBe(200)
}

async function roundsOf(userId: string, app: TestApp = t) {
  return app.db.db.select().from(rounds).where(eq(rounds.userId, userId))
}

let spinSeq = 0
const requestId = () => `spin-${Date.now().toString(36)}-${(spinSeq++).toString(36)}`

/** Espera a que pase la animación de la última tirada (el ritmo lo marca `revealAt`). */
function afterReveal(app: TestApp = t, quick = false): void {
  const cfg = app.config.game
  app.clock.advance(quick ? cfg.pendingSpins.quickSpinMs : cfg.spin.minSpinMs)
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

const types = (messages: readonly ServerMessage[]) => messages.map(m => m.type)

describe('acumular', () => {
  it('sin ninguna ventana conectada el prompt se guarda como tirada pendiente', async () => {
    const { user, bearer } = await createUser(t)
    const id = turnId()
    await start(bearer, id)
    const first = await end(bearer, id)
    expect(first).toMatchObject({ status: 'queued', dropped: false })
    expect(first.wallet).toMatchObject({ pendingSpins: 1, spins: 0, balance: 1000 })
    const second = await end(bearer)
    expect(second.wallet.pendingSpins).toBe(2)

    const list = await roundsOf(user.id)
    expect(list.map(r => r.status)).toEqual(['deferred', 'deferred'])
    expect(list.every(r => r.result === null && r.deferredAt !== null)).toBe(true)
    // No hay ronda abierta: la del turno se cerró sin tirar.
    expect(list.filter(r => r.status === 'open')).toHaveLength(0)

    // /api/me también lo cuenta (y no cuentan como tiradas hasta gastarlas).
    const me = meResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: bearer })).json(),
    )
    expect(me.wallet).toMatchObject({ pendingSpins: 2, spins: 0 })
  })

  it('con todas las ventanas ocultas también se guarda, y las ventanas reciben `pending`', async () => {
    const { user, bearer, window } = await createUser(t, undefined, { window: 'hidden' })
    const id = turnId()
    await start(bearer, id)
    const res = await end(bearer, id)
    expect(res).toMatchObject({ status: 'queued', dropped: false })
    expect(res.wallet.pendingSpins).toBe(1)
    const received = window?.received ?? []
    expect(types(received)).toEqual(['round.started', 'pending'])
    expect(received.at(-1)).toMatchObject({ type: 'pending', event: 'queued' })
    expect(received.some(m => m.type === 'round.resolved')).toBe(false)
    const [row] = await roundsOf(user.id)
    expect(row?.status).toBe('deferred')
  })

  it('un turn/end sin turn/start y sin nadie mirando no anuncia ninguna ronda', async () => {
    const { bearer, window } = await createUser(t, undefined, { window: 'hidden' })
    expect((await end(bearer)).status).toBe('queued')
    expect(types(window?.received ?? [])).toEqual(['pending'])
  })

  it('con una ventana visible se juega en directo; si se oculta, se guarda', async () => {
    const { user, bearer, window } = await createUser(t, undefined, { window: 'visible' })
    t.rng.fix(5)
    const live = await end(bearer)
    expect(live.status).toBe('resolved')
    expect(live.wallet).toMatchObject({ spins: 1, pendingSpins: 0 })

    window?.setVisible(false)
    const hidden = await end(bearer)
    expect(hidden.status).toBe('queued')
    expect(hidden.wallet).toMatchObject({ spins: 1, pendingSpins: 1 })

    // Otra ventana visible basta para volver a jugar en directo.
    const other = attachWindow(t, user.id, true)
    try {
      expect((await end(bearer)).status).toBe('resolved')
    } finally {
      other.detach()
    }
  })

  it('tope: los prompts que pasan de pendingSpins.max se descartan', async () => {
    const { user, bearer } = await createUser(t)
    const max = t.config.game.pendingSpins.max
    for (let i = 0; i < max; i++) expect((await end(bearer)).status).toBe('queued')
    const id = turnId()
    const over = await end(bearer, id)
    expect(over).toMatchObject({ status: 'queued', dropped: true })
    expect(over.wallet.pendingSpins).toBe(max)
    const list = await roundsOf(user.id)
    expect(list.filter(r => r.status === 'deferred')).toHaveLength(max)
    expect(list.filter(r => r.status === 'expired')).toHaveLength(1)
    // Su reintento dice lo mismo, sin guardar nada.
    expect(await end(bearer, id)).toEqual(over)
  })

  it('un turn/end reintentado no guarda dos tiradas, ni antes ni después de gastarla', async () => {
    const { user, bearer } = await createUser(t)
    const id = turnId()
    await start(bearer, id)
    const first = await end(bearer, id)
    const again = await end(bearer, id)
    expect(again).toEqual(first)
    expect(first.wallet.pendingSpins).toBe(1)

    afterReveal()
    await t.services.game.spendPending(user.id, { quick: false, requestId: requestId() })
    const late = await end(bearer, id)
    expect(late).toMatchObject({ status: 'queued', dropped: false })
    expect(late.wallet).toMatchObject({ pendingSpins: 0, spins: 1 })
    expect(await roundsOf(user.id)).toHaveLength(1)
  })

  it('dos sesiones de Claude Code compartiendo ronda: una pendiente, la otra no_round', async () => {
    const { user, bearer } = await createUser(t)
    const second = await t.services.auth.createSession(user.id, 'mod')
    const bearer2 = { authorization: `Bearer ${second}` }
    const a = turnId()
    const b = turnId()
    await start(bearer, a)
    await start(bearer2, b)
    expect((await end(bearer, a)).status).toBe('queued')
    const other = await end(bearer2, b)
    expect(other).toMatchObject({ status: 'no_round' })
    expect(other.wallet.pendingSpins).toBe(1)
  })
})

describe('gastar', () => {
  it('GIRAR tira en ese momento, con el giro normal, y la tirada cuenta al gastarla', async () => {
    const { user, bearer } = await createUser(t)
    await end(bearer)
    await end(bearer)
    afterReveal()
    const window = attachWindow(t, user.id, true)
    try {
      t.rng.fix(1) // rojo: gana la apuesta por defecto
      const spentAt = t.clock.now()
      const spent = await t.services.game.spendPending(user.id, {
        quick: false,
        requestId: requestId(),
      })
      expect(spent.fresh).toBe(true)
      expect(spent.round).toMatchObject({ result: 1, source: 'default', net: 10 })
      expect(spent.round.openedAt).toBe(spentAt.toISOString())
      expect(Date.parse(spent.round.revealAt) - spentAt.getTime()).toBe(
        t.config.game.spin.minSpinMs,
      )
      expect(spent.wallet).toMatchObject({ spins: 1, pendingSpins: 1, balance: 1010 })
      // Las ventanas ven empezar y acabar la tirada, en ese orden, con el contador rebajado.
      // (y detrás, el logro de la primera tirada).
      expect(types(window.received)).toEqual([
        'round.started',
        'round.resolved',
        'achievement.unlocked',
      ])
      expect(window.received[1]).toMatchObject({ wallet: { pendingSpins: 1 } })

      const list = await roundsOf(user.id)
      expect(list.filter(r => r.status === 'resolved')).toHaveLength(1)
      expect(list.filter(r => r.status === 'deferred')).toHaveLength(1)
    } finally {
      window.detach()
    }
  })

  it('en modo rápido (GIRAR TODAS) el giro dura pendingSpins.quickSpinMs', async () => {
    const { user, bearer } = await createUser(t)
    await end(bearer)
    afterReveal()
    const now = t.clock.now().getTime()
    const spent = await t.services.game.spendPending(user.id, {
      quick: true,
      requestId: requestId(),
    })
    expect(Date.parse(spent.round.revealAt) - now).toBe(t.config.game.pendingSpins.quickSpinMs)
  })

  it('ritmo: no se gasta otra hasta que se haya enseñado la anterior', async () => {
    const { user, bearer } = await createUser(t)
    await end(bearer)
    await end(bearer)
    afterReveal()
    const game = t.services.game
    await game.spendPending(user.id, { quick: true, requestId: requestId() })
    expect(await codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() }))).toBe(
      'rate_limited',
    )
    t.clock.advance(t.config.game.pendingSpins.quickSpinMs - 1)
    expect(await codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() }))).toBe(
      'rate_limited',
    )
    t.clock.advance(1)
    expect(await codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() }))).toBe(
      'ok',
    )
    afterReveal(t, true)
    // Ya no quedan.
    expect(await codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() }))).toBe(
      'not_found',
    )
  })

  it('no se gasta mientras gira una ronda en directo (Claude pensando)', async () => {
    const { user, bearer } = await createUser(t)
    await end(bearer)
    afterReveal()
    await start(bearer, turnId())
    expect(
      await codeOf(t.services.game.spendPending(user.id, { quick: false, requestId: requestId() })),
    ).toBe('conflict')
  })

  it('el mismo requestId no tira dos veces', async () => {
    const { user, bearer } = await createUser(t)
    await end(bearer)
    await end(bearer)
    afterReveal()
    const id = requestId()
    const first = await t.services.game.spendPending(user.id, { quick: false, requestId: id })
    afterReveal()
    const again = await t.services.game.spendPending(user.id, { quick: false, requestId: id })
    expect(again.fresh).toBe(false)
    expect(again.round).toEqual(first.round)
    expect(again.wallet).toMatchObject({ spins: 1, pendingSpins: 1 })
  })

  it('el jackpot del git push y los tests fallidos del turno se conservan', async () => {
    const { user, bearer } = await createUser(t)
    await end(bearer, turnId(), { gitPushOk: true, testFailed: true })
    await bet(bearer, 100, '17')
    afterReveal()
    t.rng.fix(17)
    const spent = await t.services.game.spendPending(user.id, {
      quick: false,
      requestId: requestId(),
    })
    const mult = t.config.game.jackpot.gitPushMultiplier
    expect(spent.round).toMatchObject({
      jackpot: true,
      gitPushOk: true,
      testFailed: true,
      source: 'slip',
      returned: 100 + 100 * 35 * mult,
    })
    expect(spent.wallet.balance).toBe(900 + 100 + 100 * 35 * mult)
  })
})

describe('concurrencia', () => {
  it('50 GIRAR simultáneos: una sola tirada', async () => {
    const { user, bearer } = await createUser(t)
    await end(bearer)
    await end(bearer)
    afterReveal()
    const codes = await Promise.all(
      Array.from({ length: 50 }, () =>
        codeOf(t.services.game.spendPending(user.id, { quick: true, requestId: requestId() })),
      ),
    )
    expect(codes.filter(c => c === 'ok')).toHaveLength(1)
    expect(codes.filter(c => c !== 'ok').every(c => c === 'rate_limited')).toBe(true)
    const list = await roundsOf(user.id)
    expect(list.filter(r => r.status === 'resolved')).toHaveLength(1)
    expect(list.filter(r => r.status === 'deferred')).toHaveLength(1)
  })

  it('50 reintentos simultáneos del mismo GIRAR: una sola tirada', async () => {
    const { user, bearer } = await createUser(t)
    await end(bearer)
    await end(bearer)
    afterReveal()
    const id = requestId()
    const all = await Promise.all(
      Array.from({ length: 50 }, () =>
        t.services.game.spendPending(user.id, { quick: true, requestId: id }),
      ),
    )
    expect(all.filter(r => r.fresh)).toHaveLength(1)
    expect(new Set(all.map(r => r.round.roundId)).size).toBe(1)
    expect((await roundsOf(user.id)).filter(r => r.status === 'resolved')).toHaveLength(1)
  })

  it('gastar mientras se apuesta y se pide préstamo: cada moneda está en un solo sitio', async () => {
    const { user, bearer } = await createUser(t)
    const max = t.config.game.pendingSpins.max
    for (let i = 0; i < max; i++) await end(bearer)
    const game = t.services.game
    const loanAmount = t.config.game.loan.amount
    for (let batch = 0; batch < max; batch++) {
      afterReveal(t, true)
      t.rng.fix([2, 0, 17][batch % 3]!)
      await Promise.all([
        ...Array.from({ length: 10 }, () =>
          codeOf(game.spendPending(user.id, { quick: true, requestId: requestId() })),
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          codeOf(game.placeBet(user.id, { kind: i % 2 ? 'red' : 'black' }, 100)),
        ),
        ...Array.from({ length: 3 }, () => codeOf(game.requestLoan(user.id))),
        codeOf(game.clearSlip(user.id)),
      ])
    }
    const [wallet] = await t.db.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, user.id), eq(wallets.seasonId, '2026-10')))
    const list = await roundsOf(user.id)
    const resolved = list.filter(r => r.status === 'resolved')
    expect(resolved).toHaveLength(max)
    expect(list.filter(r => r.status === 'deferred')).toHaveLength(0)
    expect(wallet?.spins).toBe(max)
    const slipTotal = (wallet?.slip ?? []).reduce((acc, b) => acc + b.amount, 0)
    const flow = resolved.reduce((acc, r) => acc + (r.returned ?? 0) - (r.staked ?? 0), 0)
    expect((wallet?.balance ?? 0) + slipTotal).toBe(
      t.config.game.startingBalance + (wallet?.loans ?? 0) * loanAmount + flow,
    )
  })
})

describe('temporadas', () => {
  it('las pendientes caducan al cerrar la temporada, antes del Salón de la Ruina', async () => {
    const own = await startTestApp()
    try {
      const { user, bearer, window } = await createUser(own, 'pending-ruin', {
        window: 'visible',
      })
      own.rng.fix(2) // negro: pierde los 10 de la apuesta por defecto
      expect((await end(bearer, turnId(), {}, own)).status).toBe('resolved')
      window?.setVisible(false)
      expect((await end(bearer, turnId(), {}, own)).wallet.pendingSpins).toBe(1)
      expect((await end(bearer, turnId(), {}, own)).wallet.pendingSpins).toBe(2)

      own.clock.set('2026-10-31T23:00:00Z')
      expect((await own.services.seasons.tick()).closed).toEqual(['2026-10'])

      const list = await roundsOf(user.id, own)
      expect(list.filter(r => r.status === 'deferred')).toHaveLength(0)
      expect(list.filter(r => r.status === 'expired')).toHaveLength(2)
      // El Salón guarda solo lo jugado: una tirada, y el patrimonio sin las pendientes.
      const [hall] = await own.db.db.select().from(hallOfRuin).where(eq(hallOfRuin.userId, user.id))
      expect(hall).toMatchObject({ spins: 1, netWorth: 990 })
      // La temporada nueva empieza sin pendientes, y ya no hay nada que gastar.
      const me = meResponseSchema.parse(
        (await own.app.inject({ method: 'GET', url: '/api/me', headers: bearer })).json(),
      )
      expect(me.wallet).toMatchObject({ seasonId: '2026-11', pendingSpins: 0 })
      expect(
        await codeOf(
          own.services.game.spendPending(user.id, { quick: false, requestId: requestId() }),
        ),
      ).toBe('not_found')
      // La ventana se entera del cambio con el contador a cero.
      expect(window?.received.at(-1)).toMatchObject({
        type: 'season.changed',
        wallet: { pendingSpins: 0 },
      })
    } finally {
      await own.close()
    }
  })

  it('una pendiente de la temporada pasada no se gasta aunque el job aún no la haya cerrado', async () => {
    const own = await startTestApp()
    try {
      const { user, bearer } = await createUser(own)
      await end(bearer, turnId(), {}, own)
      own.clock.set('2026-11-01T00:30:00+01:00')
      expect(
        await codeOf(
          own.services.game.spendPending(user.id, { quick: false, requestId: requestId() }),
        ),
      ).toBe('not_found')
    } finally {
      own.clock.set(START)
      await own.close()
    }
  })
})
