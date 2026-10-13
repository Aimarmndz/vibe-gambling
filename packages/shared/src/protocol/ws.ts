// SPDX-License-Identifier: AGPL-3.0-or-later
// Mensajes del WebSocket `/ws` entre la ventana (navegador) y el servidor.
import { z } from 'zod'

import { seasonIdSchema } from '../game/season.ts'
import { betSelectionSchema } from '../roulette/bets.ts'
import {
  errorCodeSchema,
  localeSchema,
  chipSkinIdSchema,
  feltIdSchema,
  itemIdSchema,
  openRoundSchema,
  purchaseRequestIdSchema,
  resolvedRoundSchema,
  selfUserSchema,
  slipSchema,
  spinRequestIdSchema,
  versionSchema,
  walletSchema,
} from './common.ts'
import { betAmountSchema, referralStatusSchema } from './http.ts'
import { achievementSchema, bankStatementSchema, seasonStatsSchema } from './progress.ts'
import { consumableIdSchema, inventorySchema, shopSchema } from './shop.ts'

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
      felt: feltIdSchema.optional(),
      chipSkin: chipSkinIdSchema.optional(),
    })
    .strict(),
  /**
   * Si la ventana se ve (`document.visibilityState`). Se manda al conectar y en cada cambio: con
   * todas las ventanas ocultas, los prompts se guardan como tiradas pendientes.
   */
  z.object({ v: versionSchema, type: z.literal('presence'), visible: z.boolean() }).strict(),
  /**
   * Gasta la tirada pendiente más antigua (GIRAR). `quick` = giro rápido (parte de GIRAR TODAS).
   * `requestId` lo genera la ventana: un reintento con el mismo id no tira dos veces.
   */
  z
    .object({
      v: versionSchema,
      type: z.literal('spin.pending'),
      quick: z.boolean(),
      requestId: spinRequestIdSchema,
    })
    .strict(),
  /**
   * Pide las estadísticas de una temporada (por defecto, la en curso) para la pantalla
   * ESTADÍSTICAS. Responde `stats` solo a esta ventana.
   */
  z
    .object({
      v: versionSchema,
      type: z.literal('stats.request'),
      seasonId: seasonIdSchema.optional(),
    })
    .strict(),
  /** Pide el extracto del banco de una temporada (por defecto, la en curso). Responde `bank`. */
  z
    .object({
      v: versionSchema,
      type: z.literal('bank.request'),
      seasonId: seasonIdSchema.optional(),
    })
    .strict(),
  /** Pide tu situación en el programa de afiliados (pantalla AFILIADOS). Responde `referral`. */
  z.object({ v: versionSchema, type: z.literal('referral.request') }).strict(),
  /** Pide la TIENDA (catálogo, bolsillo, armario y Placebómetro). Responde `shop`. */
  z.object({ v: versionSchema, type: z.literal('shop.request') }).strict(),
  /**
   * Compra un objeto (o `git revert HEAD~1`). Un reintento con el mismo `requestId` no compra dos
   * veces. Responde con `inventory` (`bought`) a todas las ventanas del usuario.
   */
  z
    .object({
      v: versionSchema,
      type: z.literal('shop.buy'),
      itemId: itemIdSchema,
      requestId: purchaseRequestIdSchema,
    })
    .strict(),
  /** Arma o desarma un consumible: vale para la próxima ronda que se resuelva. */
  z
    .object({
      v: versionSchema,
      type: z.literal('item.arm'),
      itemId: consumableIdSchema,
      armed: z.boolean(),
    })
    .strict(),
  /** Pide el estado completo (tras reconectar). */
  z.object({ v: versionSchema, type: z.literal('sync') }).strict(),
  z.object({ v: versionSchema, type: z.literal('ping'), t: z.number().int().min(0) }).strict(),
])
export type ClientMessage = z.output<typeof clientMessageSchema>

