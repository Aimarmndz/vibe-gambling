// SPDX-License-Identifier: AGPL-3.0-or-later
// Curvas de las animaciones de espectáculo (docs/DISENO-V2.md, "Curvas y tiempos"). Son cubic-bezier
// de CSS evaluadas a mano; después de aplicar la curva, cada posición se redondea a píxel entero
// (regla "movimiento en escalones"), así que aquí basta con precisión de coma flotante normal.

export type Ease = (k: number) => number

/** cubic-bezier(x1, y1, x2, y2) como en CSS: resuelve x(s) = k por Newton y bisección. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const bx = (s: number) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3
  const by = (s: number) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3
  const dx = (s: number) =>
    3 * x1 * (1 - s) ** 2 + 6 * (x2 - x1) * s * (1 - s) + 3 * (1 - x2) * s * s
  return k => {
    if (k <= 0) return 0
    if (k >= 1) return 1
    let s = k
    for (let i = 0; i < 6; i++) {
      const d = dx(s)
      if (Math.abs(d) < 1e-6) break
      s -= (bx(s) - k) / d
    }
    if (s < 0 || s > 1 || Math.abs(bx(s) - k) > 1e-4) {
      // Newton se ha salido: bisección, que siempre converge (x es monótona en [0, 1]).
      let lo = 0
      let hi = 1
      for (let i = 0; i < 30; i++) {
        s = (lo + hi) / 2
        if (bx(s) < k) lo = s
        else hi = s
      }
    }
    return by(s)
  }
}

export const outBack = cubicBezier(0.34, 1.56, 0.64, 1)
export const outCubic = cubicBezier(0.33, 1, 0.68, 1)
export const outExpo = cubicBezier(0.16, 1, 0.3, 1)
export const inQuad = cubicBezier(0.11, 0, 0.5, 0)

/** Fracción 0–1 de un tramo [start, start + duration) en el instante `ms`. */
export function progress(ms: number, start: number, duration: number): number {
  if (duration <= 0) return ms >= start ? 1 : 0
  return Math.min(1, Math.max(0, (ms - start) / duration))
}

/** Interpolación lineal. */
export function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

/**
 * Escala de texto en escalones (los "rebotes" de los rótulos): de `from` a `to` bajando uno cada
 * `stepMs`. Nunca devuelve escalas fraccionarias.
 */
export function stepScale(ms: number, from: number, to: number, stepMs: number): number {
  if (ms <= 0) return from
  const steps = Math.floor(ms / Math.max(1, stepMs))
  return from > to ? Math.max(to, from - steps) : Math.min(to, from + steps)
}

/** Valor de un contador que rueda (curva `outCubic`), siempre entero. */
export function rollValue(from: number, to: number, k: number): number {
  return Math.round(lerp(from, to, outCubic(Math.min(1, Math.max(0, k)))))
}
