// SPDX-License-Identifier: AGPL-3.0-or-later
// Base de las pantallas de espectáculo: reloj con cues, "siempre saltable" con ✕/○/clic (la primera
// pulsación lleva al estado final y la segunda cierra), cierre solo al acabar el hold y una zona
// clicable de pantalla completa para que el clic no caiga en la mesa de debajo.
import type { Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { PSX_HEIGHT, PSX_WIDTH } from '../pipeline.ts'
import { FxClock } from './clock.ts'
import type { Cue } from './clock.ts'
import type { FxKit } from './kit.ts'

export abstract class FxScreen implements Screen {
  abstract readonly id: string
  protected readonly kit: FxKit
  protected clock: FxClock
  private readonly onDone: () => void
  private closed = false

  constructor(kit: FxKit, onDone: () => void) {
    this.kit = kit
    this.onDone = onDone
    this.clock = new FxClock(0, 0)
  }

  /** Programa la animación: estado final, hold y sonidos. Llamar desde el constructor. */
  protected timeline(finalAt: number, holdMs: number, cues: Cue[] = []): void {
    this.clock = new FxClock(finalAt, holdMs, cues)
  }

  /** Milisegundos desde t = 0. */
  get ms(): number {
    return this.clock.ms
  }

  get isClosed(): boolean {
    return this.closed
  }

  /** Cierra y pasa al siguiente paso de la secuencia. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.kit.ctx.pop(this)
    this.onDone()
  }

  /** Quita la pantalla sin seguir con la secuencia (llega otra ronda). */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.kit.ctx.pop(this)
  }

  /** ✕/○/clic: primero al final, luego cerrar. */
  protected press(): void {
    if (this.clock.skip() === 'close') {
      this.kit.ctx.sfx.play('accept')
      this.close()
    } else {
      this.onSkip()
    }
  }

  /** Al saltar al estado final (p. ej. soltar todas las fichas de golpe). */
  protected onSkip(): void {}

  update(dt: number): void {
    this.clock.tick(dt * 1000)
    this.step(dt)
    if (this.clock.expired) this.close()
  }

  /** Lo que avanza cada fotograma además del reloj. */
  protected step(_dt: number): void {}

  action(e: ActionEvent): void {
    if (e.action === 'accept' || e.action === 'back' || e.action === 'start') this.press()
  }

  pointer(kind: 'move' | 'down' | 'leave'): boolean {
    if (kind === 'down') this.press()
    return true
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    this.kit.ctx.hits.add({
      x: 0,
      y: 0,
      w: PSX_WIDTH,
      h: PSX_HEIGHT,
      id: `${this.id}:skip`,
      onClick: () => this.press(),
    })
    this.drawUi(g, t)
  }

  /** Capa de interfaz (no tiembla): ayuda inferior, ventanas fijas. */
  protected drawUi(_g: CanvasRenderingContext2D, _t: number): void {}

  abstract drawFx(fx: CanvasRenderingContext2D, t: number): boolean
}
