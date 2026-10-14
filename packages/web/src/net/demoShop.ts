// SPDX-License-Identifier: AGPL-3.0-or-later
// TIENDA de la demo ("Prueba antes de no comprar"): la misma lógica pura de shared que usa el
// servidor (topes, cargas, armado, la ronda con objetos, `git revert` y el Placebómetro), en
// memoria y solo para esta pestaña. Se borra al recargar.
import {
  COSMETIC_IDS,
  CONSUMABLE_IDS,
  DEFAULT_CHIP_SKIN,
  DEFAULT_FELT,
  ITEM_IDS,
  addCharges,
  armBlock,
  cosmeticOf,
  finePrint,
  inRevertWindow,
  isConsumable,
  isCosmetic,
  itemCharges,
  itemKind,
  itemMaxPerSeason,
  itemPrice,
  placebometer,
  planItems,
  purchaseBlock,
  revertDeadline,
  revertRefund,
  setArmed,
  settleItems,
  spendCharges,
} from '@vibe-gambling/shared'
import type {
  Bet,
  ChipSkinId,
  ConsumableId,
  ErrorCode,
  FeltId,
  Inventory,
  InventoryEntry,
  ItemId,
  ItemPlan,
  ItemSettlement,
  ItemsConfig,
  PlaceboRound,
  RoundOutcome,
  Shop,
} from '@vibe-gambling/shared'

/** Lo que sale de una compra: monedas que cambian o el error (los mismos códigos que el servidor). */
export type DemoPurchase =
  { ok: true; price: number; refund: number } | { ok: false; error: ErrorCode; message: string }

/** Última ronda resuelta, para `git revert`. */
interface LastRound {
  roundId: string
  /** Neto de la ruleta más lo que pagaron los objetos. */
  net: number
  revealAt: Date
}

const BLOCK_ERROR = {
  closed: 'not_found',
  insufficient_funds: 'insufficient_funds',
  sold_out: 'conflict',
  owned: 'conflict',
  cooldown: 'rate_limited',
  nothing_to_revert: 'conflict',
} as const satisfies Record<string, ErrorCode>

export class DemoShop {
  private readonly cfg: ItemsConfig
  private inventory: InventoryEntry[] = []
  private readonly owned = new Set<string>()
  private readonly bought = new Map<ItemId, number>()
  private spent = 0
  private recovered = 0
  private lastPurchaseAt: number | null = null
  private readonly rounds: PlaceboRound[] = []
  private last: LastRound | null = null
  /** Rondas ya revertidas (una sola vez cada una). */
  private readonly reverted = new Set<string>()
  felt: FeltId = DEFAULT_FELT
  chipSkin: ChipSkinId = DEFAULT_CHIP_SKIN

  constructor(cfg: ItemsConfig) {
    this.cfg = cfg
  }

  /** Lo que devolvería ahora `git revert` (null: nada que revertir). */
  private revertNow(now: Date): { roundId: string; refund: number; until: Date } | null {
    const last = this.last
    if (!last || this.reverted.has(last.roundId)) return null
    if ((this.bought.get('revert') ?? 0) >= this.cfg.revert.maxPerSeason) return null
    if (!inRevertWindow(last.revealAt, now, this.cfg.revert)) return null
    const refund = revertRefund(last.net, this.cfg.revert)
    if (refund <= 0) return null
    return { roundId: last.roundId, refund, until: revertDeadline(last.revealAt, this.cfg.revert) }
  }

  view(seasonId: string, now: Date = new Date()): Inventory {
    const felts = new Set<FeltId>([DEFAULT_FELT])
    const chips = new Set<ChipSkinId>([DEFAULT_CHIP_SKIN])
    for (const id of this.owned) {
      if (!isCosmetic(id)) continue
      const c = cosmeticOf(id)
      if (c.slot === 'felt') felts.add(c.skin)
      else chips.add(c.skin)
    }
    const revert = this.revertNow(now)
    return {
      seasonId,
      enabled: this.cfg.enabled,
      maxArmed: this.cfg.maxArmed,
      items: CONSUMABLE_IDS.flatMap(id => {
        const e = this.inventory.find(i => i.itemId === id)
        return e && e.charges > 0 ? [{ id, charges: e.charges, armed: e.armed }] : []
      }),
      cosmetics: { felts: [...felts], chips: [...chips], felt: this.felt, chipSkin: this.chipSkin },
      revert: revert
        ? { roundId: revert.roundId, refund: revert.refund, until: revert.until.toISOString() }
        : null,
    }
  }

