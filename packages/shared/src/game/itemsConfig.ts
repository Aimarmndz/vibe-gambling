// SPDX-License-Identifier: AGPL-3.0-or-later
// Esquema del bloque `items` de `config/game.json` (la TIENDA) y las cotas de valor esperado que
// lo validan. La regla de la casa no se negocia: para cualquier boleto, lo que un objeto devuelve
// de media en una carga es menor o igual que lo que cuesta esa carga. Si la configuración la
// rompe, el proceso no arranca.
//
// Las cotas salen de la lógica de la ruleta (37 casillas, `PAYOUTS`, lo que cubre cada apuesta
// exterior), no de números escritos a mano.
import { z } from 'zod'

import { GROUP_BET_KINDS, PAYOUTS, SIMPLE_BET_KINDS, coveredNumbers } from '../roulette/bets.ts'
import { POCKET_COUNT } from '../roulette/wheel.ts'

const coins = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const charges = z.number().int().min(1).max(10_000)
const perSeason = z.number().int().min(1).max(10_000)

/** Casillas en las que pierde, como mucho, una apuesta exterior (la docena o la columna: 25). */
export const OUTSIDE_MAX_LOSING_POCKETS = Math.max(
  ...[
    ...GROUP_BET_KINDS.map(kind => coveredNumbers({ kind, index: 1 }).length),
    ...SIMPLE_BET_KINDS.map(kind => coveredNumbers({ kind }).length),
  ].map(covered => POCKET_COUNT - covered),
)

/**
 * Lo máximo que devuelve de media el seguro en una ronda: r·C·P(perder una exterior). La
 * cobertura es a prorrata sobre C, así que la peor apuesta posible es toda a una docena.
 */
export function insuranceMaxExpected(cfg: { refundRate: number; coverCap: number }): number {
  return (cfg.refundRate * cfg.coverCap * OUTSIDE_MAX_LOSING_POCKETS) / POCKET_COUNT
}

/**
 * Lo máximo que paga de media el turbo en una ronda: el pleno (1/37) cobra 35·(m − 1)·C de más.
 * Con el jackpot del `git push` (J) el extra es 35·(m − J)·C o nada, así que esta es la cota.
 */
export function turboMaxExpected(cfg: { multiplier: number; coverCap: number }): number {
  return (PAYOUTS.straight * (cfg.multiplier - 1) * cfg.coverCap) / POCKET_COUNT
}

/** Consumible sin efecto en monedas: solo precio, cargas por compra y tope por temporada. */
const plainConsumable = z.object({ price: coins, charges, maxPerSeason: perSeason }).strict()

export const itemsConfigSchema = z
  .object({
    /** Si la tienda está abierta. Cerrada, no se compra ni se arma nada (los cosméticos siguen). */
    enabled: z.boolean(),
    /** Tiempo mínimo entre dos compras del mismo jugador (antiabuso), en ms. */
    purchaseCooldownMs: z.number().int().min(0).max(600_000),
    /** Consumibles armados a la vez como mucho. */
    maxArmed: z.number().int().min(1).max(16),
    /** Pata de Conejo™: placebo puro. Una carga por ronda jugada. */
    rabbitFoot: plainConsumable,
    /** VibeOracle: "predice" el número con otra tirada independiente. Una carga por ronda. */
    oracle: plainConsumable,
    /** Seguro a Todo Riesgo: devuelve una parte de las apuestas exteriores perdidas. */
    insurance: z
      .object({
        price: coins,
        charges,
        /** Parte devuelta de lo perdido en apuestas exteriores (0,5 = 50 %). */
        refundRate: z.number().gt(0).max(1),
        /** Tope de lo asegurado por ronda (cobertura a prorrata entre las exteriores). */
        coverCap: coins,
        maxPerSeason: perSeason,
      })
      .strict()
      .refine(c => c.price >= c.charges * insuranceMaxExpected(c), {
        message:
          'el seguro saldría a cuenta: price/charges tiene que ser ≥ refundRate·coverCap·25/37',
        path: ['price'],
      }),
    /** Turbo Pleno: el único pleno del boleto cobra con un multiplicador extra. */
    turbo: z
      .object({
        price: coins,
        charges,
        /** Multiplicador de la ganancia del pleno (no se suma al del `git push`). */
        multiplier: z.number().gt(1).max(100),
        /** Parte del pleno que se multiplica, como mucho. */
        coverCap: coins,
        maxPerSeason: perSeason,
      })
      .strict()
      .refine(c => c.price >= c.charges * turboMaxExpected(c), {
        message:
          'el turbo saldría a cuenta: price/charges tiene que ser ≥ 35·(multiplier − 1)·coverCap/37',
        path: ['price'],
      }),
    /** Casco de Racha: una ronda perdida no rompe la racha ganadora (y le pone un asterisco). */
    streakHelmet: plainConsumable,
    /** `git revert HEAD~1`: devuelve parte de la pérdida de la última ronda, a posteriori. */
    revert: z
      .object({
        price: coins,
        /** Lo que devuelve como mucho (siempre menos que el precio). */
        maxRefund: coins,
        /** Cuánto tiempo, desde que se enseña la ronda, se puede revertir (ms). */
        windowMs: z.number().int().min(1000).max(86_400_000),
        maxPerSeason: perSeason,
      })
      .strict()
      .refine(c => c.price > c.maxRefund, {
        message: 'el revert saldría a cuenta: price tiene que ser mayor que maxRefund',
        path: ['price'],
      }),
    /** Tapetes y fichas: permanentes, sin efecto en el juego. */
    cosmetics: z.object({ feltPrice: coins, chipsPrice: coins }).strict(),
  })
  .strict()
export type ItemsConfig = z.output<typeof itemsConfigSchema>
