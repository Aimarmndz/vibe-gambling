// SPDX-License-Identifier: AGPL-3.0-or-later
// Textos del mod en todos los idiomas de `locales/` (el del sistema; inglés por defecto). Los
// textos y las frases son la copia generada en `../generated` (`pnpm gen:locales`). Módulo puro.
import { MOD_TEXTS, REFERENCE_LOCALE } from '../generated/locales.ts'
import type { ModTextKey, ModTexts } from '../generated/locales.ts'
import { fillTemplate } from '../generated/phrases.ts'
import { LOCALES } from '../generated/protocol.ts'
import type { Locale } from '../generated/protocol.ts'
import type { PocketColor } from './responses.ts'

export interface Messages {
  readonly coin: string
  readonly colors: Readonly<Record<PocketColor, string>>
  readonly debtLabel: string
  readonly statusOffline: string
  readonly statusLogin: string
  readonly statusBadConfig: string
  readonly loginHint: string
  readonly jackpotTag: string
  readonly noRound: string
  /** Trozo de la status line con las tiradas pendientes. */
  readonly pendingCount: (count: string) => string
  /** Toast: el prompt terminó sin ventana visible y la tirada se guardó. */
  readonly spinSaved: (count: string) => string
  /** Toast: tope de tiradas pendientes alcanzado, este prompt se descarta. */
  readonly spinDropped: (count: string) => string
  /** `/balance`: cuántas hay y cómo se gastan. */
  readonly pendingHint: (count: string) => string

  readonly commands: Readonly<Record<CommandId, { description: string; argumentHint?: string }>>

  readonly notLoggedIn: string
  readonly offline: string
  readonly serverError: (detail: string) => string
  readonly badConfig: (errors: string) => string
  readonly sessionExpired: string

  readonly openingWindow: string
  readonly windowFailed: string

  readonly betUsage: string
  readonly allInUsage: string
  readonly betBadAmount: (raw: string) => string
  readonly betBadTarget: (raw: string) => string
  readonly betPlaced: (
    amount: string,
    target: string,
    round: 'current' | 'next',
    balance: string,
  ) => string
  readonly insufficientFunds: string
  readonly tooManyBets: string
  readonly invalidBet: (target: string) => string

  readonly balance: (balance: string, debt: string, netWorth: string, rank: string) => string
  readonly rankHidden: string
  readonly rankNone: string

  readonly alreadyLoggedIn: (login: string) => string
  readonly loginPrompt: (uri: string, code: string, minutes: number) => string
  readonly loginInProgress: (uri: string, code: string) => string
  readonly loginWelcome: (login: string) => string
  readonly loginPublicNotice: string
  readonly loginExpired: string
  readonly loginDenied: string
  readonly loginFailed: (detail: string) => string
  readonly loggedOut: string
  readonly notLoggedInLogout: string

  readonly hidden: string
  readonly shown: string

  readonly serverCurrent: (url: string, name: string, official: boolean | null) => string
  readonly serverBadUrl: (raw: string) => string
  readonly serverNeedsHttps: (raw: string) => string
  readonly serverUnreachable: (url: string) => string
  readonly serverIncompatible: (url: string, protocol: number, expected: number) => string
  readonly serverChanged: (url: string, name: string, official: boolean) => string
  readonly serverChangeDenied: (reason: string) => string
  readonly officialTag: string
  readonly selfHostedTag: string

  readonly deleteUsage: (login: string) => string
  readonly deleteMismatch: string
  readonly deleted: string
}

export type CommandId =
  | 'roulette'
  | 'bet'
  | 'allIn'
  | 'balance'
  | 'login'
  | 'logout'
  | 'hide'
  | 'show'
  | 'server'
  | 'deleteAccount'

const COMMAND_IDS: readonly CommandId[] = [
  'roulette',
  'bet',
  'allIn',
  'balance',
  'login',
  'logout',
  'hide',
  'show',
  'server',
  'deleteAccount',
]

