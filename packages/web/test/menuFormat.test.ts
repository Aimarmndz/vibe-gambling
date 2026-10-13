// SPDX-License-Identifier: AGPL-3.0-or-later
// Formateo y geometría puros del menú v2: tiempos, fechas, banco, con qué se juegan las
// pendientes, la gráfica del patrimonio (escalado de la serie) y los cálculos de las páginas.
import { describe, expect, it } from 'vitest'

import {
  bankRow,
  chartGeometry,
  pendingPlay,
  seasonDaysLeft,
  seasonTimeLeft,
  shortDate,
  stepYAt,
  timeLeft,
} from '../src/ui/menu/format.ts'
import {
  bandRows,
  cornerGap,
  fit,
  helpWidth,
  patternOffset,
  pocketText,
  windowColorAt,
} from '../src/ui/menu/kit.ts'
import { daysInDebt } from '../src/ui/menu/pages/bank.ts'
import { creditsOffset, VIEW } from '../src/ui/menu/pages/credits.ts'
import { turnedColumns } from '../src/ui/menu/pages/howTo.ts'
import { scrollFor } from '../src/ui/menu/pages/achievements.ts'
import { stackChips } from '../src/ui/menu/pages/pending.ts'
import { outCubic } from '../src/ui/menu/pages/stats.ts'
import { PALETTE } from '../src/ui/palette.ts'
import { REST_YAW, bobOffset, spinAngle, swingAngle } from '../src/render/menuIcons/layer.ts'
import { BANK, STATS } from './menuFixtures.ts'
import { testWebConfig } from './fixtures.ts'
import { translator } from './translators.ts'

const es = translator('es')
const en = translator('en')

describe('tiempo y fechas', () => {
  it('lo que queda: días a partir de 48 h, horas por debajo, nunca negativo', () => {
    expect(timeLeft(3 * 86_400_000, es)).toBe('3 d')
    expect(timeLeft(47 * 3_600_000, es)).toBe('47 h')
    expect(timeLeft(-5, es)).toBe('0 h')
  })

  it('días y tiempo que le quedan a la temporada en su zona horaria', () => {
    const game = testWebConfig.game
    // La temporada de prueba (UTC, día 1) de octubre acaba el 1 de noviembre a las 00:00.
    const now = Date.parse('2026-10-12T12:00:00Z')
    expect(seasonDaysLeft('2026-10', game, now)).toBe(20)
    expect(seasonTimeLeft('2026-10', game, now, es)).toBe('19 d')
    expect(seasonDaysLeft('2026-10', game, Date.parse('2026-12-01T00:00:00Z'))).toBe(0)
  })

  it('fechas cortas en mayúsculas y sin el punto de la abreviatura, en cada idioma', () => {
    expect(shortDate('2026-10-03T18:00:00.000Z', 'es', 'UTC')).toBe('03 OCT')
    expect(shortDate('2026-10-03T18:00:00.000Z', 'en', 'UTC')).toBe('03 OCT')
    expect(shortDate('2026-03-03T18:00:00.000Z', 'de', 'UTC')).toBe('03 MÄRZ')
    // Un día de pared (AAAA-MM-DD) no se mueve por la zona horaria.
    expect(shortDate('2026-10-12', 'es', 'Pacific/Kiritimati')).toBe('12 OCT')
    // La zona horaria de la temporada decide el día de un instante.
    expect(shortDate('2026-10-12T23:30:00.000Z', 'es', 'Europe/Madrid')).toBe('13 OCT')
  })
})

describe('banco', () => {
  it('préstamos e intereses agrupados, con su signo', () => {
    const [interest, loan] = BANK.history.map(e => bankRow(e, es, 'UTC'))
    expect(interest).toEqual({
      date: '12 OCT',
      label: 'INTERESES · 1 TIRADAS',
      amount: '+30',
      debtAfter: '330',
    })
    expect(loan?.label).toBe('PRÉSTAMO')
    expect(bankRow(BANK.history[1]!, en, 'UTC').label).toBe('LOAN')
  })

  it('días en números rojos desde el primer préstamo del historial', () => {
    const now = Date.parse('2026-10-12T12:00:00Z')
    expect(daysInDebt(BANK, now)).toBe(2)
    expect(daysInDebt({ ...BANK, debt: 0 }, now)).toBe(0)
    expect(daysInDebt({ ...BANK, history: [] }, now)).toBe(0)
  })
})

