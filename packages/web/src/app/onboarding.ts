// SPDX-License-Identifier: AGPL-3.0-or-later
// Recordatorios por navegador: ¿ya vio el arranque en esta sesión? ¿ya leyó "cómo se juega"? ¿ya
// se le avisó en esta sesión de que dibuja sin aceleración por hardware? Son comodidades: si el
// almacenamiento falla, se vuelve a enseñar y ya está.

const BOOTED_KEY = 'vibe-gambling:booted'
const TIP_KEY = 'vibe-gambling:tip-seen'
const GPU_WARNED_KEY = 'vibe-gambling:gpu-warned'

type Reader = Pick<Storage, 'getItem'> | null
type Writer = Pick<Storage, 'setItem'> | null

function read(storage: Reader, key: string): boolean {
  try {
    return storage?.getItem(key) === '1'
  } catch (error) {
    console.warn(`[prefs] no se pudo leer ${key}`, error)
    return false
  }
}

function write(storage: Writer, key: string): void {
  try {
    storage?.setItem(key, '1')
  } catch (error) {
    console.warn(`[prefs] no se pudo guardar ${key}`, error)
  }
}

export const bootSeen = (session: Reader): boolean => read(session, BOOTED_KEY)
export const markBootSeen = (session: Writer): void => write(session, BOOTED_KEY)
export const tipSeen = (local: Reader): boolean => read(local, TIP_KEY)
export const markTipSeen = (local: Writer): void => write(local, TIP_KEY)
export const gpuWarned = (session: Reader): boolean => read(session, GPU_WARNED_KEY)
export const markGpuWarned = (session: Writer): void => write(session, GPU_WARNED_KEY)
