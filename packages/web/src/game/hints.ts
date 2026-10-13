// SPDX-License-Identifier: AGPL-3.0-or-later
// Cómo se explica en la mesa que el giro no se lanza desde la ventana: la ruleta solo gira con un
// turno real de Claude Code (decisión cerrada: el servidor es la única autoridad y no hay botón de
// girar). Aquí se decide qué texto toca en cada momento; las pantallas solo lo pintan.
import type { Phase } from './state.ts'

export type IdleStatusKey =
  | 'status.idle'
  | 'status.ready'
  | 'status.demo'
  | 'status.demoReady'
  | 'status.demoPaused'
  | 'status.demoPausedReady'

/**
 * Rótulo de la mesa sin ronda abierta: invita a mandar un prompt (o avisa de que ya está lista).
 * En la demo en PAUSA (`demoAuto` false) dice cómo se gira a mano.
 */
export function idleStatusKey(
  demo: boolean,
  slipTotal: number,
  demoAuto: boolean | null = null,
): IdleStatusKey {
  if (demo && demoAuto === false) {
    return slipTotal > 0 ? 'status.demoPausedReady' : 'status.demoPaused'
  }
  if (demo) return slipTotal > 0 ? 'status.demoReady' : 'status.demo'
  return slipTotal > 0 ? 'status.ready' : 'status.idle'
}

/**
 * ¿Avisar de que la apuesta está lista? Solo al pasar de mesa vacía a mesa con fichas y sin ronda
 * abierta: con Claude pensando, la apuesta entra en la ronda en curso y el rótulo ya lo dice.
 */
export function betReadyHint(prevTotal: number, nextTotal: number, phase: Phase): boolean {
  return prevTotal === 0 && nextTotal > 0 && phase === 'idle'
}

/**
 * ¿Recordar cómo se gira? Cuando se pulsa ✕ sobre una casilla que ya tiene fichas sin ronda abierta
 * (el gesto de quien busca "girar"): la ficha se pone igual, pero se explica el giro.
 */
export function spinHelpOnRepeat(alreadyOnIt: boolean, phase: Phase): boolean {
  return alreadyOnIt && phase === 'idle'
}

export type TableHelpKey = 'help.table' | 'help.spin' | 'help.spinDemo' | 'help.spinDemoPaused'

/**
 * Ayuda de la barra inferior: en cada vuelta de tres periodos de `cycleMs`, dos enseñan los
 * controles y uno recuerda cómo se gira (en la demo, que gira sola y cómo pausarla, o, en PAUSA,
 * cómo girar a mano y volver a AUTO).
 */
export function tableHelpKey(
  timeMs: number,
  cycleMs: number,
  demo: boolean,
  demoAuto: boolean | null = null,
): TableHelpKey {
  if (cycleMs <= 0) return 'help.table'
  const slot = Math.floor(timeMs / cycleMs) % 3
  if (slot !== 2) return 'help.table'
  if (!demo) return 'help.spin'
  return demoAuto === false ? 'help.spinDemoPaused' : 'help.spinDemo'
}
