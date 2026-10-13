// SPDX-License-Identifier: AGPL-3.0-or-later
// Comandos del mod: validan la entrada, llaman al servidor y responden corto y con gracia.

import type { Io } from './io.ts'
import { PROTOCOL_VERSION, TEXT_LIMITS } from '../generated/protocol.ts'
import { callApi, debug, isUnauthorized } from './api.ts'
import type { ApiFailure } from './api.ts'
import { cancelLogin, startLogin } from './auth.ts'
import type { AuthState } from './auth.ts'
import { isPlainHttpRemote, normalizeServerUrl } from './config.ts'
import type { ModConfig } from './config.ts'
import { formatCoins } from './format.ts'
import {
  MAX_BET_TARGET_LENGTH,
  betBody,
  deleteAccountBody,
  emptyBody,
  parseBetAmount,
  settingsBody,
} from './payloads.ts'
import type { BetAmount } from './payloads.ts'
import { cleanText, isBet, isMeta, isOk, isSettings } from './responses.ts'
import {
  clearSession,
  loadSession,
  manifestDefault,
  refreshMe,
  setStatus,
  showWallet,
} from './runtime.ts'
import type { Runtime, StoredSession } from './runtime.ts'
import { openWindow } from './window.ts'
import type { WindowState } from './window.ts'

export interface CommandContext {
  readonly io: Io
  readonly runtime: Runtime
  readonly config: ModConfig
  readonly auth: AuthState
  readonly window: WindowState
}

/** Texto para un fallo de la API; si la sesión ya no vale, la olvida. */
async function failureText(ctx: CommandContext, failure: ApiFailure): Promise<string> {
  const { io, runtime, config } = ctx
  const m = runtime.messages
  if (isUnauthorized(failure)) {
    await clearSession(io, config.serverUrl)
    setStatus(io, m.statusLogin)
    return m.sessionExpired
  }
  if (failure.reason !== 'http') {
    setStatus(io, m.statusOffline)
    return m.offline
  }
  switch (failure.error) {
    case 'insufficient_funds':
      return m.insufficientFunds
    case 'too_many_bets':
      return m.tooManyBets
    default:
      return m.serverError(failure.message ?? `HTTP ${failure.status}`)
  }
}

async function requireSession(ctx: CommandContext): Promise<StoredSession | null> {
  return loadSession(ctx.io, ctx.config.serverUrl)
}

/** Separa los argumentos por espacios. */
function argsOf(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .filter(arg => arg !== '')
}

// ------------------------------------------------------------------ /roulette

export async function roulette(ctx: CommandContext): Promise<string> {
  const session = await requireSession(ctx)
  if (session === null) return ctx.runtime.messages.notLoggedIn
  const result = await openWindow(ctx.io, ctx.runtime, ctx.config, session, ctx.window, {
    force: true,
    timeoutMs: ctx.config.commandTimeoutMs,
  })
  switch (result.status) {
    case 'link-failed':
      // Sin enlace no hay ventana: sesión caducada, servidor caído… se dice lo que pasa de verdad.
      return failureText(ctx, result.failure)
    case 'opened':
    case 'skipped': // ya se estaba abriendo una
      return ctx.runtime.messages.openingWindow
    case 'failed':
      return ctx.runtime.messages.windowFailed
  }
}

// ------------------------------------------------------------------ /bet, /all-in

async function placeBet(ctx: CommandContext, amount: BetAmount, target: string): Promise<string> {
  const { io, runtime, config } = ctx
  const m = runtime.messages
  if (target.length > MAX_BET_TARGET_LENGTH) return m.betBadTarget(target.slice(0, 40))
  const session = await requireSession(ctx)
  if (session === null) return m.notLoggedIn
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'bet',
    guard: isBet,
    timeoutMs: config.commandTimeoutMs,
    token: session.token,
    body: betBody(amount, target),
  })
  if (!result.ok) {
    if (result.reason === 'http' && result.error === 'invalid_bet') return m.invalidBet(target)
    return failureText(ctx, result)
  }
  showWallet(io, runtime, result.data.wallet)
  const shown = amount === 'all-in' ? 'ALL-IN' : `${formatCoins(amount, runtime.locale)} ${m.coin}`
  return m.betPlaced(
    shown,
    target,
    result.data.forRound,
    formatCoins(result.data.wallet.balance, runtime.locale),
  )
}

/** `/bet <cantidad> <casilla>` (la casilla puede llevar espacios: `/bet 50 8 9 11 12`). */
export async function bet(ctx: CommandContext, raw: string): Promise<string> {
  const m = ctx.runtime.messages
  const [amountText, ...rest] = argsOf(raw)
  if (amountText === undefined || rest.length === 0) return m.betUsage
  const amount = parseBetAmount(amountText)
  if (amount === null) return m.betBadAmount(amountText.slice(0, 40))
  return placeBet(ctx, amount, rest.join(' '))
}

/** `/all-in [casilla]`: todo el saldo, al rojo si no se dice nada. */
export async function allIn(ctx: CommandContext, raw: string): Promise<string> {
  const target = argsOf(raw).join(' ')
  return placeBet(ctx, 'all-in', target === '' ? 'red' : target)
}

// ------------------------------------------------------------------ /balance

