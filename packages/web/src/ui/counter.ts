// SPDX-License-Identifier: AGPL-3.0-or-later
// Contador con salto: cuando cambia el número (una tirada guardada o gastada), da un bote, parpadea
// y enseña el "+1" / "−1" que flota hacia arriba. Con movimiento reducido solo cambia de color.

export interface CounterLook {
  /** Desplazamiento vertical del número (píxeles; negativo = arriba). */
  readonly dy: number
  /** Si el número debe pintarse resaltado en este fotograma. */
  readonly flash: boolean
  /** Diferencia que flota ("+1", "−3") o null si no hay salto en curso. */
  readonly delta: string | null
  /** Altura del texto flotante sobre el número (píxeles). */
  readonly deltaRise: number
}

const QUIET: CounterLook = Object.freeze({ dy: 0, flash: false, delta: null, deltaRise: 0 })

export class BumpCounter {
  private value: number | null = null
  private changedAt = -Infinity
  private diff = 0
  private readonly durationS: number
  private readonly reducedMotion: boolean

  constructor(durationMs: number, reducedMotion: boolean) {
    this.durationS = durationMs / 1000
    this.reducedMotion = reducedMotion
  }

  /** Mira el valor actual en el instante `t` (s); si cambió, empieza un salto. */
  see(value: number, t: number): void {
    if (this.value !== null && value !== this.value) {
      this.diff = value - this.value
      this.changedAt = t
    }
    this.value = value
  }

  look(t: number): CounterLook {
    const k = (t - this.changedAt) / this.durationS
    if (k < 0 || k >= 1) return QUIET
    const flash = Math.floor(k * 6) % 2 === 0
    if (this.reducedMotion) return { dy: 0, flash, delta: null, deltaRise: 0 }
    const sign = this.diff > 0 ? '+' : '−'
    return {
      // Un bote: sube y vuelve (seno), más alto al sumar que al gastar.
      dy: -Math.round(Math.sin(k * Math.PI) * (this.diff > 0 ? 3 : 2)),
      flash,
      delta: `${sign}${Math.abs(this.diff)}`,
      deltaRise: Math.round(k * 8),
    }
  }
}
