// SPDX-License-Identifier: AGPL-3.0-or-later
// Piezas del protocolo para las pantallas de la v2: logros, estadísticas de la temporada y banco.
import { z } from 'zod'

import { ACHIEVEMENT_IDS } from '../game/achievements.ts'
import { seasonIdSchema } from '../game/season.ts'
import { coinsSchema, pocketColorSchema } from './common.ts'

export const achievementIdSchema = z.enum(ACHIEVEMENT_IDS)

/**
 * Un logro del catálogo visto por su dueño. Los logros son para siempre (no por temporada):
 * `seasonId` es la temporada en la que se consiguió.
 */
export const achievementSchema = z
  .object({
    id: achievementIdSchema,
    /** Secreto: la web enseña "???" mientras `unlockedAt` sea null. */
    hidden: z.boolean(),
    unlockedAt: z.iso.datetime().nullable(),
    seasonId: seasonIdSchema.nullable(),
    /**
     * Valores de los `{marcadores}` de sus textos de i18n (`goal`, `multiple`, `from`, `to`…),
     * con la configuración de esta instancia.
     */
    params: z.record(z.string().regex(/^[a-z][A-Za-z]{0,31}$/), z.number()),
    /** Solo los contables y aún sin conseguir: valor actual (tope = meta) y meta. */
    progress: z
      .object({ current: z.number().int().min(0), goal: z.number().int().positive() })
      .strict()
      .nullable(),
  })
  .strict()
export type Achievement = z.output<typeof achievementSchema>

/** Una tirada resumida (lista "ÚLTIMAS" y "MAYOR PREMIO"). */
export const roundSummarySchema = z
  .object({
    roundId: z.uuid(),
    resolvedAt: z.iso.datetime(),
    result: z.number().int().min(0).max(36),
    color: pocketColorSchema,
    staked: z.number().int().min(0),
    net: coinsSchema,
  })
  .strict()
export type RoundSummary = z.output<typeof roundSummarySchema>

/** Estadísticas de una temporada del propio jugador (pantalla ESTADÍSTICAS). */
export const seasonStatsSchema = z
  .object({
    seasonId: seasonIdSchema,
    /** Temporadas en las que ha jugado, de la más reciente a la más antigua (para ←→). */
    seasons: z.array(seasonIdSchema),
    spins: z.number().int().min(0),
    bestStreak: z.number().int().min(0),
    /**
     * Patrimonio tras cada tirada, muestreado a `stats.seriesPoints` puntos como mucho. `spin` es
     * el número de tirada (0 = antes de la primera, con el saldo inicial). El último punto es
     * siempre la última tirada.
     */
    series: z.array(z.object({ spin: z.number().int().min(0), netWorth: coinsSchema }).strict()),
    /** Máximo y mínimo del patrimonio en toda la temporada (no solo en los puntos muestreados). */
    peakNetWorth: coinsSchema,
    lowestNetWorth: coinsSchema,
    /** Tirada tras la que se pidió cada préstamo (▼ en la gráfica), las más recientes. */
    loanMarks: z.array(z.number().int().min(0)),
    /** Últimas tiradas, de la más reciente a la más antigua. */
    recent: z.array(roundSummarySchema),
    /** Número que más ha salido en la temporada (con empate, el menor). */
    mostFrequent: z
      .object({
        result: z.number().int().min(0).max(36),
        color: pocketColorSchema,
        count: z.number().int().positive(),
      })
      .strict()
      .nullable(),
    /** Tirada con más ganancia neta (null si nunca ha ganado). */
    biggestWin: roundSummarySchema.nullable(),
  })
  .strict()
export type SeasonStats = z.output<typeof seasonStatsSchema>

/** Un movimiento del historial del banco. Los intereses se agrupan por día y entre préstamos. */
export const bankEntrySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('loan'),
      at: z.iso.datetime(),
      amount: z.number().int().positive(),
      /** Deuda justo después del movimiento. */
      debtAfter: coinsSchema.min(0),
    })
    .strict(),
  z
    .object({
      kind: z.literal('interest'),
      /** Día de pared (zona horaria de la temporada), `AAAA-MM-DD`. */
      day: z.iso.date(),
      /** Primera y última tirada del grupo. */
      from: z.iso.datetime(),
      to: z.iso.datetime(),
      spins: z.number().int().positive(),
      amount: z.number().int().positive(),
      debtAfter: coinsSchema.min(0),
    })
    .strict(),
])
export type BankEntry = z.output<typeof bankEntrySchema>

/** Pantalla BANCO: deuda, condiciones del Ludo-Crédito e historial de la temporada. */
export const bankStatementSchema = z
  .object({
    seasonId: seasonIdSchema,
    seasons: z.array(seasonIdSchema),
    balance: coinsSchema,
    debt: coinsSchema.min(0),
    netWorth: coinsSchema,
    loans: z.number().int().min(0),
    /** Lo que sumará a la deuda la próxima tirada (0 en temporadas pasadas). */
    nextInterest: z.number().int().min(0),
    /** Si ahora mismo se le concedería un préstamo (solo en la temporada en curso). */
    canBorrow: z.boolean(),
    /** Movimientos, del más reciente al más antiguo, hasta `stats.bankHistory`. */
    history: z.array(bankEntrySchema),
    /** true si hay movimientos más antiguos que no caben. */
    truncated: z.boolean(),
  })
  .strict()
export type BankStatement = z.output<typeof bankStatementSchema>
