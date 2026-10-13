// SPDX-License-Identifier: AGPL-3.0-or-later
// Programa de Afiliados Piramidal (legalmente distinto): códigos de invitación y sus reglas, como
// lógica pura. El servidor las aplica con la cartera bloqueada; la web y el mod solo las enseñan.
//
// - Cada jugador tiene un código corto y legible, creado la primera vez que lo pide.
// - Quien entra con el código de otro (canje) cobra un bono de bienvenida, una sola vez en la
//   vida de su cuenta, solo si su cuenta es nueva en vibe-gambling (días y tiradas) y nunca con
//   su propio código ni con el de alguien que canjeó el suyo.
// - Quien invitó cobra la comisión cuando su invitado se "activa": su cuenta de GitHub tiene edad
//   para el ranking y ha jugado unas cuantas tiradas desde el canje. Con tope por temporada.
import { z } from 'zod'

/**
 * Alfabeto de los códigos: base 32 de Crockford sin los caracteres que se confunden al leerlos o
 * dictarlos (0/O, 1/I/L) ni la U. 30 símbolos: con 8 caracteres, unos 6,6 × 10¹¹ códigos.
 * Es el formato del código (como las 37 casillas de la ruleta), no un ajuste.
 */
export const REFERRAL_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
/** Caracteres de cada código. */
export const REFERRAL_CODE_LENGTH = 8

export const referralCodeSchema = z
  .string()
  .regex(new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`))
export type ReferralCode = z.output<typeof referralCodeSchema>

/**
 * Código tal como lo escribe una persona → formato canónico, o null si no puede ser un código.
 * Acepta minúsculas, espacios, guiones y la URL entera (`…/r/ABCD2345`).
 */
export function normalizeReferralCode(raw: string): ReferralCode | null {
  const tail = raw.trim().split('/').filter(Boolean).at(-1) ?? ''
  const text = tail.replace(/[\s_-]+/g, '').toUpperCase()
  return referralCodeSchema.safeParse(text).success ? text : null
}

/** Genera un código con un azar uniforme `randomIndex(n)` ∈ [0, n). */
export function makeReferralCode(randomIndex: (n: number) => number): ReferralCode {
  let code = ''
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_CODE_ALPHABET[randomIndex(REFERRAL_CODE_ALPHABET.length)]
  }
  return code
}

/** Reglas del programa (bloque `referral` de `config/game.json`). */
export interface ReferralRules {
  /** Monedas para quien canjea un código, en su cartera de la temporada en curso. */
  readonly welcomeBonus: number
  /** Monedas para quien invitó cuando su invitado se activa. */
  readonly commission: number
  /** Tiradas que tiene que jugar el invitado desde el canje para activarse. */
  readonly activationSpins: number
  /** Días (de 24 h) desde el alta en vibe-gambling en los que aún se puede canjear un código. */
  readonly redeemWindowDays: number
  /** Con estas tiradas jugadas (todas las temporadas) ya no se puede canjear. */
  readonly redeemMaxSpins: number
  /** Comisiones cobradas como mucho por un mismo jugador en una temporada. */
  readonly maxCommissionsPerSeason: number
}

/** Por qué no se puede canjear un código (también es la respuesta de la API). */
export const REFERRAL_REJECTIONS = [
  'not_found',
  'own_code',
  'already_redeemed',
  'cycle',
  'too_late',
  'too_many_spins',
] as const
export type ReferralRejection = (typeof REFERRAL_REJECTIONS)[number]

/** Milisegundos de un día (unidad, no configuración). */
const DAY_MS = 86_400_000

/** Hasta cuándo puede canjear un código una cuenta dada de alta en `accountCreatedAt`. */
export function redeemDeadline(accountCreatedAt: Date, rules: ReferralRules): Date {
  return new Date(accountCreatedAt.getTime() + rules.redeemWindowDays * DAY_MS)
}

/**
 * Lo que impide canjear por ser ya una cuenta veterana (fuera de plazo o con demasiadas tiradas),
 * o null. El resto de reglas (código, ciclos, una sola vez) necesitan la base de datos.
 */
export function redeemWindowBlock(
  args: { accountCreatedAt: Date; spins: number; now: Date },
  rules: ReferralRules,
): Extract<ReferralRejection, 'too_late' | 'too_many_spins'> | null {
  if (args.now.getTime() >= redeemDeadline(args.accountCreatedAt, rules).getTime()) {
    return 'too_late'
  }
  if (args.spins >= rules.redeemMaxSpins) return 'too_many_spins'
  return null
}

/**
 * ¿Se activa el invitado? Tiradas jugadas desde el canje y si su cuenta de GitHub ya tiene edad
 * para el ranking (`leaderboard.minAccountAgeDays`, que decide el servidor).
 */
export function isActivated(
  args: { spinsSinceRedeem: number; githubOldEnough: boolean },
  rules: Pick<ReferralRules, 'activationSpins'>,
): boolean {
  return args.githubOldEnough && args.spinsSinceRedeem >= rules.activationSpins
}

/** Comisión de una activación: la de la configuración o 0 si ya cobró el tope esta temporada. */
export function commissionFor(
  paidThisSeason: number,
  rules: Pick<ReferralRules, 'commission' | 'maxCommissionsPerSeason'>,
): number {
  return paidThisSeason >= rules.maxCommissionsPerSeason ? 0 : rules.commission
}
