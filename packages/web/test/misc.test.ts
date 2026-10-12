// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest'

import { measure, wrap, hasGlyph } from '../src/font/bitmap.ts'
import { chipLabel, describePayout, describeSelection } from '../src/game/describe.ts'
import { translator } from './translators.ts'

describe('nombres de apuestas y fichas', () => {
  const es = translator('es')
  const en = translator('en')
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

describe('recordatorios por navegador', () => {
  it('arranque visto y "cómo se juega" leído; si el almacenamiento falla, se vuelve a enseñar', async () => {
    const { bootSeen, markBootSeen, markTipSeen, tipSeen } =
      await import('../src/app/onboarding.ts')
    const data = new Map<string, string>()
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    }
    expect(tipSeen(storage)).toBe(false)
    markTipSeen(storage)
    expect(tipSeen(storage)).toBe(true)
    expect(bootSeen(storage)).toBe(false)
    markBootSeen(storage)
    expect(bootSeen(storage)).toBe(true)
    expect(tipSeen(null)).toBe(false)
    const broken = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('lleno')
      },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(tipSeen(broken)).toBe(false)
    expect(() => markTipSeen(broken)).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
