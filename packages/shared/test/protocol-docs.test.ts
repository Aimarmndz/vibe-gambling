// SPDX-License-Identifier: AGPL-3.0-or-later
// `docs/PROTOCOLO.md` se genera en parte desde estos esquemas (`scripts/gen-protocol-docs.ts`):
// si cambia el contrato y nadie regenera el documento, o un ejemplo deja de cumplir su esquema,
// este test falla.
import { describe, expect, it } from 'vitest'

import { checkExamples, protocolDocStatus } from '../../../scripts/gen-protocol-docs.ts'

describe('docs/PROTOCOLO.md', () => {
  it('está al día con los esquemas de shared (si falla: `pnpm docs:protocol`)', async () => {
    const { upToDate, problems } = await protocolDocStatus()
    expect(problems).toEqual([])
    expect(upToDate).toBe(true)
  })

  it('detecta un ejemplo que ya no cumple el contrato', () => {
    const doc = [
      '<!-- example: turnStartRequestSchema -->',
      '',
      '```json',
      '{ "v": 1, "turnId": "abc12345-xyz", "pluginVersion": "0.1.0", "os": "linux", "prompt": "x" }',
      '```',
    ].join('\n')
    expect(checkExamples(doc)).toHaveLength(1)
  })

  it('detecta un ejemplo con un esquema que no existe', () => {
    const doc = '<!-- example: nopeSchema -->\n\n```json\n{}\n```'
    expect(checkExamples(doc)).toEqual(['ejemplo con un esquema que shared no exporta: nopeSchema'])
  })
})
