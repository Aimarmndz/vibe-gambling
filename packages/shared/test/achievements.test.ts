// SPDX-License-Identifier: AGPL-3.0-or-later
// Logros de broma: catálogo, cada condición, progreso y su protocolo.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  ACHIEVEMENT_IDS,
  ACHIEVEMENTS,
  COSMETIC_IDS,
  achievementDef,
  achievementParams,
  achievementProgress,
  achievementSchema,
  bankStatementSchema,
  clientMessageSchema,
  evaluateAchievements,
  fallacyConfirmed,
  inHourRange,
  localClock,
  meResponseSchema,
  PROTOCOL_VERSION,
  seasonStatsSchema,
  serverMessageSchema,
  spectacleOf,
} from '../src/index.ts'
import type {
  AchievementContext,
  AchievementId,
  AchievementRound,
  AchievementRules,
} from '../src/index.ts'
import { testGameConfig } from './fixtures.ts'

const cfg = testGameConfig()
const rules: AchievementRules = {
  achievements: {
    proDebtorLoans: 3,
    compoundInterestDebt: 5000,
    zeroCollectorZeros: 2,
    addictSpins: 10,
    nightOwl: { fromHour: 3, toHour: 6 },
  },
  pendingSpins: { max: 4, quickSpinMs: 100, quickLandingMs: 100 },
  loan: cfg.loan,
  bigWin: cfg.bigWin,
  streak: { onFireAt: 3, colorWarningAt: 4 },
  referral: { maxCommissionsPerSeason: 3 },
}
const spectacleRules = { bigWin: cfg.bigWin, onFireAt: 3, colorWarningAt: 4 }

type RoundInput = Omit<AchievementRound, 'spectacle'> & { streak?: number; bankrupt?: boolean }

function mkRound(r: Partial<RoundInput> = {}): AchievementRound {
  const base = {
    result: 7,
    net: -10,
    staked: 10,
    jackpot: false,
    testFailed: false,
    bets: [{ won: false, selection: { kind: 'black' } }],
    ...r,
  }
  const spectacle = spectacleOf(
    { ...base, colorStreak: null },
    { streak: r.streak ?? 0, bankrupt: r.bankrupt ?? false },
    spectacleRules,
  )
  return { ...base, spectacle }
}

function ctx(over: Partial<AchievementContext> = {}): AchievementContext {
  return {
    event: 'round',
    round: mkRound(),
    wallet: { netWorth: 500, debt: 0, loans: 0, spins: 1, bestStreak: 0, pendingSpins: 0 },
    wasBankrupt: false,
    previousColorStreak: null,
    lifetimeZeros: 0,
    // Miércoles a mediodía: nada especial.
    local: { weekday: 3, hour: 12 },
    ...over,
  }
}

const all = (c: AchievementContext) => evaluateAchievements(c, rules, new Set())
const wallet = ctx().wallet

function buy(itemId: string): NonNullable<AchievementContext['purchase']> {
  return { itemId, cosmeticsOwned: 0, revert: null }
}

describe('catálogo', () => {
  it('al menos 12 logros, ids únicos y en snake_case, algunos secretos', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(12)
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENT_IDS.length)
    for (const id of ACHIEVEMENT_IDS) expect(id).toMatch(/^[a-z][a-z0-9_]{2,39}$/)
    expect(ACHIEVEMENTS.some(a => a.hidden)).toBe(true)
    expect(achievementDef('first_spin').id).toBe('first_spin')
  })
})

describe('Push el viernes con tiradas pendientes', () => {
  const jackpotRound = mkRound({
    net: 20,
    jackpot: true,
    bets: [{ won: true, selection: { kind: 'red' } }],
  })
  it('cuenta el día del turno (el del push), no el de la tirada', () => {
    const pushedThursday = ctx({
      round: jackpotRound,
      local: { weekday: 5, hour: 18 },
      turnLocal: { weekday: 4, hour: 18 },
    })
    expect(all(pushedThursday)).not.toContain('friday_push')
    const pushedFriday = ctx({
      round: jackpotRound,
      local: { weekday: 6, hour: 11 },
      turnLocal: { weekday: 5, hour: 23 },
    })
    expect(all(pushedFriday)).toContain('friday_push')
  })
})

