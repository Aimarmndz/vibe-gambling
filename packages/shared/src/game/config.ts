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
    leaderboard: z
      .object({
        /**
         * Antiabuso: una cuenta de GitHub con menos días que estos juega con normalidad, pero no
         * sale en los rankings públicos ni en el Salón de la Ruina hasta cumplirlos (días de
         * 24 h desde su `created_at` en GitHub). 0 lo desactiva.
         */
        minAccountAgeDays: z.number().int().min(0).max(3650),
      })
      .strict(),
    spin: z
      .object({
        /** Duración mínima de la animación de giro (ms), aunque el turno sea más corto. */
        minSpinMs: z.number().int().min(0).max(60_000),
        /**
         * Lo que tarda la bola en caer desde que se resuelve la ronda (ms). El servidor nunca pone
         * `revealAt` antes de "ahora + caída", así ni el mod ni la web destripan el resultado
         * cuando Claude tarda más que el giro mínimo.
         */
        landingMs: z.number().int().min(0).max(60_000),
      })
      .strict(),
    round: z
      .object({
        /** Las rondas abiertas más tiempo que esto caducan sin tirada (ms). */
        staleAfterMs: z.number().int().positive(),
      })
      .strict(),
    turn: z
      .object({
        /**
         * Duración mínima de un turno (ms), medida por el servidor entre `turn/start` y
         * `turn/end` (nunca la `durationMs` del cliente). Un turno más corto no da tirada ni
         * pendiente: ningún prompt real de Claude dura tan poco, un script sí.
         */
        minDurationMs: z.number().int().min(0).max(60_000),
      })
      .strict(),
    /**
     * Tope de tiradas jugadas (en directo y pendientes gastadas) por usuario y día, de 00:00 a
     * 00:00 en la zona horaria de la temporada. Al llegar, la mesa cierra hasta el día siguiente.
     */
    dailySpinLimit: z.number().int().min(1).max(1_000_000),
    streak: z
      .object({
        /** A partir de cuántos colores iguales seguidos sale el aviso de "falacia del jugador". */
        colorWarningAt: z.number().int().min(2).max(50),
        /** Cuántas tiradas recientes se miran para calcular la racha de color. */
        historySize: z.number().int().min(2).max(500),
        /** A partir de cuántas rondas ganadas seguidas el jugador está "ON FIRE". */
        onFireAt: z.number().int().min(2).max(1000),
      })
      .strict(),
    pendingSpins: z
      .object({
        /**
         * Tope de tiradas pendientes por usuario y temporada (prompts hechos sin ninguna ventana
         * visible). Los que pasan del tope se descartan.
         */
        max: z.number().int().min(1).max(10_000),
        /**
         * Giro mínimo (ms) de una tirada pendiente gastada en modo rápido (GIRAR TODAS). Marca
         * también el ritmo: no se puede gastar otra hasta que se haya enseñado la anterior.
         */
        quickSpinMs: z.number().int().min(0).max(60_000),
        /** Caída de la bola en una tirada rápida (GIRAR TODAS), en ms. */
        quickLandingMs: z.number().int().min(0).max(60_000),
      })
      .strict(),
    bigWin: z
      .object({
        /**
         * Premio gordo: ganancia neta de al menos este múltiplo de lo apostado (o un pleno
         * acertado, o el jackpot del `git push`). GIRAR TODAS se para en él.
         */
        minNetMultiple: z.number().min(1).max(1000),
        /** MEGA WIN: ganancia neta de al menos este múltiplo de lo apostado. */
        megaNetMultiple: z.number().min(1).max(1000),
      })
      .strict()
      .refine(b => b.megaNetMultiple > b.minNetMultiple, {
        message: 'el MEGA WIN tiene que pedir más que el BIG WIN',
        path: ['megaNetMultiple'],
      }),
    /**
     * Umbrales de los logros de broma (`game/achievements.ts`). Los que dependen de otro valor
     * del juego (tope de pendientes, ON FIRE, tope de deuda) usan ese valor y no se repiten aquí.
     */
    achievements: z
      .object({
        /** "Deudor profesional": préstamos pedidos en una misma temporada. */
        proDebtorLoans: z.number().int().min(1).max(100_000),
        /** "Interés compuesto": deuda mínima. */
        compoundInterestDebt: coins,
        /** "Coleccionista de ceros": veces que te ha salido el 0 (sumando todas las temporadas). */
        zeroCollectorZeros: z.number().int().min(1).max(100_000),
        /** "Lo dejo cuando quiera": tiradas en una misma temporada. */
        addictSpins: z.number().int().min(1).max(10_000_000),
        /**
         * "Deploy de madrugada": tirar entre estas horas (de pared, en la zona horaria de la
         * temporada). `fromHour` incluida y `toHour` excluida; si `fromHour > toHour`, cruza la
         * medianoche.
         */
        nightOwl: z
          .object({
            fromHour: z.number().int().min(0).max(23),
            toHour: z.number().int().min(0).max(23),
          })
          .strict()
          .refine(h => h.fromHour !== h.toHour, { message: 'el intervalo no puede estar vacío' }),
      })
      .strict(),
    /** Límites de las pantallas de Estadísticas y Banco (cuánto se lee y se manda). */
    stats: z
      .object({
        /** Tiradas de la lista "ÚLTIMAS". */
        recentRounds: z.number().int().min(1).max(200),
        /** Puntos como mucho de la gráfica del patrimonio (se muestrea si hay más tiradas). */
        seriesPoints: z.number().int().min(2).max(2000),
        /** Marcas de préstamo como mucho en la gráfica (las más recientes). */
        loanMarks: z.number().int().min(0).max(2000),
        /** Movimientos como mucho del historial del banco (los más recientes). */
        bankHistory: z.number().int().min(1).max(1000),
      })
      .strict(),
  })
  .strict()
  .refine(cfg => cfg.pendingSpins.quickLandingMs <= cfg.spin.landingMs, {
    message: 'la caída rápida no puede durar más que la normal',
    path: ['pendingSpins', 'quickLandingMs'],
  })
  .refine(cfg => cfg.pendingSpins.quickSpinMs <= cfg.spin.minSpinMs, {
    message: 'el giro rápido no puede durar más que el normal',
    path: ['pendingSpins', 'quickSpinMs'],
  })
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
    landingMs: z.number().int().min(0),
    colorWarningAt: z.number().int(),
    seasonTimeZone: z.string(),
    /** Día del mes en que empieza cada temporada (para calcular cuánto le queda). */
    seasonStartDay: z.number().int().min(1).max(28),
    pendingSpins: z
      .object({
        max: z.number().int().positive(),
        quickSpinMs: z.number().int().min(0),
        quickLandingMs: z.number().int().min(0),
      })
      .strict(),
    bigWin: z
      .object({ minNetMultiple: z.number().min(1), megaNetMultiple: z.number().min(1) })
      .strict(),
    /** Victorias seguidas para el "ON FIRE". */
    onFireAt: z.number().int().min(2),
    /**
     * Días que tiene que tener una cuenta de GitHub para salir en los rankings (0: sin mínimo).
     * La landing lo explica junto al ranking.
     */
    minAccountAgeDays: z.number().int().min(0),
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
    landingMs: cfg.spin.landingMs,
    colorWarningAt: cfg.streak.colorWarningAt,
    seasonTimeZone: cfg.season.timeZone,
    seasonStartDay: cfg.season.startDay,
    pendingSpins: {
      max: cfg.pendingSpins.max,
      quickSpinMs: cfg.pendingSpins.quickSpinMs,
      quickLandingMs: cfg.pendingSpins.quickLandingMs,
    },
    bigWin: {
      minNetMultiple: cfg.bigWin.minNetMultiple,
      megaNetMultiple: cfg.bigWin.megaNetMultiple,
    },
    onFireAt: cfg.streak.onFireAt,
    minAccountAgeDays: cfg.leaderboard.minAccountAgeDays,
  }
}
