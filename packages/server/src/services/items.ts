// SPDX-License-Identifier: AGPL-3.0-or-later
// TIENDA con base de datos: catálogo, compras, bolsillo, armario y Placebómetro. Las reglas son
// las de `game/items.ts` de shared (lógica pura); aquí solo se leen y se guardan.
//
// Concurrencia: comprar, armar, tirar, pedir un préstamo y revertir bloquean **primero** la
// cartera de la temporada (`lockWallet`, `FOR UPDATE`), y después las filas del bolsillo. Es el
// mismo orden en todas las operaciones (y nunca se bloquean dos carteras en la misma transacción,
// como en la comisión de afiliados), así que no hay interbloqueos. Las compras son idempotentes
// por `(user_id, request_id)`: el reintento ve la compra hecha con la cartera ya bloqueada.
import {
  CONSUMABLE_IDS,
  CHIP_SKIN_IDS,
  DEFAULT_CHIP_SKIN,
  DEFAULT_FELT,
  FELT_IDS,
  ITEM_IDS,
  armBlock,
  canRequestLoan,
  chipSkinIdSchema,
  feltIdSchema,
  finePrint,
  inRevertWindow,
  isArmed,
  isConsumable,
  isCosmetic,
  itemCharges,
  itemKind,
  itemMaxPerSeason,
  itemPrice,
  netWorth,
  purchaseBlock,
  revertDeadline,
  revertRefund,
  setArmed,
  totalStake,
} from '@vibe-gambling/shared'
import type {
  Achievement,
  ArmBlock,
  ConsumableId,
  CosmeticId,
  GameConfig,
  Inventory,
  InventoryEntry,
  ItemId,
  PlacebometerView,
  PurchaseBlock,
  SeasonBounds,
  Shop,
  ShopBuyResponse,
  Wallet,
} from '@vibe-gambling/shared'
import { and, count, desc, eq, inArray, max, sql, sum } from 'drizzle-orm'

import type { Database, Executor, Tx } from '../db/client.ts'
import {
  cosmeticsOwned,
  inventory,
  itemPurchases,
  roundItemEffects,
  rounds,
  users,
  wallets,
} from '../db/schema.ts'
import type { RoundRow, WalletRow } from '../db/schema.ts'
import type { Clock } from '../lib/clock.ts'
import { AppError } from '../lib/errors.ts'
import type { AchievementService } from './achievements.ts'
import { ensureSeason, lockWallet, pendingCount } from './game.ts'
import type { Notifier } from './notifier.ts'
import type { Views } from './views.ts'

const V = 1 as const

export interface ItemDeps {
  db: Database
  game: GameConfig
  clock: Clock
  views: Views
  notifier: Notifier
  achievements: AchievementService
  /** Temporada en curso según el reloj del servidor. */
  currentSeason: (now: Date) => SeasonBounds
}

/** Rechazo de una compra → error del protocolo (sin códigos nuevos). */
const PURCHASE_ERRORS: Readonly<Record<PurchaseBlock, [AppError['code'], string]>> = {
  closed: ['not_found', 'The shop is closed. Even the house needs a break.'],
  insufficient_funds: ['insufficient_funds', 'Not enough coins. The bank might help. It loves to.'],
  sold_out: ['conflict', 'Season limit reached for that item. Responsible gambling, allegedly.'],
  owned: ['conflict', 'You already own that. Bad taste is not stackable.'],
  cooldown: ['rate_limited', 'Easy there, big spender. One purchase at a time.'],
  nothing_to_revert: ['conflict', 'Nothing to revert: no recent loss, or the window is closed.'],
}

const ARM_ERRORS: Readonly<Record<ArmBlock, [AppError['code'], string]>> = {
  closed: ['not_found', 'The shop is closed. Your items are taking a nap.'],
  no_charges: ['conflict', 'No charges left. Placebo needs a refill.'],
  max_armed: ['conflict', 'Too many items armed. Even superstition has limits.'],
}

/** Lo que devolvería ahora `git revert` sobre la última ronda (null: nada que revertir). */
export interface RevertTarget {
  round: RoundRow
  refund: number
  until: Date
}

export class ItemService {
  readonly #d: ItemDeps

  constructor(deps: ItemDeps) {
    this.#d = deps
  }

