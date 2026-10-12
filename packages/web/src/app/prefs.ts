// SPDX-License-Identifier: AGPL-3.0-or-later
// Preferencias que se quedan en el navegador (sonido, CRT, calidad, idioma). Solo comodidades:
// si el almacenamiento falla o está vacío, se usan los valores iniciales y todo funciona igual.
import { localeSchema } from '@vibe-gambling/shared'
import { z } from 'zod'

export const prefsSchema = z.object({
  sound: z.boolean(),
  crt: z.boolean(),
  quality: z.enum(['high', 'low']),
  locale: localeSchema.nullable(),
})
export type Prefs = z.output<typeof prefsSchema>

export const DEFAULT_PREFS: Prefs = Object.freeze({
  sound: true,
  crt: true,
  quality: 'high',
  locale: null,
})

const KEY = 'vibe-gambling:prefs'

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
