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
  /** Un prompt sin ventana visible: tirada guardada (o descartada por el tope). */
  | { type: 'pending'; event: 'queued' | 'dropped'; count: number }

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
      // Ronda resuelta mientras no había conexión (servidor reiniciado, red caída o ventana
      // abierta a mitad de turno) cuyo revealAt aún no ha llegado: se anima su caída como si
      // llegara por `round.resolved`, sin destripar el número ni el saldo antes de tiempo. Si ya
      // hay otra ronda abierta, manda la nueva (se empieza a girar, como siempre).
      const unseen =
        msg.round === null &&
        msg.lastRound !== null &&
        msg.lastRound.roundId !== state.lastRound?.roundId &&
        msg.lastRound.roundId !== state.pending?.roundId &&
        Date.parse(msg.lastRound.revealAt) - offset > nowMs
      if (unseen && msg.lastRound) {
        const pending = msg.lastRound
        return {
          state: {
            ...state,
            user: msg.user,
            wallet: msg.wallet,
            // El saldo que se enseña sigue congelado (null si es la primera conexión).
            shown: state.shown,
            slip: msg.slip,
            round: null,
            pending,
            phase: 'landing',
            clockOffsetMs: offset,
          },
          effects: [
            { type: 'connected', first },
            { type: 'land', round: pending },
          ],
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
    case 'pending': {
      // El turno terminó sin tirar: la ronda que se viera girar ya no existe (solo hay una
      // abierta por usuario y es la de ese turno). Si la bola está cayendo, se deja caer.
      const phase: Phase = state.phase === 'spinning' ? 'idle' : state.phase
      return {
        state: { ...withWallet(state, msg.wallet), round: null, phase },
        effects: [{ type: 'pending', event: msg.event, count: msg.wallet.pendingSpins }],
      }
    }
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
    // Logros, estadísticas y banco (fase 8): los pintan las pantallas de la v2; aquí no cambian
    // el estado de la mesa.
    case 'pong':
    case 'achievement.unlocked':
    case 'stats':
    case 'bank':
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

/**
 * Tiradas pendientes que quedan. Sale de la última cartera del servidor, no de la congelada: el
 * contador no destripa nada y debe bajar en cuanto se pulsa GIRAR.
 */
export function pendingSpins(state: GameState): number {
  return state.wallet?.pendingSpins ?? 0
}

/** ¿Se puede gastar ahora una tirada pendiente? (Mesa quieta, sin ronda girando.) */
export function canSpinPending(state: GameState): boolean {
  return (
    state.user !== null && state.phase === 'idle' && state.round === null && pendingSpins(state) > 0
  )
}

/** Instante local (ms) a partir del cual se puede enseñar el resultado de una ronda. */
export function localRevealAt(state: GameState, round: ResolvedRound): number {
  return Date.parse(round.revealAt) - state.clockOffsetMs
}
