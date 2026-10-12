// SPDX-License-Identifier: AGPL-3.0-or-later
// Nivel de espectáculo: tamaño del premio, verde, jackpot, ON FIRE, falacia y bancarrota.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  colorStreak,
  fireState,
  gameConfigSchema,
  isBigWin,
  netMultipleOf,
  resolveBets,
  spectacleOf,
  spectacleSchema,
  toPublicGameConfig,
  winTier,
} from '../src/index.ts'
import type { Bet, SpectacleRound, SpectacleRules } from '../src/index.ts'
import { loadTestGameConfig, testGameConfig } from './fixtures.ts'

const rules: SpectacleRules = {
  bigWin: { minNetMultiple: 5, megaNetMultiple: 15 },
  onFireAt: 3,
  colorWarningAt: 4,
}

function round(overrides: Partial<SpectacleRound> = {}): SpectacleRound {
  return {
    result: 7,
    net: -10,
    staked: 10,
    jackpot: false,
    colorStreak: { color: 'red', count: 1 },
    bets: [{ won: false, selection: { kind: 'black' } }],
    ...overrides,
  }
}

const ctx = { streak: 0, bankrupt: false }

/** Ronda real a partir de unas apuestas y un número (como la resuelve el servidor). */
function resolved(bets: Bet[], result: number, multiplier = 1): SpectacleRound {
  const o = resolveBets(bets, result, multiplier)
  return {
    result,
    net: o.net,
    staked: o.staked,
    jackpot: o.jackpot,
    colorStreak: colorStreak([result]),
    bets: o.outcomes.map(x => ({ won: x.won, selection: x.bet.selection })),
  }
}

describe('tamaño del premio', () => {
  it('sin ganancia no hay premio', () => {
    expect(winTier(round(), rules)).toBe('none')
    expect(winTier(round({ net: 0 }), rules)).toBe('none')
    expect(winTier(round({ net: 0, staked: 0, bets: [] }), rules)).toBe('none')
  })

  it('escalones exactos de BIG y MEGA', () => {
    const won = [{ won: true, selection: { kind: 'dozen' } }]
    expect(winTier(round({ net: 49, staked: 10, bets: won }), rules)).toBe('win')
    expect(winTier(round({ net: 50, staked: 10, bets: won }), rules)).toBe('big')
    expect(winTier(round({ net: 149, staked: 10, bets: won }), rules)).toBe('big')
    expect(winTier(round({ net: 150, staked: 10, bets: won }), rules)).toBe('mega')
  })

  it('un pleno acertado con ganancia es ¡PLENO! aunque el neto sea pequeño', () => {
    const bets: Bet[] = [
      { selection: { kind: 'straight', numbers: [7] }, amount: 10 },
      { selection: { kind: 'black' }, amount: 300 },
    ]
    const r = resolved(bets, 7)
    expect(r.net).toBe(50)
    expect(winTier(r, rules)).toBe('straight')
    // Pleno acertado pero con pérdida neta: no hay fiesta.
    const lost = resolved(
      [
        { selection: { kind: 'straight', numbers: [7] }, amount: 10 },
        { selection: { kind: 'black' }, amount: 500 },
      ],
      7,
    )
    expect(lost.net).toBeLessThan(0)
    expect(winTier(lost, rules)).toBe('none')
  })

  it('múltiplo neto entero', () => {
    expect(netMultipleOf({ net: 159, staked: 10 })).toBe(15)
    expect(netMultipleOf({ net: -5, staked: 10 })).toBe(0)
    expect(netMultipleOf({ net: 5, staked: 0 })).toBe(0)
  })
})

describe('ON FIRE', () => {
  it('se enciende justo al llegar al umbral ganando y luego arde', () => {
    expect(fireState(2, true, 3)).toBe('none')
    expect(fireState(3, true, 3)).toBe('ignite')
    expect(fireState(4, true, 3)).toBe('burning')
    // Una ronda sin apuesta no cambia la racha: sigue ardiendo pero no vuelve a encenderse.
    expect(fireState(3, false, 3)).toBe('burning')
    expect(fireState(-3, false, 3)).toBe('none')
  })
})

