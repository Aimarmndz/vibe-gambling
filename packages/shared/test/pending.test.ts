// SPDX-License-Identifier: AGPL-3.0-or-later
// Tiradas pendientes: tope, premio gordo y cuándo se para GIRAR TODAS. Y su configuración y
// protocolo (mensajes nuevos, compatibles con la versión 1).
import { describe, expect, it } from 'vitest'

import {
  clientMessageSchema,
  gameConfigSchema,
  isBigWin,
  PROTOCOL_VERSION,
  queueOutcome,
  serverMessageSchema,
  spinAllStopReason,
  toPublicGameConfig,
  turnEndResponseSchema,
  walletSchema,
} from '../src/index.ts'
import type { StopRound, Wallet } from '../src/index.ts'
import { testGameConfig } from './fixtures.ts'

const rules = { chips: [10, 50, 100], bigWin: { minNetMultiple: 5 } }

function round(overrides: Partial<StopRound> = {}): StopRound {
  return {
    result: 7,
    net: -10,
    staked: 10,
    jackpot: false,
    source: 'repeat',
    bets: [{ won: false, selection: { kind: 'black' } }],
    ...overrides,
  }
}

const wallet: Wallet = {
  seasonId: '2026-10',
  balance: 500,
  debt: 0,
  netWorth: 500,
  spins: 3,
  loans: 0,
  currentStreak: 0,
  bestStreak: 0,
  pendingSpins: 7,
}

describe('tope de tiradas pendientes', () => {
  it('guarda hasta el tope y descarta a partir de ahí', () => {
    expect(queueOutcome(0, { max: 3 })).toBe('queued')
    expect(queueOutcome(2, { max: 3 })).toBe('queued')
    expect(queueOutcome(3, { max: 3 })).toBe('dropped')
    expect(queueOutcome(40, { max: 3 })).toBe('dropped')
  })
})

describe('premio gordo', () => {
  it('no hay premio gordo sin ganar', () => {
    expect(isBigWin(round({ net: 0, jackpot: true }), rules)).toBe(false)
    expect(isBigWin(round({ net: -50 }), rules)).toBe(false)
  })

  it('jackpot del git push, pleno o neto ≥ minNetMultiple × lo apostado', () => {
    expect(isBigWin(round({ net: 10, jackpot: true }), rules)).toBe(true)
    expect(
      isBigWin(
        round({ net: 350, staked: 10, bets: [{ won: true, selection: { kind: 'straight' } }] }),
        rules,
      ),
    ).toBe(true)
    expect(isBigWin(round({ net: 50, staked: 10 }), rules)).toBe(true)
    expect(isBigWin(round({ net: 49, staked: 10 }), rules)).toBe(false)
    // Rojo a la par: gana, pero no es gordo.
    expect(
      isBigWin(
        round({ net: 10, staked: 10, bets: [{ won: true, selection: { kind: 'red' } }] }),
        rules,
      ),
    ).toBe(false)
    expect(isBigWin(round({ net: 5, staked: 0, bets: [] }), rules)).toBe(false)
  })
})

describe('GIRAR TODAS se para solo', () => {
  it('en un premio gordo', () => {
    expect(spinAllStopReason(round({ net: 100, staked: 10 }), wallet, rules)).toBe('bigWin')
  })

  it('cuando sale el verde (aunque no se apostara)', () => {
    expect(spinAllStopReason(round({ result: 0 }), wallet, rules)).toBe('green')
    expect(spinAllStopReason(round({ result: 0, source: 'none', bets: [] }), wallet, rules)).toBe(
      'green',
    )
  })

  it('premio gordo antes que verde: un pleno al 0', () => {
    const zero = round({
      result: 0,
      net: 350,
      staked: 10,
      bets: [{ won: true, selection: { kind: 'straight' } }],
    })
    expect(spinAllStopReason(zero, wallet, rules)).toBe('bigWin')
  })

  it('en bancarrota: había fichas y ya no llega ni para la mínima', () => {
    expect(spinAllStopReason(round(), { balance: 9 }, rules)).toBe('broke')
    expect(spinAllStopReason(round(), { balance: 10 }, rules)).toBeNull()
  })

  it('las tiradas sin fichas (ya arruinado) no paran el bucle', () => {
    expect(
      spinAllStopReason(
        round({ source: 'none', bets: [], net: 0, staked: 0 }),
        { balance: 0 },
        rules,
      ),
    ).toBeNull()
  })

  it('una tirada normal sigue', () => {
    expect(spinAllStopReason(round(), wallet, rules)).toBeNull()
  })
})

