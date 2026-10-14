// SPDX-License-Identifier: AGPL-3.0-or-later
// Comandos del mod: validan la entrada, llaman al servidor y responden corto y con gracia.

import type { Io } from './io.ts'
import { PROTOCOL_VERSION, TEXT_LIMITS } from '../generated/protocol.ts'
import type { ItemId } from '../generated/protocol.ts'
import { callApi, debug, isUnauthorized } from './api.ts'
import type { ApiFailure } from './api.ts'
import { cancelLogin, startLogin } from './auth.ts'
import type { AuthState } from './auth.ts'
import { isPlainHttpRemote, normalizeServerUrl } from './config.ts'
import type { ModConfig } from './config.ts'
import { formatCoins } from './format.ts'
import { ITEM_GLYPHS, inventoryOf, isArmed, isConsumableId, resolveItem } from './items.ts'
import type { InventoryView, PocketItem } from './items.ts'
import {
  MAX_BET_TARGET_LENGTH,
  betBody,
  deleteAccountBody,
  emptyBody,
  itemArmBody,
  newRequestId,
  normalizeReferralCode,
  parseBetAmount,
  referralRedeemBody,
  settingsBody,
  shopBuyBody,
} from './payloads.ts'
import type { BetAmount } from './payloads.ts'
import {
  cleanText,
  isBet,
  isItemArm,
  isMeta,
  isOk,
  isReferral,
  isReferralRedeem,
  isSettings,
  isShop,
  isShopBuy,
} from './responses.ts'
import type { ShopItemView } from './responses.ts'
import {
  clearSession,
  loadSession,
  manifestDefault,
  refreshMe,
  refreshStatus,
  rememberInventory,
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
  // Cuenta de GitHub aún demasiado nueva: ni puesto ni "sin puesto", sino desde cuándo sale.
  const wait = me.user.newAccount ?? null
  const rank = me.user.hidden
    ? m.rankHidden
    : wait !== null
      ? m.rankNewAccount(wait.rankedFrom)
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
  const lines = [text]
  const pending = me.wallet.pendingSpins ?? 0
  if (pending > 0) lines.push(m.pendingHint(pending, coins(pending)))
  const pocket = pocketLine(runtime, inventoryOf(me.inventory), 'balance')
  if (pocket !== null) lines.push(pocket)
  return lines.join('\n')
}

/** `🐇 Pata de Conejo™ ×36` (y "armado" en la tienda). */
function pocketItemText(runtime: Runtime, item: PocketItem, markArmed: boolean): string {
  const m = runtime.messages.shop
  const count = formatCoins(item.charges, runtime.locale)
  const text = `${ITEM_GLYPHS[item.id]} ${m.itemName(item.id)} ×${count}`
  return markArmed && isArmed(item) ? `${text} (${m.pocketArmed})` : text
}

/**
 * Línea del bolsillo: en `/balance`, lo armado (o lo que tienes sin armar); en `/vibe-shop`, todo
 * con su marca de armado. null si no hay nada que contar.
 */