describe('con qué se juegan las pendientes', () => {
  const red = { selection: { kind: 'red' as const }, amount: 50 }
  const straight = { selection: { kind: 'straight' as const, numbers: [17] }, amount: 100 }

  it('el boleto si hay fichas; si no, la última apuesta si llega el saldo', () => {
    expect(pendingPlay({ bets: [red], total: 50 }, [straight], 0)).toEqual({
      source: 'slip',
      bets: [red],
      cost: 50,
    })
    expect(pendingPlay({ bets: [], total: 0 }, [red, straight], 500)).toEqual({
      source: 'repeat',
      bets: [red, straight],
      cost: 150,
    })
    expect(pendingPlay({ bets: [], total: 0 }, [red, straight], 100).source).toBe('none')
    expect(pendingPlay({ bets: [], total: 0 }, null, 100).source).toBe('default')
    expect(pendingPlay({ bets: [], total: 0 }, [], 100).source).toBe('default')
  })
})

describe('gráfica del patrimonio', () => {
  const box = { x: 16, y: 48, w: 280, h: 70 }

  it('escala con un mínimo de ±500 y siempre deja ver el cero', () => {
    const flat = chartGeometry(
      {
        series: [{ spin: 0, netWorth: 100 }],
        peakNetWorth: 100,
        lowestNetWorth: 100,
        loanMarks: [],
      },
      box,
      500,
    )
    expect(flat.lo).toBe(-500)
    expect(flat.hi).toBe(500)
    // El cero en el centro del área y el único punto en la columna 0.
    expect(flat.zeroY).toBe(box.y + Math.round(0.5 * (box.h - 1)))
    expect(flat.points[0]).toMatchObject({ x: box.x, spin: 0 })
  })

  it('se abre para el máximo y el mínimo reales y reparte las tiradas en el ancho', () => {
    const g = chartGeometry(STATS, box, 500)
    expect(g.hi).toBe(700)
    expect(g.lo).toBe(-500)
    const ys = g.points.map(p => p.y)
    // El máximo arriba del todo y el último punto (tirada 4) en la última columna.
    expect(Math.min(...ys)).toBe(box.y)
    expect(g.points.at(-1)?.x).toBe(box.x + box.w - 1)
    // La tirada 2 cae a la mitad del ancho.
    expect(g.points[2]?.x).toBe(box.x + Math.round(0.5 * (box.w - 1)))
    // Préstamo tras la tirada 2: ▼ en esa columna.
    expect(g.loans).toEqual([g.points[2]!.x])
    // Valores por debajo del cero, por debajo de su fila.
    expect(g.points[3]!.y).toBeGreaterThan(g.zeroY)
    // Serie desordenada: se ordena por tirada; las marcas fuera de la serie no se pintan.
    const shuffled = chartGeometry(
      { ...STATS, series: [...STATS.series].reverse(), loanMarks: [2, 99] },
      box,
      500,
    )
    expect(shuffled.points.map(p => p.spin)).toEqual([0, 1, 2, 4])
    expect(shuffled.loans).toHaveLength(1)
  })

  it('la línea va en escalón: en cada columna vale el último punto a su izquierda', () => {
    const g = chartGeometry(STATS, box, 500)
    expect(stepYAt(g.points, box.x - 1)).toBeNull()
    expect(stepYAt(g.points, box.x)).toBe(g.points[0]!.y)
    expect(stepYAt(g.points, g.points[2]!.x + 3)).toBe(g.points[2]!.y)
    expect(stepYAt(g.points, 999)).toBe(g.points[3]!.y)
  })

  it('la línea se dibuja con outCubic y se queda en 1', () => {
    expect(outCubic(0)).toBe(0)
    expect(outCubic(0.5)).toBeCloseTo(0.875)
    expect(outCubic(2)).toBe(1)
    expect(outCubic(-1)).toBe(0)
  })
})