describe('cada logro', () => {
  const cases: Array<[AchievementId, AchievementContext, AchievementContext]> = [
    ['first_spin', ctx(), ctx({ event: 'loan', round: null })],
    ['first_ruin', ctx({ round: mkRound({ bankrupt: true }) }), ctx()],
    [
      'pro_debtor',
      ctx({ event: 'loan', round: null, wallet: { ...wallet, loans: 3 } }),
      ctx({ event: 'loan', round: null, wallet: { ...wallet, loans: 2 } }),
    ],
    [
      'all_on_zero',
      ctx({
        round: mkRound({
          result: 0,
          net: 350,
          bets: [{ won: true, selection: { kind: 'straight', numbers: [0] } }],
        }),
      }),
      ctx({
        round: mkRound({
          result: 0,
          net: 10,
          bets: [{ won: true, selection: { kind: 'street', numbers: [0, 1, 2] } }],
        }),
      }),
    ],
    [
      'friday_push',
      ctx({
        round: mkRound({
          net: 20,
          jackpot: true,
          bets: [{ won: true, selection: { kind: 'red' } }],
        }),
        local: { weekday: 5, hour: 18 },
      }),
      ctx({
        round: mkRound({
          net: 20,
          jackpot: true,
          bets: [{ won: true, selection: { kind: 'red' } }],
        }),
        local: { weekday: 4, hour: 18 },
      }),
    ],
    [
      'queue_full',
      ctx({ event: 'queue', round: null, wallet: { ...wallet, pendingSpins: 4 } }),
      ctx({ event: 'queue', round: null, wallet: { ...wallet, pendingSpins: 3 } }),
    ],
    ['on_fire', ctx({ round: mkRound({ streak: 3 }) }), ctx({ round: mkRound({ streak: 2 }) })],
    [
      'fallacy_confirmed',
      ctx({ previousColorStreak: { color: 'red', count: 4 } }),
      ctx({ previousColorStreak: { color: 'red', count: 3 } }),
    ],
    [
      'compound_interest',
      ctx({ wallet: { ...wallet, debt: 5000 } }),
      ctx({ wallet: { ...wallet, debt: 4999 } }),
    ],
    [
      'comeback',
      ctx({ wasBankrupt: true, wallet: { ...wallet, netWorth: 1 } }),
      ctx({ wasBankrupt: true, wallet: { ...wallet, netWorth: 0 } }),
    ],
    [
      'zero_collector',
      ctx({ round: mkRound({ result: 0 }), lifetimeZeros: 2 }),
      ctx({ round: mkRound({ result: 0 }), lifetimeZeros: 1 }),
    ],
    [
      'big_win',
      ctx({ round: mkRound({ net: 50, bets: [{ won: true, selection: { kind: 'dozen' } }] }) }),
      ctx({ round: mkRound({ net: 49, bets: [{ won: true, selection: { kind: 'dozen' } }] }) }),
    ],
    [
      'mega_win',
      ctx({ round: mkRound({ net: 150, bets: [{ won: true, selection: { kind: 'line' } }] }) }),
      ctx({ round: mkRound({ net: 149, bets: [{ won: true, selection: { kind: 'line' } }] }) }),
    ],
    [
      'tests_also_bet',
      ctx({
        round: mkRound({
          testFailed: true,
          net: 10,
          bets: [{ won: true, selection: { kind: 'red' } }],
        }),
      }),
      ctx({ round: mkRound({ testFailed: true }) }),
    ],
    ['addict', ctx({ wallet: { ...wallet, spins: 10 } }), ctx({ wallet: { ...wallet, spins: 9 } })],
    ['night_owl', ctx({ local: { weekday: 1, hour: 3 } }), ctx({ local: { weekday: 1, hour: 6 } })],
    [
      'too_big_to_fail',
      ctx({ wallet: { ...wallet, debt: cfg.loan.maxDebt } }),
      ctx({ wallet: { ...wallet, debt: cfg.loan.maxDebt - 1 } }),
    ],
    [
      'influencer',
      ctx({ event: 'referral', round: null, referral: { activated: 1, seasonCommissions: 0 } }),
      ctx({ event: 'referral', round: null, referral: { activated: 0, seasonCommissions: 0 } }),
    ],
    [
      'pyramid_boss',
      ctx({ event: 'referral', round: null, referral: { activated: 3, seasonCommissions: 3 } }),
      ctx({ event: 'referral', round: null, referral: { activated: 9, seasonCommissions: 2 } }),
    ],
    [
      'first_purchase',
      ctx({ event: 'purchase', round: null, purchase: buy('oracle') }),
      ctx({ event: 'loan', round: null }),
    ],
    [
      'placebo_win',
      ctx({ round: mkRound({ net: 10, items: [{ itemId: 'rabbit_foot' }] }) }),
      ctx({ round: mkRound({ net: 10, items: [{ itemId: 'oracle', hit: false }] }) }),
    ],
    [
      'oracle_hit',
      ctx({ round: mkRound({ items: [{ itemId: 'oracle', hit: true }] }) }),
      ctx({ round: mkRound({ items: [{ itemId: 'oracle', hit: false }] }) }),
    ],
    [
      'asterisk_streak',
      ctx({ round: mkRound({ streak: 3 }), streakAsterisk: true }),
      ctx({ round: mkRound({ streak: 2 }), streakAsterisk: true }),
    ],
    [
      'revert_regret',
      ctx({
        event: 'purchase',
        round: null,
        purchase: { ...buy('revert'), revert: { loss: 501, refund: 500 } },
      }),
      ctx({
        event: 'purchase',
        round: null,
        purchase: { ...buy('revert'), revert: { loss: 500, refund: 500 } },
      }),
    ],
    [
      'bad_taste',
      ctx({
        event: 'purchase',
        round: null,
        purchase: { ...buy('chips_floppy'), cosmeticsOwned: COSMETIC_IDS.length },
      }),
      ctx({
        event: 'purchase',
        round: null,
        purchase: { ...buy('chips_floppy'), cosmeticsOwned: COSMETIC_IDS.length - 1 },
      }),
    ],
  ]

  it('ON FIRE no vale con una racha salvada por el casco (lleva asterisco)', () => {
    const got = all(ctx({ round: mkRound({ streak: 3 }), streakAsterisk: true }))
    expect(got).toContain('asterisk_streak')
    expect(got).not.toContain('on_fire')
  })

  it('cubre todo el catálogo', () => {
    expect(cases.map(c => c[0]).sort()).toEqual([...ACHIEVEMENT_IDS].sort())
  })

  it.each(cases)('%s: se consigue justo en el umbral y no antes', (id, yes, no) => {
    expect(all(yes)).toContain(id)
    expect(all(no)).not.toContain(id)
  })

  it('los de tirada no salen con un préstamo ni con una pendiente guardada', () => {
    for (const event of ['loan', 'queue'] as const) {
      const got = all(
        ctx({
          event,
          round: mkRound({ bankrupt: true, streak: 9 }),
          local: { weekday: 5, hour: 4 },
          wasBankrupt: true,
          lifetimeZeros: 99,
        }),
      )
      for (const id of [
        'first_spin',
        'first_ruin',
        'on_fire',
        'comeback',
        'night_owl',
        'zero_collector',
      ]) {
        expect(got).not.toContain(id)
      }
    }
  })
})

