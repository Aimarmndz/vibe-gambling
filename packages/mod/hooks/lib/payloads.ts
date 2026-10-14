// SPDX-License-Identifier: AGPL-3.0-or-later
// Constructores de los cuerpos que el mod manda al servidor. Cada uno copia campo a campo lo
// permitido, así nada más puede colarse. Módulo puro: `packages/shared/test/mod-contract.test.ts`
// los valida contra los esquemas zod de `shared`.
import {
  PROTOCOL_VERSION,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
} from '../generated/protocol.ts'
import type { ConsumableId, ItemId, Os } from '../generated/protocol.ts'

/** Tope de `durationMs` que acepta el servidor (`turnEndRequestSchema`): un día. */
const MAX_DURATION_MS = 24 * 60 * 60 * 1000

export interface VersionedBody {
  readonly v: typeof PROTOCOL_VERSION
}

export interface TurnStartBody extends VersionedBody {
  readonly turnId: string
  readonly pluginVersion: string
  readonly os: Os
}

export interface TurnEndBody extends TurnStartBody {
  readonly durationMs: number
  readonly gitPushOk: boolean
  readonly testFailed: boolean
}

export type BetAmount = number | 'all-in'

export interface BetBody extends VersionedBody {
  readonly amount: BetAmount
  readonly target: string
}

/** Cuerpo de las rutas que no llevan datos (device/start, link, logout). */
export function emptyBody(): VersionedBody {
  return { v: PROTOCOL_VERSION }
}

export function turnStartBody(input: TurnStartBody | Omit<TurnStartBody, 'v'>): TurnStartBody {
  return {
    v: PROTOCOL_VERSION,
    turnId: input.turnId,
    pluginVersion: input.pluginVersion,
    os: input.os,
  }
}

export function turnEndBody(input: Omit<TurnEndBody, 'v'>): TurnEndBody {
  const duration = Number.isFinite(input.durationMs) ? Math.round(input.durationMs) : 0
  return {
    v: PROTOCOL_VERSION,
    turnId: input.turnId,
    durationMs: Math.min(MAX_DURATION_MS, Math.max(0, duration)),
    gitPushOk: input.gitPushOk === true,
    testFailed: input.testFailed === true,
    pluginVersion: input.pluginVersion,
    os: input.os,
  }
}

export function betBody(amount: BetAmount, target: string): BetBody {
  return { v: PROTOCOL_VERSION, amount, target }
}

export function devicePollBody(pollId: string): VersionedBody & { readonly pollId: string } {
  return { v: PROTOCOL_VERSION, pollId }
}

export function settingsBody(hidden: boolean): VersionedBody & { readonly hidden: boolean } {
  return { v: PROTOCOL_VERSION, hidden }
}

export function deleteAccountBody(confirm: string): VersionedBody & { readonly confirm: string } {
  return { v: PROTOCOL_VERSION, confirm }
}

export function referralRedeemBody(code: string): VersionedBody & { readonly code: string } {
  return { v: PROTOCOL_VERSION, code }
}

/** Compra en la TIENDA: el objeto y el id de la compra (los reintentos repiten el mismo). */
export function shopBuyBody(
  itemId: ItemId,
  requestId: string,
): VersionedBody & { readonly itemId: ItemId; readonly requestId: string } {
  return { v: PROTOCOL_VERSION, itemId, requestId }
}

/** Arma o desarma un consumible del bolsillo. */
export function itemArmBody(
  itemId: ConsumableId,
  armed: boolean,
): VersionedBody & { readonly itemId: ConsumableId; readonly armed: boolean } {
  return { v: PROTOCOL_VERSION, itemId, armed: armed === true }
}

/** Id de una compra: aleatorio, del formato que pide el servidor (`[A-Za-z0-9_-]{8,64}`). */
export function newRequestId(): string {
  return crypto.randomUUID()
}

const REFERRAL_CODE = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`)

/**
 * Código de afiliado tal como lo escribe una persona → formato canónico, o null. Acepta
 * minúsculas, espacios, guiones y la URL entera (`…/r/abcd2345`). Es la misma regla que
 * `normalizeReferralCode` de shared (`mod-contract.test.ts` lo comprueba).
 */
export function normalizeReferralCode(raw: string): string | null {
  const tail =
    raw
      .trim()
      .split('/')
      .filter(part => part !== '')
      .at(-1) ?? ''
  const text = tail.replace(/[\s_-]+/g, '').toUpperCase()
  return REFERRAL_CODE.test(text) ? text : null
}

/** Palabras que `/bet` y `/all-in` aceptan como "todo el saldo". */
const ALL_IN_WORDS = new Set(['all', 'allin', 'all-in', 'todo'])

/**
 * Interpreta la cantidad de `/bet`: un entero positivo seguro o "all-in". El servidor vuelve a
 * validarla; aquí solo se filtra lo que no tiene sentido mandar.
 */
export function parseBetAmount(raw: string): BetAmount | null {
  const text = raw.trim().toLowerCase()
  if (ALL_IN_WORDS.has(text)) return 'all-in'
  // Separador de miles (`1.000`, `1,000`, `1_000`) solo en grupos de tres y siempre el mismo:
  // así `1.5` no se convierte en 15 monedas, sino en un error.
  const digits = /^\d{1,3}([._,])\d{3}(?:\1\d{3})*$/.test(text) ? text.replace(/[._,]/g, '') : text
  if (!/^\d{1,15}$/.test(digits)) return null
  const amount = Number(digits)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

/** Longitud máxima de la casilla en `betRequestSchema`. */
export const MAX_BET_TARGET_LENGTH = 32
