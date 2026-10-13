// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import {
  dayAt,
  nextSeasonId,
  seasonAt,
  seasonBounds,
  zonedMidnight,
  zonedParts,
} from '../src/index.ts'

const TZ = 'Europe/Madrid'

describe('temporadas en Europe/Madrid', () => {
  it('cambia el día 1 a las 00:00 hora de Madrid (invierno, UTC+1)', () => {
    expect(seasonAt(new Date('2026-10-31T22:59:59Z'), TZ, 1).id).toBe('2026-10')
    expect(seasonAt(new Date('2026-10-31T23:00:00Z'), TZ, 1).id).toBe('2026-11')
  })

  it('cambia el día 1 a las 00:00 hora de Madrid (verano, UTC+2)', () => {
    expect(seasonAt(new Date('2027-05-31T21:59:59Z'), TZ, 1).id).toBe('2027-05')
    expect(seasonAt(new Date('2027-05-31T22:00:00Z'), TZ, 1).id).toBe('2027-06')
  })

  it('el cambio de año también funciona', () => {
    expect(seasonAt(new Date('2026-12-31T22:59:59Z'), TZ, 1).id).toBe('2026-12')
    expect(seasonAt(new Date('2026-12-31T23:00:00Z'), TZ, 1).id).toBe('2027-01')
    expect(nextSeasonId('2026-12')).toBe('2027-01')
    expect(nextSeasonId('2026-01')).toBe('2026-02')
  })

  it('calcula los límites aunque el mes contenga el cambio de hora', () => {
    // Marzo de 2027: el 28 se pasa a horario de verano.
    const march = seasonBounds('2027-03', TZ, 1)
    expect(march.startsAt.toISOString()).toBe('2027-02-28T23:00:00.000Z')
    expect(march.endsAt.toISOString()).toBe('2027-03-31T22:00:00.000Z')
    // Octubre de 2026: el 25 se vuelve al horario de invierno.
    const october = seasonBounds('2026-10', TZ, 1)
    expect(october.startsAt.toISOString()).toBe('2026-09-30T22:00:00.000Z')
    expect(october.endsAt.toISOString()).toBe('2026-10-31T23:00:00.000Z')
  })

  it('admite otro día de cambio y otras zonas', () => {
    expect(seasonAt(new Date('2026-10-14T12:00:00Z'), TZ, 15).id).toBe('2026-09')
    expect(seasonAt(new Date('2026-10-15T12:00:00Z'), TZ, 15).id).toBe('2026-10')
    expect(seasonAt(new Date('2026-01-01T00:00:00Z'), 'UTC', 1).id).toBe('2026-01')
    expect(zonedMidnight(2026, 7, 1, 'America/New_York').toISOString()).toBe(
      '2026-07-01T04:00:00.000Z',
    )
  })

  it('rechaza identificadores mal formados', () => {
    expect(() => seasonBounds('2026-13', TZ, 1)).toThrow()
    expect(() => nextSeasonId('26-01')).toThrow()
  })

  it('da la hora de pared', () => {
    expect(zonedParts(new Date('2026-07-01T10:30:15Z'), TZ)).toEqual({
      year: 2026,
      month: 7,
      day: 1,
      hour: 12,
      minute: 30,
      second: 15,
    })
  })
})

describe('día de pared (tope diario)', () => {
  const day = (instant: string, tz = 'Europe/Madrid') => {
    const d = dayAt(new Date(instant), tz)
    return [d.startsAt.toISOString(), d.endsAt.toISOString()]
  }

  it('de 00:00 a 00:00 en la zona horaria, no en UTC', () => {
    // 23:30 UTC del 15 de octubre ya es el 16 en Madrid (CEST, +2).
    expect(day('2026-10-15T23:30:00Z')).toEqual([
      '2026-10-15T22:00:00.000Z',
      '2026-10-16T22:00:00.000Z',
    ])
    expect(day('2026-10-15T23:30:00Z', 'UTC')).toEqual([
      '2026-10-15T00:00:00.000Z',
      '2026-10-16T00:00:00.000Z',
    ])
  })

  it('con el cambio de hora el día dura 25 h (octubre) o 23 h (marzo)', () => {
    expect(day('2026-10-25T12:00:00Z')).toEqual([
      '2026-10-24T22:00:00.000Z',
      '2026-10-25T23:00:00.000Z',
    ])
    expect(day('2026-03-29T12:00:00Z')).toEqual([
      '2026-03-28T23:00:00.000Z',
      '2026-03-29T22:00:00.000Z',
    ])
  })

  it('la medianoche es del día siguiente (cambio de mes y de año) y el límite es exacto', () => {
    expect(day('2026-12-31T12:00:00Z')).toEqual([
      '2026-12-30T23:00:00.000Z',
      '2026-12-31T23:00:00.000Z',
    ])
    // Justo a medianoche ya es el día nuevo.
    expect(day('2026-12-31T23:00:00Z')[0]).toBe('2026-12-31T23:00:00.000Z')
    expect(day('2026-12-31T22:59:59.999Z')[1]).toBe('2026-12-31T23:00:00.000Z')
  })
})
