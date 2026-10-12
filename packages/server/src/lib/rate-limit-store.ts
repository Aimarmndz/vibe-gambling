// SPDX-License-Identifier: AGPL-3.0-or-later
// Almacén en memoria del rate limit que OLVIDA cada clave en cuanto vence su ventana.
// El de @fastify/rate-limit es un LRU sin caducidad: una IP que entra una vez se queda en memoria
// hasta que otras 5000 claves la empujan fuera (o hasta reiniciar), y la política de privacidad
// promete que la IP solo vive lo que dura la ventana del límite.
import type { FastifyRateLimitStore } from '@fastify/rate-limit'

type Callback = Parameters<FastifyRateLimitStore['incr']>[1]

interface Entry {
  current: number
  /** Cuándo vence la ventana de esta clave (ms). */
  expiresAt: number
  /** Borra la clave al vencer, aunque no vuelva a llegar ninguna petición. */
  timer: NodeJS.Timeout
}

export class ExpiringStore implements FastifyRateLimitStore {
  /** En orden de llegada: al pasarse del tope se descartan las primeras (las más antiguas). */
  readonly #entries = new Map<string, Entry>()
  readonly #maxKeys: number

  constructor(maxKeys: number) {
    this.#maxKeys = maxKeys
  }

  get size(): number {
    return this.#entries.size
  }

  has(key: string): boolean {
    return this.#entries.has(key)
  }

  incr(key: string, callback: Callback, timeWindow: number, _max: number): void {
    const now = Date.now()
    let entry = this.#entries.get(key)
    // El temporizador puede llegar con retraso si el proceso está ocupado: la hora manda.
    if (entry && entry.expiresAt <= now) this.#forget(key)
    entry = this.#entries.get(key)
    if (!entry) {
      const timer = setTimeout(() => {
        if (this.#entries.get(key) === created) this.#entries.delete(key)
      }, timeWindow)
      timer.unref()
      const created: Entry = { current: 0, expiresAt: now + timeWindow, timer }
      entry = created
      this.#entries.set(key, entry)
      // Tope de claves: bajo una avalancha de IPs distintas, se descartan las más antiguas.
      for (const oldest of this.#entries.keys()) {
        if (this.#entries.size <= this.#maxKeys) break
        this.#forget(oldest)
      }
    }
    entry.current++
    callback(null, { current: entry.current, ttl: entry.expiresAt - now })
  }

  child(): ExpiringStore {
    return new ExpiringStore(this.#maxKeys)
  }

  #forget(key: string): void {
    const entry = this.#entries.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    this.#entries.delete(key)
  }
}

/** Clase para la opción `store` de @fastify/rate-limit (el plugin la instancia él). */
export function expiringStore(maxKeys: number) {
  return class extends ExpiringStore {
    constructor() {
      super(maxKeys)
    }
  }
}
