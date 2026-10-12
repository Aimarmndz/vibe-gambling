// SPDX-License-Identifier: AGPL-3.0-or-later
// Conexión de la ventana con el servidor: WebSocket `/ws` con reconexión (backoff exponencial con
// jitter), `sync` al volver, `ping` de aplicación y validación zod de todo lo que entra y sale.
import {
  PROTOCOL_VERSION,
  WS_CLOSE_CODES,
  clientMessageSchema,
  serverMessageSchema,
} from '@vibe-gambling/shared'
import type { ClientMessageInput, ServerMessage } from '@vibe-gambling/shared'

import type { WebClientConfig } from '../config.ts'

export type LinkStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  /** Sin sesión: hay que entrar con /vibe-login. */
  | 'unauthorized'
  /** El servidor no acepta este origen o hay demasiadas ventanas abiertas. */
  | 'refused'
  /** La sesión terminó (logout, cuenta borrada, ventana abierta en otro sitio). */
  | 'ended'

/** Lo que la ventana necesita de una conexión (la real o la del modo demo). */
export interface Link {
  start(): void
  stop(): void
  send(msg: ClientMessageInput): boolean
  onMessage(listener: (msg: ServerMessage) => void): void
  onStatus(listener: (status: LinkStatus) => void): void
}

/** Mensaje del cliente con la versión del protocolo ya puesta. */
export type Outgoing = ClientMessageInput extends infer M
  ? M extends { v: number }
    ? Omit<M, 'v'>
    : never
  : never

export function withVersion(msg: Outgoing): ClientMessageInput {
  return { v: PROTOCOL_VERSION, ...msg } as ClientMessageInput
}

/** Espera antes del reintento número `attempt` (0, 1, 2…). */
export function backoffDelay(
  attempt: number,
  cfg: WebClientConfig['ws']['reconnect'],
  random: () => number = Math.random,
): number {
  const raw = Math.min(cfg.maxMs, cfg.baseMs * 2 ** Math.min(attempt, 30))
  const jitter = 1 + cfg.jitter * (random() * 2 - 1)
  return Math.max(0, Math.round(raw * jitter))
}

/** Valida un mensaje del servidor. Devuelve `null` (y lo registra) si no cumple el contrato. */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') {
    console.warn('[ws] mensaje binario ignorado')
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    console.warn('[ws] mensaje que no es JSON ignorado')
    return null
  }
  const parsed = serverMessageSchema.safeParse(json)
  if (!parsed.success) {
    console.warn('[ws] mensaje fuera de contrato ignorado', parsed.error.issues)
    return null
  }
  return parsed.data
}

/** URL del WebSocket en el mismo dominio que la página. */
export function wsUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
}

export class WsLink implements Link {
  private socket: WebSocket | null = null
  private attempt = 0
  private connectedOnce = false
  private stopped = true
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private readonly messageListeners: ((msg: ServerMessage) => void)[] = []
  private readonly statusListeners: ((status: LinkStatus) => void)[] = []

  private readonly url: string
  private readonly cfg: WebClientConfig['ws']

  constructor(url: string, cfg: WebClientConfig['ws']) {
    this.url = url
    this.cfg = cfg
  }

  onMessage(listener: (msg: ServerMessage) => void): void {
    this.messageListeners.push(listener)
  }

  onStatus(listener: (status: LinkStatus) => void): void {
    this.statusListeners.push(listener)
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    this.socket?.close(1000, 'bye')
    this.socket = null
  }

  send(msg: ClientMessageInput): boolean {
    const parsed = clientMessageSchema.safeParse(msg)
    if (!parsed.success) {
      console.error('[ws] intento de mandar un mensaje fuera de contrato', parsed.error.issues)
      return false
    }
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(msg))
    return true
  }

  private emitStatus(status: LinkStatus): void {
    for (const l of this.statusListeners) l(status)
  }

  private connect(): void {
    this.emitStatus(this.connectedOnce ? 'reconnecting' : 'connecting')
    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch (error) {
      console.error('[ws] no se pudo abrir el WebSocket', error)
      this.scheduleRetry()
      return
    }
    this.socket = socket
    socket.addEventListener('open', () => {
      const reconnect = this.connectedOnce
      this.attempt = 0
      this.connectedOnce = true
      this.emitStatus('open')
      // El servidor manda `hello` al conectar; al reconectar se pide además el estado completo.
      if (reconnect) this.send(withVersion({ type: 'sync' }))
      this.startPing()
    })
    socket.addEventListener('message', event => {
      this.armPongTimeout(false)
      const msg = parseServerMessage(event.data)
      if (!msg) return
      if (msg.type === 'bye' && msg.reason !== 'shutdown') {
        this.stopped = true
      }
      for (const l of this.messageListeners) l(msg)
    })
    socket.addEventListener('close', event => {
      this.clearTimers()
      if (this.socket === socket) this.socket = null
      if (event.code === WS_CLOSE_CODES.unauthorized) {
        this.stopped = true
        this.emitStatus('unauthorized')
        return
      }
      if (
        event.code === WS_CLOSE_CODES.forbiddenOrigin ||
        event.code === WS_CLOSE_CODES.tooManyConnections
      ) {
        this.stopped = true
        this.emitStatus('refused')
        return
      }
      if (event.code === WS_CLOSE_CODES.sessionEnded || this.stopped) {
        this.stopped = true
        this.emitStatus('ended')
        return
      }
      this.scheduleRetry()
    })
    // Los errores del WebSocket siempre van seguidos de `close`, que es donde se reintenta.
    socket.addEventListener('error', () => console.warn('[ws] error de conexión'))
  }

  private scheduleRetry(): void {
    if (this.stopped) return
    this.emitStatus('reconnecting')
    const delay = backoffDelay(this.attempt++, this.cfg.reconnect)
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }

  private startPing(): void {
    this.pingTimer = setInterval(() => {
      if (this.send(withVersion({ type: 'ping', t: Date.now() }))) this.armPongTimeout(true)
    }, this.cfg.pingIntervalMs)
  }

  /** Tras un ping, si no llega nada en `pongTimeoutMs`, la conexión está muerta: se cierra y se reintenta. */
  private armPongTimeout(arm: boolean): void {
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.pongTimer = null
    if (!arm) return
    this.pongTimer = setTimeout(() => {
      console.warn('[ws] sin respuesta al ping: reconectando')
      this.socket?.close(4000, 'ping timeout')
    }, this.cfg.pongTimeoutMs)
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.retryTimer = this.pingTimer = this.pongTimer = null
  }
}
