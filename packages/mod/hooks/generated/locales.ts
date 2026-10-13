// SPDX-License-Identifier: AGPL-3.0-or-later
// GENERADO por scripts/gen-locales.ts a partir de locales/*/{meta,phrases,mod}.json. No lo edites a mano.
// Idiomas del mod: metadatos, frases de ludópata y textos de cada uno.
import type { PhraseCatalog } from './phrases.ts'
import type { Locale } from './protocol.ts'
import { phrasesEn } from './phrases.en.ts'
import { modTextsEn } from './texts.en.ts'
import { phrasesEs } from './phrases.es.ts'
import { modTextsEs } from './texts.es.ts'
import { phrasesFr } from './phrases.fr.ts'
import { modTextsFr } from './texts.fr.ts'
import { phrasesDe } from './phrases.de.ts'
import { modTextsDe } from './texts.de.ts'

export const REFERENCE_LOCALE = 'en' as const

/** Claves de los textos del mod (las del idioma de referencia). */
export type ModTextKey =
  | 'coin'
  | 'color.red'
  | 'color.black'
  | 'color.green'
  | 'debtLabel'
  | 'statusOffline'
  | 'statusLogin'
  | 'statusBadConfig'
  | 'loginHint'
  | 'jackpotTag'
  | 'noRound'
  | 'pendingCount'
  | 'pendingCount.one'
  | 'spinSaved'
  | 'spinSaved.one'
  | 'spinDropped'
  | 'spinDropped.one'
  | 'pendingHint'
  | 'pendingHint.one'
  | 'command.roulette.description'
  | 'command.bet.description'
  | 'command.bet.argumentHint'
  | 'command.allIn.description'
  | 'command.allIn.argumentHint'
  | 'command.balance.description'
  | 'command.login.description'
  | 'command.logout.description'
  | 'command.hide.description'
  | 'command.show.description'
  | 'command.server.description'
  | 'command.server.argumentHint'
  | 'command.deleteAccount.description'
  | 'command.deleteAccount.argumentHint'
  | 'notLoggedIn'
  | 'offline'
  | 'serverError'
  | 'badConfig'
  | 'sessionExpired'
  | 'openingWindow'
  | 'windowFailed'
  | 'betUsage'
  | 'allInUsage'
  | 'betBadAmount'
  | 'betBadTarget'
  | 'betPlaced'
  | 'betRound.current'
  | 'betRound.next'
  | 'insufficientFunds'
  | 'tooManyBets'
  | 'invalidBet'
  | 'balance'
  | 'rankHidden'
  | 'rankNone'
  | 'rankNewAccount'
  | 'alreadyLoggedIn'
  | 'loginPrompt'
  | 'loginInProgress'
  | 'loginWelcome'
  | 'loginPublicNotice'
  | 'loginNewAccount'
  | 'loginExpired'
  | 'loginDenied'
  | 'loginFailed'
  | 'loggedOut'
  | 'notLoggedInLogout'
  | 'hidden'
  | 'shown'
  | 'serverCurrent'
  | 'serverNameSuffix'
  | 'serverState.unreachable'
  | 'serverState.official'
  | 'serverState.selfHosted'
  | 'serverBadUrl'
  | 'serverNeedsHttps'
  | 'serverUnreachable'
  | 'serverIncompatible'
  | 'serverChanged'
  | 'serverChangeDenied'
  | 'officialTag'
  | 'selfHostedTag'
  | 'deleteUsage'
  | 'deleteMismatch'
  | 'deleted'
  | 'dailyLimit'
  | 'command.invite.description'
  | 'command.redeem.description'
  | 'command.redeem.argumentHint'
  | 'inviteHeader'
  | 'inviteLink'
  | 'inviteStats'
  | 'inviteActivation'
  | 'inviteActivationAge'
  | 'inviteCanRedeem'
  | 'inviteRedeemed'
  | 'redeemUsage'
  | 'redeemBadCode'
  | 'redeemed'
  | 'redeemedAnon'
  | 'redeemRejected.not_found'
  | 'redeemRejected.own_code'
  | 'redeemRejected.already_redeemed'
  | 'redeemRejected.cycle'
  | 'redeemRejected.too_late'
  | 'redeemRejected.too_many_spins'
export type ModTexts = Readonly<Record<ModTextKey, string>>

export interface LocaleInfo {
  readonly bcp47: string
  readonly nativeName: string
  /** Separador de miles de las cifras. */
  readonly groupSeparator: string
}

export const LOCALE_INFO: Readonly<Record<Locale, LocaleInfo>> = {
  en: { bcp47: 'en', nativeName: 'English', groupSeparator: ',' },
  es: { bcp47: 'es-ES', nativeName: 'Español', groupSeparator: '.' },
  fr: { bcp47: 'fr-FR', nativeName: 'Français', groupSeparator: ' ' },
  de: { bcp47: 'de-DE', nativeName: 'Deutsch', groupSeparator: '.' },
}
export const PHRASES: Readonly<Record<Locale, PhraseCatalog>> = {
  en: phrasesEn,
  es: phrasesEs,
  fr: phrasesFr,
  de: phrasesDe,
}
export const MOD_TEXTS: Readonly<Record<Locale, ModTexts>> = {
  en: modTextsEn,
  es: modTextsEs,
  fr: modTextsFr,
  de: modTextsDe,
}
