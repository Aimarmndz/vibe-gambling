// SPDX-License-Identifier: AGPL-3.0-or-later
// Lo que los servicios necesitan del WebSocket: avisar a las ventanas de un usuario.
import type { ServerMessage } from '@vibe-gambling/shared'

export type ByeReason = Extract<ServerMessage, { type: 'bye' }>['reason']

export interface Notifier {
  /** Manda un mensaje a todas las ventanas conectadas del usuario. */
  send(userId: string, message: ServerMessage): void
  /** Si el usuario tiene alguna ventana conectada. */
  isConnected(userId: string): boolean
  /** Usuarios con alguna ventana conectada ahora mismo. */
  connectedUsers(): string[]
  /** Despide y cierra todas las ventanas del usuario. */
  closeUser(userId: string, reason: ByeReason): void
  /** Despide y cierra las ventanas abiertas con una sesión concreta. */
  closeSession(sessionId: string, reason: ByeReason): void
}

/** Notificador que no hace nada (para tests de servicios sin WebSocket). */
export const nullNotifier: Notifier = {
  send: () => {},
  isConnected: () => false,
  connectedUsers: () => [],
  closeUser: () => {},
  closeSession: () => {},
}
