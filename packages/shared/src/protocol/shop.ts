// SPDX-License-Identifier: AGPL-3.0-or-later
// Piezas del protocolo de la TIENDA: catálogo con precios, bolsillo (inventario), Placebómetro y
// los cuerpos de `/api/shop`, `/api/shop/buy` y `/api/items/arm`. Todo es aditivo (`v: 1`).
import { z } from 'zod'

import { CONSUMABLE_IDS, ITEM_KINDS } from '../game/items.ts'
import { seasonIdSchema } from '../game/season.ts'
import {
  chipSkinIdSchema,
  coinsSchema,
  feltIdSchema,
  itemIdSchema,
  purchaseRequestIdSchema,
  versionSchema,
  walletSchema,
} from './common.ts'

export const consumableIdSchema = z.enum(CONSUMABLE_IDS)

/** Bolsillo del jugador en la temporada en curso (consumibles) y su armario (cosméticos). */
export const inventorySchema = z
  .object({
    seasonId: seasonIdSchema,
    /** Si la tienda está abierta (cerrada no se arma ni se compra nada salvo cosméticos). */
    enabled: z.boolean(),
    /** Consumibles armados a la vez como mucho. */
    maxArmed: z.number().int().positive(),
    /** Consumibles con cargas, en el orden del catálogo. */
    items: z.array(
      z
        .object({
          id: consumableIdSchema,
          charges: z.number().int().min(0),
          armed: z.boolean(),
        })
        .strict(),
    ),
    cosmetics: z
      .object({
        /** Tapetes y fichas que puede usar (los clásicos, siempre). */
        felts: z.array(feltIdSchema),
        chips: z.array(chipSkinIdSchema),
        felt: feltIdSchema,
        chipSkin: chipSkinIdSchema,
      })
      .strict(),
    /**
     * `git revert HEAD~1` disponible ahora: la última ronda perdida, lo que devolvería y hasta
     * cuándo. null si no hay nada que revertir (o ya lo usaste esta temporada).
     */
    revert: z
      .object({
        roundId: z.uuid(),
        refund: z.number().int().positive(),
        until: z.iso.datetime(),
      })
      .strict()
      .nullable(),
  })
  .strict()
export type Inventory = z.output<typeof inventorySchema>

/** Un artículo de la tienda con su precio, sus topes y la letra pequeña en números. */
export const shopItemSchema = z
  .object({
    id: itemIdSchema,
    kind: z.enum(ITEM_KINDS),
    price: z.number().int().positive(),
    /** Cargas que da cada compra (0 en servicios y cosméticos). */
    charges: z.number().int().min(0),
    /** Compras como mucho por temporada (null: sin tope). */
    maxPerSeason: z.number().int().positive().nullable(),
    /** Compras de esta temporada. */
    bought: z.number().int().min(0),
    /** Solo cosméticos: si ya es tuyo. */
    owned: z.boolean(),
    /**
     * La letra pequeña: lo que cuesta cada carga, lo máximo que devuelve de media en una carga con
     * el boleto más favorable y lo que la casa gana como mínimo por carga (la resta).
     */
    finePrint: z
      .object({
        perCharge: z.number().min(0),
        maxExpected: z.number().min(0),
        minEdge: z.number().min(0),
      })
      .strict(),
  })
  .strict()
export type ShopItem = z.output<typeof shopItemSchema>

/** El Placebómetro: lo que te han costado los objetos frente a lo que te han devuelto. */
export const placebometerSchema = z
  .object({
    spent: z.number().int().min(0),
    recovered: z.number().int().min(0),
    net: coinsSchema,
    rabbit: z
      .object({
        with: z.object({ rounds: z.number().int().min(0), won: z.number().int().min(0) }).strict(),
        without: z
          .object({ rounds: z.number().int().min(0), won: z.number().int().min(0) })
          .strict(),
      })
      .strict(),
    oracle: z
      .object({ predictions: z.number().int().min(0), hits: z.number().int().min(0) })
      .strict(),
  })
  .strict()
export type PlacebometerView = z.output<typeof placebometerSchema>

/** Pantalla TIENDA (con sus pestañas BOLSILLO y ARMARIO) y `/vibe-shop`. */
export const shopSchema = z
  .object({
    seasonId: seasonIdSchema,
    /** Cuándo caducan los consumibles (fin de la temporada). */
    seasonEndsAt: z.iso.datetime(),
    items: z.array(shopItemSchema),
    inventory: inventorySchema,
    placebometer: placebometerSchema,
    /** Si el banco te prestaría ahora ("¿Financiamos tu pata de conejo?"). */
    canBorrow: z.boolean(),
  })
  .strict()
export type Shop = z.output<typeof shopSchema>

export const shopResponseSchema = z.object({ v: versionSchema, shop: shopSchema }).strict()
export type ShopResponse = z.output<typeof shopResponseSchema>

/** Compra (o `git revert`). Un reintento con el mismo `requestId` no compra dos veces. */
export const shopBuyRequestSchema = z
  .object({ v: versionSchema, itemId: itemIdSchema, requestId: purchaseRequestIdSchema })
  .strict()
export type ShopBuyRequest = z.output<typeof shopBuyRequestSchema>

export const shopBuyResponseSchema = z
  .object({
    v: versionSchema,
    itemId: itemIdSchema,
    price: z.number().int().positive(),
    /** Solo `git revert`: lo que ha devuelto (0 en el resto). */
    refund: z.number().int().min(0),
    /** false si era un reintento de una compra ya hecha. */
    fresh: z.boolean(),
    wallet: walletSchema,
    inventory: inventorySchema,
  })
  .strict()
export type ShopBuyResponse = z.output<typeof shopBuyResponseSchema>

export const itemArmRequestSchema = z
  .object({ v: versionSchema, itemId: consumableIdSchema, armed: z.boolean() })
  .strict()
export type ItemArmRequest = z.output<typeof itemArmRequestSchema>

export const itemArmResponseSchema = z
  .object({ v: versionSchema, inventory: inventorySchema })
  .strict()
export type ItemArmResponse = z.output<typeof itemArmResponseSchema>
