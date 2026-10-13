// SPDX-License-Identifier: AGPL-3.0-or-later
// Qué animaciones de espectáculo tocan tras una ronda, y en qué orden. Lógica pura: sale de
// `round.spectacle`, que calcula el servidor (docs/DECISIONES.md, "Espectáculo (servidor)"); si una
// ronda antigua no lo trae, se recalcula con las mismas reglas de shared y la configuración
// pública (sin racha ni bancarrota, que solo sabe el servidor).
//
// Todo empieza cuando la bola se ha asentado, que nunca es antes de `revealAt`: nada de esto
// adelanta el número ni el saldo.
import { spectacleOf } from '@vibe-gambling/shared'
import type { PublicGameConfig, ResolvedRound, SpectacleView } from '@vibe-gambling/shared'

export type PrizeTier = 'big' | 'mega' | 'straight'

export type FxStep =
  /** PUSH TO PROD: entre la caída y el resultado, con el multiplicador. */
  | { kind: 'push'; multiplier: number }
  /** ¡VERDE!; `chain` = se había apostado al 0 y se encadena con el premio. */
  | { kind: 'green'; chain: boolean }
  /** BIG WIN / MEGA WIN / ¡PLENO!. */
  | { kind: 'prize'; tier: PrizeTier; net: number; netMultiple: number }
  /** La pantalla de resultado de siempre (número, veredicto, frase). */
  | { kind: 'result' }
  /** Aviso de la falacia del jugador, ya sobre la mesa. */
  | { kind: 'fallacy' }
  /** Intro de ON FIRE (la ronda que enciende la racha). */
  | { kind: 'fire'; streak: number }
  /** BANCARROTA — CONTINUE?, que desemboca en la oferta del préstamo. */
  | { kind: 'bankrupt' }

export interface PlanOptions {
  /** Tirada de GIRAR TODAS que no se ha parado: solo el resultado rápido. */
  quick: boolean
}

/** El espectáculo de la ronda: el del servidor o, si no lo trae, recalculado sin racha. */
export function spectacleFor(round: ResolvedRound, game: PublicGameConfig): SpectacleView {
  if (round.spectacle) return round.spectacle
  return spectacleOf(
    round,
    { streak: 0, bankrupt: false },
    { bigWin: game.bigWin, onFireAt: game.onFireAt, colorWarningAt: game.colorWarningAt },
  )
}

function isPrize(tier: SpectacleView['tier']): tier is PrizeTier {
  return tier === 'big' || tier === 'mega' || tier === 'straight'
}

/** Pasos de la secuencia de una ronda, en orden. */
export function planRound(
  round: ResolvedRound,
  game: PublicGameConfig,
  opts: PlanOptions,
): FxStep[] {
  const s = spectacleFor(round, game)
  // GIRAR TODAS se para sola en premio gordo, verde y bancarrota (lo decide el servidor), así que
  // las rondas rápidas que siguen son "normales": solo el resultado, para no frenar la cola.
  if (opts.quick) return [{ kind: 'result' }]
  const steps: FxStep[] = []
  if (s.jackpot) steps.push({ kind: 'push', multiplier: game.jackpot.gitPushMultiplier })
  const prize = isPrize(s.tier)
  if (s.green) steps.push({ kind: 'green', chain: s.greenWin && prize })
  if (isPrize(s.tier)) {
    steps.push({ kind: 'prize', tier: s.tier, net: round.net, netMultiple: s.netMultiple })
  }
  steps.push({ kind: 'result' })
  // Lo que pasa ya sobre la mesa, cuando se cierra el resultado.
  if (s.fallacy) steps.push({ kind: 'fallacy' })
  if (s.fire === 'ignite') steps.push({ kind: 'fire', streak: s.streak })
  if (s.bankrupt) steps.push({ kind: 'bankrupt' })
  return steps
}

/** ¿Es un paso de los que tapan la pantalla y esperan a ✕ (no se apilan avisos encima)? */
export function isBlocking(step: FxStep): boolean {
  return step.kind !== 'fire'
}