function pocketLine(
  runtime: Runtime,
  inventory: InventoryView | null,
  where: 'balance' | 'shop',
): string | null {
  const m = runtime.messages.shop
  const items = (inventory?.items ?? []).filter(item => item.charges > 0)
  if (where === 'shop') {
    if (items.length === 0) return m.pocketEmpty
    return m.pocket(items.map(item => pocketItemText(runtime, item, true)).join(' · '))
  }
  if (items.length === 0) return null
  const armed = items.filter(isArmed)
  const list = (xs: readonly PocketItem[]) =>
    xs.map(item => pocketItemText(runtime, item, false)).join(' · ')
  return armed.length > 0 ? m.balanceArmed(list(armed)) : m.balancePocket(list(items))
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
 * Cambio de servidor ya comprobado: el hook de `/vibe-server` guarda `url` en la opción
 * `vibe-gambling.serverUrl` y contesta con `reply`, que recibe el `deny` del engine si lo hay.
 */
export interface ServerChange {
  readonly url: string
  readonly reply: (deny: string | undefined) => string
}

/**
 * `/vibe-server [url|default]`. Sin argumento enseña el actual; con una URL comprueba
 * `/api/meta` (protocolo compatible) y devuelve el cambio para que el hook lo guarde con
 * `$.config.set`, que recarga el mod con la nueva configuración. Las sesiones van por servidor.
 */
export async function server(ctx: CommandContext, raw: string): Promise<string | ServerChange> {
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
  const name = nameOf(meta.data.name)
  const isOfficial = meta.data.isOfficial
  return {
    url,
    reply: deny =>
      deny !== undefined ? m.serverChangeDenied(deny) : m.serverChanged(url, name, isOfficial),
  }
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

// ------------------------------------------------------------------ /vibe-invite, /vibe-redeem

/** `/vibe-invite`: tu enlace de afiliado, tu código y las cuentas de tu pirámide. */
export async function invite(ctx: CommandContext): Promise<string> {
  const { io, runtime, config } = ctx
  const m = runtime.messages
  const session = await requireSession(ctx)
  if (session === null) return m.notLoggedIn
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'referral',
    guard: isReferral,
    timeoutMs: config.commandTimeoutMs,
    token: session.token,
  })
  if (!result.ok) return failureText(ctx, result)
  const r = result.data.referral
  const coins = (n: number): string => formatCoins(n, runtime.locale)
  // El enlace y el código vienen del servidor: se limpian antes de enseñarlos en el terminal.
  const code = cleanText(r.code, 16)
  const lines = [
    m.inviteHeader,
    m.inviteLink(cleanText(r.url, 200), code),
    m.inviteStats({
      invited: coins(r.invited),
      activated: coins(r.activated),
      waiting: coins(r.waiting),
      earned: coins(r.earned),
      commissions: coins(r.season.commissions),
      cap: coins(r.season.cap),
    }),
    m.inviteActivation({
      bonus: coins(r.rules.welcomeBonus),
      code,
      commission: coins(r.rules.commission),
      spins: coins(r.rules.activationSpins),
      days: r.rules.minAccountAgeDays,
    }),
  ]
  if (r.invitedBy !== null) lines.push(m.inviteRedeemed(coins(r.invitedBy.bonus)))
  else if (r.canRedeem) lines.push(m.inviteCanRedeem(r.redeemUntil, coins(r.rules.welcomeBonus)))
  return lines.join('\n')
}

/** `/vibe-redeem <código>`: canjea el código de quien te invitó (una vez en la vida). */
export async function redeem(ctx: CommandContext, raw: string): Promise<string> {
  const { io, runtime, config } = ctx
  const m = runtime.messages
  const [arg] = argsOf(raw)
  if (arg === undefined) return m.redeemUsage
  const code = normalizeReferralCode(arg)
  if (code === null) return m.redeemBadCode(arg.slice(0, 40))
  const session = await requireSession(ctx)
  if (session === null) return m.notLoggedIn
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'referralRedeem',
    guard: isReferralRedeem,
    timeoutMs: config.commandTimeoutMs,
    token: session.token,
    body: referralRedeemBody(code),
  })
  if (!result.ok) return failureText(ctx, result)
  const data = result.data
  if (data.status === 'rejected') return m.redeemRejected(data.reason)
  showWallet(io, runtime, data.wallet)
  const coins = (n: number): string => formatCoins(n, runtime.locale)
  const login = data.inviter === null ? null : cleanText(data.inviter.login, TEXT_LIMITS.login)
  return m.redeemed(coins(data.bonus), coins(data.wallet.balance), login)
}
// ------------------------------------------------------------------ /vibe-shop, /vibe-use

/** Palabras que piden comprar en `/vibe-shop`. */
const BUY_WORDS = new Set(['buy', 'comprar', 'compra', 'acheter', 'kaufen'])
/** Palabras que desarman en `/vibe-use`. */
const OFF_WORDS = new Set(['off', 'no', 'desarmar', 'disarm', 'aus'])

/** Cifra con hasta dos decimales en el formato del idioma (la letra pequeña). */
function decimal(runtime: Runtime, value: number): string {
  return new Intl.NumberFormat(runtime.locale, {
    maximumFractionDigits: 2,
  }).format(value)
}

