// SPDX-License-Identifier: AGPL-3.0-or-later
// Guiones del modo demo para forzar cada animación de espectáculo (`/play?demo&fx=mega`, o
// `__vgDemo.fx('mega')`): qué boleto, qué cartera y qué número salen para que el espectáculo que
// calcula shared sea justo ese. Sirve para las capturas, los GIF y los E2E: es una partida local
// de mentira, como el resto de la demo.
import type { AchievementId, Bet, GameConfig } from '@vibe-gambling/shared'

export const DEMO_FX = [
  'big',
  'mega',
  'pleno',
  'green',
  'greenwin',
  'push',
  'bank',
  'bankrupt',
  'fire',
  'fallacy',
  'achievement',
  'pending',
  'commission',
] as const
export type DemoFx = (typeof DEMO_FX)[number]

export function isDemoFx(value: string | null): value is DemoFx {
  return value !== null && (DEMO_FX as readonly string[]).includes(value)
}

export interface DemoScenario {
  /** Cartera antes de la tirada (lo que no se diga se queda como está). */
  wallet: { balance?: number; debt?: number; currentStreak?: number }
  /** Fichas sobre la mesa (se cobran del saldo al prepararlas, como un `bet.place`). */
  bets: Bet[]
  /** Números que "ya habían salido" (para la racha de color de la falacia). */
  history: number[]
  /** Número que sale; null = no hay tirada (el préstamo sale solo con saldo 0). */
  result: number | null
  gitPushOk: boolean
  /** Logro que se anuncia detrás de la ronda. */
  achievement: AchievementId | null
  /**
   * Contador de tiradas pendientes, paso a paso (el primero sin animación): sube con una tirada
   * guardada y baja como al gastarla. Vacío = no se toca.
   */
  pendingSteps: number[]
  /** Comisión de afiliado de mentira (un invitado "se activa"), sin tirada. */
  commission: boolean
}

/** Números rojos del cilindro europeo (para la racha de la falacia). */
const REDS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]

export function demoScenario(kind: DemoFx, cfg: GameConfig): DemoScenario {
  const sorted = [...cfg.chips].sort((a, b) => a - b)
  const chip = sorted[1] ?? sorted[0]!
  const base: DemoScenario = {
    wallet: {},
    bets: [],
    history: [],
    result: null,
    gitPushOk: false,
    achievement: null,
    pendingSteps: [],
    commission: false,
  }
  const bet = (selection: Bet['selection'], amount = chip): Bet => ({ selection, amount })
  switch (kind) {
    case 'big':
      // Cuadro 8:1 → neto ×8 (≥ BIG WIN).
      return { ...base, bets: [bet({ kind: 'corner', numbers: [17, 18, 20, 21] })], result: 17 }
    case 'mega':
      // Caballo 17:1 → neto ×17 (≥ MEGA WIN, sin ser pleno).
      return { ...base, bets: [bet({ kind: 'split', numbers: [17, 20] })], result: 17 }
    case 'pleno':
      return { ...base, bets: [bet({ kind: 'straight', numbers: [17] })], result: 17 }
    case 'green':
      return { ...base, bets: [bet({ kind: 'red' })], result: 0 }
    case 'greenwin':
      return { ...base, bets: [bet({ kind: 'straight', numbers: [0] })], result: 0 }
    case 'push':
      return { ...base, bets: [bet({ kind: 'red' })], result: 1, gitPushOk: true }
    case 'bank':
      // Sin saldo: la mesa ofrece el Ludo-Crédito sola.
      return { ...base, wallet: { balance: 0 } }
    case 'bankrupt':
      // Todo al rojo con lo último que queda, y sale negro: patrimonio a 0.
      return {
        ...base,
        wallet: { balance: chip, debt: 0 },
        bets: [bet({ kind: 'red' })],
        result: 2,
      }
    case 'fire':
      return {
        ...base,
        wallet: { currentStreak: cfg.streak.onFireAt - 1 },
        bets: [bet({ kind: 'red' })],
        result: 1,
      }
    case 'fallacy':
      return {
        ...base,
        history: REDS.slice(0, cfg.streak.colorWarningAt - 1),
        bets: [bet({ kind: 'black' })],
        result: 36,
      }
    case 'achievement':
      return { ...base, bets: [bet({ kind: 'red' })], result: 3, achievement: 'first_spin' }
    case 'pending':
      return { ...base, pendingSteps: [19, 20, 19] }
    case 'commission':
      return { ...base, commission: true }
  }
}