export async function balance(ctx: CommandContext): Promise<string> {
  const { runtime, config } = ctx
  const m = runtime.messages
  const session = await requireSession(ctx)
  if (session === null) return m.notLoggedIn
  const me = await refreshMe(ctx.io, runtime, config, session, config.commandTimeoutMs)
  if (me === null) {
    const stillThere = await requireSession(ctx)
    return stillThere === null ? m.sessionExpired : m.offline
  }
  const rank = me.user.hidden
    ? m.rankHidden
    : me.brokeRank === null
      ? m.rankNone
      : `#${me.brokeRank}`
  const coins = (n: number): string => formatCoins(n, runtime.locale)
  const text = m.balance(
    coins(me.wallet.balance),
    coins(me.wallet.debt),
    coins(me.wallet.netWorth),
    rank,
  )
  const pending = me.wallet.pendingSpins ?? 0
  return pending > 0 ? `${text}\n${m.pendingHint(pending, coins(pending))}` : text
}

// ------------------------------------------------------------------ /vibe-login, /vibe-logout

export async function login(ctx: CommandContext): Promise<string> {
  const session = await requireSession(ctx)
  if (session !== null) return ctx.runtime.messages.alreadyLoggedIn(session.login)
  return startLogin(ctx.io, ctx.runtime, ctx.config, ctx.auth)
}

export async function logout(ctx: CommandContext): Promise<string> {
  const { io, runtime, config } = ctx
  cancelLogin(ctx.auth)
  const session = await requireSession(ctx)
  if (session === null) return runtime.messages.notLoggedInLogout
  // Se olvida el token pase lo que pase; avisar al servidor es para revocarlo allí también.
  await clearSession(io, config.serverUrl)
  setStatus(io, runtime.messages.statusLogin)
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'logout',
    guard: isOk,
    timeoutMs: config.commandTimeoutMs,
    token: session.token,
    body: emptyBody(),
  })
  if (!result.ok) debug(io, 'logout: el servidor no ha confirmado la revocación del token')
  return runtime.messages.loggedOut
}

// ------------------------------------------------------------------ /vibe-hide, /vibe-show

export async function setHidden(ctx: CommandContext, hidden: boolean): Promise<string> {
  const m = ctx.runtime.messages
  const session = await requireSession(ctx)
  if (session === null) return m.notLoggedIn
  const result = await callApi(ctx.io, {
    baseUrl: ctx.config.serverUrl,
    route: 'settings',
    guard: isSettings,
    timeoutMs: ctx.config.commandTimeoutMs,
    token: session.token,
    body: settingsBody(hidden),
  })
  if (!result.ok) return failureText(ctx, result)
  return result.data.user.hidden ? m.hidden : m.shown
}

// ------------------------------------------------------------------ /vibe-server

/**
 * `/vibe-server [url|default]`. Sin argumento enseña el actual; con una URL comprueba
 * `/api/meta` (protocolo compatible) y la guarda en la opción `serverUrl` con `$.config.set`,
 * que recarga el mod con la nueva configuración. Las sesiones van por servidor.
 */
export async function server(ctx: CommandContext, raw: string): Promise<string> {
  const { io, runtime, config } = ctx
  const m = runtime.messages
  const [arg] = argsOf(raw)
  const metaOf = async (baseUrl: string) =>
    callApi(io, { baseUrl, route: 'meta', guard: isMeta, timeoutMs: config.commandTimeoutMs })
  // El nombre lo elige quien monta el servidor: se limpia antes de enseñarlo.
  const nameOf = (name: string): string => cleanText(name, TEXT_LIMITS.serverName)

  if (arg === undefined) {
    const meta = await metaOf(config.serverUrl)
    return meta.ok
      ? m.serverCurrent(config.serverUrl, nameOf(meta.data.name), meta.data.isOfficial)
      : m.serverCurrent(config.serverUrl, '', null)
  }

  const wanted = arg === 'default' ? manifestDefault('serverUrl') : arg
  if (typeof wanted === 'string' && isPlainHttpRemote(wanted)) {
    return m.serverNeedsHttps(arg.slice(0, 200))
  }
  const url = typeof wanted === 'string' ? normalizeServerUrl(wanted) : null
  if (url === null) return m.serverBadUrl(arg.slice(0, 200))
  const meta = await metaOf(url)
  if (!meta.ok) return m.serverUnreachable(url)
  if (meta.data.protocol !== PROTOCOL_VERSION) {
    return m.serverIncompatible(url, meta.data.protocol, PROTOCOL_VERSION)
  }
  cancelLogin(ctx.auth)
  const saved = await io.configSet(`${io.pluginName}.serverUrl`, url)
  if (saved.deny !== undefined) return m.serverChangeDenied(saved.deny)
  return m.serverChanged(url, nameOf(meta.data.name), meta.data.isOfficial)
}

// ------------------------------------------------------------------ /vibe-delete-account

/** Borra la cuenta. Hay que repetir el login como confirmación (el servidor lo vuelve a mirar). */
export async function deleteAccount(ctx: CommandContext, raw: string): Promise<string> {
  const { io, runtime, config } = ctx
  const m = runtime.messages
  const session = await requireSession(ctx)
  if (session === null) return m.notLoggedIn
  const [confirm] = argsOf(raw)
  if (confirm === undefined) return m.deleteUsage(session.login)
  if (confirm.replace(/^@/, '').toLowerCase() !== session.login.toLowerCase()) {
    return m.deleteMismatch
  }
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'deleteAccount',
    guard: isOk,
    timeoutMs: config.commandTimeoutMs,
    token: session.token,
    body: deleteAccountBody(session.login),
  })
  if (!result.ok) return failureText(ctx, result)
  cancelLogin(ctx.auth)
  await clearSession(io, config.serverUrl)
  setStatus(io, m.statusLogin)
  return m.deleted
}
