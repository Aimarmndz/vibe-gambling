// SPDX-License-Identifier: AGPL-3.0-or-later
// Reloj inyectable: el código nunca llama a `new Date()` directamente, así los tests controlan el tiempo.

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

/** Reloj manual para los tests: solo avanza cuando se le pide. */
export class ManualClock implements Clock {
  #ms: number

  constructor(start: Date | string) {
    this.#ms = new Date(start).getTime()
  }

  now(): Date {
    return new Date(this.#ms)
  }

  set(instant: Date | string): void {
    this.#ms = new Date(instant).getTime()
  }

  advance(ms: number): void {
    this.#ms += ms
  }
}
