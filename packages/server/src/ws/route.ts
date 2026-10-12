// SPDX-License-Identifier: AGPL-3.0-or-later
// WebSocket `/ws` de la ventana del juego.
// - Autentica con la cookie de sesión web y exige `Origin` == PUBLIC_URL.
// - Límite de conexiones por usuario, de tamaño (ws cierra con 1009) y de mensajes por ventana.
// - Lo primero que recibe la ventana es siempre `hello`; los avisos que lleguen mientras se
//   prepara se guardan y se mandan después, en orden.
import { clientMessageSchema, WS_CLOSE_CODES } from '@vibe-gambling/shared'
import type { ClientMessage, ServerMessage } from '@vibe-gambling/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RawData, WebSocket } from 'ws'

import type { Config } from '../config.ts'
import { lookup } from '../http/auth.ts'
import { isAllowedOrigin, originOf } from '../http/security.ts'
import { AppError } from '../lib/errors.ts'
import { rateLimitKeyOf } from '../lib/real-ip.ts'
import type { Services } from '../services/index.ts'
import type { Connection, Hub } from './hub.ts'

export interface WsOptions {
  config: Config
  services: Services
  hub: Hub
}

const V = 1 as const

export async function wsRoutes(app: FastifyInstance, options: WsOptions): Promise<void> {
  const { config, services, hub } = options
  const { env } = config

  // Los intentos de conexión cuentan por IP real (con su propio cupo, aparte del de /api):
  // si no, abrir y cerrar sockets sería una forma gratis de hacer consultas de sesión.
  const ipLimit = app.createRateLimit({
    max: env.RATE_LIMIT_IP_MAX,
    timeWindow: env.RATE_LIMIT_IP_WINDOW_MS,
    keyGenerator: (request: FastifyRequest) =>
      `ws:${rateLimitKeyOf(request.realIp, env.RATE_LIMIT_IPV6_PREFIX)}`,
  })

  // Antes del upgrade: cupo, origen y sesión. El resultado se aplica ya con el socket abierto,
  // para poder cerrarlo con los códigos 44xx del protocolo (el navegador no ve los 4xx de HTTP).
  app.addHook('preValidation', async (request: FastifyRequest) => {
    const limit = await ipLimit(request)
    const limited = !limit.isAllowed && limit.isExceeded
    const originOk = isAllowedOrigin(config, originOf(request))
    const cookie = request.cookies[env.SESSION_COOKIE_NAME]
    const auth =
      !limited && originOk && cookie
        ? await lookup(services.auth, { via: 'cookie', token: cookie })
        : null
    request.wsContext = { limited, originOk, auth: auth?.session.kind === 'web' ? auth : null }
  })

  app.get('/ws', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const ctx = request.wsContext
    if (!ctx || ctx.limited) {
      socket.close(WS_CLOSE_CODES.tooManyConnections, 'rate limited')
      return
    }
    if (!ctx.originOk) {
      socket.close(WS_CLOSE_CODES.forbiddenOrigin, 'forbidden origin')
      return
    }
    if (!ctx.auth) {
      socket.close(WS_CLOSE_CODES.unauthorized, 'unauthorized')
      return
    }
    const userId = ctx.auth.user.id
    if (hub.count(userId) >= env.WS_MAX_CONNECTIONS_PER_USER) {
      socket.close(WS_CLOSE_CODES.tooManyConnections, 'too many connections')
      return
    }

    const connection: Connection = {
      socket,
      userId,
      sessionId: ctx.auth.session.id,
      alive: true,
      pending: [],
    }
    hub.add(connection)
    socket.on('pong', () => {
      connection.alive = true
    })
    socket.on('close', () => hub.remove(connection))
    socket.on('error', error => {
      request.log.warn({ err: error }, 'error en un WebSocket')
    })

    // Límite de mensajes por ventana (ventana fija).
    let windowStart = Date.now()
    let count = 0
    const allow = (): boolean => {
      const now = Date.now()
      if (now - windowStart >= env.WS_RATE_LIMIT_WINDOW_MS) {
        windowStart = now
        count = 0
      }
      count++
      return count <= env.WS_RATE_LIMIT_MAX
    }

    // La sesión puede caducar, revocarse o purgarse con la ventana abierta (o justo entre la
    // comprobación previa y el alta en el hub): se vuelve a mirar antes de cada acción.
    const stillValid = async (): Promise<boolean> => {
      if (await services.auth.isSessionActive(connection.sessionId)) return true
      hub.remove(connection)
      socket.close(WS_CLOSE_CODES.unauthorized, 'session ended')
      return false
    }

    // Los mensajes de una misma ventana se procesan de uno en uno y en orden.
    let chain: Promise<void> = (async () => {
      if (await stillValid()) await sendHello(services, hub, connection)
    })().catch((error: unknown) => {
      request.log.error({ err: error }, 'no se pudo preparar el hello')
      socket.close(WS_CLOSE_CODES.protocolError, 'hello failed')
    })
    socket.on('message', (data: RawData, isBinary: boolean) => {
      if (!allow()) {
        hub.sendTo(connection, errorMessage('rate_limited', 'Too many messages. Breathe.'))
        return
      }
      const parsed = parseMessage(data, isBinary)
      chain = chain
        .then(async () => {
          // Un `ping` no toca nada: no merece una consulta.
          if (parsed?.type === 'ping' || (await stillValid())) {
            await handle(services, hub, connection, parsed)
          }
        })
        .catch((error: unknown) => {
          request.log.error({ err: error }, 'error procesando un mensaje WS')
          hub.sendTo(connection, errorMessage('internal', 'Something broke on our side.'))
        })
    })
  })
}

