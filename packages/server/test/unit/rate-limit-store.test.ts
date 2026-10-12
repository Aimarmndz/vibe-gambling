// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExpiringStore, expiringStore } from '../../src/lib/rate-limit-store.ts'

function incr(store: ExpiringStore, key: string, window: number, max = 100) {
  let out: { current: number; ttl: number } | undefined
  store.incr(
    key,
    (error, result) => {
      if (error) throw error
      out = result
    },
    window,
    max,
  )
  if (!out) throw new Error('el store no respondió')
  return out
}

describe('store del rate limit con caducidad', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('cuenta las peticiones de cada clave dentro de su ventana', () => {
    const store = new ExpiringStore(100)
    expect(incr(store, 'ip:a', 1000)).toEqual({ current: 1, ttl: 1000 })
    vi.advanceTimersByTime(400)
    expect(incr(store, 'ip:a', 1000)).toEqual({ current: 2, ttl: 600 })
    expect(incr(store, 'ip:b', 1000)).toEqual({ current: 1, ttl: 1000 })
  })

  it('al vencer la ventana, la cuenta vuelve a empezar', () => {
    const store = new ExpiringStore(100)
    incr(store, 'ip:a', 1000)
    incr(store, 'ip:a', 1000)
    vi.advanceTimersByTime(1000)
    expect(incr(store, 'ip:a', 1000)).toEqual({ current: 1, ttl: 1000 })
  })

  it('olvida la clave (la IP) en cuanto vence su ventana, aunque no vuelva ninguna petición', () => {
    // La política de privacidad promete que la IP solo vive en memoria lo que dura la ventana.
    const store = new ExpiringStore(100)
    incr(store, 'ip:203.0.113.9', 1000)
    vi.advanceTimersByTime(999)
    expect(store.has('ip:203.0.113.9')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(store.has('ip:203.0.113.9')).toBe(false)
    expect(store.size).toBe(0)
  })

  it('si el temporizador llega tarde, la hora manda y la cuenta empieza de cero', () => {
    const store = new ExpiringStore(100)
    incr(store, 'ip:a', 1000)
    incr(store, 'ip:a', 1000)
    // Solo avanza el reloj, sin disparar temporizadores (un proceso ocupado).
    vi.setSystemTime(Date.now() + 1500)
    expect(incr(store, 'ip:a', 1000)).toEqual({ current: 1, ttl: 1000 })
    // El temporizador viejo no borra la entrada nueva.
    vi.advanceTimersByTime(500)
    expect(store.has('ip:a')).toBe(true)
    vi.advanceTimersByTime(500)
    expect(store.has('ip:a')).toBe(false)
  })

  it('no guarda más claves que el tope: descarta las más antiguas', () => {
    const store = new ExpiringStore(3)
    for (const key of ['a', 'b', 'c', 'd']) {
      incr(store, key, 60_000)
      vi.advanceTimersByTime(1)
    }
    expect(store.size).toBe(3)
    expect(store.has('a')).toBe(false)
    expect(store.has('d')).toBe(true)
    expect(vi.getTimerCount()).toBe(3)
  })

  it('cada limitador (child) tiene sus propias cuentas', () => {
    const Store = expiringStore(100)
    const root = new Store()
    const api = root.child()
    const ws = root.child()
    incr(api, 'ip:a', 1000)
    expect(incr(ws, 'ip:a', 1000).current).toBe(1)
    expect(incr(api, 'ip:a', 1000).current).toBe(2)
  })
})