describe('spectacleOf', () => {
  it('el verde, con y sin premio', () => {
    const lost = spectacleOf(resolved([{ selection: { kind: 'red' }, amount: 10 }], 0), ctx, rules)
    expect(lost).toMatchObject({ green: true, greenWin: false, tier: 'none', bigWin: false })
    const zero = spectacleOf(
      resolved([{ selection: { kind: 'straight', numbers: [0] }, amount: 10 }], 0),
      ctx,
      rules,
    )
    expect(zero).toMatchObject({ green: true, greenWin: true, tier: 'straight', bigWin: true })
    expect(zero.netMultiple).toBe(35)
  })

  it('el jackpot solo cuenta si se gana', () => {
    const won = spectacleOf(
      resolved([{ selection: { kind: 'red' }, amount: 10 }], 1, 2),
      ctx,
      rules,
    )
    expect(won).toMatchObject({ jackpot: true, bigWin: true, tier: 'win' })
    const lost = spectacleOf(
      { ...resolved([{ selection: { kind: 'red' }, amount: 10 }], 2, 2), jackpot: true },
      ctx,
      rules,
    )
    expect(lost).toMatchObject({ jackpot: false, bigWin: false })
  })

  it('falacia, racha y bancarrota salen del contexto', () => {
    const s = spectacleOf(
      round({ colorStreak: { color: 'black', count: 4 } }),
      { streak: -6, bankrupt: true },
      rules,
    )
    expect(s).toMatchObject({ fallacy: true, bankrupt: true, streak: -6, fire: 'none' })
    expect(spectacleOf(round({ colorStreak: null }), ctx, rules).fallacy).toBe(false)
    expect(
      spectacleOf(round({ colorStreak: { color: 'red', count: 3 } }), ctx, rules).fallacy,
    ).toBe(false)
  })

  const betArb: fc.Arbitrary<Bet> = fc.oneof(
    fc.record({
      selection: fc
        .integer({ min: 0, max: 36 })
        .map(n => ({ kind: 'straight' as const, numbers: [n] })),
      amount: fc.integer({ min: 1, max: 1000 }),
    }),
    fc.record({
      selection: fc.constantFrom(
        { kind: 'red' as const },
        { kind: 'black' as const },
        { kind: 'even' as const },
        { kind: 'low' as const },
        { kind: 'dozen' as const, index: 2 as const },
        { kind: 'column' as const, index: 1 as const },
      ),
      amount: fc.integer({ min: 1, max: 1000 }),
    }),
  )
  const roundArb = fc
    .tuple(
      fc.array(betArb, { maxLength: 6 }),
      fc.integer({ min: 0, max: 36 }),
      fc.constantFrom(1, 2, 3),
    )
    .map(([bets, result, mult]) => resolved(bets, result, mult))
  const rulesArb = fc
    .tuple(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 40 }))
    .map(([min, extra]) => ({
      bigWin: { minNetMultiple: min, megaNetMultiple: min + extra },
      onFireAt: 3,
      colorWarningAt: 2,
    }))

  it('propiedad: premio gordo == regla de parada de GIRAR TODAS', () => {
    fc.assert(
      fc.property(roundArb, rulesArb, (r, rl) => {
        const s = spectacleOf(r, ctx, rl)
        expect(s.bigWin).toBe(isBigWin({ ...r, source: 'slip' }, { ...rl, chips: [10] }))
      }),
    )
  })

  it('propiedad: los niveles son monótonos y coherentes con el neto', () => {
    const order = ['none', 'win', 'big', 'mega', 'straight']
    fc.assert(
      fc.property(roundArb, rulesArb, (r, rl) => {
        const s = spectacleOf(r, ctx, rl)
        expect(s.tier === 'none').toBe(r.net <= 0)
        expect(s.greenWin).toBe(s.green && r.net > 0)
        expect(s.green).toBe(r.result === 0)
        expect(s.netMultiple * r.staked).toBeLessThanOrEqual(Math.max(0, r.net))
        if (s.tier === 'mega')
          expect(s.netMultiple).toBeGreaterThanOrEqual(rl.bigWin.megaNetMultiple)
        if (s.tier === 'win') expect(s.netMultiple).toBeLessThan(rl.bigWin.minNetMultiple)
        // Con umbrales más altos el nivel nunca sube.
        const harder = {
          ...rl,
          bigWin: {
            minNetMultiple: rl.bigWin.minNetMultiple + 1,
            megaNetMultiple: rl.bigWin.megaNetMultiple + 1,
          },
        }
        expect(order.indexOf(spectacleOf(r, ctx, harder).tier)).toBeLessThanOrEqual(
          order.indexOf(s.tier),
        )
        expect(spectacleSchema.safeParse(s).success).toBe(true)
      }),
    )
  })
})

describe('configuración', () => {
  it('config/game.json trae los umbrales de la v2 y la parte pública los publica', () => {
    const cfg = loadTestGameConfig()
    const pub = toPublicGameConfig(cfg)
    expect(pub.bigWin.megaNetMultiple).toBe(cfg.bigWin.megaNetMultiple)
    expect(pub.onFireAt).toBe(cfg.streak.onFireAt)
    // La configuración pública vale tal cual como reglas del espectáculo.
    const asRules: SpectacleRules = pub
    expect(asRules.colorWarningAt).toBe(cfg.streak.colorWarningAt)
  })

  it('el MEGA WIN tiene que pedir más que el BIG WIN', () => {
    const base = testGameConfig()
    const bad = { ...base, bigWin: { minNetMultiple: 5, megaNetMultiple: 5 } }
    expect(gameConfigSchema.safeParse(bad).success).toBe(false)
  })

  it('la madrugada no puede ser un intervalo vacío', () => {
    const base = testGameConfig()
    const bad = {
      ...base,
      achievements: { ...base.achievements, nightOwl: { fromHour: 4, toHour: 4 } },
    }
    expect(gameConfigSchema.safeParse(bad).success).toBe(false)
  })
})
