// SPDX-License-Identifier: AGPL-3.0-or-later
// Nivel de espectáculo de una ronda resuelta: qué animaciones le tocan (BIG WIN, MEGA WIN, ¡PLENO!,
// ¡VERDE!, PUSH TO PROD, ON FIRE, falacia del jugador, BANCARROTA). Lógica pura: el servidor lo
// calcula al resolver y lo manda dentro de la ronda, para que la web y el mod no lo recalculen
// cada uno a su manera. Los umbrales salen de la configuración del juego.
import type { ColorStreak } from './streaks.ts'

/** Tamaño del premio, de menor a mayor. `straight` (¡PLENO!) sustituye a MEGA WIN. */
export const WIN_TIERS = ['none', 'win', 'big', 'mega', 'straight'] as const
export type WinTier = (typeof WIN_TIERS)[number]

/** Estado de la racha ganadora: `ignite` es la ronda que la enciende (la de la intro). */
export const FIRE_STATES = ['none', 'ignite', 'burning'] as const
export type FireState = (typeof FIRE_STATES)[number]

/** Umbrales que mira el espectáculo (están en la configuración pública con este mismo nombre). */
export interface SpectacleRules {
  readonly bigWin: { readonly minNetMultiple: number; readonly megaNetMultiple: number }
  readonly onFireAt: number
  readonly colorWarningAt: number
}

/** Lo que el espectáculo necesita de una ronda resuelta. */
export interface SpectacleRound {
  readonly result: number
  readonly net: number
  readonly staked: number
  readonly jackpot: boolean
  readonly colorStreak: ColorStreak | null
  readonly bets: ReadonlyArray<{
    readonly won: boolean
    readonly selection: { readonly kind: string }
  }>
}

/** Lo que sabe la cartera justo después de la ronda. */
export interface SpectacleContext {
  /** Racha del jugador después de la ronda (positiva = ganadas seguidas). */
  readonly streak: number
  /** Si en esta ronda el patrimonio cayó a 0 o menos por primera vez en la temporada. */
  readonly bankrupt: boolean
}

export interface Spectacle {
  readonly tier: WinTier
  /** Ganancia neta entre lo apostado, redondeada hacia abajo (0 si no se gana). El "×15". */
  readonly netMultiple: number
  /**
   * Premio gordo: un nivel `big` o mayor, o el jackpot del `git push` con ganancia. Es la regla de
   * parada de GIRAR TODAS (`isBigWin`).
   */
  readonly bigWin: boolean
  /** Salió el verde (0). */
  readonly green: boolean
  /** Salió el 0 y se ganó con una apuesta que lo cubría (encadena ¡VERDE! con el premio). */
  readonly greenWin: boolean
  /** Jackpot dev: PUSH TO PROD antes del resultado. */
  readonly jackpot: boolean
  readonly streak: number
  readonly fire: FireState
  /** La racha de color llega al aviso de la falacia del jugador. */
  readonly fallacy: boolean
  /** BANCARROTA — CONTINUE? (primera vez en la temporada). */
  readonly bankrupt: boolean
}

/** Tamaño del premio según el neto respecto a lo apostado. */
export function winTier(round: SpectacleRound, rules: Pick<SpectacleRules, 'bigWin'>): WinTier {
  if (round.net <= 0 || round.staked <= 0) return 'none'
  if (round.bets.some(bet => bet.won && bet.selection.kind === 'straight')) return 'straight'
  if (round.net >= round.staked * rules.bigWin.megaNetMultiple) return 'mega'
  if (round.net >= round.staked * rules.bigWin.minNetMultiple) return 'big'
  return 'win'
}

/** Ganancia neta como múltiplo entero de lo apostado (0 sin ganancia). */
export function netMultipleOf(round: Pick<SpectacleRound, 'net' | 'staked'>): number {
  if (round.net <= 0 || round.staked <= 0) return 0
  return Math.floor(round.net / round.staked)
}

/**
 * Racha ganadora: se enciende en la ronda que la lleva justo al umbral. Una ronda ganada suma
 * exactamente 1, así que esa es la única en la que la racha vale `onFireAt` y se ha ganado.
 */
export function fireState(streak: number, won: boolean, onFireAt: number): FireState {
  if (streak < onFireAt) return 'none'
  return streak === onFireAt && won ? 'ignite' : 'burning'
}

export function spectacleOf(
  round: SpectacleRound,
  ctx: SpectacleContext,
  rules: SpectacleRules,
): Spectacle {
  const tier = winTier(round, rules)
  const won = tier !== 'none'
  const green = round.result === 0
  return {
    tier,
    netMultiple: netMultipleOf(round),
    bigWin: tier === 'big' || tier === 'mega' || tier === 'straight' || (won && round.jackpot),
    green,
    greenWin: green && won,
    jackpot: round.jackpot && won,
    streak: ctx.streak,
    fire: fireState(ctx.streak, won, rules.onFireAt),
    fallacy: round.colorStreak !== null && round.colorStreak.count >= rules.colorWarningAt,
    bankrupt: ctx.bankrupt,
  }
}
