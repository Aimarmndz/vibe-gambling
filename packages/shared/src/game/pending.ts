// SPDX-License-Identifier: AGPL-3.0-or-later
// Tiradas pendientes: los prompts que terminan sin ninguna ventana visible (o con la bola de la
// tirada anterior aún cayendo) se guardan y se gastan después con GIRAR (una) o GIRAR TODAS (en bucle, con giro rápido). Lógica pura: la usan el
// servidor (tope), la web (cuándo se para GIRAR TODAS) y los tests.
import type { ResolvedRound, Wallet } from '../protocol/common.ts'

/** Lo que hace falta de la configuración (vale la del servidor o la pública de la web). */
export interface PendingLimits {
  readonly max: number
}

/** Qué pasa con un prompt sin ventana visible: se guarda o, si ya está en el tope, se descarta. */
export function queueOutcome(current: number, limits: PendingLimits): 'queued' | 'dropped' {
  return current >= limits.max ? 'dropped' : 'queued'
}

/** Configuración que mira GIRAR TODAS para saber cuándo pararse. */
export interface SpinAllRules {
  readonly chips: readonly number[]
  readonly bigWin: { readonly minNetMultiple: number }
}

/** Ronda vista por las reglas de parada (solo lo que miran). */
export type StopRound = Pick<ResolvedRound, 'result' | 'net' | 'staked' | 'jackpot' | 'source'> & {
  readonly bets: ReadonlyArray<{ readonly won: boolean; readonly selection: { kind: string } }>
}

/**
 * Premio gordo: se gana y, además, es el jackpot del `git push`, un pleno acertado o una ganancia
 * neta de al menos `minNetMultiple` veces lo apostado.
 */
export function isBigWin(round: StopRound, rules: SpinAllRules): boolean {
  if (round.net <= 0) return false
  if (round.jackpot) return true
  if (round.bets.some(bet => bet.won && bet.selection.kind === 'straight')) return true
  return round.staked > 0 && round.net >= round.staked * rules.bigWin.minNetMultiple
}

export const SPIN_ALL_STOP_REASONS = ['bigWin', 'green', 'broke'] as const
export type SpinAllStopReason = (typeof SPIN_ALL_STOP_REASONS)[number]

/**
 * ¿Debe pararse GIRAR TODAS después de esta tirada? En un premio gordo, cuando sale el verde (0)
 * o en bancarrota: había fichas en juego y ya no queda saldo ni para la ficha mínima. Las tiradas
 * sin fichas (ya arruinado) no paran el bucle: así se pueden vaciar aunque no haya saldo.
 */
export function spinAllStopReason(
  round: StopRound,
  wallet: Pick<Wallet, 'balance'>,
  rules: SpinAllRules,
): SpinAllStopReason | null {
  if (isBigWin(round, rules)) return 'bigWin'
  if (round.result === 0) return 'green'
  if (round.source !== 'none' && wallet.balance < Math.min(...rules.chips)) return 'broke'
  return null
}