/** La letra pequeña de un artículo, con los números que manda el servidor. */
function finePrintText(runtime: Runtime, item: ShopItemView): string {
  const m = runtime.messages.shop
  const edge = decimal(runtime, item.finePrint.minEdge)
  if (item.kind === 'cosmetic') return m.edgeCosmetic(edge)
  if (item.kind === 'service') {
    return m.edgeRevert(decimal(runtime, item.finePrint.maxExpected), edge)
  }
  if (item.finePrint.maxExpected === 0) return m.edgePlacebo(edge)
  return m.edge(decimal(runtime, item.finePrint.maxExpected), edge)
}

function shopLine(runtime: Runtime, item: ShopItemView): string {
  const m = runtime.messages.shop
  const coins = (n: number): string => formatCoins(n, runtime.locale)
  const parts = [
    `${ITEM_GLYPHS[item.id]} ${m.itemName(item.id)} — ${coins(item.price)} ${runtime.messages.coin}`,
  ]
  if (item.charges > 0) parts.push(m.charges(item.charges, coins(item.charges)))
  if (item.kind === 'cosmetic') {
    if (item.owned) parts.push(m.owned)
  } else if (item.maxPerSeason !== null) {
    parts.push(
      item.bought >= item.maxPerSeason
        ? m.soldOut
        : m.bought(coins(item.bought), coins(item.maxPerSeason)),
    )
  }
  parts.push(m.itemTag(item.id), finePrintText(runtime, item))
  return parts.join(' · ')
}

/** `/vibe-shop`: catálogo, letra pequeña y bolsillo. `/vibe-shop buy <objeto>`: compra. */
export async function shop(ctx: CommandContext, raw: string): Promise<string> {
  const m = ctx.runtime.messages.shop
  const [first, ...rest] = argsOf(raw)
  if (first === undefined) return catalogue(ctx)
  if (!BUY_WORDS.has(first.toLowerCase()) || rest.length === 0) return m.usage
  const wanted = rest.join(' ')
  const itemId = resolveItem(wanted)
  if (itemId === null) return m.unknownItem(wanted.slice(0, 40))
  return buy(ctx, itemId, rest.join(' '))
}

async function catalogue(ctx: CommandContext): Promise<string> {
  const { io, runtime, config } = ctx
  const m = runtime.messages.shop
  const session = await requireSession(ctx)
  if (session === null) return runtime.messages.notLoggedIn
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'shop',
    guard: isShop,
    timeoutMs: config.commandTimeoutMs,
    token: session.token,
  })
  if (!result.ok) return failureText(ctx, result)
  const data = result.data.shop
  const inventory = rememberInventory(runtime, data.inventory)
  const lines = [m.header(cleanText(data.seasonId, 7), data.seasonEndsAt)]
  if (inventory !== null && !inventory.enabled) lines.push(m.closedNote)
  const goods = data.items.filter(item => item.kind !== 'cosmetic')
  const cosmetics = data.items.filter(item => item.kind === 'cosmetic')
  lines.push(...goods.map(item => shopLine(runtime, item)))
  if (cosmetics.length > 0) {
    lines.push(m.cosmetics, ...cosmetics.map(item => `  ${shopLine(runtime, item)}`))
  }
  lines.push(pocketLine(runtime, inventory, 'shop') ?? m.pocketEmpty)
  const undo = inventory?.revert ?? null
  const undoPrice = data.items.find(item => item.kind === 'service')?.price
  if (undo !== null && undoPrice !== undefined) {
    const coins = (n: number): string => formatCoins(n, runtime.locale)
    lines.push(m.revertAvailable(coins(undo.refund), coins(undoPrice), undo.until))
  }
  if (data.canBorrow) lines.push(m.borrow)
  lines.push(m.footer)
  return lines.join('\n')
}

