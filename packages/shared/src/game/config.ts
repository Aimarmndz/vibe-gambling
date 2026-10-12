// SPDX-License-Identifier: AGPL-3.0-or-later
// Esquema de `config/game.json`: todos los números del juego que se pueden ajustar.
// Ningún valor por defecto vive aquí: el archivo de configuración es la única fuente.
import { z } from 'zod'

import { betSelectionSchema } from '../roulette/bets.ts'

const coins = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

/** Comprueba que una zona horaria IANA existe en este entorno. */
function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const gameConfigSchema = z
  .object({
    /** Saldo con el que empieza cada temporada. */
    startingBalance: coins,
    /** Fichas disponibles en la mesa, de menor a mayor. La menor es la apuesta mínima. */
    chips: z
      .array(coins)
      .min(1)
      .max(12)
      .refine(list => list.every((v, i) => i === 0 || v > list[i - 1]!), {
        message: 'las fichas deben ir de menor a mayor y sin repetirse',
      }),
    /** Si existe la ficha ALL-IN (todo el saldo disponible). */
    allIn: z.boolean(),
    /** Máximo de casillas distintas con fichas en una misma ronda. */
    maxBetsPerRound: z.number().int().min(1).max(200),
    /** Apuesta automática cuando el usuario nunca ha apostado. */
    defaultBet: z.object({ selection: betSelectionSchema, amount: coins }).strict(),
    loan: z
      .object({
        /** Monedas que da cada préstamo. */
        amount: coins,
        /** TAE que se enseña en la oferta (solo de broma; en %). */
        displayApr: z.number().positive(),
        /** Interés que se suma a la deuda en cada tirada (0,02 = 2 %). */
        interestPerSpin: z.number().min(0).max(1),
        /** Tope de la deuda, para que el número siga siendo representable. */
        maxDebt: coins,
      })
      .strict(),
    jackpot: z
      .object({
        /** Multiplicador de las ganancias si en el turno hubo un `git push` con éxito. */
        gitPushMultiplier: z.number().min(1).max(100),
      })
      .strict(),
    season: z
      .object({
        /** Zona horaria en la que cambia la temporada. */
        timeZone: z.string().refine(isTimeZone, { message: 'zona horaria desconocida' }),
        /** Día del mes (a las 00:00) en el que empieza cada temporada. */
        startDay: z.number().int().min(1).max(28),
      })
      .strict(),
    /** Cuántos arruinados de cada temporada entran en el Salón de la Ruina. */
    hallOfRuinSize: z.number().int().min(1).max(100),
    spin: z
      .object({
        /** Duración mínima de la animación de giro (ms), aunque el turno sea más corto. */
        minSpinMs: z.number().int().min(0).max(60_000),
      })
      .strict(),
    round: z
      .object({
        /** Las rondas abiertas más tiempo que esto caducan sin tirada (ms). */
        staleAfterMs: z.number().int().positive(),
      })
      .strict(),
    streak: z
      .object({
        /** A partir de cuántos colores iguales seguidos sale el aviso de "falacia del jugador". */
        colorWarningAt: z.number().int().min(2).max(50),
        /** Cuántas tiradas recientes se miran para calcular la racha de color. */
        historySize: z.number().int().min(2).max(500),
      })
      .strict(),
  })
  .strict()
  .refine(cfg => cfg.defaultBet.amount >= Math.min(...cfg.chips), {
    message: 'la apuesta por defecto no puede ser menor que la ficha mínima',
    path: ['defaultBet', 'amount'],
  })

export type GameConfig = z.output<typeof gameConfigSchema>

/** Apuesta mínima: la ficha más pequeña. */
export function minBet(cfg: GameConfig): number {
  return Math.min(...cfg.chips)
}

/** Parte de la configuración del juego que la web puede ver. */
export const publicGameConfigSchema = z
  .object({
    startingBalance: coins,
    chips: z.array(coins),
    allIn: z.boolean(),
    maxBetsPerRound: z.number().int(),
    loan: z.object({ amount: coins, displayApr: z.number(), interestPerSpin: z.number() }).strict(),
    jackpot: z.object({ gitPushMultiplier: z.number() }).strict(),
    minSpinMs: z.number().int(),
    colorWarningAt: z.number().int(),
    seasonTimeZone: z.string(),
    /** Día del mes en que empieza cada temporada (para calcular cuánto le queda). */
    seasonStartDay: z.number().int().min(1).max(28),
  })
  .strict()
export type PublicGameConfig = z.output<typeof publicGameConfigSchema>

export function toPublicGameConfig(cfg: GameConfig): PublicGameConfig {
  return {
    startingBalance: cfg.startingBalance,
    chips: [...cfg.chips],
    allIn: cfg.allIn,
    maxBetsPerRound: cfg.maxBetsPerRound,
    loan: {
      amount: cfg.loan.amount,
      displayApr: cfg.loan.displayApr,
      interestPerSpin: cfg.loan.interestPerSpin,
    },
    jackpot: { gitPushMultiplier: cfg.jackpot.gitPushMultiplier },
    minSpinMs: cfg.spin.minSpinMs,
    colorWarningAt: cfg.streak.colorWarningAt,
    seasonTimeZone: cfg.season.timeZone,
    seasonStartDay: cfg.season.startDay,
  }
}
