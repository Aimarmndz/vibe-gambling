// SPDX-License-Identifier: AGPL-3.0-or-later
// Un cliente que habla otra versión del protocolo recibe `protocol_mismatch`, no un error genérico.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { DbHandle } from '../../src/db/client.ts'
import { startTestApp } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'
import { createTestDb } from '../helpers/db.ts'

let db: DbHandle
let t: TestApp

beforeAll(async () => {
  db = await createTestDb()
  t = await startTestApp({ db })
})
afterAll(async () => {
  await t.close()
  await db.close(5)
})

describe('versión del protocolo', () => {
  it('un cuerpo con otra `v` → 400 protocol_mismatch', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/device/start',
      payload: { v: 2 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ v: 1, error: 'protocol_mismatch' })
  })

  it('un cuerpo de la versión buena pero mal formado sigue siendo invalid_request', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/device/poll',
      payload: { v: 1, pollId: 'corto' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'invalid_request' })
  })
})
