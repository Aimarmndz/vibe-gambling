// SPDX-License-Identifier: AGPL-3.0-or-later
// Cuentas de GitHub nuevas fuera del ranking: cuándo sale cada una (días de 24 h exactas).
import { describe, expect, it } from 'vitest'

import { pendingRankedFrom, rankableAt } from '../../src/services/accountAge.ts'

const DAY = 86_400_000
const created = new Date('2026-10-01T10:00:00Z')

describe('edad de la cuenta de GitHub', () => {
  it('sale justo al cumplir los días (ni antes ni por zona horaria)', () => {
    const at = rankableAt(created, 30)
    expect(at.toISOString()).toBe('2026-10-31T10:00:00.000Z')
    expect(pendingRankedFrom(created, 30, new Date(at.getTime() - 1))).toEqual(at)
    expect(pendingRankedFrom(created, 30, at)).toBeNull()
    expect(pendingRankedFrom(created, 30, new Date(at.getTime() + DAY))).toBeNull()
  })

  it('sin dato cuenta como antigua, y con 0 días no espera nadie', () => {
    expect(pendingRankedFrom(null, 30, created)).toBeNull()
    expect(pendingRankedFrom(new Date(created.getTime() + DAY), 0, created)).toBeNull()
  })
})
