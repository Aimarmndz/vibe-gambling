// SPDX-License-Identifier: AGPL-3.0-or-later
// Contador de tiradas pendientes como un odómetro (docs/DISENO-V2.md, "Contador de pendientes",
// sb-pending-counter.png): al sumar, el número viejo sale hacia arriba y el nuevo entra por abajo
// (al gastar, al revés), un paso por unidad (si cambian más de 5, un solo giro) y todo dentro de
// `ui.counterBumpMs`; "+n" en oro que sube 12 px y se desvanece. Lógica pura (tiempos en ms).

export interface OdometerLook {
  /** Número que sale (null = no hay giro en curso). */
  from: number | null
  /** Número que entra (o el que se ve quieto). */
  to: number
  /** Avance del giro, 0–1. */
  k: number
  /** +1 sube (el viejo sale por arriba), −1 baja. */
  dir: 1 | -1
  /** "+n" / "−n" que flota, con su subida en px y opacidad; null si no hay. */
  float: { text: string; rise: number; alpha: number } | null
  /** Destello del panel (el primer fotograma del cambio). */
  flash: boolean
}

export interface OdometerTiming {
  /** Un paso del giro (`fx.pending.rollMs`). */
  rollMs: number
  /** Lo que tarda el "+n" en subir y apagarse (`fx.pending.floatMs`). */
  floatMs: number
  /** Tope de toda la animación de giro (`ui.counterBumpMs`). */
  budgetMs: number
}

/** Pasos de giro para una diferencia: uno por unidad hasta 5; más, un solo giro. */
export function rollSteps(diff: number): number {
  const d = Math.abs(diff)
  return d === 0 ? 0 : d <= 5 ? d : 1
}

/** Lo que dura un fotograma "de destello" (≈ 1 fotograma a 60 fps). */
const FLASH_MS = 17
/** Subida del "+n" en píxeles. */
const FLOAT_RISE = 12

export class Odometer {
  private readonly timing: OdometerTiming
  private readonly reduced: boolean
  private value: number | null = null
  private from = 0
  private changedAt = -Infinity

  constructor(timing: OdometerTiming, reduced: boolean) {
    this.timing = timing
    this.reduced = reduced
  }

  /** Mira el valor en el instante `ms`; si cambió, empieza el giro. */
  see(value: number, ms: number): void {
    if (this.value !== null && value !== this.value) {
      this.from = this.value
      this.changedAt = ms
    }
    this.value = value
  }

  look(ms: number): OdometerLook {
    const to = this.value ?? 0
    const diff = to - this.from
    const since = ms - this.changedAt
    const quiet: OdometerLook = { from: null, to, k: 1, dir: 1, float: null, flash: false }
    if (!(since >= 0) || diff === 0) return quiet
    const dir: 1 | -1 = diff > 0 ? 1 : -1
    const flash = since < FLASH_MS
    if (this.reduced) return { ...quiet, flash }
    const steps = rollSteps(diff)
    const stepMs = Math.min(this.timing.rollMs, this.timing.budgetMs / steps)
    const i = Math.floor(since / stepMs)
    const floatK = since / this.timing.floatMs
    const float =
      floatK < 1
        ? {
            text: `${dir > 0 ? '+' : '−'}${Math.abs(diff)}`,
            rise: Math.round(FLOAT_RISE * floatK),
            alpha: 1 - floatK,
          }
        : null
    if (i >= steps) return { ...quiet, float, flash, dir }
    // Un giro de "a" a "b"; si eran más de 5, de golpe del viejo al nuevo.
    const a = steps === 1 ? this.from : this.from + dir * i
    const b = steps === 1 ? to : a + dir
    return { from: a, to: b, k: (since - i * stepMs) / stepMs, dir, float, flash }
  }
}
