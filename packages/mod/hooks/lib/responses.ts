// SPDX-License-Identifier: AGPL-3.0-or-later
// Comprobaciones de forma de las respuestas del servidor. El mod no puede usar zod, así que
// comprueba a mano lo que lee (y nada más): una respuesta rara se trata como "offline".
// Módulo puro.
import { ERROR_CODES, REFERRAL_REJECTIONS } from '../generated/protocol.ts'
import type { ErrorCode, ReferralRejection } from '../generated/protocol.ts'

type Guard<T> = (value: unknown) => value is T

type Obj = Readonly<Record<string, unknown>>

const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isInt = (value: unknown): value is number => Number.isSafeInteger(value)
const isStr = (value: unknown): value is string => typeof value === 'string'
const isBool = (value: unknown): value is boolean => typeof value === 'boolean'
const isIso = (value: unknown): value is string => isStr(value) && !Number.isNaN(Date.parse(value))

/**
 * Texto que llega del servidor, listo para enseñarlo en el terminal: sin caracteres de control
 * (ni secuencias de escape ANSI/OSC, que podrían borrar la pantalla, disfrazar enlaces o escribir
 * en el portapapeles), sin marcas de dirección bidi y cortado a `max` caracteres. Un servidor
 * self-host puede estar comprometido: su texto nunca manda en el terminal de nadie.
 */
export function cleanText(value: string, max: number): string {
  const text = value
    // Secuencias completas: OSC (`ESC ] … BEL` o `ESC ] … ESC \`), CSI (`ESC [ … letra`) y el
    // resto. Buscar caracteres de control es justo lo que hace esta función.
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b[@-_]/g, '')
    // Y cualquier carácter de control o marca bidi que quede suelto.
    .replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
  return [...text].slice(0, max).join('')
}

/** ¿Es una URL http(s) absoluta? */
export function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const { protocol } = new URL(value)
  return protocol === 'https:' || protocol === 'http:'
}

export interface WalletView {
  readonly balance: number
  readonly debt: number
  readonly netWorth: number
  readonly spins: number
  /** Tiradas pendientes. Un servidor anterior a ellas no lo manda: entonces no hay ninguna. */
  readonly pendingSpins?: number
}
export const isWallet: Guard<WalletView> = (v): v is WalletView =>
  isObj(v) &&
  isInt(v.balance) &&
  isInt(v.debt) &&
  isInt(v.netWorth) &&
  isInt(v.spins) &&
  (v.pendingSpins === undefined || (isInt(v.pendingSpins) && v.pendingSpins >= 0))

export type PocketColor = 'red' | 'black' | 'green'
const isColor = (v: unknown): v is PocketColor => v === 'red' || v === 'black' || v === 'green'

export interface BetOutcomeView {
  readonly selection: { readonly kind: string }
  readonly won: boolean
}
const isBetOutcome = (v: unknown): v is BetOutcomeView =>
  isObj(v) && isObj(v.selection) && isStr(v.selection.kind) && isBool(v.won)

export interface ResolvedRoundView {
  readonly result: number
  readonly color: PocketColor
  readonly net: number
  readonly staked: number
  readonly jackpot: boolean
  readonly testFailed: boolean
  readonly source: string
  readonly bets: readonly BetOutcomeView[]
  readonly resolvedAt: string
  readonly revealAt: string
}
const isResolvedRound = (v: unknown): v is ResolvedRoundView =>
  isObj(v) &&
  isInt(v.result) &&
  v.result >= 0 &&
  v.result <= 36 &&
  isColor(v.color) &&
  isInt(v.net) &&
  isInt(v.staked) &&
  isBool(v.jackpot) &&
  isBool(v.testFailed) &&
  isStr(v.source) &&
  Array.isArray(v.bets) &&
  v.bets.every(isBetOutcome) &&
  isIso(v.resolvedAt) &&
  isIso(v.revealAt)

export interface TurnStartView {
  readonly windowConnected: boolean
}
export const isTurnStart: Guard<TurnStartView> = (v): v is TurnStartView =>
  isObj(v) && isBool(v.windowConnected) && isObj(v.round)

export type TurnEndView =
  | { readonly status: 'resolved'; readonly round: ResolvedRoundView; readonly wallet: WalletView }
  | { readonly status: 'no_round'; readonly wallet: WalletView }
  /** Sin ventana visible: tirada guardada como pendiente (o descartada por el tope). */
  | { readonly status: 'queued'; readonly dropped: boolean; readonly wallet: WalletView }
  /** Tope diario: ni tira ni se guarda; la mesa reabre en `reopensAt`. */
  | {
      readonly status: 'daily_limit'
      readonly limit: number
      readonly reopensAt: string
      readonly wallet: WalletView
    }
export const isTurnEnd: Guard<TurnEndView> = (v): v is TurnEndView =>
  isObj(v) &&
  isWallet(v.wallet) &&
  ((v.status === 'resolved' && isResolvedRound(v.round)) ||
    v.status === 'no_round' ||
    (v.status === 'queued' && isBool(v.dropped)) ||
    (v.status === 'daily_limit' && isInt(v.limit) && v.limit > 0 && isIso(v.reopensAt)))

/**
 * Antiabuso: cuenta de GitHub aún demasiado nueva para el ranking público (juega igual). Un
 * servidor anterior a la regla no lo manda; `null` si ya sale.
 */
export interface NewAccountView {
  readonly minAgeDays: number
  readonly rankedFrom: string
}
const isNewAccount = (v: unknown): v is NewAccountView | null | undefined =>
  v === undefined ||
  v === null ||
  (isObj(v) && isInt(v.minAgeDays) && v.minAgeDays > 0 && isIso(v.rankedFrom))

