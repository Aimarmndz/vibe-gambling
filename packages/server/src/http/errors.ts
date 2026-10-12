// SPDX-License-Identifier: AGPL-3.0-or-later
// Todas las respuestas de error tienen la forma `{ v, error, message }` de `errorResponseSchema`.
import { isOtherProtocolVersion, PROTOCOL_VERSION } from '@vibe-gambling/shared'
import type { ErrorCode, ErrorResponse } from '@vibe-gambling/shared'
import type { FastifyError, FastifyInstance } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'

import { AppError, statusOf } from '../lib/errors.ts'

export function errorBody(code: ErrorCode, message: string): ErrorResponse {
  return { v: 1, error: code, message: message.slice(0, 500) }
}

function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized'
    case 403:
      return 'forbidden'
    case 404:
      return 'not_found'
    case 409:
      return 'conflict'
    case 413:
      return 'payload_too_large'
    case 429:
      return 'rate_limited'
    default:
      return 'invalid_request'
  }
}

export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message))
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      if (error.validationContext === 'body' && isOtherProtocolVersion(request.body)) {
        return reply
          .code(statusOf('protocol_mismatch'))
          .send(errorBody('protocol_mismatch', `This server speaks protocol v${PROTOCOL_VERSION}.`))
      }
      const issue = error.validation[0]
      const where = issue?.instancePath ? ` (${issue.instancePath})` : ''
      const message = `Invalid ${error.validationContext ?? 'request'}${where}: ${issue?.message ?? 'bad input'}`
      return reply.code(400).send(errorBody('invalid_request', message))
    }
    const status = error.statusCode ?? 500
    if (status >= 400 && status < 500) {
      // Errores de Fastify: JSON roto, cuerpo enorme, tipo de contenido no admitido…
      const code = codeForStatus(status)
      const message = code === 'payload_too_large' ? 'Request body too large.' : error.message
      return reply.code(status).send(errorBody(code, message))
    }
    request.log.error({ err: error }, 'error no controlado')
    return reply.code(500).send(errorBody('internal', 'Something broke on our side.'))
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.code(statusOf('not_found')).send(errorBody('not_found', 'Nothing here.')),
  )
}
