// SPDX-License-Identifier: AGPL-3.0-or-later
// Cuerpos de petición y respuesta de la API HTTP. Cada ruta valida su entrada con estos esquemas.
import { z } from 'zod'

import { publicGameConfigSchema } from '../game/config.ts'
import { LEADERBOARD_BOARDS } from '../game/constants.ts'
import { seasonIdSchema } from '../game/season.ts'
import { betSelectionSchema } from '../roulette/bets.ts'
import {
  coinsSchema,
  localeSchema,
  opaqueTokenSchema,
  openRoundSchema,
  osSchema,
  pluginVersionSchema,
  publicUserSchema,
  resolvedRoundSchema,
  selfUserSchema,
  slipSchema,
  turnIdSchema,
  versionSchema,
  walletSchema,
} from './common.ts'

// ---------------------------------------------------------------- /api/meta

export const metaResponseSchema = z
  .object({
    v: versionSchema,
    protocol: versionSchema,
    name: z.string().min(1).max(80),
    isOfficial: z.boolean(),
    serverVersion: z.string().max(40),
    publicUrl: z.url(),
  })
  .strict()
export type MetaResponse = z.output<typeof metaResponseSchema>

// ---------------------------------------------------------------- Device Flow

export const deviceStartRequestSchema = z.object({ v: versionSchema }).strict()

export const deviceStartResponseSchema = z
  .object({
    v: versionSchema,
    /** Identificador opaco para el polling (el `device_code` de GitHub nunca sale del servidor). */
    pollId: opaqueTokenSchema,
    userCode: z.string().min(4).max(20),
    verificationUri: z.url(),
    expiresIn: z.number().int().positive(),
    interval: z.number().int().positive(),
  })
  .strict()
export type DeviceStartResponse = z.output<typeof deviceStartResponseSchema>

export const devicePollRequestSchema = z
  .object({ v: versionSchema, pollId: opaqueTokenSchema })
  .strict()

export const devicePollResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      v: versionSchema,
      status: z.literal('pending'),
      interval: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      v: versionSchema,
      status: z.literal('slow_down'),
      interval: z.number().int().positive(),
    })
    .strict(),
  z.object({ v: versionSchema, status: z.literal('expired') }).strict(),
  z.object({ v: versionSchema, status: z.literal('denied') }).strict(),
  z
    .object({
      v: versionSchema,
      status: z.literal('ok'),
      /** Token de sesión del mod (se guarda en `$.store`). */
      token: opaqueTokenSchema,
      user: selfUserSchema,
      /** true la primera vez: el mod enseña el aviso de que sales en el ranking. */
      isNew: z.boolean(),
    })
    .strict(),
])
export type DevicePollResponse = z.output<typeof devicePollResponseSchema>

// ---------------------------------------------------------------- enlace de un solo uso

export const linkRequestSchema = z.object({ v: versionSchema }).strict()

export const linkResponseSchema = z
  .object({
    v: versionSchema,
    /** URL completa de la ventana con el código de un solo uso. */
    url: z.url(),
    expiresIn: z.number().int().positive(),
  })
  .strict()
export type LinkResponse = z.output<typeof linkResponseSchema>

export const redeemRequestSchema = z.object({ v: versionSchema, code: opaqueTokenSchema }).strict()

export const redeemResponseSchema = z.object({ v: versionSchema, user: selfUserSchema }).strict()

export const okResponseSchema = z.object({ v: versionSchema, ok: z.literal(true) }).strict()

// ---------------------------------------------------------------- turnos

/** Lo que el mod manda al empezar un turno. Ni prompts, ni rutas, ni código: nada más. */
export const turnStartRequestSchema = z
  .object({
    v: versionSchema,
    turnId: turnIdSchema,
    pluginVersion: pluginVersionSchema,
    os: osSchema,
  })
  .strict()
export type TurnStartRequest = z.output<typeof turnStartRequestSchema>

export const turnStartResponseSchema = z
  .object({
    v: versionSchema,
    round: openRoundSchema,
    /** Si ya se reutilizó una ronda abierta (dos sesiones de Claude Code a la vez). */
    reused: z.boolean(),
    /** Si el usuario tiene alguna ventana conectada (para no abrir otra). */
    windowConnected: z.boolean(),
  })
  .strict()
export type TurnStartResponse = z.output<typeof turnStartResponseSchema>

/** Lo que el mod manda al terminar un turno: duración y dos booleanos. */
export const turnEndRequestSchema = z
  .object({
    v: versionSchema,
    turnId: turnIdSchema,
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(24 * 60 * 60 * 1000),
    gitPushOk: z.boolean(),
    testFailed: z.boolean(),
    pluginVersion: pluginVersionSchema,
    os: osSchema,
  })
  .strict()
export type TurnEndRequest = z.output<typeof turnEndRequestSchema>

