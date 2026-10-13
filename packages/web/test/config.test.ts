// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest'

import rawClient from '../../../config/web.json'
import { ConfigError, clientConfig, loadWebConfig, parseClientConfig } from '../src/config.ts'
import { DEFAULT_PREFS, loadPrefs, savePrefs } from '../src/app/prefs.ts'
import { testWebConfig } from './fixtures.ts'

describe('configuración de la web', () => {
  it('config/web.json es válido', () => {
    expect(clientConfig.ws.reconnect.maxMs).toBeGreaterThanOrEqual(clientConfig.ws.reconnect.baseMs)
  })

  it('rechaza una configuración del cliente incompleta o incoherente', () => {
    expect(() => parseClientConfig({})).toThrow(/config\/web.json/)
    const bad = structuredClone(rawClient)
    bad.ws.reconnect.maxMs = 1
    bad.ws.reconnect.baseMs = 500
    expect(() => parseClientConfig(bad)).toThrow()
    expect(() => parseClientConfig({ ...rawClient, extra: 1 })).toThrow()
  })

  it('carga y valida /config.json', async () => {
    const ok = vi.fn(
      async (_url: RequestInfo | URL) =>
        new Response(JSON.stringify(testWebConfig), { status: 200 }),
    )
    await expect(loadWebConfig(ok)).resolves.toEqual(testWebConfig)
    expect(ok.mock.calls[0]![0]).toBe('/config.json')
    await expect(
      loadWebConfig(async () => new Response('x', { status: 500 })),
    ).rejects.toBeInstanceOf(ConfigError)
    await expect(loadWebConfig(async () => new Response('{bad', { status: 200 }))).rejects.toThrow(
      /JSON/,
    )
    await expect(
      loadWebConfig(async () => new Response('{"v":1}', { status: 200 })),
    ).rejects.toThrow(/contrato/)
    await expect(
      loadWebConfig(async () => {
        throw new TypeError('offline')
      }),
    ).rejects.toThrow(/descargar/)
  })
})

describe('preferencias del navegador', () => {
  it('guarda y lee; si falla o no hay nada, valores iniciales', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS)
    savePrefs(storage, { ...DEFAULT_PREFS, crt: false, locale: 'es' })
    expect(loadPrefs(storage)).toEqual({ ...DEFAULT_PREFS, crt: false, locale: 'es' })
    store.set('vibe-gambling:prefs', '{"sound":"loud"}')
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadPrefs(broken)).toEqual(DEFAULT_PREFS)
    expect(() => savePrefs(broken, DEFAULT_PREFS)).not.toThrow()
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS)
    warn.mockRestore()
  })
})

describe('preferencias de la demo y del aviso de GPU', () => {
  it('por defecto, AUTO y con aviso; las de antes (sin estos campos) siguen valiendo', () => {
    expect(DEFAULT_PREFS.demoAuto).toBe(true)
    expect(DEFAULT_PREFS.gpuWarning).toBe(true)
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    store.set(
      'vibe-gambling:prefs',
      JSON.stringify({ sound: false, crt: true, quality: 'low', locale: 'fr' }),
    )
    expect(loadPrefs(storage)).toMatchObject({
      sound: false,
      quality: 'low',
      locale: 'fr',
      demoAuto: true,
      gpuWarning: true,
    })
    savePrefs(storage, { ...DEFAULT_PREFS, demoAuto: false, gpuWarning: false })
    expect(loadPrefs(storage)).toMatchObject({ demoAuto: false, gpuWarning: false })
    // Un valor raro en un campo nuevo no tira el resto.
    store.set('vibe-gambling:prefs', JSON.stringify({ ...DEFAULT_PREFS, demoAuto: 'yes' }))
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS)
  })
})
