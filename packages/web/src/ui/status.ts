// SPDX-License-Identifier: AGPL-3.0-or-later
// Aspecto del rótulo de estado de la mesa. El parpadeo alterna entre dos colores que se leen
// siempre sobre la ventana (contraste ≥ 4,5:1 en las dos fases; lo comprueba un test): antes la
// fase tenue usaba el color del bisel y "CLAUDE ESTÁ PENSANDO…" desaparecía medio segundo.
import { PALETTE } from './palette.ts'

export type StatusKind = 'connecting' | 'offline' | 'thinking' | 'landing' | 'idle' | 'ready'

export interface StatusLook {
  color: string
  /** Color de la otra fase del parpadeo (null = no parpadea). */
  blink: string | null
  /** Degradado de la ventana del rótulo. */
  top: string
  bottom: string
}

export const STATUS_LOOKS: Readonly<Record<StatusKind, StatusLook>> = Object.freeze({
  connecting: {
    color: PALETTE.cream,
    blink: PALETTE.gold,
    top: PALETTE.menuTop,
    bottom: PALETTE.menuBottom,
  },
  offline: {
    color: PALETTE.cream,
    blink: PALETTE.gold,
    top: PALETTE.alertTop,
    bottom: PALETTE.menuBottom,
  },
  thinking: {
    color: PALETTE.gold,
    blink: PALETTE.cream,
    top: PALETTE.menuTop,
    bottom: PALETTE.menuBottom,
  },
  landing: { color: PALETTE.cream, blink: null, top: PALETTE.menuTop, bottom: PALETTE.menuBottom },
  idle: { color: PALETTE.cream, blink: null, top: PALETTE.menuTop, bottom: PALETTE.menuBottom },
  ready: { color: PALETTE.gold, blink: null, top: PALETTE.menuTop, bottom: PALETTE.menuBottom },
})

/** Color del texto en el instante `t` (segundos): dos fases por segundo. */
export function statusColor(look: StatusLook, t: number): string {
  if (!look.blink) return look.color
  return Math.floor(t * 2) % 2 === 1 ? look.blink : look.color
}

/** Alto de la ventana del rótulo y fila (desde arriba) donde empiezan las mayúsculas. */
export const STATUS_BOX = Object.freeze({ height: 15, textTop: 4, capHeight: 7 })