/** Motivo de un `conflict` al comprar, según lo que se compra. */
function conflictText(runtime: Runtime, itemId: ItemId): string {
  const m = runtime.messages.shop
  const name = m.itemName(itemId)
  if (isConsumableId(itemId)) return m.soldOutFor(name)
  if (itemId.startsWith('felt_') || itemId.startsWith('chips_')) return m.alreadyOwned(name)
  return m.nothingToRevert
}

async function buy(ctx: CommandContext, itemId: ItemId, alias: string): Promise<string> {
  const { io, runtime, config } = ctx
  const m = runtime.messages.shop
  const session = await requireSession(ctx)
  if (session === null) return runtime.messages.notLoggedIn
  // Un id por compra: si la red falla y se reintenta, el servidor ve la misma compra y no cobra
  // dos veces.
  const body = shopBuyBody(itemId, newRequestId())
  const send = () =>
    callApi(io, {
      baseUrl: config.serverUrl,
      route: 'shopBuy',
      guard: isShopBuy,
      timeoutMs: config.commandTimeoutMs,
      token: session.token,
      body,
    })
  let result = await send()
  if (!result.ok && (result.reason === 'timeout' || result.reason === 'offline')) {
    debug(io, 'shop/buy: sin respuesta; reintento con el mismo requestId')
    result = await send()
  }
  if (!result.ok) {
    if (result.reason === 'http') {
      const name = m.itemName(itemId)
      switch (result.error) {
        case 'insufficient_funds':
          return m.noFunds(name)
        case 'conflict':
          return conflictText(runtime, itemId)
        case 'not_found':
          return m.closed
        case 'rate_limited':
          return m.cooldown
        default:
          break
      }
    }
    return failureText(ctx, result)
  }
  const data = result.data
  rememberInventory(runtime, data.inventory)
  showWallet(io, runtime, data.wallet)
  const coins = (n: number): string => formatCoins(n, runtime.locale)
  const balance = coins(data.wallet.balance)
  const name = m.itemName(data.itemId)
  if (isConsumableId(data.itemId)) {
    const charges = runtime.inventory?.items.find(item => item.id === data.itemId)?.charges ?? 0
    return m.boughtConsumable({
      name,
      charges: coins(charges),
      price: coins(data.price),
      balance,
      alias: cleanText(alias, 24),
    })
  }
  if (data.itemId.startsWith('felt_') || data.itemId.startsWith('chips_')) {
    return m.boughtCosmetic(name, coins(data.price), balance)
  }
  return m.boughtRevert(coins(data.price), coins(data.refund), balance)
}

/** `/vibe-use <objeto> [off]`: arma (o desarma) un consumible para la próxima tirada. */
export async function use(ctx: CommandContext, raw: string): Promise<string> {
  const { io, runtime, config } = ctx
  const m = runtime.messages.shop
  const words = argsOf(raw)
  const last = words.at(-1)?.toLowerCase()
  const off = last !== undefined && OFF_WORDS.has(last) && words.length > 1
  const wanted = (off ? words.slice(0, -1) : words).join(' ')
  if (wanted === '') return m.useUsage
  const itemId = resolveItem(wanted)
  if (itemId === null) return m.unknownItem(wanted.slice(0, 40))
  const name = m.itemName(itemId)
  if (!isConsumableId(itemId)) return m.notConsumable(name)
  const session = await requireSession(ctx)
  if (session === null) return runtime.messages.notLoggedIn
  const result = await callApi(io, {
    baseUrl: config.serverUrl,
    route: 'itemArm',
    guard: isItemArm,
    timeoutMs: config.commandTimeoutMs,
    token: session.token,
    body: itemArmBody(itemId, !off),
  })
  if (!result.ok) {
    if (result.reason === 'http' && result.error === 'conflict') return m.armConflict(name)
    if (result.reason === 'http' && result.error === 'not_found') return m.closed
    return failureText(ctx, result)
  }
  const inventory = rememberInventory(runtime, result.data.inventory)
  // La status line enseña el glifo ya, sin esperar a la siguiente tirada.
  refreshStatus(io, runtime)
  if (off) return m.disarmed(name)
  const charges = inventory?.items.find(item => item.id === itemId)?.charges ?? 0
  return m.armed(name, formatCoins(charges, runtime.locale))
}