describe('evaluación', () => {
  it('nunca repite uno conseguido y respeta el orden del catálogo', () => {
    fc.assert(
      fc.property(
        fc.subarray([...ACHIEVEMENT_IDS]),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 6 }),
        fc.boolean(),
        (have, hour, weekday, broke) => {
          const c = ctx({
            local: { weekday, hour },
            round: mkRound({ bankrupt: broke, streak: 5 }),
            wallet: { ...wallet, debt: 99_999, spins: 50 },
          })
          const got = evaluateAchievements(c, rules, new Set(have))
          for (const id of got) expect(have).not.toContain(id)
          const idx = got.map(id => ACHIEVEMENT_IDS.indexOf(id))
          expect(idx).toEqual([...idx].sort((a, b) => a - b))
          // Lo que se consigue con un conjunto vacío = lo que falta + lo que ya tenía.
          const fresh = new Set(all(c))
          expect(new Set([...got, ...have.filter(id => fresh.has(id))])).toEqual(fresh)
        },
      ),
    )
  })
})

describe('falacia', () => {
  it('solo con el aviso en pantalla, apostando al color contrario y perdiendo', () => {
    const lostBlack = [{ won: false, selection: { kind: 'black' } }]
    expect(fallacyConfirmed({ color: 'red', count: 4 }, lostBlack, 4)).toBe(true)
    expect(fallacyConfirmed({ color: 'black', count: 4 }, lostBlack, 4)).toBe(false)
    expect(
      fallacyConfirmed(
        { color: 'red', count: 4 },
        [{ won: true, selection: { kind: 'black' } }],
        4,
      ),
    ).toBe(false)
    expect(fallacyConfirmed({ color: 'green', count: 9 }, lostBlack, 4)).toBe(false)
    expect(fallacyConfirmed(null, lostBlack, 4)).toBe(false)
  })
})

