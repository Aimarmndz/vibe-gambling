// SPDX-License-Identifier: AGPL-3.0-or-later
// Logs sin datos personales: ni IPs, ni cabeceras, ni queries (la de `/play` lleva el código de
// un solo uso), ni tokens. De cada petición solo se registra el método, el patrón de la ruta,
// el estado y el tiempo.
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'

export function loggerOptions(level: string) {
  return {
    level,
    // Ningún serializador de petición/respuesta: si alguien registra `req` por error, sale vacío.
    serializers: {
      req: () => ({}),
      res: () => ({}),
    },
    redact: {
      paths: [
        '*.authorization',
        '*.cookie',
        '*.token',
        '*.code',
        '*.pollId',
        '*.headers',
        '*.remoteAddress',
        '*.ip',
      ],
      censor: '[redacted]',
    },
  }
}

/** Una línea por respuesta, con la ruta como patrón (`/api/leaderboard`, nunca la URL real). */
export function registerRequestLogging(app: FastifyInstance): void {
  app.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url ?? '(sin ruta)'
    const entry = {
      method: request.method,
      route,
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
    }
    const log: FastifyBaseLogger = request.log
    if (route === '/healthz' || reply.statusCode < 400) log.debug(entry, 'petición')
    else log.info(entry, 'petición')
  })
}