  shop(args: { seasonId: string; seasonEndsAt: Date; canBorrow: boolean; now?: Date }): Shop {
    const cfg = this.cfg
    return {
      seasonId: args.seasonId,
      seasonEndsAt: args.seasonEndsAt.toISOString(),
      items: ITEM_IDS.map(id => ({
        id,
        kind: itemKind(id),
        price: itemPrice(id, cfg),
        charges: itemCharges(id, cfg),
        maxPerSeason: itemMaxPerSeason(id, cfg),
        bought: this.bought.get(id) ?? 0,
        owned: isCosmetic(id) && this.owned.has(id),
        finePrint: finePrint(id, cfg),
      })),
      inventory: this.view(args.seasonId, args.now),
      placebometer: placebometer({
        spent: this.spent,
        recovered: this.recovered,
        rounds: this.rounds,
      }),
      canBorrow: args.canBorrow,
    }
  }

  /** Compra (o `git revert`). No toca la cartera: devuelve cuánto cuesta y cuánto devuelve. */
  buy(itemId: ItemId, balance: number, now: Date = new Date()): DemoPurchase {
    const revert = itemId === 'revert' ? this.revertNow(now) : null
    const block = purchaseBlock(
      {
        itemId,
        balance,
        boughtThisSeason: this.bought.get(itemId) ?? 0,
        owned: this.owned,
        sinceLastPurchaseMs:
          this.lastPurchaseAt === null ? null : now.getTime() - this.lastPurchaseAt,
        revertRefund: revert?.refund ?? null,
      },
      this.cfg,
    )
    if (block) return { ok: false, error: BLOCK_ERROR[block], message: block }
    const price = itemPrice(itemId, this.cfg)
    this.bought.set(itemId, (this.bought.get(itemId) ?? 0) + 1)
    this.lastPurchaseAt = now.getTime()
    this.spent += price
    let refund = 0
    if (isConsumable(itemId)) this.inventory = addCharges(this.inventory, itemId, this.cfg)
    else if (isCosmetic(itemId)) this.owned.add(itemId)
    else if (revert) {
      refund = revert.refund
      this.recovered += refund
      this.reverted.add(revert.roundId)
    }
    return { ok: true, price, refund }
  }

  /** Arma o desarma. Devuelve el error si no se puede. */
  arm(id: ConsumableId, armed: boolean): { error: ErrorCode; message: string } | null {
    const block = armBlock(this.inventory, id, armed, this.cfg)
    if (block) return { error: block === 'closed' ? 'not_found' : 'conflict', message: block }
    this.inventory = setArmed(this.inventory, id, armed)
    return null
  }

  /** ¿Tiene ese tapete o esas fichas? (los clásicos, siempre) */
  owns(slot: 'felt' | 'chips', skin: string): boolean {
    return skin === 'classic' || this.owned.has(`${slot}_${skin}`)
  }

  /** Fase antes del número. */
  plan(bets: readonly Bet[], jackpotMultiplier: number): ItemPlan {
    return planItems(this.inventory, bets, jackpotMultiplier, this.cfg)
  }

  /** Fase después del número: gasta las cargas y apunta la ronda en el Placebómetro. */
  settle(args: {
    plan: ItemPlan
    outcome: RoundOutcome
    jackpotMultiplier: number
    prediction: number | null
    current: number
    asterisk: boolean
  }): ItemSettlement {
    const settled = settleItems(args, this.cfg)
    this.inventory = spendCharges(this.inventory, settled.spent)
    this.recovered += Math.max(0, settled.itemNet)
    if (args.outcome.outcomes.length > 0) {
      this.rounds.push({
        won: args.outcome.net + settled.itemNet > 0,
        items: settled.effects.map(e => ({ itemId: e.itemId, hit: e.hit })),
      })
    }
    return settled
  }

  /** La ronda que se acaba de resolver (la que `git revert` puede deshacer). */
  resolved(roundId: string, net: number, revealAt: Date): void {
    this.last = { roundId, net, revealAt }
  }

  /** Todos los cosméticos (para el logro "Ballena de píxeles" y los tests). */
  cosmeticsOwned(): number {
    return COSMETIC_IDS.filter(id => this.owned.has(id)).length
  }
}