describe('configuración de las tiradas pendientes', () => {
  it('se publica a la web el tope, el giro rápido y el umbral del premio gordo', () => {
    const pub = toPublicGameConfig(testGameConfig())
    expect(pub.pendingSpins).toEqual({ max: 100, quickSpinMs: 1200, quickLandingMs: 900 })
    expect(pub.bigWin).toEqual({ minNetMultiple: 5, megaNetMultiple: 15 })
  })

  it('el giro rápido no puede durar más que el normal', () => {
    const cfg = testGameConfig()
    const bad = {
      ...cfg,
      pendingSpins: { ...cfg.pendingSpins, max: 10, quickSpinMs: cfg.spin.minSpinMs + 1 },
    }
    expect(gameConfigSchema.safeParse(bad).success).toBe(false)
    const zero = { ...cfg, pendingSpins: { max: 0, quickSpinMs: 0, quickLandingMs: 0 } }
    expect(gameConfigSchema.safeParse(zero).success).toBe(false)
  })
})

describe('protocolo de las tiradas pendientes (sigue en la versión 1)', () => {
  it('la cartera lleva el contador', () => {
    expect(walletSchema.parse(wallet).pendingSpins).toBe(7)
    expect(walletSchema.safeParse({ ...wallet, pendingSpins: -1 }).success).toBe(false)
    const { pendingSpins: _omit, ...without } = wallet
    expect(walletSchema.safeParse(without).success).toBe(false)
  })

  it('turn/end responde queued con el contador y si se descartó', () => {
    const queued = { v: PROTOCOL_VERSION, status: 'queued', dropped: false, wallet }
    expect(turnEndResponseSchema.parse(queued)).toEqual(queued)
    expect(turnEndResponseSchema.safeParse({ ...queued, dropped: undefined }).success).toBe(false)
    expect(turnEndResponseSchema.safeParse({ ...queued, round: {} }).success).toBe(false)
  })

  it('presence y spin.pending del cliente', () => {
    expect(clientMessageSchema.parse({ v: 1, type: 'presence', visible: false })).toEqual({
      v: 1,
      type: 'presence',
      visible: false,
    })
    expect(clientMessageSchema.safeParse({ v: 1, type: 'presence' }).success).toBe(false)
    const spin = { v: 1, type: 'spin.pending', quick: true, requestId: 'spin-abc123' }
    expect(clientMessageSchema.parse(spin)).toEqual(spin)
    expect(clientMessageSchema.safeParse({ ...spin, requestId: 'x' }).success).toBe(false)
    expect(clientMessageSchema.safeParse({ ...spin, requestId: 'a b c d e f g h' }).success).toBe(
      false,
    )
    expect(clientMessageSchema.safeParse({ ...spin, count: 5 }).success).toBe(false)
  })

  it('pending del servidor: queued o dropped, con la cartera', () => {
    for (const event of ['queued', 'dropped'] as const) {
      const msg = { v: 1, type: 'pending', event, wallet }
      expect(serverMessageSchema.parse(msg)).toEqual(msg)
    }
    expect(
      serverMessageSchema.safeParse({ v: 1, type: 'pending', event: 'spent', wallet }).success,
    ).toBe(false)
  })
})
