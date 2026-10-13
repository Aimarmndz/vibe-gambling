// SPDX-License-Identifier: AGPL-3.0-or-later
// El mod no puede importar `shared` (se instala solo `packages/mod`) ni usar zod. Estos tests
// atan las dos orillas: la copia generada en el mod está al día y lo que construye el mod pasa
// los esquemas del servidor.
import { describe, expect, it } from 'vitest'

import {
  betBody,
  deleteAccountBody,
  devicePollBody,
  emptyBody,
  normalizeReferralCode,
  parseBetAmount,
  referralRedeemBody,
  settingsBody,
  turnEndBody,
  turnStartBody,
} from '../../mod/hooks/lib/payloads.ts'
import { normalizeReferralCode as sharedNormalizeReferralCode } from '../src/game/referral.ts'
import { parseBetAmount as sharedParseBetAmount } from '../src/roulette/parse.ts'
import {
  betRequestSchema,
  deleteAccountRequestSchema,
  devicePollRequestSchema,
  deviceStartRequestSchema,
  linkRequestSchema,
  referralRedeemRequestSchema,
  settingsRequestSchema,
  turnEndRequestSchema,
  turnStartRequestSchema,
} from '../src/protocol/http.ts'
import { OS_VALUES } from '../src/protocol/common.ts'
import { staleModSharedFiles } from '../../../scripts/sync-mod-shared.ts'

describe('copia de shared en el mod', () => {
  it('está al día (si falla: `pnpm sync:mod`)', async () => {
    expect(await staleModSharedFiles()).toEqual([])
  })
})

describe('cuerpos que construye el mod', () => {
  const turn = { turnId: crypto.randomUUID(), pluginVersion: '0.1.0' }

  it('turn/start y turn/end pasan los esquemas estrictos en todos los SO', () => {
    for (const os of OS_VALUES) {
      expect(turnStartRequestSchema.parse(turnStartBody({ ...turn, os }))).toBeTruthy()
      expect(
        turnEndRequestSchema.parse(
          turnEndBody({ ...turn, os, durationMs: 1234.6, gitPushOk: true, testFailed: false }),
        ),
      ).toMatchObject({ durationMs: 1235 })
    }
  })

  it('turn/end acota la duración a lo que acepta el servidor', () => {
    const base = { ...turn, os: 'linux' as const, gitPushOk: false, testFailed: true }
    for (const durationMs of [-5, 0, Number.NaN, 10 ** 12]) {
      expect(turnEndRequestSchema.safeParse(turnEndBody({ ...base, durationMs })).success).toBe(
        true,
      )
    }
  })

  it('no deja pasar campos de más aunque se los den', () => {
    const sneaky = { ...turn, os: 'linux' as const, prompt: 'secreto', cwd: '/home/x' }
    expect(Object.keys(turnStartBody(sneaky)).sort()).toEqual([
      'os',
      'pluginVersion',
      'turnId',
      'v',
    ])
    expect(turnStartRequestSchema.safeParse(turnStartBody(sneaky)).success).toBe(true)
  })

  it('el resto de cuerpos', () => {
    expect(deviceStartRequestSchema.parse(emptyBody())).toEqual({ v: 1 })
    expect(linkRequestSchema.parse(emptyBody())).toEqual({ v: 1 })
    expect(devicePollRequestSchema.parse(devicePollBody('p'.repeat(43)))).toBeTruthy()
    expect(settingsRequestSchema.parse(settingsBody(true))).toEqual({ v: 1, hidden: true })
    expect(deleteAccountRequestSchema.parse(deleteAccountBody('octocat'))).toBeTruthy()
    expect(betRequestSchema.parse(betBody(200, 'red'))).toEqual({
      v: 1,
      amount: 200,
      target: 'red',
    })
    expect(betRequestSchema.parse(betBody('all-in', '8 9 11 12'))).toBeTruthy()
    expect(betRequestSchema.safeParse(betBody(10, 'x'.repeat(33))).success).toBe(false)
  })

  it('la cantidad de /bet se interpreta igual que en shared', () => {
    for (const raw of [
      '200',
      '1_000',
      'all-in',
      'ALLIN',
      'todo',
      '0',
      '-1',
      'abc',
      '9'.repeat(16),
    ]) {
      expect(parseBetAmount(raw), raw).toEqual(sharedParseBetAmount(raw))
      const amount = parseBetAmount(raw)
      if (amount !== null)
        expect(betRequestSchema.safeParse(betBody(amount, 'red')).success).toBe(true)
    }
  })

  it('el código de afiliado se normaliza igual que en shared y el canje pasa el esquema', () => {
    for (const raw of [
      'ABCD2345',
      'abcd-2345',
      ' abcd 2345 ',
      'https://vibe.test/r/abcd2345/',
      'ABCD0345',
      'OLIO1234',
      'ABC',
      'ABCD23456',
      '',
      '/',
    ]) {
      const code = normalizeReferralCode(raw)
      expect(code, raw).toEqual(sharedNormalizeReferralCode(raw))
      if (code !== null) {
        expect(referralRedeemRequestSchema.parse(referralRedeemBody(code))).toEqual({ v: 1, code })
      }
    }
  })
})