describe('horas y días', () => {
  it('intervalos normales y que cruzan la medianoche', () => {
    expect(inHourRange(3, 3, 6)).toBe(true)
    expect(inHourRange(6, 3, 6)).toBe(false)
    expect(inHourRange(23, 22, 2)).toBe(true)
    expect(inHourRange(1, 22, 2)).toBe(true)
    expect(inHourRange(2, 22, 2)).toBe(false)
    expect(inHourRange(12, 22, 2)).toBe(false)
  })

  it('el día de la semana es el de la zona horaria de la temporada', () => {
    // Viernes 23:30 en Madrid es sábado en UTC.
    const instant = new Date('2026-10-16T21:30:00Z')
    expect(localClock(instant, 'Europe/Madrid')).toEqual({ weekday: 5, hour: 23 })
    expect(localClock(instant, 'UTC')).toEqual({ weekday: 5, hour: 21 })
    expect(localClock(new Date('2026-10-16T22:30:00Z'), 'Europe/Madrid')).toEqual({
      weekday: 6,
      hour: 0,
    })
  })
})

describe('progreso', () => {
  const snap = {
    loans: 1,
    debt: 99_999,
    spins: 4,
    bestStreak: 2,
    pendingSpins: 2,
    lifetimeZeros: 0,
    referralCommissions: 1,
  }

  it('contables con meta y tope; el resto sin progreso', () => {
    expect(achievementProgress('pro_debtor', snap, rules, false)).toEqual({ current: 1, goal: 3 })
    expect(achievementProgress('compound_interest', snap, rules, false)).toEqual({
      current: 5000,
      goal: 5000,
    })
    expect(achievementProgress('queue_full', snap, rules, false)).toEqual({ current: 2, goal: 4 })
    expect(achievementProgress('on_fire', snap, rules, false)).toEqual({ current: 2, goal: 3 })
    expect(achievementProgress('addict', snap, rules, false)).toEqual({ current: 4, goal: 10 })
    expect(achievementProgress('zero_collector', snap, rules, false)).toEqual({
      current: 0,
      goal: 2,
    })
    expect(achievementProgress('pyramid_boss', snap, rules, false)).toEqual({
      current: 1,
      goal: 3,
    })
    expect(achievementProgress('influencer', snap, rules, false)).toBeNull()
    expect(achievementProgress('first_spin', snap, rules, false)).toBeNull()
    expect(achievementProgress('pro_debtor', snap, rules, true)).toBeNull()
    expect(achievementProgress('on_fire', { ...snap, bestStreak: -3 }, rules, false)).toEqual({
      current: 0,
      goal: 3,
    })
  })
})

