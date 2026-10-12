// SPDX-License-Identifier: AGPL-3.0-or-later
// Lo que el servidor añade a cada petición de Fastify.
import type { Authenticated } from '../services/auth.ts'

export interface WsContext {
  /** La IP ya ha pasado su cupo de peticiones (cada intento de conexión cuenta). */
  limited: boolean
  originOk: boolean
  auth: Authenticated | null
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Sesión autenticada (la rellena `requireAuth`). */
    auth: Authenticated | null
    /** Cómo llegó la credencial: cabecera del mod o cookie de la web. */
    authVia: 'bearer' | 'cookie' | null
    /** IP real del cliente (solo para el rate limit; nunca se registra). */
    realIp: string
    /** Resultado de la comprobación previa del WebSocket. */
    wsContext: WsContext | null
  }
}
