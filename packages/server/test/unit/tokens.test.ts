// SPDX-License-Identifier: AGPL-3.0-or-later
import { opaqueTokenSchema } from '@vibe-gambling/shared'
import { describe, expect, it } from 'vitest'

import { generateToken, hashToken } from '../../src/lib/tokens.ts'

describe('tokens', () => {
  it('256 bits en base64url (43 caracteres), válidos para el protocolo y distintos', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateToken))
    expect(tokens.size).toBe(200)
    for (const token of tokens) expect(opaqueTokenSchema.safeParse(token).success).toBe(true)
  })

  it('en la base de datos va su SHA-256 en hexadecimal', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/)
  })
})
