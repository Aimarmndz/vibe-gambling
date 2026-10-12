// SPDX-License-Identifier: AGPL-3.0-or-later
// Textos del mod en inglés y español (el idioma del sistema; inglés por defecto).
// Las frases de ludópata vienen de `shared` (copia generada en `../generated`). Módulo puro.
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
  readonly loggedOut: string
  readonly notLoggedInLogout: string

  readonly hidden: string
  readonly shown: string

  readonly serverCurrent: (url: string, name: string, official: boolean | null) => string
  readonly serverBadUrl: (raw: string) => string
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

const en: Messages = {
  coin: '🪙',
  colors: { red: 'red', black: 'black', green: 'green' },
  debtLabel: 'debt',
  statusOffline: '🎰 offline',
  statusLogin: '🎰 /vibe-login',
  statusBadConfig: '🎰 bad config',
  loginHint: '🎰 Every prompt is a spin. Run /vibe-login to take a seat at the table.',
  jackpotTag: '🚀 JACKPOT',
  noRound: 'The wheel stopped without you. Next prompt, next spin.',

  commands: {
    roulette: { description: 'Open the roulette window' },
    bet: {
      description: 'Bet fake coins on the current or next spin',
      argumentHint: '<amount> <square>',
    },
    allIn: { description: 'Bet your whole balance (red by default)', argumentHint: '[square]' },
    balance: { description: 'Balance, debt, net worth and rank' },
    login: { description: 'Log in with GitHub (device code)' },
    logout: { description: 'Log out of vibe-gambling' },
    hide: { description: 'Hide from the public leaderboard' },
    show: { description: 'Show up on the public leaderboard again' },
    server: {
      description: 'Show or change the vibe-gambling server',
      argumentHint: '[url|default]',
    },
    deleteAccount: { description: 'Delete your account and all its data', argumentHint: '<login>' },
  },

  notLoggedIn: "You're not logged in. Run /vibe-login first.",
  offline:
    '🎰 The casino is unreachable right now. Your fake coins are safe (they were never real).',
  serverError: detail => `The server said no: ${detail}`,
  badConfig: errors => `vibe-gambling is misconfigured: ${errors}. Fix it in /config.`,
  sessionExpired: 'Your session expired. Run /vibe-login again.',

  openingWindow: '🎰 Opening the table…',
  windowFailed: "Couldn't open the window. Is there a browser around?",

  betUsage: 'Usage: /bet <amount> <square>, e.g. /bet 200 red, /bet 50 17, /bet 100 1st12',
  allInUsage: 'Usage: /all-in [square], e.g. /all-in black',
  betBadAmount: raw => `"${raw}" is not an amount. Whole fake coins only (or "all-in").`,
  betBadTarget: raw => `"${raw}" is too long to be a square on this table.`,
  betPlaced: (amount, target, round, balance) =>
    `🎰 ${amount} on ${target} (${round === 'current' ? 'this spin' : 'next spin'}). Balance: ${balance}.`,
  insufficientFunds:
    "Not enough fake coins. The Ludo-Credit Express is in the window, if you're brave.",
  tooManyBets: 'Too many chips on the table for one spin. Even addicts have limits.',
  invalidBet: target => `"${target}" is not a square on this table.`,

  balance: (balance, debt, netWorth, rank) =>
    `🎰 Balance ${balance} · Debt ${debt} · Net worth ${netWorth} · ${rank}`,
  rankHidden: 'hidden from the leaderboard',
  rankNone: 'not ranked yet',

  alreadyLoggedIn: login => `You're already logged in as @${login}. /vibe-logout first to switch.`,
  loginPrompt: (uri, code, minutes) =>
    `🎰 Go to ${uri} and enter ${code}. You have ${minutes} min; I'll keep checking in the background.`,
  loginInProgress: (uri, code) => `Still waiting: go to ${uri} and enter ${code}.`,
  loginWelcome: login => `🎰 Welcome to the table, @${login}.`,
  loginPublicNotice:
    'Heads-up: you appear on the public leaderboard (login and avatar). /vibe-hide to vanish.',
  loginExpired: 'The login code expired. Run /vibe-login to get a new one.',
  loginDenied: 'GitHub login was cancelled. The table will wait.',
  loggedOut: '🎰 Logged out. The wheel will miss you.',
  notLoggedInLogout: "You weren't logged in. Mission accomplished anyway.",

  hidden: "🎰 You're hidden from the leaderboard (and the Hall of Ruin).",
  shown: "🎰 You're back on the leaderboard. Shame is public again.",

  serverCurrent: (url, name, official) =>
    `🎰 Server: ${url}${name === '' ? '' : ` — ${name}`}${
      official === null ? ' (unreachable)' : official ? ' (official)' : ' (self-hosted)'
    }`,
  serverBadUrl: raw => `"${raw}" is not an http(s) URL.`,
  serverUnreachable: url => `Couldn't reach ${url}/api/meta. Server not changed.`,
  serverIncompatible: (url, protocol, expected) =>
    `${url} speaks protocol v${protocol}, this mod speaks v${expected}. Server not changed.`,
  serverChanged: (url, name, official) =>
    `🎰 Now playing at ${url} — ${name}${official ? ' (official)' : ' (self-hosted)'}. Log in there with /vibe-login.`,
  serverChangeDenied: reason => `Couldn't save the server: ${reason}`,
  officialTag: 'official',
  selfHostedTag: 'self-hosted',

  deleteUsage: login =>
    `This deletes your account and every spin, forever. To confirm, type: /vibe-delete-account ${login}`,
  deleteMismatch: "That's not your login. Nothing was deleted.",
  deleted: '🎰 Account deleted. All data is gone. The house thanks you for playing.',
}

