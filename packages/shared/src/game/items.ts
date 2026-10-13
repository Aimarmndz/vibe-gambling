// SPDX-License-Identifier: AGPL-3.0-or-later
// TIENDA: objetos y potenciadores, como lógica pura. El servidor la aplica dentro de la
// transacción de la tirada (con la cartera bloqueada) y la demo del navegador la usa tal cual.
//
// Invariantes (ver `docs/DECISIONES.md`, "Objetos y tienda"):
// - El RNG no se toca: los objetos nunca cambian el número ni `PAYOUTS`/`resolveBets`. Pagan
//   aparte, en líneas propias, como una aseguradora externa.
// - La casa siempre gana: para cualquier boleto, lo que un objeto devuelve de media en una carga
//   es ≤ lo que cuesta esa carga (`itemsConfig.ts` lo comprueba al arrancar; un test lo enumera).
// - Se decide antes del número: qué objetos actúan y cuántas cargas gastan sale de `planItems`,
//   antes de `rng.pocket()`. Las dos excepciones no cambian monedas o tienen tope fijo: el casco
//   (se gasta solo si se pierde) y `git revert` (a posteriori, pero cuesta más que su tope).
//
// Los ids del catálogo y los tipos de efecto son constantes de la lógica (como los logros): se
// guardan en la base de datos y nunca se reutilizan. Los números (precios, cargas, tasas, topes)
// están en `config/game.json → items`.
import { GROUP_BET_KINDS, PAYOUTS, SIMPLE_BET_KINDS } from '../roulette/bets.ts'
import type { Bet } from '../roulette/bets.ts'
import type { RoundOutcome } from './economy.ts'
import type { ItemsConfig } from './itemsConfig.ts'
import { insuranceMaxExpected, turboMaxExpected } from './itemsConfig.ts'
import { nextStreak } from './streaks.ts'

/** Consumibles: se compran por cargas, se arman y caducan con la temporada. En orden de tienda. */
export const CONSUMABLE_IDS = [
  'rabbit_foot',
  'oracle',
  'insurance',
  'turbo',
  'streak_helmet',
] as const
export type ConsumableId = (typeof CONSUMABLE_IDS)[number]

/** Servicios: se usan en el momento de comprarlos. */
export const SERVICE_IDS = ['revert'] as const
export type ServiceId = (typeof SERVICE_IDS)[number]

/** Tapetes. `classic` es gratis y es el de siempre. */
export const FELT_IDS = [
  'classic',
  'memory_blue',
  'montecarlo97',
  'dark_mode',
  'vaporwave',
] as const
export type FeltId = (typeof FELT_IDS)[number]

/** Juegos de fichas. `classic` es gratis y es el de siempre. */
export const CHIP_SKIN_IDS = ['classic', 'floppy', 'cinco_duros', 'bottle_cap'] as const
export type ChipSkinId = (typeof CHIP_SKIN_IDS)[number]

export const DEFAULT_FELT: FeltId = 'classic'
export const DEFAULT_CHIP_SKIN: ChipSkinId = 'classic'

/** Cosméticos de pago (los gratis no se compran): `felt_<tapete>` y `chips_<fichas>`. */
export const COSMETIC_IDS = [
  'felt_memory_blue',
  'felt_montecarlo97',
  'felt_dark_mode',
  'felt_vaporwave',
  'chips_floppy',
  'chips_cinco_duros',
  'chips_bottle_cap',
] as const
export type CosmeticId = (typeof COSMETIC_IDS)[number]

/** Todo lo que se puede comprar, en el orden de la tienda. */
export const ITEM_IDS = [...CONSUMABLE_IDS, ...SERVICE_IDS, ...COSMETIC_IDS] as const
export type ItemId = (typeof ITEM_IDS)[number]