  get #cfg() {
    return this.#d.game.items
  }

  // ---------------------------------------------------------------- bolsillo (con la cartera bloqueada)

  /** Consumibles de la temporada, en el orden del catálogo. Con `lock`, bloquea sus filas. */
  async entries(
    db: Executor,
    userId: string,
    seasonId: string,
    lock = false,
  ): Promise<InventoryEntry[]> {
    const query = db
      .select({ itemId: inventory.itemId, charges: inventory.charges, armed: inventory.armed })
      .from(inventory)
      .where(and(eq(inventory.userId, userId), eq(inventory.seasonId, seasonId)))
    const rows = lock ? await query.for('update') : await query
    const byId = new Map(rows.map(r => [r.itemId, r]))
    return CONSUMABLE_IDS.flatMap(id => {
      const row = byId.get(id)
      return row ? [{ itemId: id, charges: row.charges, armed: row.armed }] : []
    })
  }

  /** Gasta una carga de cada consumible de `spent` (al quedarse sin cargas, se desarma). */
  async spend(
    tx: Tx,
    userId: string,
    seasonId: string,
    spent: readonly ConsumableId[],
    now: Date,
  ): Promise<void> {
    if (spent.length === 0) return
    await tx
      .update(inventory)
      .set({
        charges: sql`greatest(${inventory.charges} - 1, 0)`,
        armed: sql`${inventory.armed} and ${inventory.charges} > 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(inventory.userId, userId),
          eq(inventory.seasonId, seasonId),
          inArray(inventory.itemId, [...spent]),
        ),
      )
  }

  /** Cosméticos que tiene el usuario. */
  async owned(db: Executor, userId: string): Promise<Set<CosmeticId>> {
    const rows = await db
      .select({ itemId: cosmeticsOwned.itemId })
      .from(cosmeticsOwned)
      .where(eq(cosmeticsOwned.userId, userId))
    return new Set(rows.map(r => r.itemId).filter(isCosmetic))
  }

  /**
   * Lo que devolvería ahora `git revert`: la última ronda resuelta del usuario, si es de esta
   * temporada, ya se ha enseñado, está dentro de la ventana, no se ha revertido y perdió algo.
   */
  async revertTarget(
    db: Executor,
    userId: string,
    seasonId: string,
    now: Date,
  ): Promise<RevertTarget | null> {
    const cfg = this.#cfg.revert
    const [last] = await db
      .select()
      .from(rounds)
      .where(and(eq(rounds.userId, userId), eq(rounds.status, 'resolved')))
      .orderBy(desc(rounds.resolvedAt))
      .limit(1)
    if (!last || last.seasonId !== seasonId || !last.revealAt || last.net === null) return null
    if (!inRevertWindow(last.revealAt, now, cfg)) return null
    const [done] = await db
      .select({ itemId: roundItemEffects.itemId })
      .from(roundItemEffects)
      .where(and(eq(roundItemEffects.roundId, last.id), eq(roundItemEffects.itemId, 'revert')))
    if (done) return null
    const refund = revertRefund(last.net + (last.itemNet ?? 0), cfg)
    if (refund <= 0) return null
    return { round: last, refund, until: revertDeadline(last.revealAt, cfg) }
  }

  /** Compras de la temporada por objeto. */
  async #boughtThisSeason(db: Executor, userId: string, seasonId: string) {
    const rows = await db
      .select({ itemId: itemPurchases.itemId, n: count() })
      .from(itemPurchases)
      .where(and(eq(itemPurchases.userId, userId), eq(itemPurchases.seasonId, seasonId)))
      .groupBy(itemPurchases.itemId)
    return new Map(rows.map(r => [r.itemId, r.n]))
  }

  /** Bolsillo y armario tal como los ve el protocolo. */
  async inventoryView(db: Executor, userId: string, seasonId: string): Promise<Inventory> {
    const now = this.#d.clock.now()
    const [user] = await db
      .select({ felt: users.felt, chipSkin: users.chipSkin })
      .from(users)
      .where(eq(users.id, userId))
    const owned = await this.owned(db, userId)
    const entries = await this.entries(db, userId, seasonId)
    const bought = await this.#boughtThisSeason(db, userId, seasonId)
    const revertLeft = (bought.get('revert') ?? 0) < this.#cfg.revert.maxPerSeason
    const target =
      this.#cfg.enabled && revertLeft ? await this.revertTarget(db, userId, seasonId, now) : null
    return {
      seasonId,
      enabled: this.#cfg.enabled,
      maxArmed: this.#cfg.maxArmed,
      items: entries
        .filter(e => e.charges > 0)
        .map(e => ({ id: e.itemId, charges: e.charges, armed: isArmed(e) })),
      cosmetics: {
        felts: FELT_IDS.filter(f => f === DEFAULT_FELT || owned.has(`felt_${f}` as CosmeticId)),
        chips: CHIP_SKIN_IDS.filter(
          c => c === DEFAULT_CHIP_SKIN || owned.has(`chips_${c}` as CosmeticId),
        ),
        felt: feltIdSchema.safeParse(user?.felt).data ?? DEFAULT_FELT,
        chipSkin: chipSkinIdSchema.safeParse(user?.chipSkin).data ?? DEFAULT_CHIP_SKIN,
      },
      revert: target
        ? { roundId: target.round.id, refund: target.refund, until: target.until.toISOString() }
        : null,
    }
  }

  // ---------------------------------------------------------------- lectura

  /** Pantalla TIENDA y `/vibe-shop`. Solo lee. */
  async shop(userId: string): Promise<Shop> {
    const db = this.#d.db
    const now = this.#d.clock.now()
    const season = this.#d.currentSeason(now)
    const cfg = this.#cfg
    const bought = await this.#boughtThisSeason(db, userId, season.id)
    const owned = await this.owned(db, userId)
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, season.id)))
    const balance = wallet?.balance ?? this.#d.game.startingBalance
    return {
      seasonId: season.id,
      seasonEndsAt: season.endsAt.toISOString(),
      items: ITEM_IDS.map(id => ({
        id,
        kind: itemKind(id),
        price: itemPrice(id, cfg),
        charges: itemCharges(id, cfg),
        maxPerSeason: itemMaxPerSeason(id, cfg),
        bought: bought.get(id) ?? 0,
        owned: isCosmetic(id) && owned.has(id),
        finePrint: finePrint(id, cfg),
      })),
      inventory: await this.inventoryView(db, userId, season.id),
      placebometer: await this.placebometer(db, userId, season.id),
      canBorrow: canRequestLoan(
        balance + totalStake(wallet?.slip ?? []),
        this.#d.game,
        wallet?.debt ?? 0,
      ),
    }
  }

  /**
   * Placebómetro de una temporada: lo gastado en la tienda frente a lo que han devuelto los
   * objetos, las rondas ganadas con la pata armada y sin ella, y los aciertos de la IA.
   */
  async placebometer(db: Executor, userId: string, seasonId: string): Promise<PlacebometerView> {
    const [spent] = await db
      .select({ total: sum(itemPurchases.price).mapWith(Number) })
      .from(itemPurchases)
      .where(and(eq(itemPurchases.userId, userId), eq(itemPurchases.seasonId, seasonId)))
    const mine = and(
      eq(rounds.userId, userId),
      eq(rounds.seasonId, seasonId),
      eq(rounds.status, 'resolved'),
    )
    const [recovered] = await db
      .select({ total: sum(roundItemEffects.amount).mapWith(Number) })
      .from(roundItemEffects)
      .innerJoin(rounds, eq(rounds.id, roundItemEffects.roundId))
      .where(mine)
    // Rondas con fichas (las únicas en las que actúan los objetos), con pata y sin ella.
    const rabbit = sql`exists (select 1 from ${roundItemEffects} e where e.round_id = ${rounds.id} and e.item_id = 'rabbit_foot')`
    const won = sql`(${rounds.net} + coalesce(${rounds.itemNet}, 0)) > 0`
    const [buckets] = await db
      .select({
        withRounds: sql<number>`count(*) filter (where ${rabbit})`.mapWith(Number),
        withWon: sql<number>`count(*) filter (where ${rabbit} and ${won})`.mapWith(Number),
        withoutRounds: sql<number>`count(*) filter (where not ${rabbit})`.mapWith(Number),
        withoutWon: sql<number>`count(*) filter (where not ${rabbit} and ${won})`.mapWith(Number),
      })
      .from(rounds)
      .where(and(mine, sql`${rounds.staked} > 0`))
    const [oracle] = await db
      .select({
        predictions: count(),
        hits: sql<number>`count(*) filter (where (${roundItemEffects.detail} ->> 'hit')::boolean)`.mapWith(
          Number,
        ),
      })
      .from(roundItemEffects)
      .innerJoin(rounds, eq(rounds.id, roundItemEffects.roundId))
      .where(and(mine, eq(roundItemEffects.itemId, 'oracle')))
    const spentTotal = spent?.total ?? 0
    const recoveredTotal = recovered?.total ?? 0
    return {
      spent: spentTotal,
      recovered: recoveredTotal,
      net: recoveredTotal - spentTotal,
      rabbit: {
        with: { rounds: buckets?.withRounds ?? 0, won: buckets?.withWon ?? 0 },
        without: { rounds: buckets?.withoutRounds ?? 0, won: buckets?.withoutWon ?? 0 },
      },
      oracle: { predictions: oracle?.predictions ?? 0, hits: oracle?.hits ?? 0 },
    }
  }

  // ---------------------------------------------------------------- compra

  /** Compra un objeto (o `git revert`). Idempotente por `requestId`. */
  async buy(
    userId: string,
    itemId: ItemId,
    requestId: string,
  ): Promise<Omit<ShopBuyResponse, 'v'>> {
    const now = this.#d.clock.now()
    const season = this.#d.currentSeason(now)
    const cfg = this.#cfg
    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await lockWallet(tx, this.#d.game.startingBalance, userId, season.id)

      // Reintento: la misma compra, sin cobrar otra vez.
      const [done] = await tx
        .select()
        .from(itemPurchases)
        .where(and(eq(itemPurchases.userId, userId), eq(itemPurchases.requestId, requestId)))
      if (done) {
        return {
          itemId: done.itemId as ItemId,
          price: done.price,
          refund: done.refund,
          fresh: false,
          row: wallet,
          unlocked: [] as Achievement[],
        }
      }

      const bought = await this.#boughtThisSeason(tx, userId, season.id)
      const owned = await this.owned(tx, userId)
      const [last] = await tx
        .select({ at: max(itemPurchases.createdAt) })
        .from(itemPurchases)
        .where(eq(itemPurchases.userId, userId))
      const target =
        itemId === 'revert' ? await this.revertTarget(tx, userId, season.id, now) : null
      const blocked = purchaseBlock(
        {
          itemId,
          balance: wallet.balance,
          boughtThisSeason: bought.get(itemId) ?? 0,
          owned,
          sinceLastPurchaseMs: last?.at ? now.getTime() - last.at.getTime() : null,
          revertRefund: target?.refund ?? null,
        },
        cfg,
      )
      if (blocked) {
        const [code, message] = PURCHASE_ERRORS[blocked]
        throw new AppError(code, message)
      }

      const price = itemPrice(itemId, cfg)
      const refund = target?.refund ?? 0
      await tx.insert(itemPurchases).values({
        userId,
        seasonId: season.id,
        itemId,
        price,
        refund,
        roundId: target?.round.id ?? null,
        requestId,
        createdAt: now,
      })
      if (isConsumable(itemId)) {
        const add = itemCharges(itemId, cfg)
        await tx
          .insert(inventory)
          .values({ userId, seasonId: season.id, itemId, charges: add, updatedAt: now })
          .onConflictDoUpdate({
            target: [inventory.userId, inventory.seasonId, inventory.itemId],
            set: { charges: sql`${inventory.charges} + ${add}`, updatedAt: now },
          })
      } else if (isCosmetic(itemId)) {
        await tx.insert(cosmeticsOwned).values({ userId, itemId, acquiredAt: now })
      } else if (target) {
        // `git revert`: una línea más en la ronda revertida (no la borra ni cambia su neto).
        await tx.insert(roundItemEffects).values({
          roundId: target.round.id,
          itemId: 'revert',
          kind: 'revert',
          amount: refund,
        })
      }
      const [updated] = await tx
        .update(wallets)
        .set({ balance: wallet.balance - price + refund, updatedAt: now })
        .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, season.id)))
        .returning()
      if (!updated) throw new Error('la cartera bloqueada ha desaparecido')

      const unlocked = await this.#d.achievements.unlock(tx, {
        userId,
        seasonId: season.id,
        now,
        ctx: {
          event: 'purchase',
          round: null,
          wallet: {
            netWorth: netWorth(updated.balance, updated.debt),
            debt: updated.debt,
            loans: updated.loans,
            spins: updated.spins,
            bestStreak: updated.bestStreak,
            pendingSpins: await pendingCount(tx, userId, season.id),
          },
          wasBankrupt: updated.brokeAt !== null,
          previousColorStreak: null,
          lifetimeZeros: 0,
          purchase: {
            itemId,
            cosmeticsOwned: owned.size + (isCosmetic(itemId) ? 1 : 0),
            revert: target
              ? { loss: -(target.round.net! + (target.round.itemNet ?? 0)), refund }
              : null,
          },
        },
      })
      return { itemId, price, refund, fresh: true, row: updated, unlocked }
    })

    const view = await this.#snapshot(userId, season.id, result.row)
    if (result.fresh) {
      this.#d.notifier.send(userId, {
        v: V,
        type: 'inventory',
        event: 'bought',
        inventory: view.inventory,
        wallet: view.wallet,
      })
      for (const achievement of result.unlocked) {
        this.#d.notifier.send(userId, { v: V, type: 'achievement.unlocked', achievement })
      }
    }
    return {
      itemId: result.itemId,
      price: result.price,
      refund: result.refund,
      fresh: result.fresh,
      wallet: view.wallet,
      inventory: view.inventory,
    }
  }

  // ---------------------------------------------------------------- armar

  /** Arma o desarma un consumible: vale para la próxima ronda que se resuelva. */
  async arm(userId: string, itemId: ConsumableId, armed: boolean): Promise<Inventory> {
    const now = this.#d.clock.now()
    const season = this.#d.currentSeason(now)
    const row = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await lockWallet(tx, this.#d.game.startingBalance, userId, season.id)
      const entries = await this.entries(tx, userId, season.id, true)
      const blocked = armBlock(entries, itemId, armed, this.#cfg)
      if (blocked) {
        const [code, message] = ARM_ERRORS[blocked]
        throw new AppError(code, message)
      }
      const next = setArmed(entries, itemId, armed).find(e => e.itemId === itemId)
      if (next) {
        await tx
          .update(inventory)
          .set({ armed: next.armed, updatedAt: now })
          .where(
            and(
              eq(inventory.userId, userId),
              eq(inventory.seasonId, season.id),
              eq(inventory.itemId, itemId),
            ),
          )
      }
      return wallet
    })
    const view = await this.#snapshot(userId, season.id, row)
    this.#d.notifier.send(userId, {
      v: V,
      type: 'inventory',
      event: 'armed',
      inventory: view.inventory,
      wallet: view.wallet,
    })
    return view.inventory
  }

  /** Bolsillo y cartera después de una operación (ya confirmada). */
  async #snapshot(
    userId: string,
    seasonId: string,
    row: WalletRow,
  ): Promise<{ inventory: Inventory; wallet: Wallet }> {
    const db = this.#d.db
    return {
      inventory: await this.inventoryView(db, userId, seasonId),
      wallet: this.#d.views.wallet(row, seasonId, await pendingCount(db, userId, seasonId)),
    }
  }

  // ---------------------------------------------------------------- cosméticos

  /** Antes de equipar un tapete o unas fichas: solo los que tiene (los clásicos, siempre). */
  async assertCanEquip(
    userId: string,
    change: { felt?: string | undefined; chipSkin?: string | undefined },
  ): Promise<void> {
    if (!(await this.canEquip(this.#d.db, userId, change))) {
      throw new AppError(
        'conflict',
        'You do not own that. Window shopping is free, equipping is not.',
      )
    }
  }

  /** ¿Puede equipar ese tapete o esas fichas? (Los clásicos, siempre.) */
  async canEquip(
    db: Executor,
    userId: string,
    change: { felt?: string | undefined; chipSkin?: string | undefined },
  ): Promise<boolean> {
    const needed: CosmeticId[] = []
    if (change.felt !== undefined && change.felt !== DEFAULT_FELT) {
      needed.push(`felt_${change.felt}` as CosmeticId)
    }
    if (change.chipSkin !== undefined && change.chipSkin !== DEFAULT_CHIP_SKIN) {
      needed.push(`chips_${change.chipSkin}` as CosmeticId)
    }
    if (needed.length === 0) return true
    const owned = await this.owned(db, userId)
    return needed.every(id => owned.has(id))
  }
}
