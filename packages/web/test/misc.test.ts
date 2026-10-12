// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import { measure, wrap, hasGlyph } from '../src/font/bitmap.ts'
import { chipLabel, describePayout, describeSelection } from '../src/game/describe.ts'
import { createTranslator } from '../src/i18n/index.ts'

describe('nombres de apuestas y fichas', () => {
  const es = createTranslator('es')
  const en = createTranslator('en')
  it('describe cada tipo de apuesta con su pago', () => {
    expect(describeSelection({ kind: 'straight', numbers: [17] }, es)).toBe('PLENO 17')
    expect(describeSelection({ kind: 'corner', numbers: [16, 17, 19, 20] }, en)).toBe(
      'CORNER 16-17-19-20',
    )
    expect(describeSelection({ kind: 'dozen', index: 2 }, es)).toBe('DOCENA 2')
    expect(describeSelection({ kind: 'black' }, en)).toBe('BLACK')
    expect(describePayout({ kind: 'split', numbers: [1, 2] }, es)).toBe('PAGA 17 A 1')
  })

  it('acorta las fichas grandes', () => {
    expect(chipLabel(10)).toBe('10')
    expect(chipLabel(1000)).toBe('1K')
    expect(chipLabel(2500)).toBe('2.5K')
    expect(chipLabel(1_000_000)).toBe('1M')
  })
})

describe('fuente bitmap', () => {
  it('mide en píxeles enteros y escala', () => {
    expect(measure('')).toBe(0)
    expect(measure('A')).toBe(5)
    expect(measure('AB')).toBe(11)
    expect(measure('AB', 3)).toBe(33)
    // Los emojis no tienen glifo: no ocupan.
    expect(measure('A🚀')).toBe(5)
    expect(hasGlyph('ñ')).toBe(true)
    expect(hasGlyph('🚀')).toBe(false)
  })

  it('parte en líneas que caben y respeta los saltos', () => {
    const lines = wrap('uno dos tres cuatro cinco seis', 60)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(60)
    expect(wrap('a\nb', 100)).toEqual(['a', 'b'])
    expect(wrap('supercalifragilisticoespialidoso', 10)).toEqual([
      'supercalifragilisticoespialidoso',
    ])
  })
})
