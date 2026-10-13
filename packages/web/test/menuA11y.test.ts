// SPDX-License-Identifier: AGPL-3.0-or-later
// Accesibilidad del menú v2: contraste ≥ 4,5:1 del texto sobre los fondos donde de verdad cae
// (los degradados de las ventanas se miran en la fila del texto) y la marca de guardado.
import { describe, expect, it } from 'vitest'

import { brandMarks, parseMark } from '../src/ui/brandMark.ts'
import { SECONDARY, windowColorAt } from '../src/ui/menu/kit.ts'
import { PALETTE, contrastRatio } from '../src/ui/palette.ts'

const AA = 4.5

/** [qué, color del texto, fondo] tal como se pintan. */
const PAIRS: [string, string, string][] = [
  // Plantilla.
  ['título de cabecera (oro sobre la banda)', PALETTE.gold, PALETTE.menuTop],
  ['dato de cabecera (crema)', PALETTE.cream, PALETTE.menuTop],
  ['etiquetas de la ayuda (apagado sobre tinta)', PALETTE.muted, PALETTE.ink],
  ['símbolos de la ayuda (oro sobre tinta)', PALETTE.gold, PALETTE.ink],
  ['texto de un pozo (crema sobre tinta)', PALETTE.cream, PALETTE.ink],
  ['fila elegida (oro sobre la banda)', PALETTE.gold, PALETTE.menuTop],
  ['descripción de la fila elegida (crema sobre la banda)', PALETTE.cream, PALETTE.menuTop],
  ['texto secundario en lo alto de una ventana', SECONDARY, PALETTE.menuTop],
  // Menú principal: pista apagada en la parte baja de la ventana de información (150, 64).
  ['pista del menú', PALETTE.muted, windowColorAt(150, 64, 196)],
  ['"DE 100" del menú', PALETTE.muted, windowColorAt(150, 64, 186)],
  // Estadísticas: el pie de cada ficha (129, 48) en apagado.
  ['pie de las fichas de estadísticas', PALETTE.muted, windowColorAt(129, 48, 166)],
  // Tiradas pendientes: "+n MÁS" y las cifras de la ventana del contador (28, 120).
  ['"+n MÁS" de la cola', SECONDARY, windowColorAt(28, 120, 116)],
  // Listas sobre ventana `deepTop` (logros, ranking, ajustes, historial del banco).
  ['logro bloqueado (apagado)', PALETTE.muted, PALETTE.deepTop],
  ['cifras negativas en listas', PALETTE.loss, PALETTE.deepTop],
  ['cifras positivas en listas', PALETTE.win, PALETTE.deepTop],
  // Banco: patrimonio negativo en la ventana de deuda (28, 112, de alertTop a menuBottom).
  [
    'patrimonio negativo (banco)',
    PALETTE.loss,
    windowColorAt(28, 112, 91, PALETTE.alertTop, PALETTE.menuBottom),
  ],
  ['TAE (oro, banco)', PALETTE.gold, windowColorAt(28, 112, 102, PALETTE.alertTop)],
  ['días en números rojos', PALETTE.loss, windowColorAt(28, 112, 117)],
  // Casillas.
  ['número en rojo', PALETTE.cream, PALETTE.red],
  ['número en negro', PALETTE.cream, PALETTE.black],
  ['número en verde (tinta)', PALETTE.ink, PALETTE.green],
  // Libro de CÓMO SE JUEGA.
  ['texto del libro', PALETTE.ink, PALETTE.paperBottom],
  ['título y notas del libro', PALETTE.redLo, PALETTE.paperBottom],
  ['números de página', PALETTE.frameInner, PALETTE.paperTop],
  // Pestaña activa del ranking.
  ['pestaña activa', PALETTE.ink, PALETTE.gold],
  // Valor de la gráfica, sobre su caja de tinta.
  ['valor de la última tirada', PALETTE.loss, PALETTE.ink],
]

describe('contraste del menú v2', () => {
  it.each(PAIRS)('%s', (_what, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA)
  })

  it('el apagado no va en lo alto de una ventana azul (3,4:1): por eso existe SECONDARY', () => {
    expect(contrastRatio(PALETTE.muted, PALETTE.menuTop)).toBeLessThan(AA)
    expect(contrastRatio(PALETTE.loss, PALETTE.menuTop)).toBeLessThan(AA)
  })
})

describe('marca de guardado', () => {
  it('se lee de los SVG de docs/brand y conoce su "_" (el que parpadea)', () => {
    const { small, large } = brandMarks()
    expect(small.size).toBe(16)
    expect(large.size).toBe(32)
    for (const mark of [small, large]) {
      const cursor = mark.pixels.filter(p => p.cursor)
      expect(cursor.length).toBeGreaterThan(0)
      expect(cursor.every(p => p.color === PALETTE.gold)).toBe(true)
      expect(mark.pixels.every(p => p.x + p.w <= mark.size && p.y + p.h <= mark.size)).toBe(true)
    }
    expect(() => parseMark('<svg></svg>', 16)).toThrow()
  })
})