export const ITEM_KINDS = ['consumable', 'service', 'cosmetic'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

/** Qué ha hecho un objeto en una ronda (una línea de la pantalla de resultado). */
export const ITEM_EFFECT_KINDS = [
  /** Pata de Conejo™: nada (con mucho estilo). */
  'placebo',
  /** VibeOracle: su predicción y si acertó. */
  'prediction',
  /** Seguro: monedas devueltas de las exteriores perdidas. */
  'refund',
  /** Turbo: monedas de más del pleno. */
  'boost',
  /** Casco: la racha no se rompe (y gana un asterisco). */
  'shield',
  /** `git revert`: monedas devueltas de la pérdida de la ronda. */
  'revert',
] as const
export type ItemEffectKind = (typeof ITEM_EFFECT_KINDS)[number]

/** Clave de cada consumible en `config/game.json → items`. */
const CONSUMABLE_CONFIG_KEY = {
  rabbit_foot: 'rabbitFoot',
  oracle: 'oracle',
  insurance: 'insurance',
  turbo: 'turbo',
  streak_helmet: 'streakHelmet',
} as const satisfies Record<ConsumableId, keyof ItemsConfig>

const CONSUMABLES: ReadonlySet<string> = new Set(CONSUMABLE_IDS)
const COSMETICS: ReadonlySet<string> = new Set(COSMETIC_IDS)

export function isConsumable(id: string): id is ConsumableId {
  return CONSUMABLES.has(id)
}

export function isCosmetic(id: string): id is CosmeticId {
  return COSMETICS.has(id)
}

export function itemKind(id: ItemId): ItemKind {
  if (isConsumable(id)) return 'consumable'
  if (isCosmetic(id)) return 'cosmetic'
  return 'service'
}

/** Ranura y aspecto de un cosmético (`felt_vaporwave` → tapete `vaporwave`). */
export function cosmeticOf(
  id: CosmeticId,
): { slot: 'felt'; skin: FeltId } | { slot: 'chips'; skin: ChipSkinId } {
  if (id.startsWith('felt_')) return { slot: 'felt', skin: id.slice('felt_'.length) as FeltId }
  return { slot: 'chips', skin: id.slice('chips_'.length) as ChipSkinId }
}

/** Cosmético que hay que tener para usar un tapete o unas fichas (null: el clásico, gratis). */
export function cosmeticFor(slot: 'felt', skin: FeltId): CosmeticId | null
export function cosmeticFor(slot: 'chips', skin: ChipSkinId): CosmeticId | null
export function cosmeticFor(slot: 'felt' | 'chips', skin: string): CosmeticId | null {
  if (skin === 'classic') return null
  const id = `${slot}_${skin}`
  return isCosmetic(id) ? id : null
}

/** Precio de una compra. */
export function itemPrice(id: ItemId, cfg: ItemsConfig): number {
  if (isConsumable(id)) return cfg[CONSUMABLE_CONFIG_KEY[id]].price
  if (isCosmetic(id)) {
    return cosmeticOf(id).slot === 'felt' ? cfg.cosmetics.feltPrice : cfg.cosmetics.chipsPrice
  }
  return cfg.revert.price
}

/** Cargas que da cada compra (0 en servicios y cosméticos). */
export function itemCharges(id: ItemId, cfg: ItemsConfig): number {
  return isConsumable(id) ? cfg[CONSUMABLE_CONFIG_KEY[id]].charges : 0
}

/** Compras como mucho por temporada (null: sin tope, los cosméticos). */
export function itemMaxPerSeason(id: ItemId, cfg: ItemsConfig): number | null {
  if (isConsumable(id)) return cfg[CONSUMABLE_CONFIG_KEY[id]].maxPerSeason
  if (isCosmetic(id)) return null
  return cfg.revert.maxPerSeason
}

/**
 * La letra pequeña de cada objeto, en números: lo que cuesta cada carga, lo máximo que puede
 * devolver de media en esa carga (con el peor boleto para la casa) y lo que la casa gana como
 * mínimo (la resta). En los servicios, la "carga" es la compra y la cota es determinista.
 */
export interface FinePrint {
  readonly perCharge: number
  readonly maxExpected: number
  readonly minEdge: number
}

export function finePrint(id: ItemId, cfg: ItemsConfig): FinePrint {
  const price = itemPrice(id, cfg)
  const charges = Math.max(1, itemCharges(id, cfg))
  const perCharge = price / charges
  const maxExpected =
    id === 'insurance'
      ? insuranceMaxExpected(cfg.insurance)
      : id === 'turbo'
        ? turboMaxExpected(cfg.turbo)
        : id === 'revert'
          ? cfg.revert.maxRefund
          : 0
  return { perCharge, maxExpected, minEdge: perCharge - maxExpected }
}

// ---------------------------------------------------------------- inventario

/** Un consumible del bolsillo en la temporada en curso. */
export interface InventoryEntry {
  readonly itemId: ConsumableId
  readonly charges: number
  readonly armed: boolean
}

/** ¿Cuenta como armado? (Sin cargas no hace nada aunque se haya quedado marcado.) */
export function isArmed(entry: InventoryEntry): boolean {
  return entry.armed && entry.charges > 0
}

/** Bolsillo tras una compra: suma las cargas a las que ya tenía. */
export function addCharges(
  inventory: readonly InventoryEntry[],
  id: ConsumableId,
  cfg: ItemsConfig,
): InventoryEntry[] {
  const add = itemCharges(id, cfg)
  const found = inventory.some(e => e.itemId === id)
  const next = inventory.map(e => (e.itemId === id ? { ...e, charges: e.charges + add } : e))
  return found ? next : [...next, { itemId: id, charges: add, armed: false }]
}

/** Bolsillo tras gastar una carga de cada uno de `spent`. Al quedarse sin cargas, se desarma. */
export function spendCharges(
  inventory: readonly InventoryEntry[],
  spent: readonly ConsumableId[],
): InventoryEntry[] {
  const used = new Set(spent)
  return inventory.map(e => {
    if (!used.has(e.itemId)) return e
    const charges = Math.max(0, e.charges - 1)
    return { ...e, charges, armed: charges > 0 && e.armed }
  })
}

/** Por qué no se puede comprar algo (el servidor lo traduce a sus códigos de error). */
export const PURCHASE_BLOCKS = [
  /** La tienda está cerrada (`items.enabled` = false). */
  'closed',
  'insufficient_funds',
  /** Ya se ha comprado el tope de la temporada. */
  'sold_out',
  /** Ese cosmético ya es tuyo. */
  'owned',
  /** Otra compra hace nada (`purchaseCooldownMs`). */
  'cooldown',
  /** `git revert` sin una ronda perdida que revertir (o con la ventana ya cerrada). */
  'nothing_to_revert',
] as const
export type PurchaseBlock = (typeof PURCHASE_BLOCKS)[number]

export function purchaseBlock(
  args: {
    itemId: ItemId
    balance: number
    /** Compras de este objeto en la temporada. */
    boughtThisSeason: number
    /** Cosméticos que ya tiene. */
    owned: ReadonlySet<string>
    /** Milisegundos desde su última compra (null si nunca ha comprado). */
    sinceLastPurchaseMs: number | null
    /** Lo que devolvería ahora `git revert` (null o 0: nada que revertir). */
    revertRefund: number | null
  },
  cfg: ItemsConfig,
): PurchaseBlock | null {
  const { itemId } = args
  const cosmetic = isCosmetic(itemId)
  if (!cfg.enabled && !cosmetic) return 'closed'
  if (cosmetic && args.owned.has(itemId)) return 'owned'
  const cap = itemMaxPerSeason(itemId, cfg)
  if (cap !== null && args.boughtThisSeason >= cap) return 'sold_out'
  if (args.sinceLastPurchaseMs !== null && args.sinceLastPurchaseMs < cfg.purchaseCooldownMs) {
    return 'cooldown'
  }
  if (itemId === 'revert' && !(args.revertRefund !== null && args.revertRefund > 0)) {
    return 'nothing_to_revert'
  }
  if (itemPrice(itemId, cfg) > args.balance) return 'insufficient_funds'
  return null
}

/** Por qué no se puede armar un consumible. Desarmar siempre se puede. */
export const ARM_BLOCKS = ['closed', 'no_charges', 'max_armed'] as const
export type ArmBlock = (typeof ARM_BLOCKS)[number]

export function armBlock(
  inventory: readonly InventoryEntry[],
  id: ConsumableId,
  armed: boolean,
  cfg: ItemsConfig,
): ArmBlock | null {
  if (!armed) return null
  if (!cfg.enabled) return 'closed'
  const entry = inventory.find(e => e.itemId === id)
  if (!entry || entry.charges <= 0) return 'no_charges'
  if (isArmed(entry)) return null
  if (inventory.filter(isArmed).length >= cfg.maxArmed) return 'max_armed'
  return null
}

/** Bolsillo tras armar o desarmar (sin comprobar: antes, `armBlock`). */
export function setArmed(
  inventory: readonly InventoryEntry[],
  id: ConsumableId,
  armed: boolean,
): InventoryEntry[] {
  return inventory.map(e => (e.itemId === id ? { ...e, armed } : e))
}

// ---------------------------------------------------------------- una ronda con objetos

/** ¿Es una apuesta exterior (docena, columna o sencilla)? Las que cubre el seguro. */
export function isOutsideBet(bet: Pick<Bet, 'selection'>): boolean {
  const kind: string = bet.selection.kind
  return (
    (GROUP_BET_KINDS as readonly string[]).includes(kind) ||
    (SIMPLE_BET_KINDS as readonly string[]).includes(kind)
  )
}

/** El único pleno del boleto, o null si hay cero o más de uno ("un número, una fe"). */
export function soleStraight(bets: readonly Bet[]): Bet | null {
  const straights = bets.filter(b => b.selection.kind === 'straight')
  return straights.length === 1 ? straights[0]! : null
}

/** Lo que se decide antes del número. */
export interface ItemPlan {
  /** Consumibles que actúan en esta ronda y gastan una carga (el casco va aparte). */
  readonly acting: readonly ConsumableId[]
  /** Si el oráculo tira su predicción: otra `rng.pocket()`, justo antes de la del resultado. */
  readonly oracle: boolean
  /** Casco armado: se gasta después del número, solo si se pierde con una racha que proteger. */
  readonly helmet: boolean
}

export const EMPTY_PLAN: ItemPlan = Object.freeze({ acting: [], oracle: false, helmet: false })

/**
 * Fase antes del número. Con el boleto final de la ronda (`chooseRoundBets`) y el multiplicador
 * del jackpot (que ya se sabe: depende del `git push` del turno), decide qué objetos armados
 * actúan. Una ronda sin fichas no gasta nada: la ruleta gira sin ti y los objetos se quedan.
 */
export function planItems(
  inventory: readonly InventoryEntry[],
  bets: readonly Bet[],
  jackpotMultiplier: number,
  cfg: ItemsConfig,
): ItemPlan {
  if (!cfg.enabled || bets.length === 0) return EMPTY_PLAN
  const armed = new Set(inventory.filter(isArmed).map(e => e.itemId))
  const acting = CONSUMABLE_IDS.filter(id => {
    if (!armed.has(id)) return false
    switch (id) {
      case 'rabbit_foot':
      case 'oracle':
        return true
      case 'insurance':
        return bets.some(isOutsideBet)
      case 'turbo':
        // Con el jackpot igual o mayor que el turbo, el turbo no añade nada: no se gasta.
        return soleStraight(bets) !== null && jackpotMultiplier < cfg.turbo.multiplier
      case 'streak_helmet':
        return false
    }
  })
  return { acting, oracle: acting.includes('oracle'), helmet: armed.has('streak_helmet') }
}

/** Línea de un objeto en una ronda resuelta. `amount` en monedas (con signo). */
export interface ItemEffect {
  readonly itemId: ItemId
  readonly kind: ItemEffectKind
  readonly amount: number
  /** Solo el oráculo: su número y si ha acertado. */
  readonly prediction?: number
  readonly hit?: boolean
}

export interface ItemSettlement {
  /** Una línea por objeto que ha actuado, en el orden del catálogo. */
  readonly effects: ItemEffect[]
  /** Lo que pagan los objetos en esta ronda (aparte de la ruleta). */
  readonly itemNet: number
  /** Consumibles que gastan una carga (los del plan más el casco si se ha usado). */
  readonly spent: ConsumableId[]
  /** Racha del jugador después de la ronda. */
  readonly streak: number
  /** Si la racha ganadora lleva asterisco (la ha salvado el casco y aún no se ha roto). */
  readonly streakAsterisk: boolean
}

/** Devolución del seguro: r × lo perdido en exteriores, sobre lo asegurado (a prorrata con C). */
export function insuranceRefund(outcome: RoundOutcome, cfg: ItemsConfig['insurance']): number {
  const outside = outcome.outcomes.filter(o => isOutsideBet(o.bet))
  const total = outside.reduce((acc, o) => acc + o.bet.amount, 0)
  if (total <= 0) return 0
  const lost = outside.filter(o => !o.won).reduce((acc, o) => acc + o.bet.amount, 0)
  const covered = Math.min(total, cfg.coverCap)
  return Math.floor((cfg.refundRate * lost * covered) / total)
}

/** Extra del turbo: floor(min(a, C)·35·(max(m, J) − J)) si el único pleno gana; si no, 0. */
export function turboBoost(
  outcome: RoundOutcome,
  jackpotMultiplier: number,
  cfg: ItemsConfig['turbo'],
): number {
  const straights = outcome.outcomes.filter(o => o.bet.selection.kind === 'straight')
  if (straights.length !== 1) return 0
  const [straight] = straights
  if (!straight?.won) return 0
  const factor = Math.max(cfg.multiplier, jackpotMultiplier) - jackpotMultiplier
  return Math.floor(Math.min(straight.bet.amount, cfg.coverCap) * PAYOUTS.straight * factor)
}

/**
 * Racha con el casco: una ronda perdida con racha ganadora no la rompe (se queda igual y gana un
 * asterisco) y gasta el casco. El asterisco dura mientras la racha siga viva.
 */
export function streakWithHelmet(args: {
  current: number
  asterisk: boolean
  /** Neto que siente el jugador (ruleta + objetos), o null si no apostó. */
  net: number | null
  helmet: boolean
}): { streak: number; asterisk: boolean; helmetUsed: boolean } {
  const { current, net } = args
  if (args.helmet && net !== null && net < 0 && current > 0) {
    return { streak: current, asterisk: true, helmetUsed: true }
  }
  const streak = nextStreak(current, net)
  return { streak, asterisk: args.asterisk && current > 0 && streak >= current, helmetUsed: false }
}

/**
 * Fase después del número: lo que paga cada objeto, la racha y las cargas gastadas. `prediction`
 * es la tirada del oráculo (null si no ha actuado).
 */
export function settleItems(
  args: {
    plan: ItemPlan
    outcome: RoundOutcome
    jackpotMultiplier: number
    prediction: number | null
    current: number
    asterisk: boolean
  },
  cfg: ItemsConfig,
): ItemSettlement {
  const { plan, outcome } = args
  const effects: ItemEffect[] = []
  for (const id of plan.acting) {
    switch (id) {
      case 'rabbit_foot':
        effects.push({ itemId: id, kind: 'placebo', amount: 0 })
        break
      case 'oracle': {
        const prediction = args.prediction ?? 0
        effects.push({
          itemId: id,
          kind: 'prediction',
          amount: 0,
          prediction,
          hit: prediction === outcome.result,
        })
        break
      }
      case 'insurance':
        effects.push({
          itemId: id,
          kind: 'refund',
          amount: insuranceRefund(outcome, cfg.insurance),
        })
        break
      case 'turbo':
        effects.push({
          itemId: id,
          kind: 'boost',
          amount: turboBoost(outcome, args.jackpotMultiplier, cfg.turbo),
        })
        break
      /* v8 ignore next 2 -- el casco nunca está en `acting` */
      case 'streak_helmet':
        break
    }
  }
  const itemNet = effects.reduce((acc, e) => acc + e.amount, 0)
  const played = outcome.outcomes.length > 0
  const streak = streakWithHelmet({
    current: args.current,
    asterisk: args.asterisk,
    net: played ? outcome.net + itemNet : null,
    helmet: plan.helmet,
  })
  const spent: ConsumableId[] = [...plan.acting]
  if (streak.helmetUsed) {
    effects.push({ itemId: 'streak_helmet', kind: 'shield', amount: 0 })
    spent.push('streak_helmet')
  }
  return { effects, itemNet, spent, streak: streak.streak, streakAsterisk: streak.asterisk }
}

// ---------------------------------------------------------------- git revert HEAD~1

/**
 * Lo que devuelve `git revert` sobre la última ronda: su pérdida neta (ruleta + objetos, así no
 * hay doble reembolso con el seguro), con el tope de la configuración. 0 si no se perdió.
 */
export function revertRefund(netWithItems: number, cfg: ItemsConfig['revert']): number {
  return Math.min(Math.max(0, -netWithItems), cfg.maxRefund)
}

/** Hasta cuándo se puede revertir una ronda que se enseñó en `revealAt`. */
export function revertDeadline(revealAt: Date, cfg: ItemsConfig['revert']): Date {
  return new Date(revealAt.getTime() + cfg.windowMs)
}

/** ¿Se puede revertir ahora esa ronda? Ya enseñada y dentro de la ventana. */
export function inRevertWindow(revealAt: Date, now: Date, cfg: ItemsConfig['revert']): boolean {
  const t = now.getTime()
  return t >= revealAt.getTime() && t < revertDeadline(revealAt, cfg).getTime()
}

// ---------------------------------------------------------------- Placebómetro

/** Una ronda con fichas vista por el Placebómetro. */
export interface PlaceboRound {
  /** Si se ganó (neto con objetos > 0). */
  readonly won: boolean
  readonly items: ReadonlyArray<Pick<ItemEffect, 'itemId' | 'hit'>>
}

export interface Placebometer {
  /** Gastado en la tienda esta temporada. */
  readonly spent: number
  /** Devuelto por los objetos (seguro, turbo y revert). */
  readonly recovered: number
  readonly net: number
  /** Rondas jugadas y ganadas con la pata armada y sin ella. */
  readonly rabbit: {
    readonly with: { readonly rounds: number; readonly won: number }
    readonly without: { readonly rounds: number; readonly won: number }
  }
  /** Predicciones de la IA y aciertos (lo esperado es 1/37). */
  readonly oracle: { readonly predictions: number; readonly hits: number }
}

export function placebometer(args: {
  spent: number
  recovered: number
  rounds: Iterable<PlaceboRound>
}): Placebometer {
  const withFoot = { rounds: 0, won: 0 }
  const without = { rounds: 0, won: 0 }
  const oracle = { predictions: 0, hits: 0 }
  for (const round of args.rounds) {
    const bucket = round.items.some(i => i.itemId === 'rabbit_foot') ? withFoot : without
    bucket.rounds++
    if (round.won) bucket.won++
    const prediction = round.items.find(i => i.itemId === 'oracle')
    if (prediction) {
      oracle.predictions++
      if (prediction.hit) oracle.hits++
    }
  }
  return {
    spent: args.spent,
    recovered: args.recovered,
    net: args.recovered - args.spent,
    rabbit: { with: withFoot, without },
    oracle,
  }
}
