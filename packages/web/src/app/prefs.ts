// SPDX-License-Identifier: AGPL-3.0-or-later
// Preferencias que se quedan en el navegador (sonido, CRT, calidad, idioma). Solo comodidades:
// si el almacenamiento falla o está vacío, se usan los valores iniciales y todo funciona igual.
import { localeSchema } from '@vibe-gambling/shared'
import { z } from 'zod'

/** Pasos del volumen (las 8 barras de Ajustes). */
export const VOLUME_STEPS = 8

export const prefsSchema = z.object({
  sound: z.boolean(),
  crt: z.boolean(),
  quality: z.enum(['high', 'low']),
  /** Volumen en 8 pasos (0 = mudo); si falta (preferencias de antes), al máximo. */
  volume: z.number().int().min(0).max(VOLUME_STEPS).catch(VOLUME_STEPS),
  // Un idioma que ya no está registrado no tira el resto de preferencias: se vuelve a detectar.
  locale: localeSchema.nullable().catch(null),
})
export type Prefs = z.output<typeof prefsSchema>

export const DEFAULT_PREFS: Prefs = Object.freeze({
  sound: true,
  crt: true,
  quality: 'high',
  volume: VOLUME_STEPS,
  locale: null,
})

const KEY = 'vibe-gambling:prefs'

/** Volumen de las preferencias (0–8) a ganancia (0–1). */
export function volumeGain(level: number): number {
  return Math.max(0, Math.min(VOLUME_STEPS, level)) / VOLUME_STEPS
}

export function loadPrefs(storage: Pick<Storage, 'getItem'> | null): Prefs {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed = prefsSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : { ...DEFAULT_PREFS }
  } catch (error) {
    console.warn('[prefs] no se pudieron leer las preferencias', error)
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(storage: Pick<Storage, 'setItem'> | null, prefs: Prefs): void {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs))
  } catch (error) {
    console.warn('[prefs] no se pudieron guardar las preferencias', error)
  }
}

/** `localStorage` puede lanzar al acceder (modo privado, datos bloqueados). */
export function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}
