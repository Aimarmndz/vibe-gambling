// SPDX-License-Identifier: AGPL-3.0-or-later
// Los errores de la base de datos no pueden llevar datos personales ni secretos a los logs.
import { Writable } from 'node:stream'

import { DrizzleQueryError } from 'drizzle-orm/errors'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { loggerOptions } from '../../src/logger.ts'

function capture() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _enc, done) {
      lines.push(String(chunk))
      done()
    },
  })
  const app = Fastify({ logger: { ...loggerOptions('debug'), stream } })
  return { app, text: () => lines.join('') }
}

/** Error de Postgres como los que lanza postgres.js (con `detail` enumerable y los valores). */
function postgresError(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint "x"'), {
    name: 'PostgresError',
    code: '23505',
    detail: 'Key (login)=(octocat-personal) already exists.',
    constraint_name: 'users_github_id_key',
  })
}

describe('logs de errores', () => {
  it('un fallo de consulta no registra sus parámetros ni el detalle de Postgres', async () => {
    const { app, text } = capture()
    const error = new DrizzleQueryError(
      'insert into "users" ("login", "avatar_url") values ($1, $2)',
      ['octocat-personal', 'gho_secret-device-code'],
      postgresError(),
    )
    app.log.error({ err: error }, 'error no controlado')
    await app.close()
    const out = text()
    expect(out).not.toContain('octocat-personal')
    expect(out).not.toContain('gho_secret-device-code')
    // Lo útil para depurar sí queda: la consulta (sin valores) y el código SQLSTATE.
    expect(out).toContain('insert into')
    expect(out).toContain('23505')
    expect(out).toContain('users_github_id_key')
  })

  it('el código del error llega al log (no lo tapa la redacción de `*.code`)', async () => {
    const { app, text } = capture()
    app.log.error({ err: postgresError() }, 'fallo')
    await app.close()
    expect(text()).toContain('"errorCode":"23505"')
  })

  it('los errores normales conservan tipo, mensaje y pila', async () => {
    const { app, text } = capture()
    app.log.error({ err: new TypeError('se rompió algo') }, 'fallo')
    await app.close()
    const out = text()
    expect(out).toContain('TypeError')
    expect(out).toContain('se rompió algo')
    expect(out).toContain('"stack"')
  })
})
