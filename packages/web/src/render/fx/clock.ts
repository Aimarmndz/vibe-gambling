// SPDX-License-Identifier: AGPL-3.0-or-later
// Reloj de una animación de espectáculo: tiempo transcurrido, sonidos programados (cues) y la regla
// de "siempre saltable" (docs/DISENO-V2.md, regla 3): la primera pulsación lleva la animación a su
// estado final y la segunda la cierra. Lógica pura (sin canvas ni audio) para poder probarla.

/** Algo que pasa en un instante de la animación (normalmente, un sonido). */
export interface Cue {
  /** Milisegundos desde t = 0. */
  at: number
  run: () => void
}

export type SkipResult = 'finished' | 'close'

export class FxClock {
  /** Milisegundos transcurridos. */
  ms = 0
  /** Instante en que la animación llega a su estado final (antes del hold). */
  readonly finalAt: number
  /** Instante en que se cierra sola (estado final + hold). */
  readonly closeAt: number
  private readonly cues: Cue[]
  private next = 0
  private skipped = false

  constructor(finalAt: number, holdMs: number, cues: readonly Cue[] = []) {
    this.finalAt = Math.max(0, finalAt)
    this.closeAt = this.finalAt + Math.max(0, holdMs)
    this.cues = [...cues].sort((a, b) => a.at - b.at)
  }

  /** Avanza `dtMs` y dispara las cues que caen en el tramo (ninguna después de saltar). */
  tick(dtMs: number): void {
    this.ms += Math.max(0, dtMs)
    while (this.next < this.cues.length && this.cues[this.next]!.at <= this.ms) {
      const cue = this.cues[this.next++]!
      if (!this.skipped) cue.run()
    }
  }

  /** ¿Ya se ha llegado al estado final (sola o saltando)? */
  get finished(): boolean {
    return this.ms >= this.finalAt
  }

  /** ¿Toca cerrarse sola? */
  get expired(): boolean {
    return this.ms >= this.closeAt
  }

  /** Si se ha saltado (para no repetir sonidos al llegar al final de golpe). */
  get wasSkipped(): boolean {
    return this.skipped
  }

  /**
   * Pulsación de ✕/○/clic. Si la animación aún no ha terminado, salta a su estado final (y se
   * descartan las cues pendientes); si ya estaba en el final, toca cerrar.
   */
  skip(): SkipResult {
    if (this.finished) return 'close'
    this.skipped = true
    this.ms = this.finalAt
    this.next = this.cues.findIndex(c => c.at > this.ms)
    if (this.next < 0) this.next = this.cues.length
    return 'finished'
  }
}
