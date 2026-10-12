// SPDX-License-Identifier: AGPL-3.0-or-later
// Mensajes del WebSocket `/ws` entre la ventana (navegador) y el servidor.
import { z } from 'zod'

import { seasonIdSchema } from '../game/season.ts'
import { betSelectionSchema } from '../roulette/bets.ts'
import {
  errorCodeSchema,
  localeSchema,
  openRoundSchema,
  resolvedRoundSchema,
  selfUserSchema,
  slipSchema,
  versionSchema,
  walletSchema,
} from './common.ts'
import { betAmountSchema } from './http.ts'

/** Tamaño máximo de un mensaje del cliente (bytes). */
export const WS_CLIENT_MESSAGE_MAX_BYTES = 4096

// ---------------------------------------------------------------- cliente → servidor

export const clientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      v: versionSchema,
      type: z.literal('bet.place'),
      selection: betSelectionSchema,
      amount: betAmountSchema,
    })
    .strict(),
  z.object({ v: versionSchema, type: z.literal('bet.clear') }).strict(),
  z.object({ v: versionSchema, type: z.literal('loan.request') }).strict(),
  z
    .object({
      v: versionSchema,
      type: z.literal('settings.update'),
      hidden: z.boolean().optional(),
      locale: localeSchema.nullable().optional(),
    })
    .strict(),
  /** Pide el estado completo (tras reconectar). */
  z.object({ v: versionSchema, type: z.literal('sync') }).strict(),
  z.object({ v: versionSchema, type: z.literal('ping'), t: z.number().int().min(0) }).strict(),
])
export type ClientMessage = z.output<typeof clientMessageSchema>
export type ClientMessageInput = z.input<typeof clientMessageSchema>

// ---------------------------------------------------------------- servidor → cliente

export const serverMessageSchema = z.discriminatedUnion('type', [
  /** Primer mensaje tras conectar y respuesta a `sync`: el estado completo. */
  z
    .object({
      v: versionSchema,
      type: z.literal('hello'),
      user: selfUserSchema,
      wallet: walletSchema,
      slip: slipSchema,
      round: openRoundSchema.nullable(),
      lastRound: resolvedRoundSchema.nullable(),
      serverTime: z.iso.datetime(),
    })
    .strict(),
  z.object({ v: versionSchema, type: z.literal('round.started'), round: openRoundSchema }).strict(),
  z
    .object({
      v: versionSchema,
      type: z.literal('round.resolved'),
      round: resolvedRoundSchema,
      wallet: walletSchema,
    })
    .strict(),
  z.object({ v: versionSchema, type: z.literal('round.expired'), roundId: z.uuid() }).strict(),
  z
    .object({ v: versionSchema, type: z.literal('slip'), slip: slipSchema, wallet: walletSchema })
    .strict(),
  z
    .object({
      v: versionSchema,
      type: z.literal('bet.rejected'),
      error: errorCodeSchema,
      message: z.string().max(500),
    })
    .strict(),
  z
    .object({
      v: versionSchema,
      type: z.literal('loan.granted'),
      amount: z.number().int().positive(),
      wallet: walletSchema,
    })
    .strict(),
  z.object({ v: versionSchema, type: z.literal('wallet'), wallet: walletSchema }).strict(),
  z.object({ v: versionSchema, type: z.literal('settings'), user: selfUserSchema }).strict(),
  z
    .object({
      v: versionSchema,
      type: z.literal('season.changed'),
      seasonId: seasonIdSchema,
      wallet: walletSchema,
    })
    .strict(),
  z
    .object({
      v: versionSchema,
      type: z.literal('error'),
      error: errorCodeSchema,
      message: z.string().max(500),
    })
    .strict(),
  z.object({ v: versionSchema, type: z.literal('pong'), t: z.number().int().min(0) }).strict(),
  /** El servidor cierra la sesión (logout, cuenta borrada, apagado). */
  z
    .object({
      v: versionSchema,
      type: z.literal('bye'),
      reason: z.enum(['logout', 'account_deleted', 'shutdown', 'replaced']),
    })
    .strict(),
])
export type ServerMessage = z.output<typeof serverMessageSchema>
export type ServerMessageType = ServerMessage['type']

/** Códigos de cierre del WebSocket propios de la aplicación (rango 4000–4999). */
export const WS_CLOSE_CODES = Object.freeze({
  unauthorized: 4401,
  forbiddenOrigin: 4403,
  tooManyConnections: 4429,
  protocolError: 4400,
  sessionEnded: 4410,
})
