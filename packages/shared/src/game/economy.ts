// SPDX-License-Identifier: AGPL-3.0-or-later
// Economía pura del juego: resolver apuestas, préstamos, intereses y apuestas automáticas.
// Sin E/S ni azar: el servidor tira el número y llama a estas funciones dentro de una transacción.
import { PAYOUTS, selectionKey, selectionWins } from '../roulette/bets.ts'
import type { Bet } from '../roulette/bets.ts'
import { isPocket } from '../roulette/wheel.ts'
import type { AUTO_BET_SOURCES } from './constants.ts'
import type { GameConfig } from './config.ts'
import { minBet } from './config.ts'

export interface BetOutcome {
  bet: Bet
  won: boolean
  /** Monedas devueltas al jugador (apuesta + ganancia) o 0 si pierde. */
  payout: number
}

export interface RoundOutcome {
  result: number
  outcomes: BetOutcome[]
  /** Total apostado. */
  staked: number
  /** Total devuelto (lo que se suma al saldo). */
  returned: number
  /** Resultado neto de la ronda: devuelto − apostado. */
  net: number
  /** Si se aplicó el multiplicador del jackpot dev. */
  jackpot: boolean
}

/**
 * Resuelve las apuestas de una ronda. Una apuesta ganadora devuelve lo apostado
 * más `apuesta × pago`; con el jackpot dev la ganancia (no la devolución) se multiplica.
 */
export function resolveBets(
  bets: readonly Bet[],
  result: number,
  jackpotMultiplier = 1,
): RoundOutcome {
  if (!isPocket(result)) throw new RangeError(`casilla inexistente: ${result}`)
  if (!(jackpotMultiplier >= 1)) throw new RangeError('el multiplicador debe ser ≥ 1')
  const outcomes = bets.map(bet => {
    const won = selectionWins(bet.selection, result)
    const profit = won
      ? Math.floor(bet.amount * PAYOUTS[bet.selection.kind] * jackpotMultiplier)
      : 0
    return { bet, won, payout: won ? bet.amount + profit : 0 }
  })
  const staked = sum(bets.map(b => b.amount))
  const returned = sum(outcomes.map(o => o.payout))
  return {
    result,
    outcomes,
    staked,
    returned,
    net: returned - staked,
    jackpot: jackpotMultiplier > 1 && outcomes.some(o => o.won),
  }
}

/** Patrimonio neto: saldo menos deuda. Es la métrica del ranking de arruinados. */
export function netWorth(balance: number, debt: number): number {
  return balance - debt
}

/** Suma el interés de una tirada a la deuda (redondeando a favor del prestamista, claro). */
export function accrueInterest(debt: number, cfg: GameConfig): number {
  if (debt <= 0) return 0
  const next = Math.ceil(debt * (1 + cfg.loan.interestPerSpin))
  return Math.min(next, cfg.loan.maxDebt)
}

/**
 * El préstamo solo se ofrece cuando el saldo no llega ni para la ficha mínima y mientras
 * el banco tenga crédito que dar: al llegar al tope de deuda deja de prestar
 * (si no, cada préstamo sería dinero gratis porque la deuda ya no puede crecer).
 */
export function canRequestLoan(balance: number, cfg: GameConfig, debt = 0): boolean {
  return balance < minBet(cfg) && debt + cfg.loan.amount <= cfg.loan.maxDebt
}

/** Saldo y deuda tras aceptar un préstamo. La deuda nunca pasa del tope. */
export function applyLoan(
  balance: number,
  debt: number,
  cfg: GameConfig,
): { balance: number; debt: number } {
  return {
    balance: balance + cfg.loan.amount,
    debt: Math.min(debt + cfg.loan.amount, cfg.loan.maxDebt),
  }
}

/** Total apostado en una lista de apuestas. */
export function totalStake(bets: readonly Bet[]): number {
  return sum(bets.map(b => b.amount))
}

/**
 * Añade fichas al boleto: si ya hay fichas en esa casilla se apilan.
 * Devuelve `null` si se pasa del máximo de casillas por ronda.
 */
export function addToSlip(slip: readonly Bet[], bet: Bet, cfg: GameConfig): Bet[] | null {
  const key = selectionKey(bet.selection)
  const index = slip.findIndex(b => selectionKey(b.selection) === key)
  if (index >= 0) {
    return slip.map((b, i) => (i === index ? { ...b, amount: b.amount + bet.amount } : b))
  }
  if (slip.length >= cfg.maxBetsPerRound) return null
  return [...slip, bet]
}

export type AutoBetSource = (typeof AUTO_BET_SOURCES)[number]

/**
 * Decide qué se juega en una ronda que se resuelve:
 * 1. lo que el usuario apostó (ya descontado del saldo);
 * 2. si no apostó, se repite su última apuesta si le llega el saldo;
 * 3. si nunca apostó, la apuesta por defecto ("tu subconsciente eligió rojo");
 * 4. si no le llega para nada, la ruleta gira sin él.
 * `charge` es lo que hay que descontar ahora del saldo (0 si ya estaba descontado).
 */
export function chooseRoundBets(args: {
  slip: readonly Bet[]
  lastBets: readonly Bet[] | null
  balance: number
  cfg: GameConfig
}): { bets: Bet[]; source: AutoBetSource; charge: number } {
  const { slip, lastBets, balance, cfg } = args
  if (slip.length > 0) return { bets: [...slip], source: 'slip', charge: 0 }
  if (lastBets && lastBets.length > 0) {
    const stake = totalStake(lastBets)
    if (stake <= balance) return { bets: [...lastBets], source: 'repeat', charge: stake }
    return { bets: [], source: 'none', charge: 0 }
  }
  if (cfg.defaultBet.amount <= balance) {
    return {
      bets: [{ selection: cfg.defaultBet.selection, amount: cfg.defaultBet.amount }],
      source: 'default',
      charge: cfg.defaultBet.amount,
    }
  }
  return { bets: [], source: 'none', charge: 0 }
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, v) => acc + v, 0)
}