/** Mensajes de un idioma a partir de sus textos (copia generada de `locales/<idioma>/mod.json`). */
export function buildMessages(t: ModTexts): Messages {
  const text = (key: ModTextKey) => t[key]
  const hintOf = (id: CommandId): string | undefined =>
    (t as Readonly<Record<string, string>>)[`command.${id}.argumentHint`]
  const state = (official: boolean | null) =>
    official === null
      ? t['serverState.unreachable']
      : official
        ? t['serverState.official']
        : t['serverState.selfHosted']
  return {
    coin: t.coin,
    colors: { red: t['color.red'], black: t['color.black'], green: t['color.green'] },
    debtLabel: t.debtLabel,
    statusOffline: t.statusOffline,
    statusLogin: t.statusLogin,
    statusBadConfig: t.statusBadConfig,
    loginHint: t.loginHint,
    jackpotTag: t.jackpotTag,
    noRound: t.noRound,
    pendingCount: count => fillTemplate(t.pendingCount, { count }),
    spinSaved: count => fillTemplate(t.spinSaved, { count }),
    spinDropped: count => fillTemplate(t.spinDropped, { count }),
    pendingHint: count => fillTemplate(t.pendingHint, { count }),

    commands: Object.fromEntries(
      COMMAND_IDS.map(id => {
        const argumentHint = hintOf(id)
        const description = text(`command.${id}.description` as ModTextKey)
        return [id, argumentHint === undefined ? { description } : { description, argumentHint }]
      }),
    ) as Messages['commands'],

    notLoggedIn: t.notLoggedIn,
    offline: t.offline,
    serverError: detail => fillTemplate(t.serverError, { detail }),
    badConfig: errors => fillTemplate(t.badConfig, { errors }),
    sessionExpired: t.sessionExpired,

    openingWindow: t.openingWindow,
    windowFailed: t.windowFailed,

    betUsage: t.betUsage,
    allInUsage: t.allInUsage,
    betBadAmount: raw => fillTemplate(t.betBadAmount, { raw }),
    betBadTarget: raw => fillTemplate(t.betBadTarget, { raw }),
    betPlaced: (amount, target, round, balance) =>
      fillTemplate(t.betPlaced, {
        amount,
        target,
        balance,
        round: round === 'current' ? t['betRound.current'] : t['betRound.next'],
      }),
    insufficientFunds: t.insufficientFunds,
    tooManyBets: t.tooManyBets,
    invalidBet: target => fillTemplate(t.invalidBet, { target }),

    balance: (balance, debt, netWorth, rank) =>
      fillTemplate(t.balance, { balance, debt, netWorth, rank }),
    rankHidden: t.rankHidden,
    rankNone: t.rankNone,

    alreadyLoggedIn: login => fillTemplate(t.alreadyLoggedIn, { login }),
    loginPrompt: (uri, code, minutes) => fillTemplate(t.loginPrompt, { uri, code, minutes }),
    loginInProgress: (uri, code) => fillTemplate(t.loginInProgress, { uri, code }),
    loginWelcome: login => fillTemplate(t.loginWelcome, { login }),
    loginPublicNotice: t.loginPublicNotice,
    loginExpired: t.loginExpired,
    loginDenied: t.loginDenied,
    loginFailed: detail => fillTemplate(t.loginFailed, { detail }),
    loggedOut: t.loggedOut,
    notLoggedInLogout: t.notLoggedInLogout,

    hidden: t.hidden,
    shown: t.shown,

    serverCurrent: (url, name, official) =>
      fillTemplate(t.serverCurrent, {
        url,
        name: name === '' ? '' : fillTemplate(t.serverNameSuffix, { name }),
        state: state(official),
      }),
    serverBadUrl: raw => fillTemplate(t.serverBadUrl, { raw }),
    serverNeedsHttps: raw => fillTemplate(t.serverNeedsHttps, { raw }),
    serverUnreachable: url => fillTemplate(t.serverUnreachable, { url }),
    serverIncompatible: (url, protocol, expected) =>
      fillTemplate(t.serverIncompatible, { url, protocol, expected }),
    serverChanged: (url, name, official) =>
      fillTemplate(t.serverChanged, { url, name, state: state(official) }),
    serverChangeDenied: reason => fillTemplate(t.serverChangeDenied, { reason }),
    officialTag: t.officialTag,
    selfHostedTag: t.selfHostedTag,

    deleteUsage: login => fillTemplate(t.deleteUsage, { login }),
    deleteMismatch: t.deleteMismatch,
    deleted: t.deleted,
  }
}

/** Mensajes de cada idioma registrado (`locales/`, copia generada por `pnpm gen:locales`). */
export const MESSAGES: Readonly<Record<Locale, Messages>> = Object.fromEntries(
  LOCALES.map(locale => [locale, buildMessages(MOD_TEXTS[locale])]),
) as Record<Locale, Messages>

/**
 * Idioma a partir de las variables de locale del sistema (`LC_ALL`, `LC_MESSAGES`, `LANG`,
 * `LANGUAGE`, en ese orden): manda la primera con valor (sin contar `C`). Se busca el idioma con
 * región (`pt_BR` → `pt-BR`) y, si no, el idioma sin región (`fr_CA.UTF-8` → `fr`); si no está
 * entre los registrados, inglés.
 */
export function localeFromEnv(values: readonly (string | undefined)[]): Locale {
  const first = values.find(value => value !== undefined && value !== '' && value !== 'C')
  const match =
    first === undefined ? null : /^([a-z]{2,3})(?:[_-]([a-z]{2}))?(?=[_.@:-]|$)/i.exec(first)
  if (match) {
    const base = match[1]!.toLowerCase()
    const region = match[2]?.toUpperCase()
    const found =
      LOCALES.find(code => region !== undefined && code === `${base}-${region}`) ??
      LOCALES.find(code => code === base)
    if (found !== undefined) return found
  }
  return REFERENCE_LOCALE
}
