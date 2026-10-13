// SPDX-License-Identifier: AGPL-3.0-or-later
// Cola de avisos de logro estilo trofeo (docs/DISENO-V2.md, "Aviso de logro", sb-achievement.png).
// También la usan las comisiones del programa de afiliados (misma ventana, otro título).
// Lógica pura de tiempos: los logros llegan por `achievement.unlocked` detrás del mensaje que los
// desbloquea (a menudo `round.resolved`, antes de que caiga la bola), así que se encolan y solo
// salen cuando la ventana deja (`ready`): nunca destripan el resultado antes de `revealAt`.
import type { FxConfig } from '../../config.ts'
import { inQuad, outBack, progress } from './easing.ts'

/** Ventana del aviso (140×32 en y = 50, bajo el HUD derecho; se ensancha si el nombre no cabe). */
export const NOTICE = { y: 50, h: 32, minW: 140, right: 316 } as const

export interface ShownNotice<T> {
  item: T
  /** Milisegundos desde que empezó a entrar. */
  ms: number
}

export interface NoticePose {
  /** x de la ventana (entra desde x = 320). */
  x: number
  /** Brillo diagonal (0–1) o null. */
  sheen: number | null
  /** Si ya se ha ido del todo. */
  done: boolean
}

/** Cola de avisos: cada uno con un `id` (no se encola dos veces el mismo). */
export class NoticeQueue<T extends { readonly id: string }> {
  private readonly cfg: FxConfig['achievement']
  private readonly reduced: boolean
  private readonly queue: T[] = []
  private current: ShownNotice<T> | null = null
  /** Espera entre dos avisos (ms que quedan). */
  private gap = 0

  constructor(cfg: FxConfig['achievement'], reduced: boolean) {
    this.cfg = cfg
    this.reduced = reduced
  }

  /** Duración total de un aviso. */
  get totalMs(): number {
    return this.cfg.inMs + this.cfg.holdMs + this.cfg.outMs
  }

  push(a: T): void {
    if (this.queue.some(q => q.id === a.id) || this.current?.item.id === a.id) return
    this.queue.push(a)
  }

  get pending(): number {
    return this.queue.length + (this.current ? 1 : 0)
  }

  get shown(): ShownNotice<T> | null {
    return this.current
  }

  /**
   * Avanza `dtMs`. `ready` = la ventana deja enseñar avisos (la bola ya ha caído y no hay una
   * animación de espectáculo a pantalla completa). Devuelve el aviso que acaba de empezar a
   * enseñarse (para el sonido y el lector de pantalla), o null.
   */
  tick(dtMs: number, ready: boolean): T | null {
    if (this.current) {
      this.current.ms += dtMs
      if (this.current.ms >= this.totalMs) {
        this.current = null
        this.gap = this.cfg.gapMs
      }
      return null
    }
    if (this.gap > 0) {
      this.gap -= dtMs
      return null
    }
    if (!ready) return null
    const next = this.queue.shift()
    if (!next) return null
    this.current = { item: next, ms: 0 }
    return next
  }

  /** Posición de la ventana de ancho `w` en el instante del aviso. */
  pose(ms: number, w: number): NoticePose {
    const c = this.cfg
    const rest = NOTICE.right - w
    const outAt = c.inMs + c.holdMs
    if (ms >= outAt + c.outMs) return { x: 320, sheen: null, done: true }
    if (this.reduced) return { x: rest, sheen: null, done: false }
    let x = rest
    if (ms < c.inMs) x = Math.round(320 + (rest - 320) * outBack(progress(ms, 0, c.inMs)))
    else if (ms >= outAt) x = Math.round(rest + (320 - rest) * inQuad(progress(ms, outAt, c.outMs)))
    // El brillo cruza la ventana justo antes de salir (300 ms).
    const sheenStart = outAt - 200
    const sheen = ms >= sheenStart && ms < sheenStart + 300 ? (ms - sheenStart) / 300 : null
    return { x, sheen, done: false }
  }
}
