// SPDX-License-Identifier: AGPL-3.0-or-later
// Reglas fijas de la ruleta europea. Son constantes de la lógica del juego,
// no configuración: cambiarlas sería jugar a otra cosa.

/** Número de casillas de la ruleta europea (0–36). */
export const POCKET_COUNT = 37

/** Mayor número de la ruleta. */
export const MAX_NUMBER = 36

/** Orden real de las casillas en el cilindro europeo, en el sentido de las agujas del reloj. */
export const WHEEL_ORDER: readonly number[] = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
])

/** Números rojos de la ruleta europea. El resto (salvo el 0) son negros. */
export const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
])

export type PocketColor = 'red' | 'black' | 'green'

/** Comprueba que `n` es una casilla válida (entero entre 0 y 36). */
export function isPocket(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= MAX_NUMBER
}

/** Color de una casilla. Lanza si el número no existe en la ruleta. */
export function colorOf(n: number): PocketColor {
  if (!isPocket(n)) throw new RangeError(`casilla inexistente: ${n}`)
  if (n === 0) return 'green'
  return RED_NUMBERS.has(n) ? 'red' : 'black'
}

/** Posición de una casilla en el cilindro (índice en WHEEL_ORDER). */
export function wheelIndexOf(n: number): number {
  if (!isPocket(n)) throw new RangeError(`casilla inexistente: ${n}`)
  return WHEEL_ORDER.indexOf(n)
}

/** Columna del tapete (1, 2 o 3) de un número del 1 al 36. */
export function columnOf(n: number): 1 | 2 | 3 {
  if (!isPocket(n) || n === 0) throw new RangeError(`el ${n} no está en ninguna columna`)
  return (((n - 1) % 3) + 1) as 1 | 2 | 3
}

/** Fila del tapete (1–12) de un número del 1 al 36. */
export function rowOf(n: number): number {
  if (!isPocket(n) || n === 0) throw new RangeError(`el ${n} no está en ninguna fila`)
  return Math.ceil(n / 3)
}
