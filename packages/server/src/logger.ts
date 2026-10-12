// SPDX-License-Identifier: AGPL-3.0-or-later
// Logs sin datos personales: ni IPs, ni cabeceras, ni queries (la de `/play` lleva el código de
// un solo uso), ni tokens. De cada petición solo se registra el método, el patrón de la ruta,
// el estado y el tiempo.
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'

/** Lo que se registra de un error: nunca sus propiedades sueltas (pueden llevar datos). */
export type SerializedError = {
  type: string
  message: string
  stack: string
  /** Código del error (SQLSTATE de Postgres, `FST_…` de Fastify, `ECONNREFUSED`…). */
  errorCode?: string
  /** Restricción de Postgres que ha fallado. */
  constraint?: string
  cause?: SerializedError
}

/** Profundidad máxima de causas encadenadas que se registran. */
const MAX_CAUSE_DEPTH = 3

/**
 * Serializador de errores sin datos personales. El de pino copia todas las propiedades
 * enumerables, y las de la base de datos llevan los valores de la consulta: el
 * `DrizzleQueryError` repite los parámetros en `message` y en `params`, y el error de
 * Postgres los pone en `detail` ("Key (login)=(…)"). Aquí solo sale el tipo, el mensaje sin
 * parámetros, la pila, el código y la restricción.
 */
export function serializeError(value: unknown, depth = 0): SerializedError {
  if (!(value instanceof Error))
    return { type: typeof value, message: '(no es un Error)', stack: '' }
  const record = value as Error & Record<string, unknown>
  const query = typeof record.query === 'string' && 'params' in record ? record.query : null
  // El mensaje de un fallo de consulta es "Failed query: <sql>\nparams: <valores>".
  const message = query === null ? value.message : `Failed query: ${query}`
  const stack = value.stack ?? ''
  const out: SerializedError = {
    type: value.name,
    message,
    stack: query === null ? stack : stack.replace(value.message, message),
  }
  if (typeof record.code === 'string') out.errorCode = record.code
  if (typeof record.constraint_name === 'string') out.constraint = record.constraint_name
  if (value.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    out.cause = serializeError(value.cause, depth + 1)
  }
  return out
}

export function loggerOptions(level: string) {
  return {
    level,
    // Ningún serializador de petición/respuesta: si alguien registra `req` por error, sale vacío.
    serializers: {
      req: () => ({}),
      res: () => ({}),
      err: (error: Error) => serializeError(error),
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
