// SPDX-License-Identifier: AGPL-3.0-or-later
// Lo que comparten las pantallas de espectáculo: contexto de la ventana, tiempos de `fx.*`, la
// capa 3D de fichas, los rayos y los mandos de la sacudida y el desaturado (que solo mueven el
// mundo y las capas FX: el HUD y los menús no tiemblan).
import type { AppContext } from '../../app/context.ts'
import type { FxConfig } from '../../config.ts'
import type { Rays } from './rays.ts'
import type { FxScene3d } from './scene3d.ts'

export interface FxKit {
  readonly ctx: AppContext
  readonly cfg: FxConfig
  /** `prefers-reduced-motion`: sin sacudidas, parpadeos, lluvia ni llamas; ≤ `reducedMaxMs`. */
  readonly reduced: boolean
  readonly coins: FxScene3d
  readonly rays: Rays
  /** Sacudida de este fotograma (píxeles enteros). Se ignora con movimiento reducido. */
  shake(x: number, y: number): void
  /** Desaturado del mundo de este fotograma (0–1). */
  desaturate(k: number): void
  /** Texto para el lector de pantalla (`aria-live`). */
  announce(text: string): void
}

/** Sacudida que decae linealmente a 0 en `decayMs` desde `startMs` (enteros). */
export function shakeAt(
  ms: number,
  startMs: number,
  amp: { x: number; y: number; decayMs: number },
): { x: number; y: number } {
  const k = (ms - startMs) / amp.decayMs
  if (k < 0 || k >= 1) return { x: 0, y: 0 }
  // Alterna de lado cada 40 ms (un "temblor"), con amplitud que decae.
  const side = Math.floor((ms - startMs) / 40) % 2 === 0 ? 1 : -1
  const left = 1 - k
  return { x: Math.round(amp.x * left * side), y: Math.round(amp.y * left * side) }
}
