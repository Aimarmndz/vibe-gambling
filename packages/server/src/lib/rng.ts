// SPDX-License-Identifier: AGPL-3.0-or-later
// Azar de la ruleta: `crypto.randomInt` en el servidor, inyectable para los tests.
import { randomInt } from 'node:crypto'

import { POCKET_COUNT } from '@vibe-gambling/shared'

export interface Rng {
  /** Una casilla entre 0 y 36, uniforme. */
  pocket(): number
}

export const cryptoRng: Rng = { pocket: () => randomInt(0, POCKET_COUNT) }

/** RNG de test: devuelve los números indicados en orden y luego repite el último. */
export function sequenceRng(
  values: readonly number[],
): Rng & { push(...v: number[]): void; fix(n: number): void } {
  const queue = [...values]
  let last = values.at(-1) ?? 0
  return {
    pocket() {
      const next = queue.shift()
      if (next !== undefined) last = next
      return last
    },
    push(...v: number[]) {
      queue.push(...v)
    },
    /** A partir de ahora siempre sale `n`. */
    fix(n: number) {
      queue.length = 0
      last = n
    },
  }
}