describe('cálculos de las páginas', () => {
  it('pila de pendientes: una ficha cada 2, de 1 a 10', () => {
    expect(stackChips(0)).toBe(1)
    expect(stackChips(3)).toBe(2)
    expect(stackChips(20)).toBe(10)
    expect(stackChips(100)).toBe(10)
  })

  it('logros: el desplazamiento justo para ver la fila elegida', () => {
    expect(scrollFor(0, 3, 6, 17)).toBe(0)
    expect(scrollFor(8, 0, 6, 17)).toBe(3)
    expect(scrollFor(4, 2, 6, 17)).toBe(2)
    expect(scrollFor(16, 0, 6, 17)).toBe(11)
    expect(scrollFor(2, 0, 6, 3)).toBe(0)
  })

  it('libro: columnas que ya han pasado página', () => {
    expect(turnedColumns(0, 160, 38)).toBe(0)
    expect(turnedColumns(80, 160, 38)).toBe(19)
    expect(turnedColumns(500, 160, 38)).toBe(38)
    expect(turnedColumns(10, 0, 38)).toBe(38)
  })

  it('créditos: quietos al entrar, suben y vuelven a entrar por abajo; ↑↓ a mano', () => {
    const viewH = VIEW.bottom - VIEW.top
    expect(creditsOffset(1, 20, 400, 0, false)).toBe(0)
    expect(creditsOffset(3, 20, 400, 0, false)).toBe(20)
    // Al acabar, entran desde abajo (desplazamiento negativo = por debajo del borde).
    expect(creditsOffset(2 + (400 + viewH) / 20, 20, 400, 0, false)).toBe(0)
    expect(creditsOffset(2 + 400 / 20 + 1, 20, 400, 0, false)).toBe(-viewH + 20)
    expect(creditsOffset(100, 20, 400, -11, true)).toBe(-11)
  })
})

describe('iconos', () => {
  it('giro, vaivén y bob: quietos en 3/4 con movimiento reducido', () => {
    expect(spinAngle(0, 2400, false)).toBe(REST_YAW)
    expect(spinAngle(1.2, 2400, false)).toBeCloseTo(REST_YAW + Math.PI)
    expect(spinAngle(1.2, 2400, true)).toBe(REST_YAW)
    expect(swingAngle(1.2, 4800, 0.5, false)).toBeCloseTo(REST_YAW + 0.5)
    expect(swingAngle(1.2, 4800, 0.5, true)).toBe(REST_YAW)
    expect(bobOffset(0.5, 2000, 1.5, false)).toBe(2)
    expect(bobOffset(0.5, 2000, 1.5, true)).toBe(0)
  })
})

describe('plantilla', () => {
  it('las esquinas respiran a saltos y se quedan quietas con movimiento reducido', () => {
    const gaps = [0, 0.25, 0.5, 0.75, 1].map(t => cornerGap(t, 250, false))
    expect(gaps).toEqual([2, 3, 4, 3, 2])
    expect(cornerGap(0.5, 250, true)).toBe(2)
  })

  it('la trama de palos se desliza y se repite', () => {
    expect(patternOffset(0, 8)).toEqual({ x: 0, y: 0 })
    expect(patternOffset(1, 8)).toEqual({ x: 8, y: 8 })
    expect(patternOffset(3, 8)).toEqual({ x: 0, y: 24 })
  })

  it('degradados de rótulo: 4 bandas sobre la altura de las mayúsculas', () => {
    expect(bandRows(1)).toEqual([0, 2, 4, 5])
    expect(bandRows(4)).toEqual([0, 7, 14, 21])
  })

  it('ayuda inferior y textos recortados', () => {
    expect(helpWidth([])).toBe(0)
    expect(helpWidth([{ key: 'X', label: 'A' }])).toBeGreaterThan(0)
    expect(fit('CORTO', 200)).toBe('CORTO')
    expect(fit('UN TEXTO BASTANTE LARGO', 40).endsWith('…')).toBe(true)
  })

  it('número en casilla: tinta sobre el verde, crema sobre rojo y negro', () => {
    expect(pocketText('green')).toBe(PALETTE.ink)
    expect(pocketText('red')).toBe(PALETTE.cream)
    expect(windowColorAt(10, 100, 10)).toBe(PALETTE.menuTop)
    expect(windowColorAt(10, 100, 500)).toBe(PALETTE.menuBottom)
  })
})
