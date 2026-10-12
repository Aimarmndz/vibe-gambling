// SPDX-License-Identifier: AGPL-3.0-or-later
// Serializador de respuestas con zod. El de `fastify-type-provider-zod` usa `encode`, que no
// admite las transformaciones de los esquemas de `shared` (p. ej. ordenar los números de una
// apuesta); aquí se valida con `parse`, que sí, y luego se serializa.
import type { FastifySerializerCompiler } from 'fastify'
import { ResponseSerializationError } from 'fastify-type-provider-zod'
import type { ZodType } from 'zod'

export const zodSerializerCompiler: FastifySerializerCompiler<ZodType> =
  ({ schema, method, url }) =>
  data => {
    const result = schema.safeParse(data)
    if (!result.success) throw new ResponseSerializationError(method, url, { cause: result.error })
    return JSON.stringify(result.data)
  }
