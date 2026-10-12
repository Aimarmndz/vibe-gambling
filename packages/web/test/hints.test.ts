// SPDX-License-Identifier: AGPL-3.0-or-later
// La mesa explica que el giro lo lanza un prompt de Claude Code (no hay botón de girar), el rótulo
// de estado se lee en las dos fases del parpadeo y los textos caben en sus ventanas.
import { describe, expect, it } from 'vitest'

import { measure, printable } from '../src/font/bitmap.ts'
import { betReadyHint, idleStatusKey, spinHelpOnRepeat, tableHelpKey } from '../src/game/hints.ts'
import { CATALOGS } from './translators.ts'
import { PALETTE, contrastRatio, mixHex } from '../src/ui/palette.ts'
import { STATUS_BOX, STATUS_LOOKS, statusColor } from '../src/ui/status.ts'

describe('cómo se gira', () => {
  it('sin ronda abierta, el rótulo pide un prompt en Claude Code (o avisa de la apuesta lista)', () => {
    expect(idleStatusKey(false, 0)).toBe('status.idle')
    expect(idleStatusKey(false, 50)).toBe('status.ready')
    expect(idleStatusKey(true, 0)).toBe('status.demo')
    expect(idleStatusKey(true, 10)).toBe('status.demoReady')
    expect(CATALOGS.en['status.idle']).toBe('SEND A PROMPT IN CLAUDE CODE TO SPIN')
    expect(CATALOGS.es['status.idle']).toBe('MANDA UN PROMPT EN CLAUDE CODE PARA GIRAR')
    for (const catalog of Object.values(CATALOGS)) {
      expect(catalog['status.ready']).toMatch(/PROMPT/)
      expect(catalog['help.spin']).toMatch(/CLAUDE CODE/)
      // "prompt" con mayúscula en alemán (es un sustantivo).
      expect(catalog['toast.betReady']).toMatch(/prompt/i)
      expect(catalog['toast.howToSpin']).toMatch(/Claude Code/)
      expect(catalog['tip.2']).toMatch(/Claude Code/)
    }
  })

  it('el aviso de apuesta lista sale solo con la primera ficha y sin ronda abierta', () => {
    expect(betReadyHint(0, 50, 'idle')).toBe(true)
    expect(betReadyHint(50, 100, 'idle')).toBe(false)
    expect(betReadyHint(0, 50, 'spinning')).toBe(false)
    expect(betReadyHint(50, 0, 'idle')).toBe(false)
  })

  it('✕ sobre una casilla que ya tiene fichas recuerda cómo se gira', () => {
    expect(spinHelpOnRepeat(true, 'idle')).toBe(true)
    expect(spinHelpOnRepeat(false, 'idle')).toBe(false)
    expect(spinHelpOnRepeat(true, 'spinning')).toBe(false)
  })

  it('la barra inferior alterna los controles con cómo se gira', () => {
    const cycle = 4000
    expect(tableHelpKey(0, cycle, false)).toBe('help.table')
    expect(tableHelpKey(cycle, cycle, false)).toBe('help.table')
    expect(tableHelpKey(2 * cycle, cycle, false)).toBe('help.spin')
    expect(tableHelpKey(2 * cycle, cycle, true)).toBe('help.spinDemo')
    expect(tableHelpKey(3 * cycle, cycle, false)).toBe('help.table')
    expect(tableHelpKey(2 * cycle, 0, false)).toBe('help.table')
  })
})

describe('legibilidad en la pantalla de 320×240', () => {
  it('el rótulo de estado tiene contraste ≥ 4,5:1 en las dos fases del parpadeo', () => {
    for (const [kind, look] of Object.entries(STATUS_LOOKS)) {
      // Fondo más claro bajo el texto: la primera fila de las mayúsculas en el degradado.
      const bg = mixHex(look.top, look.bottom, STATUS_BOX.textTop / STATUS_BOX.height)
      for (const t of [0, 0.5]) {
        const color = statusColor(look, t)
        expect(contrastRatio(color, bg), `${kind} @${t}`).toBeGreaterThanOrEqual(4.5)
      }
    }
    // La fase tenue antigua (color del bisel) no pasaba: así se ve que el test mide algo.
    const bg = mixHex(PALETTE.menuTop, PALETTE.menuBottom, STATUS_BOX.textTop / STATUS_BOX.height)
    expect(contrastRatio(PALETTE.frameInner, bg)).toBeLessThan(4.5)
  })

  it('los parpadeos cambian de color de verdad', () => {
    expect(statusColor(STATUS_LOOKS.thinking, 0)).not.toBe(statusColor(STATUS_LOOKS.thinking, 0.5))
    expect(statusColor(STATUS_LOOKS.idle, 0)).toBe(statusColor(STATUS_LOOKS.idle, 0.5))
  })

  it('los rótulos y ayudas de la mesa caben en la pantalla', () => {
    for (const catalog of Object.values(CATALOGS)) {
      for (const key of Object.keys(catalog) as (keyof typeof catalog)[]) {
        if (key.startsWith('status.')) {
          // Ventana del rótulo: texto + 16 px de márgenes, dentro de 320.
          expect(measure(catalog[key]) + 16, key).toBeLessThanOrEqual(316)
        }
      }
      for (const key of ['help.table', 'help.spin', 'help.spinDemo'] as const) {
        const text = catalog[key].replace(/\{\w+\}/g, 'X')
        expect(measure(text), key).toBeLessThanOrEqual(308)
      }
    }
  })

  it('las frases con emojis (compartidas con el mod) no dejan espacios colgando', () => {
    expect(printable('Recuperando lo perdido 📈')).toBe('Recuperando lo perdido')
    expect(printable('push to prod = bonus 🚀 ya')).toBe('push to prod = bonus ya')
    expect(printable('dos\nlíneas 📈')).toBe('dos\nlíneas')
  })
})
