// SPDX-License-Identifier: AGPL-3.0-or-later
// Rachas: la del jugador (ganadas/perdidas seguidas) y la de color (la falacia del jugador).
import { colorOf } from '../roulette/wheel.ts'
import type { PocketColor } from '../roulette/wheel.ts'

/**
 * Racha del jugador: positiva = rondas ganadas seguidas, negativa = perdidas.
 * Una ronda sin apuesta (`null`) no la rompe. Una ronda "ganada" es la de neto > 0.
 */
export function nextStreak(current: number, net: number | null): number {
  if (net === null || net === 0) return current
  if (net > 0) return current > 0 ? current + 1 : 1
  return current < 0 ? current - 1 : -1
}

/** Mejor racha ganadora histórica. */
export function bestStreak(best: number, current: number): number {
  return Math.max(best, current)
}

export interface ColorStreak {
  color: PocketColor
  count: number
}

/**
 * Color que se repite al final de una lista de resultados (del más antiguo al más reciente).
 * Devuelve `null` si no hay resultados.
 */
export function colorStreak(results: readonly number[]): ColorStreak | null {
  const last = results.at(-1)
  if (last === undefined) return null
  const color = colorOf(last)
  let count = 0
  for (let i = results.length - 1; i >= 0; i--) {
    const n = results[i]
    if (n === undefined || colorOf(n) !== color) break
    count++
  }
  return { color, count }
}

/** El color "que TIENE que salir" según la falacia del jugador. */
export function gamblersFallacyPick(streak: ColorStreak): PocketColor {
  if (streak.color === 'red') return 'black'
  if (streak.color === 'black') return 'red'
  return 'red'
}