function errorMessage(
  error: Extract<ServerMessage, { type: 'error' }>['error'],
  message: string,
): ServerMessage {
  return { v: V, type: 'error', error, message }
}

function parseMessage(data: RawData, isBinary: boolean): ClientMessage | null {
  if (isBinary) return null
  const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : data.toString('utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const result = clientMessageSchema.safeParse(json)
  return result.success ? result.data : null
}

async function sendHello(services: Services, hub: Hub, connection: Connection): Promise<void> {
  const state = await services.game.state(connection.userId)
  hub.sendTo(connection, {
    v: V,
    type: 'hello',
    user: services.views.selfUser(state.user),
    wallet: state.wallet,
    slip: state.slip,
    round: state.round,
    lastRound: state.lastRound,
    serverTime: services.game.now().toISOString(),
  })
  hub.ready(connection)
}

async function handle(
  services: Services,
  hub: Hub,
  connection: Connection,
  message: ClientMessage | null,
): Promise<void> {
  if (!message) {
    hub.sendTo(
      connection,
      errorMessage('invalid_request', 'That message is not part of the protocol.'),
    )
    return
  }
  const { userId } = connection
  try {
    switch (message.type) {
      case 'bet.place':
        // El resultado llega a todas las ventanas con el mensaje `slip`.
        await services.game.placeBet(userId, message.selection, message.amount)
        return
      case 'bet.clear':
        await services.game.clearSlip(userId)
        return
      case 'loan.request':
        await services.game.requestLoan(userId)
        return
      case 'settings.update':
        if (message.hidden === undefined && message.locale === undefined) {
          hub.sendTo(connection, errorMessage('invalid_request', 'Nothing to change.'))
          return
        }
        await services.auth.updateSettings(userId, {
          hidden: message.hidden,
          locale: message.locale,
        })
        return
      case 'sync':
        await sendHello(services, hub, connection)
        return
      case 'ping':
        hub.sendTo(connection, { v: V, type: 'pong', t: message.t })
        return
    }
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    if (message.type === 'bet.place' || message.type === 'bet.clear') {
      hub.sendTo(connection, {
        v: V,
        type: 'bet.rejected',
        error: error.code,
        message: error.message,
      })
    } else {
      hub.sendTo(connection, errorMessage(error.code, error.message))
    }
  }
}
