// SPDX-License-Identifier: AGPL-3.0-or-later
// Piezas comunes del protocolo mod ↔ servidor ↔ web.
import { z } from 'zod'

import { AUTO_BET_SOURCES } from '../game/constants.ts'
import { betSchema, betSelectionSchema } from '../roulette/bets.ts'
import { seasonIdSchema } from '../game/season.ts'

/** Versión del protocolo. Va en cada mensaje (`v`). */
export const PROTOCOL_VERSION = 1
export const versionSchema = z.literal(PROTOCOL_VERSION)

/**
 * ¿Es un mensaje de otra versión del protocolo? Sirve para responder `protocol_mismatch`
 * en vez de un `invalid_request` genérico cuando un cliente viejo o nuevo habla con este servidor.
 */
export function isOtherProtocolVersion(message: unknown): boolean {
  if (typeof message !== 'object' || message === null || !('v' in message)) return false
  const { v } = message as { v: unknown }
  return typeof v === 'number' && v !== PROTOCOL_VERSION
}

/** SO genérico: lo único que el mod cuenta del ordenador. */
export const OS_VALUES = ['linux', 'darwin', 'win32', 'other'] as const
export const osSchema = z.enum(OS_VALUES)
export type Os = z.output<typeof osSchema>

export const LOCALES = ['en', 'es'] as const
export const localeSchema = z.enum(LOCALES)
export type Locale = z.output<typeof localeSchema>

/**
 * URL que se puede enseñar o enlazar: solo `http` y `https`. `z.url()` a secas acepta también
 * `javascript:`, `data:`, `file:` o `vbscript:`, y estas URLs acaban en un `href` o un `src`.
 * Sin restringir el dominio: en desarrollo y en los tests son `http://localhost:<puerto>`.
 * El patrón (esquema en minúsculas, como lo escriben GitHub y los navegadores) hace que la
 * restricción salga también en el JSON Schema de `docs/PROTOCOLO.md`.
 */
export const httpUrlSchema = z.url({ protocol: /^https?$/ }).regex(/^https?:\/\//)

/**
 * Longitudes máximas de los textos del protocolo. El mod las usa también para cortar lo que
 * enseña del servidor (se copian a `packages/mod/hooks/generated`).
 */
export const TEXT_LIMITS = {
  /** Usuario de GitHub. */
  login: 39,
  /** Nombre de la instancia (`/api/meta`). */
  serverName: 80,
  /** Código del Device Flow. */
  userCode: 20,
  /** `message` de un error. */
  errorMessage: 500,
} as const

/** Identificador de turno generado por el mod (idempotencia de los reintentos). */
export const turnIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)

/** Versión del plugin (semver sencillo). */
export const pluginVersionSchema = z
  .string()
  .regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}([-+][0-9A-Za-z.-]{1,32})?$/)

/** Token opaco (sesión, enlace, polling): 256 bits en base64url. */
export const opaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export const coinsSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)

export const pocketColorSchema = z.enum(['red', 'black', 'green'])

/** Datos públicos de un usuario (vienen de su perfil de GitHub). */
export const publicUserSchema = z
  .object({
    login: z.string().min(1).max(TEXT_LIMITS.login),
    avatarUrl: httpUrlSchema,
    profileUrl: httpUrlSchema,
  })
  .strict()
export type PublicUser = z.output<typeof publicUserSchema>

/** El usuario visto por él mismo, con sus ajustes. */
export const selfUserSchema = publicUserSchema
  .extend({
    hidden: z.boolean(),
    locale: localeSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict()
export type SelfUser = z.output<typeof selfUserSchema>

/** Cartera de una temporada. */
export const walletSchema = z
  .object({
    seasonId: seasonIdSchema,
    balance: coinsSchema,
    debt: coinsSchema.min(0),
    netWorth: coinsSchema,
    spins: z.number().int().min(0),
    loans: z.number().int().min(0),
    currentStreak: z.number().int(),
    bestStreak: z.number().int().min(0),
  })
  .strict()
export type Wallet = z.output<typeof walletSchema>

/** Boleto: fichas puestas para la ronda en curso o la siguiente (ya descontadas del saldo). */
export const slipSchema = z
  .object({
    bets: z.array(betSchema),
    total: z.number().int().min(0),
  })
  .strict()
export type Slip = z.output<typeof slipSchema>

export const betOutcomeSchema = z
  .object({
    selection: betSelectionSchema,
    amount: z.number().int().positive(),
    won: z.boolean(),
    payout: z.number().int().min(0),
  })
  .strict()

export const autoBetSourceSchema = z.enum(AUTO_BET_SOURCES)

export const colorStreakSchema = z
  .object({ color: pocketColorSchema, count: z.number().int().min(1) })
  .strict()

/** Ronda abierta (la ruleta gira mientras Claude piensa). */
export const openRoundSchema = z
  .object({
    roundId: z.uuid(),
    openedAt: z.iso.datetime(),
  })
  .strict()
export type OpenRound = z.output<typeof openRoundSchema>

/** Ronda resuelta: el número ya ha salido. */
export const resolvedRoundSchema = z
  .object({
    roundId: z.uuid(),
    openedAt: z.iso.datetime(),
    resolvedAt: z.iso.datetime(),
    result: z.number().int().min(0).max(36),
    color: pocketColorSchema,
    bets: z.array(betOutcomeSchema),
    source: autoBetSourceSchema,
    staked: z.number().int().min(0),
    returned: z.number().int().min(0),
    net: coinsSchema,
    jackpot: z.boolean(),
    gitPushOk: z.boolean(),
    testFailed: z.boolean(),
    interestCharged: z.number().int().min(0),
    colorStreak: colorStreakSchema.nullable(),
    /** Instante a partir del cual la web puede enseñar el resultado (giro mínimo). */
    revealAt: z.iso.datetime(),
  })
  .strict()
export type ResolvedRound = z.output<typeof resolvedRoundSchema>

export const ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'insufficient_funds',
  'too_many_bets',
  'invalid_bet',
  'loan_not_allowed',
  'protocol_mismatch',
  'github_unavailable',
  'internal',
] as const
export const errorCodeSchema = z.enum(ERROR_CODES)
export type ErrorCode = z.output<typeof errorCodeSchema>

/** Cuerpo de todas las respuestas de error HTTP. */
export const errorResponseSchema = z
  .object({
    v: versionSchema,
    error: errorCodeSchema,
    message: z.string().max(TEXT_LIMITS.errorMessage),
  })
  .strict()
export type ErrorResponse = z.output<typeof errorResponseSchema>
