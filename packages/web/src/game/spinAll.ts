// SPDX-License-Identifier: AGPL-3.0-or-later
// GIRAR TODAS: un bucle de la ventana que gasta las tiradas pendientes de una en una, con giro
// rápido, y se para solo en un premio gordo, en el verde o en bancarrota (reglas puras de
// `shared`), cuando ya no quedan o cuando el jugador pulsa ○. El servidor sigue mandando: el
// bucle solo pide la siguiente cuando la anterior se ha enseñado y la mesa vuelve a estar quieta.
import { spinAllStopReason } from '@vibe-gambling/shared'
import type { ResolvedRound, SpinAllRules, SpinAllStopReason, Wallet } from '@vibe-gambling/shared'

import { canSpinPending, pendingSpins } from './state.ts'
import type { GameState } from './state.ts'

/** Por qué terminó el bucle. */
export type SpinAllEnd = SpinAllStopReason | 'user' | 'empty' | 'error'

export interface SpinAllStatus {
  readonly running: boolean
  /** Tiradas gastadas en esta pasada. */
  readonly spun: number
  /** Por qué se paró la última vez (null mientras corre o si nunca ha corrido). */
  readonly ended: SpinAllEnd | null
}

export class SpinAllLoop {
  private readonly rules: SpinAllRules
  /** Espera antes de reintentar tras un `rate_limited` (ms). */
  private readonly retryMs: number
  /** No se pide otra antes de este instante (ms, reloj local). */
  private retryAt = 0
  private running = false
  /** Hay un `spin.pending` en vuelo: se espera a su `round.resolved` (o a un error). */
  private waiting = false
  private spun = 0
  private ended: SpinAllEnd | null = null

  constructor(rules: SpinAllRules, retryMs: number) {
    this.rules = rules
    this.retryMs = retryMs
  }

  status(): SpinAllStatus {
    return { running: this.running, spun: this.spun, ended: this.ended }
  }

  get active(): boolean {
    return this.running
  }

  /** Empieza (si hay algo que gastar). Devuelve si ha empezado. */
  start(state: GameState): boolean {
    if (this.running || pendingSpins(state) === 0) return false
    this.running = true
    this.waiting = false
    this.retryAt = 0
    this.spun = 0
    this.ended = null
    return true
  }

  /** Para el bucle. Devuelve el motivo si estaba corriendo (null si ya estaba parado). */
  stop(reason: SpinAllEnd): SpinAllEnd | null {
    if (!this.running) return null
    this.running = false
    this.waiting = false
    this.ended = reason
    return reason
  }

  /**
   * ¿Toca pedir la siguiente? Solo con la mesa quieta, sin nada en vuelo. Si ya no quedan,
   * el bucle termina (`empty`) y lo devuelve en `ended`.
   */
  next(state: GameState, nowMs: number): { spin: boolean; ended: SpinAllEnd | null } {
    if (!this.running || this.waiting || nowMs < this.retryAt) return { spin: false, ended: null }
    if (pendingSpins(state) === 0 && state.phase === 'idle') {
      return { spin: false, ended: this.stop('empty') }
    }
    if (!canSpinPending(state)) return { spin: false, ended: null }
    this.waiting = true
    return { spin: true, ended: null }
  }

  /** El servidor ha resuelto la tirada pedida (`round.resolved`). */
  resolved(): void {
    if (!this.running) return
    this.waiting = false
    this.spun += 1
  }

  /**
   * Se ha enseñado el resultado: ¿hay que pararse? Devuelve el motivo (y para el bucle) o null.
   * Se mira la cartera del servidor (la de después de la tirada).
   */
  revealed(round: ResolvedRound, wallet: Pick<Wallet, 'balance'>): SpinAllStopReason | null {
    if (!this.running) return null
    const reason = spinAllStopReason(round, wallet, this.rules)
    if (reason) this.stop(reason)
    return reason
  }

  /**
   * El servidor rechazó la petición. `rate_limited` (la bola anterior aún rodaba por un desfase
   * de reloj) no para el bucle: se vuelve a pedir pasado `retryMs`. Cualquier otro error, sí.
   */
  failed(code: string, nowMs: number): SpinAllEnd | null {
    if (!this.running) return null
    this.waiting = false
    if (code === 'rate_limited') {
      this.retryAt = nowMs + this.retryMs
      return null
    }
    return code === 'not_found' ? this.stop('empty') : this.stop('error')
  }
}