const es: Messages = {
  coin: '🪙',
  colors: { red: 'rojo', black: 'negro', green: 'verde' },
  debtLabel: 'deuda',
  statusOffline: '🎰 sin conexión',
  statusLogin: '🎰 /vibe-login',
  statusBadConfig: '🎰 config rota',
  loginHint: '🎰 Cada prompt es una tirada. Usa /vibe-login para sentarte a la mesa.',
  jackpotTag: '🚀 JACKPOT',
  noRound: 'La ruleta paró sin ti. Siguiente prompt, siguiente tirada.',

  commands: {
    roulette: { description: 'Abre la ventana de la ruleta' },
    bet: {
      description: 'Apuesta monedas de mentira a la tirada actual o la siguiente',
      argumentHint: '<cantidad> <casilla>',
    },
    allIn: {
      description: 'Apuesta todo tu saldo (al rojo por defecto)',
      argumentHint: '[casilla]',
    },
    balance: { description: 'Saldo, deuda, patrimonio y puesto' },
    login: { description: 'Entra con GitHub (código de dispositivo)' },
    logout: { description: 'Cierra la sesión de vibe-gambling' },
    hide: { description: 'Ocúltate del ranking público' },
    show: { description: 'Vuelve a aparecer en el ranking público' },
    server: {
      description: 'Muestra o cambia el servidor de vibe-gambling',
      argumentHint: '[url|default]',
    },
    deleteAccount: { description: 'Borra tu cuenta y todos sus datos', argumentHint: '<login>' },
  },

  notLoggedIn: 'No has entrado. Usa /vibe-login primero.',
  offline: '🎰 El casino no responde. Tus monedas están a salvo (nunca fueron de verdad).',
  serverError: detail => `El servidor dice que no: ${detail}`,
  badConfig: errors => `vibe-gambling está mal configurado: ${errors}. Arréglalo en /config.`,
  sessionExpired: 'Tu sesión ha caducado. Vuelve a usar /vibe-login.',

  openingWindow: '🎰 Abriendo la mesa…',
  windowFailed: 'No he podido abrir la ventana. ¿Hay algún navegador por ahí?',

  betUsage: 'Uso: /bet <cantidad> <casilla>, p. ej. /bet 200 rojo, /apostar 50 17, /bet 100 1a12',
  allInUsage: 'Uso: /all-in [casilla], p. ej. /all-in negro',
  betBadAmount: raw => `"${raw}" no es una cantidad. Solo monedas enteras (o "all-in").`,
  betBadTarget: raw => `"${raw}" es demasiado largo para ser una casilla de esta mesa.`,
  betPlaced: (amount, target, round, balance) =>
    `🎰 ${amount} a ${target} (${round === 'current' ? 'esta tirada' : 'la siguiente'}). Saldo: ${balance}.`,
  insufficientFunds: 'No te llega. El Ludo-Crédito Express te espera en la ventana, si te atreves.',
  tooManyBets: 'Demasiadas fichas para una tirada. Hasta los ludópatas tienen límites.',
  invalidBet: target => `"${target}" no es una casilla de esta mesa.`,

  balance: (balance, debt, netWorth, rank) =>
    `🎰 Saldo ${balance} · Deuda ${debt} · Patrimonio ${netWorth} · ${rank}`,
  rankHidden: 'oculto del ranking',
  rankNone: 'aún sin puesto',

  alreadyLoggedIn: login => `Ya has entrado como @${login}. Usa /vibe-logout antes para cambiar.`,
  loginPrompt: (uri, code, minutes) =>
    `🎰 Ve a ${uri} y escribe ${code}. Tienes ${minutes} min; yo voy comprobando en segundo plano.`,
  loginInProgress: (uri, code) => `Sigo esperando: ve a ${uri} y escribe ${code}.`,
  loginWelcome: login => `🎰 Bienvenido a la mesa, @${login}.`,
  loginPublicNotice:
    'Ojo: apareces en el ranking público (usuario y avatar). Usa /vibe-hide para desaparecer.',
  loginExpired: 'El código ha caducado. Usa /vibe-login para pedir otro.',
  loginDenied: 'Has cancelado el login en GitHub. La mesa esperará.',
  loggedOut: '🎰 Sesión cerrada. La ruleta te echará de menos.',
  notLoggedInLogout: 'No habías entrado. Misión cumplida igualmente.',

  hidden: '🎰 Estás oculto del ranking (y del Salón de la Ruina).',
  shown: '🎰 Vuelves al ranking. La vergüenza vuelve a ser pública.',

  serverCurrent: (url, name, official) =>
    `🎰 Servidor: ${url}${name === '' ? '' : ` — ${name}`}${
      official === null ? ' (no responde)' : official ? ' (oficial)' : ' (self-host)'
    }`,
  serverBadUrl: raw => `"${raw}" no es una URL http(s).`,
  serverUnreachable: url => `No he podido llegar a ${url}/api/meta. No cambio de servidor.`,
  serverIncompatible: (url, protocol, expected) =>
    `${url} habla el protocolo v${protocol} y este mod el v${expected}. No cambio de servidor.`,
  serverChanged: (url, name, official) =>
    `🎰 Ahora juegas en ${url} — ${name}${official ? ' (oficial)' : ' (self-host)'}. Entra ahí con /vibe-login.`,
  serverChangeDenied: reason => `No he podido guardar el servidor: ${reason}`,
  officialTag: 'oficial',
  selfHostedTag: 'self-host',

  deleteUsage: login =>
    `Esto borra tu cuenta y todas tus tiradas para siempre. Para confirmarlo escribe: /vibe-delete-account ${login}`,
  deleteMismatch: 'Ese no es tu usuario. No he borrado nada.',
  deleted: '🎰 Cuenta borrada. No queda nada. La casa te agradece tu visita.',
}

export const MESSAGES: Readonly<Record<Locale, Messages>> = { en, es }

/**
 * Idioma a partir de las variables de locale del sistema (`LC_ALL`, `LC_MESSAGES`, `LANG`,
 * `LANGUAGE`, en ese orden). Español si empieza por `es`; inglés en cualquier otro caso.
 */
export function localeFromEnv(values: readonly (string | undefined)[]): Locale {
  const first = values.find(value => value !== undefined && value !== '' && value !== 'C')
  return first !== undefined && /^es([_.@:-]|$)/i.test(first) ? 'es' : 'en'
}