export interface UserView {
  readonly login: string
  readonly hidden: boolean
  readonly newAccount?: NewAccountView | null
}
const isUser = (v: unknown): v is UserView =>
  isObj(v) && isStr(v.login) && isBool(v.hidden) && isNewAccount(v.newAccount)

export interface MeView {
  readonly user: UserView
  readonly wallet: WalletView
  readonly brokeRank: number | null
}
export const isMe: Guard<MeView> = (v): v is MeView =>
  isObj(v) && isUser(v.user) && isWallet(v.wallet) && (v.brokeRank === null || isInt(v.brokeRank))

export interface LinkView {
  readonly url: string
}
export const isLink: Guard<LinkView> = (v): v is LinkView => isObj(v) && isStr(v.url)

export interface DeviceStartView {
  readonly pollId: string
  readonly userCode: string
  readonly verificationUri: string
  readonly expiresIn: number
  readonly interval: number
}
export const isDeviceStart: Guard<DeviceStartView> = (v): v is DeviceStartView =>
  isObj(v) &&
  isStr(v.pollId) &&
  isStr(v.userCode) &&
  isStr(v.verificationUri) &&
  isHttpUrl(v.verificationUri) &&
  isInt(v.expiresIn) &&
  v.expiresIn > 0 &&
  isInt(v.interval) &&
  v.interval > 0

export type DevicePollView =
  | { readonly status: 'pending' | 'slow_down'; readonly interval: number }
  | { readonly status: 'expired' | 'denied' }
  | {
      readonly status: 'ok'
      readonly token: string
      readonly user: UserView
      readonly isNew: boolean
    }
export const isDevicePoll: Guard<DevicePollView> = (v): v is DevicePollView => {
  if (!isObj(v)) return false
  switch (v.status) {
    case 'pending':
    case 'slow_down':
      return isInt(v.interval) && v.interval > 0
    case 'expired':
    case 'denied':
      return true
    case 'ok':
      return isStr(v.token) && v.token !== '' && isUser(v.user) && isBool(v.isNew)
    default:
      return false
  }
}

export interface MetaView {
  readonly protocol: number
  readonly name: string
  readonly isOfficial: boolean
  readonly publicUrl: string
}
export const isMeta: Guard<MetaView> = (v): v is MetaView =>
  isObj(v) && isInt(v.protocol) && isStr(v.name) && isBool(v.isOfficial) && isStr(v.publicUrl)

export interface BetView {
  readonly slip: { readonly total: number }
  readonly wallet: WalletView
  readonly forRound: 'current' | 'next'
}
export const isBet: Guard<BetView> = (v): v is BetView =>
  isObj(v) &&
  isObj(v.slip) &&
  isInt(v.slip.total) &&
  isWallet(v.wallet) &&
  (v.forRound === 'current' || v.forRound === 'next')

export interface SettingsView {
  readonly user: UserView
}
export const isSettings: Guard<SettingsView> = (v): v is SettingsView => isObj(v) && isUser(v.user)

export interface ReferralView {
  readonly code: string
  readonly url: string
  readonly invited: number
  readonly activated: number
  readonly waiting: number
  readonly earned: number
  readonly season: { readonly commissions: number; readonly cap: number }
  readonly invitedBy: { readonly bonus: number; readonly activated: boolean } | null
  readonly canRedeem: boolean
  readonly redeemUntil: string
  readonly rules: {
    readonly welcomeBonus: number
    readonly commission: number
    readonly activationSpins: number
    readonly minAccountAgeDays: number
  }
}
const isCount = (v: unknown): v is number => isInt(v) && v >= 0
export const isReferral: Guard<{ readonly referral: ReferralView }> = (
  v,
): v is { readonly referral: ReferralView } => {
  if (!isObj(v) || !isObj(v.referral)) return false
  const r = v.referral
  return (
    isStr(r.code) &&
    /^[A-Z0-9]{4,16}$/.test(r.code) &&
    isStr(r.url) &&
    isHttpUrl(r.url) &&
    isCount(r.invited) &&
    isCount(r.activated) &&
    isCount(r.waiting) &&
    isCount(r.earned) &&
    isObj(r.season) &&
    isCount(r.season.commissions) &&
    isCount(r.season.cap) &&
    (r.invitedBy === null ||
      (isObj(r.invitedBy) && isCount(r.invitedBy.bonus) && isBool(r.invitedBy.activated))) &&
    isBool(r.canRedeem) &&
    isIso(r.redeemUntil) &&
    isObj(r.rules) &&
    isCount(r.rules.welcomeBonus) &&
    isCount(r.rules.commission) &&
    isCount(r.rules.activationSpins) &&
    isCount(r.rules.minAccountAgeDays)
  )
}

export type ReferralRedeemView =
  | {
      readonly status: 'redeemed'
      readonly bonus: number
      readonly wallet: WalletView
      readonly inviter: { readonly login: string } | null
    }
  | { readonly status: 'rejected'; readonly reason: ReferralRejection }
export const isReferralRedeem: Guard<ReferralRedeemView> = (v): v is ReferralRedeemView =>
  isObj(v) &&
  ((v.status === 'redeemed' &&
    isCount(v.bonus) &&
    isWallet(v.wallet) &&
    (v.inviter === null || (isObj(v.inviter) && isStr(v.inviter.login)))) ||
    (v.status === 'rejected' && REFERRAL_REJECTIONS.some(reason => reason === v.reason)))

export const isOk: Guard<{ readonly ok: true }> = (v): v is { readonly ok: true } =>
  isObj(v) && v.ok === true

/** Código de error del cuerpo `{ v, error, message }`, si lo trae. */
export function errorCodeOf(value: unknown): ErrorCode | null {
  if (!isObj(value)) return null
  const code = ERROR_CODES.find(known => known === value.error)
  return code ?? null
}