describe('marcadores de los textos', () => {
  it('meta de los contables y valores propios, todos de la configuración', () => {
    expect(achievementParams('pro_debtor', rules)).toEqual({ goal: 3 })
    expect(achievementParams('queue_full', rules)).toEqual({ goal: 4 })
    expect(achievementParams('big_win', rules)).toEqual({ multiple: cfg.bigWin.minNetMultiple })
    expect(achievementParams('mega_win', rules)).toEqual({ multiple: cfg.bigWin.megaNetMultiple })
    expect(achievementParams('night_owl', rules)).toEqual({ from: 3, to: 6 })
    expect(achievementParams('too_big_to_fail', rules)).toEqual({ goal: cfg.loan.maxDebt })
    expect(achievementParams('first_spin', rules)).toEqual({})
    for (const id of ACHIEVEMENT_IDS) {
      const params = achievementParams(id, rules)
      expect(achievementSchema.shape.params.safeParse(params).success).toBe(true)
    }
  })
})

describe('protocolo', () => {
  const ach = {
    id: 'first_ruin',
    hidden: false,
    unlockedAt: '2026-10-15T12:00:00.000Z',
    seasonId: '2026-10',
    params: {},
    progress: null,
  }

  it('logro, aviso y listas en hello y /api/me', () => {
    expect(achievementSchema.parse(ach)).toEqual(ach)
    expect(achievementSchema.safeParse({ ...ach, id: 'nope' }).success).toBe(false)
    expect(
      serverMessageSchema.safeParse({
        v: PROTOCOL_VERSION,
        type: 'achievement.unlocked',
        achievement: ach,
      }).success,
    ).toBe(true)
    const me = meResponseSchema.shape
    expect(me.achievements.safeParse(undefined).success).toBe(true)
    expect(me.achievements.safeParse([ach]).success).toBe(true)
  })

  it('peticiones de estadísticas y banco', () => {
    for (const type of ['stats.request', 'bank.request']) {
      expect(clientMessageSchema.safeParse({ v: 1, type }).success).toBe(true)
      expect(clientMessageSchema.safeParse({ v: 1, type, seasonId: '2026-09' }).success).toBe(true)
      expect(clientMessageSchema.safeParse({ v: 1, type, seasonId: '2026-13' }).success).toBe(false)
    }
  })

  it('estadísticas y extracto del banco', () => {
    const summary = {
      roundId: '00000000-0000-4000-8000-000000000001',
      resolvedAt: '2026-10-15T12:00:00.000Z',
      result: 17,
      color: 'black',
      staked: 10,
      net: 350,
    }
    const stats = {
      seasonId: '2026-10',
      seasons: ['2026-10'],
      spins: 1,
      bestStreak: 1,
      series: [
        { spin: 0, netWorth: 1000 },
        { spin: 1, netWorth: 1350 },
      ],
      peakNetWorth: 1350,
      lowestNetWorth: 1000,
      loanMarks: [],
      recent: [summary],
      mostFrequent: { result: 17, color: 'black', count: 1 },
      biggestWin: summary,
    }
    expect(seasonStatsSchema.parse(stats)).toEqual(stats)
    expect(serverMessageSchema.safeParse({ v: 1, type: 'stats', stats }).success).toBe(true)
    const bank = {
      seasonId: '2026-10',
      seasons: ['2026-10'],
      balance: 1000,
      debt: 1100,
      netWorth: -100,
      loans: 1,
      nextInterest: 22,
      canBorrow: false,
      history: [
        {
          kind: 'interest',
          day: '2026-10-15',
          from: '2026-10-15T12:00:00.000Z',
          to: '2026-10-15T13:00:00.000Z',
          spins: 5,
          amount: 100,
          debtAfter: 1100,
        },
        { kind: 'loan', at: '2026-10-15T11:00:00.000Z', amount: 1000, debtAfter: 1000 },
      ],
      truncated: false,
    }
    expect(bankStatementSchema.parse(bank)).toEqual(bank)
    expect(serverMessageSchema.safeParse({ v: 1, type: 'bank', bank }).success).toBe(true)
  })
})
