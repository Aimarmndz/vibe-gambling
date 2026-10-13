// SPDX-License-Identifier: AGPL-3.0-or-later
// Programa de afiliados: formato de los códigos y reglas puras (plazo, activación, tope).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  commissionFor,
  gameConfigSchema,
  isActivated,
  makeReferralCode,
  normalizeReferralCode,
  redeemDeadline,
  redeemWindowBlock,
  referralCodeSchema,
  referralLookupResponseSchema,
  referralRedeemResponseSchema,
  referralStatusSchema,
  serverMessageSchema,
  toPublicGameConfig,
} from '../src/index.ts'
import { testGameConfig } from './fixtures.ts'

const cfg = testGameConfig()
const rules = cfg.referral
const DAY = 86_400_000

describe('códigos', () => {
  it('alfabeto sin caracteres que se confunden y sin repetidos', () => {
    expect(new Set(REFERRAL_CODE_ALPHABET).size).toBe(REFERRAL_CODE_ALPHABET.length)
    for (const ambiguous of ['0', 'O', '1', 'I', 'L', 'U']) {
      expect(REFERRAL_CODE_ALPHABET).not.toContain(ambiguous)
    }
  })

  it('makeReferralCode usa todo el alfabeto y siempre da un código válido', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: REFERRAL_CODE_LENGTH }), picks => {
        let i = 0
        const code = makeReferralCode(n => picks[i++]! % n)
        expect(referralCodeSchema.safeParse(code).success).toBe(true)
      }),
    )
    expect(makeReferralCode(() => 0)).toBe('22222222')
    expect(makeReferralCode(n => n - 1)).toBe('ZZZZZZZZ')
  })

  it('normaliza lo que escribe una persona (minúsculas, guiones, espacios, la URL entera)', () => {
    expect(normalizeReferralCode('abcd2345')).toBe('ABCD2345')
    expect(normalizeReferralCode(' abcd-2345 ')).toBe('ABCD2345')
    expect(normalizeReferralCode('ABCD 2345')).toBe('ABCD2345')
    expect(normalizeReferralCode('https://vibe.test/r/abcd2345')).toBe('ABCD2345')
    expect(normalizeReferralCode('https://vibe.test/r/abcd2345/')).toBe('ABCD2345')
    // Caracteres que no existen en el alfabeto, longitud incorrecta o nada.
    expect(normalizeReferralCode('ABCD0345')).toBeNull()
    expect(normalizeReferralCode('ABCDI345')).toBeNull()
    expect(normalizeReferralCode('ABCD234')).toBeNull()
    expect(normalizeReferralCode('ABCD23456')).toBeNull()
    expect(normalizeReferralCode('')).toBeNull()
    expect(normalizeReferralCode('<script>')).toBeNull()
  })
})

describe('reglas', () => {
  const created = new Date('2026-10-01T10:00:00Z')

  it('plazo para canjear: días desde el alta y tiradas jugadas', () => {
    expect(redeemDeadline(created, rules).getTime()).toBe(created.getTime() + 7 * DAY)
    const at = (ms: number, spins = 0) =>
      redeemWindowBlock({ accountCreatedAt: created, spins, now: new Date(ms) }, rules)
    expect(at(created.getTime())).toBeNull()
    expect(at(created.getTime() + 7 * DAY - 1)).toBeNull()
    expect(at(created.getTime() + 7 * DAY)).toBe('too_late')
    expect(at(created.getTime(), rules.redeemMaxSpins - 1)).toBeNull()
    expect(at(created.getTime(), rules.redeemMaxSpins)).toBe('too_many_spins')
  })

  it('activación: tiradas desde el canje y cuenta de GitHub con edad', () => {
    const n = rules.activationSpins
    expect(isActivated({ spinsSinceRedeem: n, githubOldEnough: true }, rules)).toBe(true)
    expect(isActivated({ spinsSinceRedeem: n - 1, githubOldEnough: true }, rules)).toBe(false)
    expect(isActivated({ spinsSinceRedeem: n * 10, githubOldEnough: false }, rules)).toBe(false)
  })

  it('comisión hasta el tope de la temporada; después, 0', () => {
    const cap = rules.maxCommissionsPerSeason
    expect(commissionFor(0, rules)).toBe(rules.commission)
    expect(commissionFor(cap - 1, rules)).toBe(rules.commission)
    expect(commissionFor(cap, rules)).toBe(0)
    expect(commissionFor(cap + 5, rules)).toBe(0)
  })

  it('la configuración exige el bloque entero y la versión pública lo copia', () => {
    const { referral: _, ...without } = cfg
    expect(gameConfigSchema.safeParse(without).success).toBe(false)
    const bad = { ...cfg, referral: { ...cfg.referral, welcomeBonus: 0 } }
    expect(gameConfigSchema.safeParse(bad).success).toBe(false)
    const extra = { ...cfg, referral: { ...cfg.referral, mlm: true } }
    expect(gameConfigSchema.safeParse(extra).success).toBe(false)
    expect(toPublicGameConfig(cfg).referral).toEqual(cfg.referral)
  })
})

describe('protocolo', () => {
  const status = {
    code: 'ABCD2345',
    url: 'https://vibe.test/r/ABCD2345',
    invited: 3,
    activated: 1,
    waiting: 2,
    earned: 1000,
    season: { seasonId: '2026-10', commissions: 1, cap: 10 },
    invitedBy: null,
    canRedeem: true,
    redeemUntil: '2026-10-08T10:00:00.000Z',
    rules: { ...rules, minAccountAgeDays: 30 },
  }

  it('estado, canje, consulta y aviso de comisión', () => {
    expect(referralStatusSchema.parse(status)).toEqual(status)
    expect(referralStatusSchema.safeParse({ ...status, code: 'abcd2345' }).success).toBe(false)
    expect(referralStatusSchema.safeParse({ ...status, url: 'javascript:alert(1)' }).success).toBe(
      false,
    )
    expect(
      referralRedeemResponseSchema.safeParse({ v: 1, status: 'rejected', reason: 'cycle' }).success,
    ).toBe(true)
    expect(
      referralRedeemResponseSchema.safeParse({ v: 1, status: 'rejected', reason: 'nope' }).success,
    ).toBe(false)
    expect(
      referralLookupResponseSchema.safeParse({ v: 1, found: false, inviter: null }).success,
    ).toBe(true)
    const wallet = {
      seasonId: '2026-10',
      balance: 2000,
      debt: 0,
      netWorth: 2000,
      spins: 0,
      loans: 0,
      currentStreak: 0,
      bestStreak: 0,
      pendingSpins: 0,
    }
    expect(
      serverMessageSchema.safeParse({
        v: 1,
        type: 'referral.commission',
        amount: 1000,
        capped: false,
        commissions: 1,
        cap: 10,
        wallet,
      }).success,
    ).toBe(true)
    expect(
      serverMessageSchema.safeParse({ v: 1, type: 'referral', referral: status }).success,
    ).toBe(true)
  })
})
