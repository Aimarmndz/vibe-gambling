// SPDX-License-Identifier: AGPL-3.0-or-later
// Estado de la ventana: un reductor puro sobre los mensajes del servidor.
// Regla de oro: el saldo que se enseña (`shown`) se congela mientras cae la bola, para que el
// HUD no destripe el resultado antes de tiempo. El servidor manda; la web solo pinta.
import type {
  OpenRound,
  ResolvedRound,
  SelfUser,
  ServerMessage,
  Slip,
  Wallet,
} from '@vibe-gambling/shared'

export type Phase = 'idle' | 'spinning' | 'landing' | 'result'

export interface GameState {
  readonly user: SelfUser | null
  /** Última cartera que mandó el servidor. */
  readonly wallet: Wallet | null
  /** Cartera que se enseña (congelada durante la caída de la bola). */
  readonly shown: Wallet | null
  readonly slip: Slip
  /** Ronda abierta (Claude pensando). */
  readonly round: OpenRound | null
  /** Ronda resuelta que aún no se ha enseñado. */
  readonly pending: ResolvedRound | null
  /** Última ronda enseñada. */
  readonly lastRound: ResolvedRound | null
  readonly phase: Phase
  /** Desfase reloj del servidor − reloj local (ms), para respetar `revealAt`. */
  readonly clockOffsetMs: number
}

export const EMPTY_SLIP: Slip = Object.freeze({ bets: [], total: 0 }) as Slip

export const INITIAL_STATE: GameState = Object.freeze({
  user: null,
  wallet: null,
  shown: null,
  slip: EMPTY_SLIP,
  round: null,
  pending: null,
  lastRound: null,
  phase: 'idle',
  clockOffsetMs: 0,
})

/** Efectos que la ventana tiene que ejecutar (animaciones, sonidos, avisos). */
export type Effect =
  | { type: 'connected'; first: boolean }
  | { type: 'spin' }
  | { type: 'land'; round: ResolvedRound }
  | { type: 'expired' }
  | { type: 'slip' }
  | { type: 'loan'; amount: number }
  | { type: 'rejected'; error: string; message: string }
  | { type: 'error'; error: string; message: string }
  | { type: 'season'; seasonId: string }
  | { type: 'settings' }
  | { type: 'bye'; reason: 'logout' | 'account_deleted' | 'shutdown' | 'replaced' }

export interface Step {
  state: GameState
  effects: Effect[]
}

function withWallet(state: GameState, wallet: Wallet): GameState {
  const frozen = state.phase === 'landing'
  return { ...state, wallet, shown: frozen ? state.shown : wallet }
}

/** Aplica un mensaje del servidor. `nowMs` es el reloj local (inyectable para los tests). */
export function reduce(state: GameState, msg: ServerMessage, nowMs: number): Step {
  switch (msg.type) {
    case 'hello': {
      const first = state.user === null
      const offset = Date.parse(msg.serverTime) - nowMs
      // Reconexión en plena caída de la misma ronda: se deja terminar la animación.
      const keepLanding =
        state.phase === 'landing' &&
        state.pending !== null &&
        msg.lastRound?.roundId === state.pending.roundId
      if (keepLanding) {
        return {
          state: {
            ...state,
            user: msg.user,
            wallet: msg.wallet,
            slip: msg.slip,
            round: msg.round,
            clockOffsetMs: offset,
          },
          effects: [{ type: 'connected', first }],
        }
      }
      const phase: Phase = msg.round ? 'spinning' : state.phase === 'result' ? 'result' : 'idle'
      const effects: Effect[] = [{ type: 'connected', first }]
      if (msg.round && state.phase !== 'spinning') effects.push({ type: 'spin' })
      return {
        state: {
          ...state,
          user: msg.user,
          wallet: msg.wallet,
          shown: msg.wallet,
          slip: msg.slip,
          round: msg.round,
          pending: null,
          lastRound: msg.lastRound ?? state.lastRound,
          phase,
          clockOffsetMs: offset,
        },
        effects,
      }
    }
    case 'round.started': {
      if (state.phase === 'landing') {
        // La bola aún está cayendo: la ronda nueva espera a que se enseñe el resultado.
        return { state: { ...state, round: msg.round }, effects: [] }
      }
      return {
        state: { ...state, round: msg.round, phase: 'spinning' },
        effects: state.phase === 'spinning' ? [] : [{ type: 'spin' }],
      }
    }
    case 'round.resolved': {
      if (
        state.pending?.roundId === msg.round.roundId ||
        state.lastRound?.roundId === msg.round.roundId
      ) {
        // Duplicado (reintento o reconexión): ya se está enseñando o ya se enseñó.
        return { state: withWallet(state, msg.wallet), effects: [] }
      }
      const round = state.round?.roundId === msg.round.roundId ? null : state.round
      return {
        // Las fichas del boleto ya se han jugado en esta ronda: la mesa queda limpia.
        state: {
          ...state,
          wallet: msg.wallet,
          slip: EMPTY_SLIP,
          round,
          pending: msg.round,
          phase: 'landing',
        },
        effects: [{ type: 'land', round: msg.round }],
      }
    }
    case 'round.expired': {
      if (state.round?.roundId !== msg.roundId) return { state, effects: [] }
      const phase: Phase = state.phase === 'spinning' ? 'idle' : state.phase
      return { state: { ...state, round: null, phase }, effects: [{ type: 'expired' }] }
    }
    case 'slip':
      return {
        state: { ...withWallet(state, msg.wallet), slip: msg.slip },
        effects: [{ type: 'slip' }],
      }
    case 'wallet':
      return { state: withWallet(state, msg.wallet), effects: [] }
    case 'loan.granted':
      return {
        state: withWallet(state, msg.wallet),
        effects: [{ type: 'loan', amount: msg.amount }],
      }
    case 'season.changed':
      return {
        state: withWallet(state, msg.wallet),
        effects: [{ type: 'season', seasonId: msg.seasonId }],
      }
    case 'settings':
      return { state: { ...state, user: msg.user }, effects: [{ type: 'settings' }] }
    case 'bet.rejected':
      return { state, effects: [{ type: 'rejected', error: msg.error, message: msg.message }] }
    case 'error':
      return { state, effects: [{ type: 'error', error: msg.error, message: msg.message }] }
    case 'pong':
      return { state, effects: [] }
    case 'bye':
      return { state, effects: [{ type: 'bye', reason: msg.reason }] }
  }
}

/** La bola ha caído: se enseña el resultado y se descongela el saldo. */
export function reveal(state: GameState): GameState {
  if (state.phase !== 'landing' || !state.pending) return state
  return {
    ...state,
    lastRound: state.pending,
    pending: null,
    shown: state.wallet,
    phase: 'result',
  }
}

/** Se cierra la pantalla de resultado: a girar si ya hay otra ronda, o a la mesa. */
export function dismissResult(state: GameState): GameState {
  if (state.phase !== 'result') return state
  return { ...state, phase: state.round ? 'spinning' : 'idle' }
}

/** Instante local (ms) a partir del cual se puede enseñar el resultado de una ronda. */
export function localRevealAt(state: GameState, round: ResolvedRound): number {
  return Date.parse(round.revealAt) - state.clockOffsetMs
}
