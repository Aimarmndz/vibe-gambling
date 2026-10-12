// SPDX-License-Identifier: AGPL-3.0-or-later
// Constructores de los cuerpos que el mod manda al servidor. Cada uno copia campo a campo lo
// permitido, así nada más puede colarse. Módulo puro: `packages/shared/test/mod-contract.test.ts`
// los valida contra los esquemas zod de `shared`.
import { PROTOCOL_VERSION } from '../generated/protocol.ts'
import type { Os } from '../generated/protocol.ts'

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

/** Palabras que `/bet` y `/all-in` aceptan como "todo el saldo". */
const ALL_IN_WORDS = new Set(['all', 'allin', 'all-in', 'todo'])

/**
 * Interpreta la cantidad de `/bet`: un entero positivo seguro o "all-in". El servidor vuelve a
 * validarla; aquí solo se filtra lo que no tiene sentido mandar.
 */
export function parseBetAmount(raw: string): BetAmount | null {
  const text = raw.trim().toLowerCase().replace(/[._]/g, '')
  if (ALL_IN_WORDS.has(text)) return 'all-in'
  if (!/^\d{1,15}$/.test(text)) return null
  const amount = Number(text)
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

/** Longitud máxima de la casilla en `betRequestSchema`. */
export const MAX_BET_TARGET_LENGTH = 32
