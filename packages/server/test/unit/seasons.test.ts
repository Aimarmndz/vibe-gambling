// SPDX-License-Identifier: AGPL-3.0-or-later
// Cierre de temporada con reloj falso: el cambio de mes se hace a las 00:00 de Europe/Madrid.
import { seasonAt, seasonBounds } from '@vibe-gambling/shared'
import { describe, expect, it } from 'vitest'

import { ManualClock } from '../../src/lib/clock.ts'
import { seasonsToClose } from '../../src/services/seasons.ts'

const TZ = 'Europe/Madrid'

function open(id: string) {
  const b = seasonBounds(id, TZ, 1)
  return { id, endsAt: b.endsAt, closedAt: null as Date | null }
}

describe('cierre de temporada (reloj falso)', () => {
  it('octubre (CET, UTC+1 tras el cambio de hora) cierra justo a las 23:00 UTC del 31', () => {
    const clock = new ManualClock('2026-10-31T22:59:59.999Z')
    expect(seasonAt(clock.now(), TZ, 1).id).toBe('2026-10')
    expect(seasonsToClose([open('2026-10')], clock.now())).toEqual([])
    clock.advance(1)
    expect(seasonAt(clock.now(), TZ, 1).id).toBe('2026-11')
    expect(seasonsToClose([open('2026-10')], clock.now()).map(s => s.id)).toEqual(['2026-10'])
  })

  it('marzo (cambio a CEST, UTC+2) cierra a las 22:00 UTC del 31', () => {
    const clock = new ManualClock('2027-03-31T21:59:59Z')
    expect(seasonsToClose([open('2027-03')], clock.now())).toEqual([])
    clock.set('2027-03-31T22:00:00Z')
    expect(seasonsToClose([open('2027-03')], clock.now()).map(s => s.id)).toEqual(['2027-03'])
    expect(seasonAt(clock.now(), TZ, 1).id).toBe('2027-04')
  })

  it('fin de año y varias temporadas pendientes, en orden; las cerradas no se tocan', () => {
    const clock = new ManualClock('2027-02-15T00:00:00Z')
    const closed = { ...open('2026-11'), closedAt: new Date('2026-12-01') }
    const result = seasonsToClose(
      [open('2027-01'), closed, open('2026-12'), open('2027-02')],
      clock.now(),
    )
    expect(result.map(s => s.id)).toEqual(['2026-12', '2027-01'])
    expect(seasonBounds('2026-12', TZ, 1).endsAt.toISOString()).toBe('2026-12-31T23:00:00.000Z')
  })
})
