// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  accrueInterest,
  addToSlip,
  applyLoan,
  betSelectionSchema,
  canRequestLoan,
  chooseRoundBets,
  gameConfigSchema,
  minBet,
  netWorth,
  resolveBets,
  publicGameConfigSchema,
  toPublicGameConfig,
  totalStake,
} from '../src/index.ts'
import type { Bet } from '../src/index.ts'
import { loadTestGameConfig, testGameConfig } from './fixtures.ts'

const red: Bet = { selection: betSelectionSchema.parse({ kind: 'red' }), amount: 10 }
const seventeen: Bet = {
  selection: betSelectionSchema.parse({ kind: 'straight', numbers: [17] }),
  amount: 50,
}

describe('configuración del juego', () => {
  it('el config/game.json del repo es válido y tiene los valores del plan', () => {
    const cfg = loadTestGameConfig()
    expect(cfg.startingBalance).toBe(1000)
    expect(cfg.chips).toEqual([10, 50, 100, 500, 1000])
    expect(cfg.allIn).toBe(true)
    expect(cfg.loan.amount).toBe(1000)
    expect(cfg.jackpot.gitPushMultiplier).toBe(2)
    expect(cfg.season.timeZone).toBe('Europe/Madrid')
    expect(cfg.hallOfRuinSize).toBe(10)
  })

  it('rechaza fichas desordenadas, zonas horarias falsas y la apuesta por defecto bajo mínimos', () => {
    const base = testGameConfig()
    expect(gameConfigSchema.safeParse({ ...base, chips: [50, 10] }).success).toBe(false)
    expect(
      gameConfigSchema.safeParse({ ...base, season: { timeZone: 'Mars/Olympus', startDay: 1 } })
        .success,
    ).toBe(false)
    expect(
      gameConfigSchema.safeParse({ ...base, defaultBet: { ...base.defaultBet, amount: 1 } })
        .success,
    ).toBe(false)
    expect(gameConfigSchema.safeParse({ ...base, extra: true }).success).toBe(false)
  })

  it('la ficha mínima es la primera y la config pública no filtra lo interno', () => {
    const cfg = testGameConfig()
    expect(minBet(cfg)).toBe(10)
    const pub = toPublicGameConfig(cfg)
    expect(pub.chips).toEqual([10, 50, 100])
    expect(pub).not.toHaveProperty('loan.maxDebt')
    expect(pub.minSpinMs).toBe(4000)
    expect(pub.seasonStartDay).toBe(cfg.season.startDay)
    expect(publicGameConfigSchema.parse(pub)).toEqual(pub)
  })
})

describe('préstamo e intereses', () => {
  const cfg = testGameConfig()

  it('solo se ofrece cuando no llega para la ficha mínima', () => {
    expect(canRequestLoan(9, cfg)).toBe(true)
    expect(canRequestLoan(0, cfg)).toBe(true)
    expect(canRequestLoan(-50, cfg)).toBe(true)
    expect(canRequestLoan(10, cfg)).toBe(false)
  })

  it('el banco deja de prestar cuando el préstamo pasaría del tope de deuda', () => {
    expect(canRequestLoan(0, cfg, 999_000)).toBe(true)
    expect(canRequestLoan(0, cfg, 999_001)).toBe(false)
    expect(canRequestLoan(0, cfg, 1_000_000)).toBe(false)
  })

  it('suma el préstamo al saldo y a la deuda; son ilimitados', () => {
    let state = { balance: 0, debt: 0 }
    state = applyLoan(state.balance, state.debt, cfg)
    expect(state).toEqual({ balance: 1000, debt: 1000 })
    state = applyLoan(state.balance, state.debt, cfg)
    expect(state).toEqual({ balance: 2000, debt: 2000 })
  })

  it('la deuda nunca pasa del tope', () => {
    expect(applyLoan(0, 999_500, cfg).debt).toBe(1_000_000)
    expect(accrueInterest(999_999, cfg)).toBe(1_000_000)
  })

  it('el interés crece por tirada y redondea a favor del prestamista', () => {
    expect(accrueInterest(1000, cfg)).toBe(1100)
    expect(accrueInterest(1, cfg)).toBe(2)
    expect(accrueInterest(0, cfg)).toBe(0)
    expect(accrueInterest(-5, cfg)).toBe(0)
  })

  it('el patrimonio neto es saldo − deuda', () => {
    expect(netWorth(500, 2000)).toBe(-1500)
    expect(netWorth(1000, 0)).toBe(1000)
  })
})