/** Tipos de mensaje de la ventana (para decir a cuál responde un `error`). */
export const clientMessageTypeSchema = z.enum([
  'bet.place',
  'bet.clear',
  'loan.request',
  'settings.update',
  'sync',
  'ping',
  'presence',
  'spin.pending',
  'stats.request',
  'bank.request',
  'referral.request',
  'shop.request',
  'shop.buy',
  'item.arm',
])
export type ClientMessageType = z.output<typeof clientMessageTypeSchema>
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
      /**
       * Catálogo de logros con los conseguidos y su progreso. Este servidor lo manda siempre;
       * opcional en el esquema por compatibilidad con clientes de antes de la v2 (`v: 1`).
       */
      achievements: z.array(achievementSchema).optional(),
      /** Bolsillo y armario de la TIENDA. Opcional por compatibilidad (`v: 1`). */
      inventory: inventorySchema.optional(),
    })
    .strict(),
  z.object({ v: versionSchema, type: z.literal('round.started'), round: openRoundSchema }).strict(),
  z
    .object({
      v: versionSchema,
      type: z.literal('round.resolved'),
      round: resolvedRoundSchema,
      wallet: walletSchema,
      /**
       * Si la ronda es la respuesta a un `spin.pending`, su `requestId`: así la ventana que lo pidió
       * (GIRAR TODAS) no confunde su tirada con una de otra ventana o de un prompt en directo.
       */
      requestId: spinRequestIdSchema.optional(),
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
  /**
   * Un prompt terminó sin ninguna ventana visible, o con la bola de la tirada anterior aún
   * cayendo: se ha guardado como tirada pendiente (`queued`) o se ha descartado por el tope
   * (`dropped`). El contador va en la cartera.
   */
  /**
   * Tope diario alcanzado (`dailySpinLimit`): un prompt o un GIRAR no ha tirado. Cierra la ronda
   * que la ventana viera girar; la mesa reabre en `reopensAt`.
   */
  z
    .object({
      v: versionSchema,
      type: z.literal('daily_limit'),
      /** El tope (`dailySpinLimit`), para las frases del aviso. */
      limit: z.number().int().positive(),
      reopensAt: z.iso.datetime(),
      wallet: walletSchema,
    })
    .strict(),
  z
    .object({
      v: versionSchema,
      type: z.literal('pending'),
      event: z.enum(['queued', 'dropped']),
      wallet: walletSchema,
    })
    .strict(),
  /**
   * Logro conseguido. Llega siempre **después** del mensaje del evento que lo desbloqueó
   * (`round.resolved`, `loan.granted`, `pending` o `inventory`), uno por logro y en el orden del
   * catálogo.
   */
  z
    .object({
      v: versionSchema,
      type: z.literal('achievement.unlocked'),
      achievement: achievementSchema,
    })
    .strict(),
  /** Respuesta a `stats.request`. */
  z.object({ v: versionSchema, type: z.literal('stats'), stats: seasonStatsSchema }).strict(),
  /** Respuesta a `bank.request`. */
  z.object({ v: versionSchema, type: z.literal('bank'), bank: bankStatementSchema }).strict(),
  /** Respuesta a `shop.request`. */
  z.object({ v: versionSchema, type: z.literal('shop'), shop: shopSchema }).strict(),
  /**
   * El bolsillo ha cambiado: compra (`bought`, también `git revert`), armado (`armed`), cargas
   * gastadas en una ronda (`consumed`, justo después de su `round.resolved`) o fin de temporada
   * (`expired`). Llega a todas las ventanas del usuario, antes de los `achievement.unlocked`.
   */
  z
    .object({
      v: versionSchema,
      type: z.literal('inventory'),
      inventory: inventorySchema,
      wallet: walletSchema,
      event: z.enum(['bought', 'armed', 'consumed', 'expired']),
    })
    .strict(),
  /** Respuesta a `referral.request`. */
  z
    .object({ v: versionSchema, type: z.literal('referral'), referral: referralStatusSchema })
    .strict(),
  /**
   * Uno de tus invitados se ha activado: comisión cobrada en la cartera de la temporada en curso
   * (o 0 con `capped`, si ya cobraste el tope de la temporada). Puede llegar en cualquier momento:
   * lo provoca la tirada de otro jugador.
   */
  z
    .object({
      v: versionSchema,
      type: z.literal('referral.commission'),
      amount: z.number().int().min(0),
      capped: z.boolean(),
      /** Comisiones cobradas esta temporada (con esta) y el tope. */
      commissions: z.number().int().min(0),
      cap: z.number().int().positive(),
      wallet: walletSchema,
    })
    .strict(),
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
      /**
       * Tipo del mensaje de la ventana que lo causó (si lo causó uno): sin él, un `not_found` de
       * `spin.pending` y el de una temporada pedida en `stats.request` serían indistinguibles.
       */
      re: clientMessageTypeSchema.optional(),
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
