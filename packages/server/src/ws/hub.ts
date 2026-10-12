// SPDX-License-Identifier: AGPL-3.0-or-later
// Registro en memoria de las ventanas conectadas por usuario. Supone una sola instancia del
// servidor (documentado en docs/DECISIONES.md): con varias haría falta un bus (LISTEN/NOTIFY).
import { serverMessageSchema, WS_CLOSE_CODES } from '@vibe-gambling/shared'
import type { ServerMessage } from '@vibe-gambling/shared'
import type { WebSocket } from 'ws'

import type { ByeReason, Notifier } from '../services/notifier.ts'

export interface HubLogger {
  warn(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

export interface Connection {
  socket: WebSocket
  userId: string
  sessionId: string
  /** Si respondió al último ping a nivel de protocolo. */
  alive: boolean
  /** Mensajes en espera hasta que salga el `hello` (null cuando ya salió). */
  pending: ServerMessage[] | null
}

/** Código de cierre estándar "el servidor se va" (RFC 6455). */
const CLOSE_GOING_AWAY = 1001
/** Cuántas rondas resueltas recientes se recuerdan por usuario para ordenar los avisos. */
const RECENT_ROUNDS = 8

export class Hub implements Notifier {
  readonly #byUser = new Map<string, Set<Connection>>()
  readonly #logger: HubLogger
  /** Rondas ya resueltas que se han anunciado (para no mandar un `round.started` tardío). */
  readonly #resolvedRounds = new Map<string, Set<string>>()
  #pingTimer: NodeJS.Timeout | null = null

  constructor(logger: HubLogger) {
    this.#logger = logger
  }

  count(userId: string): number {
    return this.#byUser.get(userId)?.size ?? 0
  }

  get size(): number {
    let n = 0
    for (const set of this.#byUser.values()) n += set.size
    return n
  }

  add(connection: Connection): void {
    let set = this.#byUser.get(connection.userId)
    if (!set) {
      set = new Set()
      this.#byUser.set(connection.userId, set)
    }
    set.add(connection)
  }

  remove(connection: Connection): void {
    const set = this.#byUser.get(connection.userId)
    if (!set) return
    set.delete(connection)
    if (set.size === 0) {
      this.#byUser.delete(connection.userId)
      this.#resolvedRounds.delete(connection.userId)
    }
  }

  /** Manda un mensaje validado a una conexión concreta (después del `hello`). */
  sendTo(connection: Connection, message: ServerMessage): void {
    if (connection.pending !== null && message.type !== 'hello') {
      connection.pending.push(message)
      return
    }
    this.#write(connection, message)
  }

  /** El `hello` ya salió: manda lo que estaba esperando, en orden. */
  ready(connection: Connection): void {
    const pending = connection.pending
    connection.pending = null
    for (const message of pending ?? []) this.#write(connection, message)
  }

  #write(connection: Connection, message: ServerMessage): void {
    const parsed = serverMessageSchema.safeParse(message)
    if (!parsed.success) {
      // Un mensaje que no cumple el protocolo es un bug del servidor: no se manda.
      this.#logger.error({ type: message.type }, 'mensaje WS fuera del protocolo')
      return
    }
    if (connection.socket.readyState !== connection.socket.OPEN) return
    connection.socket.send(JSON.stringify(parsed.data))
  }

  send(userId: string, message: ServerMessage): void {
    const set = this.#byUser.get(userId)
    if (!set) return
    if (!this.#inOrder(userId, message)) return
    for (const connection of set) this.sendTo(connection, message)
  }

  isConnected(userId: string): boolean {
    return this.count(userId) > 0
  }

  connectedUsers(): string[] {
    return [...this.#byUser.keys()]
  }

  closeUser(userId: string, reason: ByeReason): void {
    for (const connection of [...(this.#byUser.get(userId) ?? [])]) this.#bye(connection, reason)
  }

  closeSession(sessionId: string, reason: ByeReason): void {
    for (const set of this.#byUser.values()) {
      for (const connection of [...set]) {
        if (connection.sessionId === sessionId) this.#bye(connection, reason)
      }
    }
  }

  /** Ping a nivel de protocolo: mantiene viva la conexión (Cloudflare corta a los 100 s). */
  startPing(intervalMs: number): void {
    if (this.#pingTimer) return
    this.#pingTimer = setInterval(() => {
      for (const set of this.#byUser.values()) {
        for (const connection of set) {
          if (!connection.alive) {
            connection.socket.terminate()
            continue
          }
          connection.alive = false
          connection.socket.ping()
        }
      }
    }, intervalMs)
    this.#pingTimer.unref()
  }

  /** Apagado: despide a todas las ventanas y las cierra. */
  shutdown(): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer)
    this.#pingTimer = null
    for (const set of [...this.#byUser.values()]) {
      for (const connection of [...set]) {
        this.#write(connection, { v: 1, type: 'bye', reason: 'shutdown' })
        connection.socket.close(CLOSE_GOING_AWAY, 'shutdown')
        this.remove(connection)
      }
    }
  }

  #bye(connection: Connection, reason: ByeReason): void {
    this.#write(connection, { v: 1, type: 'bye', reason })
    connection.socket.close(WS_CLOSE_CODES.sessionEnded, reason)
    this.remove(connection)
  }

  /**
   * Garantiza el orden visible de una ronda: si ya se anunció su resolución, un
   * `round.started` que llegue tarde (carrera entre dos peticiones) se descarta.
   */
  #inOrder(userId: string, message: ServerMessage): boolean {
    if (message.type === 'round.resolved') {
      let set = this.#resolvedRounds.get(userId)
      if (!set) {
        set = new Set()
        this.#resolvedRounds.set(userId, set)
      }
      set.add(message.round.roundId)
      // Solo hace falta recordar las últimas: las rondas son secuenciales por usuario.
      if (set.size > RECENT_ROUNDS) set.delete(set.values().next().value as string)
      return true
    }
    if (message.type === 'round.started') {
      return !this.#resolvedRounds.get(userId)?.has(message.round.roundId)
    }
    return true
  }
}
