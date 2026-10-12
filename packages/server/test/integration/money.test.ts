// SPDX-License-Identifier: AGPL-3.0-or-later
// Dinero: boleto, all-in, límites, préstamo, intereses y, sobre todo, concurrencia.
import { betResponseSchema, totalStake } from '@vibe-gambling/shared'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loans, wallets } from '../../src/db/schema.ts'
import { AppError } from '../../src/lib/errors.ts'
import { createUser, createWatchingUser, MOD_META, startTestApp, turnId } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(async () => {
  await t.close()
})

function bet(headers: Record<string, string>, amount: number | 'all-in', target: string) {
  return t.app.inject({
    method: 'POST',
    url: '/api/bet',
    headers,
    payload: { v: 1, amount, target },
  })
}

async function walletRow(userId: string) {
  const [row] = await t.db.db
    .select()
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, '2026-10')))
  if (!row) throw new Error('sin cartera')
  return row
}

describe('boleto', () => {
  it('descuenta del saldo, apila fichas en la misma casilla y dice para qué ronda es', async () => {
    const { bearer } = await createUser(t)
    const a = betResponseSchema.parse((await bet(bearer, 50, 'rojo')).json())
    expect(a.forRound).toBe('next')
    expect(a.wallet.balance).toBe(950)
    await t.app.inject({
      method: 'POST',
      url: '/api/turn/start',
      headers: bearer,
      payload: { v: 1, turnId: turnId(), ...MOD_META },
    })
    const b = betResponseSchema.parse((await bet(bearer, 10, 'red')).json())
    expect(b.forRound).toBe('current')
    expect(b.slip).toEqual({ bets: [{ selection: { kind: 'red' }, amount: 60 }], total: 60 })
  })

  it('valida la casilla, el mínimo, el saldo y el máximo de casillas', async () => {
    const { bearer } = await createUser(t)
    expect((await bet(bearer, 10, 'banana')).json()).toMatchObject({ error: 'invalid_bet' })
    expect((await bet(bearer, 5, 'red')).json()).toMatchObject({ error: 'invalid_bet' })
    expect((await bet(bearer, 5000, 'red')).json()).toMatchObject({ error: 'insufficient_funds' })
    const max = t.config.game.maxBetsPerRound
    for (let n = 1; n <= max; n++) expect((await bet(bearer, 10, String(n))).statusCode).toBe(200)
    const over = await bet(bearer, 10, String(max + 1))
    expect(over.statusCode).toBe(422)
    expect(over.json()).toMatchObject({ v: 1, error: 'too_many_bets' })
  })

  it('all-in apuesta todo el saldo disponible y luego no queda nada', async () => {
    const { user, bearer } = await createUser(t)
    const res = betResponseSchema.parse((await bet(bearer, 'all-in', '1st12')).json())
    expect(res.slip.total).toBe(1000)
    expect(res.wallet.balance).toBe(0)
    expect((await bet(bearer, 'all-in', 'red')).json()).toMatchObject({
      error: 'insufficient_funds',
    })
    const cleared = await t.services.game.clearSlip(user.id)
    expect(cleared.wallet.balance).toBe(1000)
    expect(cleared.slip.total).toBe(0)
  })
})

describe('concurrencia', () => {
  it('100 apuestas simultáneas: el saldo nunca queda inconsistente', async () => {
    const { user, bearer } = await createUser(t)
    // 150 apuestas de 10 con 1000 de saldo: exactamente 100 entran y 50 se rechazan.
    const results = await Promise.all(Array.from({ length: 150 }, () => bet(bearer, 10, 'black')))
    const ok = results.filter(r => r.statusCode === 200)
    const rejected = results.filter(r => r.statusCode !== 200)
    expect(ok).toHaveLength(100)
    expect(rejected.every(r => r.json().error === 'insufficient_funds')).toBe(true)
    const row = await walletRow(user.id)
    expect(row.balance).toBe(0)
    expect(totalStake(row.slip)).toBe(1000)
  })

  it('apuestas, retiradas y préstamos mezclados conservan saldo + boleto − préstamos', async () => {
    const { user } = await createUser(t)
    const ops = Array.from({ length: 100 }, (_, i) => {
      if (i % 10 === 0) return t.services.game.clearSlip(user.id)
      if (i % 25 === 0) return t.services.game.requestLoan(user.id).catch(() => null)
      return t.services.game.placeBet(user.id, { kind: 'odd' }, 50).catch((e: unknown) => {
        if (!(e instanceof AppError)) throw e
        return null
      })
    })
    await Promise.all(ops)
    const row = await walletRow(user.id)
    const granted = await t.db.db.select().from(loans).where(eq(loans.userId, user.id))
    expect(row.balance).toBeGreaterThanOrEqual(0)
    expect(row.balance + totalStake(row.slip)).toBe(
      1000 + granted.length * t.config.game.loan.amount,
    )
    expect(row.debt).toBe(granted.length * t.config.game.loan.amount)
  })

  it('turn/end y apuestas a la vez: cada moneda está en un solo sitio', async () => {
    const { user, bearer } = await createWatchingUser(t)
    t.rng.fix(0)
    const jobs: Array<Promise<unknown>> = []
    for (let i = 0; i < 20; i++) {
      jobs.push(bet(bearer, 10, 'red'))
      jobs.push(
        t.app.inject({
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
          },
        }),
      )
    }
    await Promise.all(jobs)
    // Con el 0 todas las apuestas al rojo pierden: lo que no esté en el boleto se ha perdido.
    const row = await walletRow(user.id)
    expect(row.spins).toBe(20)
    expect(row.balance).toBeGreaterThanOrEqual(0)
    expect(row.balance + totalStake(row.slip)).toBeLessThanOrEqual(1000)
  })
})

describe('préstamo', () => {
  it('solo se concede cuando el saldo (contando el boleto) no llega a la ficha mínima', async () => {
    const { user, bearer } = await createWatchingUser(t)
    await expect(t.services.game.requestLoan(user.id)).rejects.toMatchObject({
      code: 'loan_not_allowed',
    })
    // Apostarlo todo no basta: las fichas del boleto cuentan.
    await bet(bearer, 'all-in', 'red')
    await expect(t.services.game.requestLoan(user.id)).rejects.toMatchObject({
      code: 'loan_not_allowed',
    })
    t.rng.fix(2)
    await t.app.inject({
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
      },
    })
    const loan = await t.services.game.requestLoan(user.id)
    expect(loan.amount).toBe(t.config.game.loan.amount)
    expect(loan.wallet).toMatchObject({ balance: 500, debt: 500, netWorth: 0, loans: 1 })
  })

  it('la deuda crece con cada tirada (redondeando a favor del banco)', async () => {
    const { user, bearer } = await createWatchingUser(t)
    await bet(bearer, 'all-in', 'red')
    t.rng.fix(2)
    const end = () =>
      t.app.inject({
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
        },
      })
    await end()
    await t.services.game.requestLoan(user.id)
    const res = (await end()).json()
    // 10 % por tirada en la configuración de test: 500 → 550.
    expect(res.round.interestCharged).toBe(50)
    expect(res.wallet.debt).toBe(550)
  })
})