export const turnEndResponseSchema = z.discriminatedUnion('status', [
  z
    .object({
      v: versionSchema,
      status: z.literal('resolved'),
      round: resolvedRoundSchema,
      wallet: walletSchema,
    })
    .strict(),
  z
    .object({
      v: versionSchema,
      /** Ya no hay ronda abierta para ese turno (caducada o resuelta por otra sesión). */
      status: z.literal('no_round'),
      wallet: walletSchema,
    })
    .strict(),
])
export type TurnEndResponse = z.output<typeof turnEndResponseSchema>

// ---------------------------------------------------------------- apuestas desde comandos

export const betAmountSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.literal('all-in'),
])

/** `/bet <cantidad> <casilla>`: la casilla llega como texto y la interpreta el servidor. */
export const betRequestSchema = z
  .object({
    v: versionSchema,
    amount: betAmountSchema,
    target: z.string().min(1).max(32),
  })
  .strict()
export type BetRequest = z.output<typeof betRequestSchema>

export const betResponseSchema = z
  .object({
    v: versionSchema,
    slip: slipSchema,
    wallet: walletSchema,
    /** Si hay ronda abierta, la apuesta entra en ella; si no, en la siguiente. */
    forRound: z.enum(['current', 'next']),
  })
  .strict()
export type BetResponse = z.output<typeof betResponseSchema>

// ---------------------------------------------------------------- /api/me

export const meResponseSchema = z
  .object({
    v: versionSchema,
    user: selfUserSchema,
    wallet: walletSchema,
    slip: slipSchema,
    round: openRoundSchema.nullable(),
    /** Puesto en el ranking de arruinados (null si está oculto o aún no ha jugado). */
    brokeRank: z.number().int().positive().nullable(),
  })
  .strict()
export type MeResponse = z.output<typeof meResponseSchema>

export const settingsRequestSchema = z
  .object({
    v: versionSchema,
    hidden: z.boolean().optional(),
    locale: localeSchema.nullable().optional(),
  })
  .strict()
  .refine(body => body.hidden !== undefined || body.locale !== undefined, {
    message: 'nada que cambiar',
  })
export type SettingsRequest = z.output<typeof settingsRequestSchema>

export const settingsResponseSchema = z.object({ v: versionSchema, user: selfUserSchema }).strict()

/** Borrado de cuenta: hay que repetir el login como confirmación. */
export const deleteAccountRequestSchema = z
  .object({ v: versionSchema, confirm: z.string().min(1).max(39) })
  .strict()

// ---------------------------------------------------------------- rankings

export const leaderboardBoardSchema = z.enum(LEADERBOARD_BOARDS)
export type LeaderboardBoard = z.output<typeof leaderboardBoardSchema>

export const leaderboardQuerySchema = z
  .object({
    season: seasonIdSchema.optional(),
    board: leaderboardBoardSchema.default('broke'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
export type LeaderboardQuery = z.output<typeof leaderboardQuerySchema>

export const leaderboardRowSchema = publicUserSchema
  .extend({
    rank: z.number().int().positive(),
    netWorth: coinsSchema,
    balance: coinsSchema,
    debt: coinsSchema,
    spins: z.number().int().min(0),
    currentStreak: z.number().int(),
    bestStreak: z.number().int().min(0),
  })
  .strict()
export type LeaderboardRow = z.output<typeof leaderboardRowSchema>

export const leaderboardResponseSchema = z
  .object({
    v: versionSchema,
    season: seasonIdSchema,
    board: leaderboardBoardSchema,
    seasons: z.array(seasonIdSchema),
    rows: z.array(leaderboardRowSchema),
    players: z.number().int().min(0),
  })
  .strict()
export type LeaderboardResponse = z.output<typeof leaderboardResponseSchema>

export const hallOfRuinRowSchema = publicUserSchema
  .extend({
    rank: z.number().int().positive(),
    netWorth: coinsSchema,
    spins: z.number().int().min(0),
  })
  .strict()

export const hallOfRuinResponseSchema = z
  .object({
    v: versionSchema,
    seasons: z.array(
      z.object({ seasonId: seasonIdSchema, rows: z.array(hallOfRuinRowSchema) }).strict(),
    ),
  })
  .strict()
export type HallOfRuinResponse = z.output<typeof hallOfRuinResponseSchema>

// ---------------------------------------------------------------- /config.json (web)

export const linkItemSchema = z.object({ label: z.string().min(1).max(80), url: z.url() }).strict()

export const webConfigSchema = z
  .object({
    v: versionSchema,
    publicUrl: z.url(),
    instanceName: z.string().min(1).max(80),
    isOfficial: z.boolean(),
    serverVersion: z.string().max(40),
    game: publicGameConfigSchema,
    site: z
      .object({
        author: z.object({ name: z.string().min(1), url: z.url() }).strict(),
        repoUrl: z.url(),
        installCommand: z.string().min(1).max(200),
        helpLinks: z.record(localeSchema, z.array(linkItemSchema)),
        moreProjects: z.array(linkItemSchema.extend({ description: z.string().max(200) }).strict()),
      })
      .strict(),
  })
  .strict()
export type WebConfig = z.output<typeof webConfigSchema>

// Reexporta lo que la web usa al apostar desde el tapete.
export { betSelectionSchema }
export const coinsAmountSchema = coinsSchema