describe('boleto y apuestas automáticas', () => {
  const cfg = testGameConfig()

  it('apila fichas en la misma casilla', () => {
    const slip = addToSlip(addToSlip([], red, cfg) ?? [], red, cfg) ?? []
    expect(slip).toHaveLength(1)
    expect(slip[0]?.amount).toBe(20)
    expect(totalStake(slip)).toBe(20)
  })

  it('no deja pasar del máximo de casillas por ronda', () => {
    let slip: Bet[] = []
    for (let n = 1; n <= 5; n++) {
      slip =
        addToSlip(
          slip,
          { selection: betSelectionSchema.parse({ kind: 'straight', numbers: [n] }), amount: 10 },
          cfg,
        ) ?? slip
    }
    expect(slip).toHaveLength(5)
    expect(addToSlip(slip, seventeen, cfg)).toBeNull()
    // Apilar en una casilla que ya está sí se puede.
    expect(addToSlip(slip, { ...slip[0]!, amount: 10 }, cfg)).toHaveLength(5)
  })

  it('juega lo apostado si hay boleto (ya descontado)', () => {
    expect(chooseRoundBets({ slip: [seventeen], lastBets: [red], balance: 0, cfg })).toEqual({
      bets: [seventeen],
      source: 'slip',
      charge: 0,
    })
  })

  it('repite la última apuesta si le llega el saldo', () => {
    expect(chooseRoundBets({ slip: [], lastBets: [seventeen, red], balance: 60, cfg })).toEqual({
      bets: [seventeen, red],
      source: 'repeat',
      charge: 60,
    })
    expect(chooseRoundBets({ slip: [], lastBets: [seventeen, red], balance: 59, cfg })).toEqual({
      bets: [],
      source: 'none',
      charge: 0,
    })
  })

  it('sin apuesta previa juega la de por defecto (10 al rojo) o nada', () => {
    expect(chooseRoundBets({ slip: [], lastBets: null, balance: 500, cfg })).toEqual({
      bets: [{ selection: { kind: 'red' }, amount: 10 }],
      source: 'default',
      charge: 10,
    })
    expect(chooseRoundBets({ slip: [], lastBets: [], balance: 5, cfg }).source).toBe('none')
  })

  it('propiedad: el saldo cuadra tras cualquier secuencia de apuestas y tiradas', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            stake: fc.integer({ min: 1, max: 500 }),
            result: fc.integer({ min: 0, max: 36 }),
            push: fc.boolean(),
          }),
          { maxLength: 60 },
        ),
        rounds => {
          let balance = cfg.startingBalance
          let debt = 0
          let ledger = cfg.startingBalance // entradas − salidas, llevado aparte
          for (const r of rounds) {
            if (canRequestLoan(balance, cfg, debt)) {
              ;({ balance, debt } = applyLoan(balance, debt, cfg))
              ledger += cfg.loan.amount
            }
            const amount = Math.min(r.stake, balance)
            if (amount <= 0) continue
            balance -= amount
            ledger -= amount
            const out = resolveBets(
              [{ selection: red.selection, amount }],
              r.result,
              r.push ? cfg.jackpot.gitPushMultiplier : 1,
            )
            expect(out.returned).toBeGreaterThanOrEqual(0)
            balance += out.returned
            ledger += out.returned
            debt = accrueInterest(debt, cfg)
            expect(balance).toBe(ledger)
            expect(balance).toBeGreaterThanOrEqual(0)
            expect(debt).toBeGreaterThanOrEqual(0)
            expect(netWorth(balance, debt)).toBe(balance - debt)
          }
        },
      ),
    )
  })
})
