// SPDX-License-Identifier: AGPL-3.0-or-later
// Temporadas mensuales calculadas en una zona horaria concreta (Europe/Madrid por configuración).
import { z } from 'zod'

/** Identificador de temporada: `AAAA-MM` (el mes en que empieza). */
export const seasonIdSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
export type SeasonId = z.output<typeof seasonIdSchema>

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Fecha y hora de pared de un instante en una zona horaria. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const out: ZonedParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const part of formatter(timeZone).formatToParts(instant)) {
    if (part.type in out) out[part.type as keyof ZonedParts] = Number(part.value)
  }
  return out
}

/** Desfase (ms) de la zona horaria respecto a UTC en un instante dado. */
function offsetAt(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant / 1000) * 1000
}

/** Instante UTC de las 00:00 de un día de pared en una zona horaria. */
export function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day)
  let result = guess - offsetAt(guess, timeZone)
  // Segunda pasada por si el desfase cambia entre la suposición y el resultado (cambio de hora).
  result = guess - offsetAt(result, timeZone)
  return new Date(result)
}

export interface SeasonBounds {
  id: SeasonId
  startsAt: Date
  endsAt: Date
}

function idOf(year: number, month: number): SeasonId {
  return `${year}-${String(month).padStart(2, '0')}`
}

function shiftMonth(year: number, month: number, delta: number): [number, number] {
  const index = year * 12 + (month - 1) + delta
  return [Math.floor(index / 12), (index % 12) + 1]
}

/** Límites de una temporada a partir de su identificador. */
export function seasonBounds(id: SeasonId, timeZone: string, startDay: number): SeasonBounds {
  const [year, month] = seasonIdSchema.parse(id).split('-').map(Number) as [number, number]
  const [ny, nm] = shiftMonth(year, month, 1)
  return {
    id,
    startsAt: zonedMidnight(year, month, startDay, timeZone),
    endsAt: zonedMidnight(ny, nm, startDay, timeZone),
  }
}

/** Temporada en curso en un instante dado. */
export function seasonAt(instant: Date, timeZone: string, startDay: number): SeasonBounds {
  const p = zonedParts(instant, timeZone)
  const [year, month] = p.day >= startDay ? [p.year, p.month] : shiftMonth(p.year, p.month, -1)
  return seasonBounds(idOf(year, month), timeZone, startDay)
}

export interface DayBounds {
  startsAt: Date
  endsAt: Date
}

/**
 * Día de pared (de 00:00 a 00:00) en una zona horaria que contiene un instante. Con el cambio de
 * hora el día dura 23 o 25 horas: los límites son las medianoches de verdad, no "+24 h".
 */
export function dayAt(instant: Date, timeZone: string): DayBounds {
  const p = zonedParts(instant, timeZone)
  return {
    startsAt: zonedMidnight(p.year, p.month, p.day, timeZone),
    // Date.UTC normaliza el día 32 al 1 del mes siguiente (y el 13.º mes al año siguiente).
    endsAt: zonedMidnight(p.year, p.month, p.day + 1, timeZone),
  }
}

/** Temporada siguiente a una dada. */
export function nextSeasonId(id: SeasonId): SeasonId {
  const [year, month] = seasonIdSchema.parse(id).split('-').map(Number) as [number, number]
  const [ny, nm] = shiftMonth(year, month, 1)
  return idOf(ny, nm)
}
