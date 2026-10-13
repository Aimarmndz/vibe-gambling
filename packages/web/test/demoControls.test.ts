// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
// Mandos de la demo en la mesa: A (L1) pasa de AUTO a PAUSA, G (SELECT) gira una tirada ya, las dos
// filas se pueden pulsar con el ratón o el dedo, y sus textos caben en los cuatro idiomas.
import { LOCALES } from '@vibe-gambling/shared/i18n'
import type { Locale } from '@vibe-gambling/shared'
import { describe, expect, it, vi } from 'vitest'

import { keyToAction } from '../src/app/input.ts'
import type * as Bitmap from '../src/font/bitmap.ts'
import {
  DEMO_PANEL,
  demoPanelRowWidths,
  demoSpinReady,
  drawDemoPanel,
} from '../src/ui/demoPanel.ts'
import { TableScreen } from '../src/ui/screens/table.ts'
import { fakeCanvas2d, fakeContext, setState } from './menuFixtures.ts'

/** Textos pintados en el último fotograma (sin canvas de verdad). */
const painted: { text: string; color: string }[] = []

vi.mock('../src/font/bitmap.ts', async importOriginal => {
  const real = await importOriginal<typeof Bitmap>()
  return {
    ...real,
    drawText: (
      _g: unknown,
      text: string,
      _x: number,
      _y: number,
      style: { scale?: number; color: string },
    ) => {
      painted.push({ text, color: style.color })
      return real.measure(text, style.scale ?? 1)
    },
  }
})

describe('teclas de la demo', () => {
  it('A es AUTO/PAUSA y G sigue siendo GIRAR (sin chocar con las demás)', () => {
    expect(keyToAction('a', false)).toEqual({ action: 'auto', fine: false })
    expect(keyToAction('A', true)).toEqual({ action: 'auto', fine: true })
    expect(keyToAction('g', false)?.action).toBe('spin')
    // Las de siempre no cambian.
    for (const [key, action] of [
      ['x', 'accept'],
      ['o', 'back'],
      ['c', 'clear'],
      ['z', 'chip'],
      ['p', 'start'],
      ['m', 'mute'],
    ] as const) {
      expect(keyToAction(key, false)?.action).toBe(action)
    }
  })
})

describe('panel AUTO/PAUSA y GIRAR', () => {
  it('solo en la demo: fuera de ella no se pinta ni registra zonas', () => {
    const ctx = fakeContext({ demo: false })
    setState(ctx, { wallet: { ...ctx.state().wallet!, pendingSpins: 0 } })
    const table = new TableScreen(ctx, { pick: () => null })
    painted.length = 0
    table.draw(fakeCanvas2d(), 1)
    expect(ctx.hits.at(DEMO_PANEL.x + 10, 4 + 29 + 3 + 6)).toBeNull()
    expect(painted.map(p => p.text)).not.toContain(ctx.tr.t('demo.spin'))
  })

  it('las dos filas se pulsan: la primera cambia de modo, la segunda gira', () => {
    const ctx = fakeContext({ demo: true })
    setState(ctx, { phase: 'idle', wallet: { ...ctx.state().wallet!, pendingSpins: 0 } })
    setState(ctx, { shown: ctx.state().wallet })
    const table = new TableScreen(ctx, { pick: () => null })
    painted.length = 0
    table.draw(fakeCanvas2d(), 1)
    const top = 4 + 29 + 3
    const auto = ctx.hits.at(DEMO_PANEL.x + 10, top + 6)
    const spin = ctx.hits.at(DEMO_PANEL.x + 10, top + 6 + DEMO_PANEL.row)
    expect(auto?.id).toBe('demo:auto')
    expect(spin?.id).toBe('demo:spin')
    // AUTO se lee en el panel (en verde) y, tras pulsar, PAUSA (en oro).
    expect(painted.some(p => p.text.endsWith(ctx.tr.t('demo.auto')))).toBe(true)
    auto!.onClick()
    expect(ctx.demoAutoOn).toBe(false)
    painted.length = 0
    table.draw(fakeCanvas2d(), 1)
    expect(painted.map(p => p.text)).toContain(ctx.tr.t('demo.paused'))
    spin!.onClick()
    expect(ctx.demoSpins).toBe(1)
  })

  it('con tiradas pendientes, el panel baja bajo la fila de PENDIENTES', () => {
    const ctx = fakeContext({ demo: true })
    const table = new TableScreen(ctx, { pick: () => null })
    table.draw(fakeCanvas2d(), 1)
    expect(ctx.hits.at(DEMO_PANEL.x + 10, 4 + 40 + 3 + 6)?.id).toBe('demo:auto')
  })

  it('G en la mesa de la demo sin pendientes gira ya; con pendientes, gasta una', () => {
    const ctx = fakeContext({ demo: true })
    const table = new TableScreen(ctx, { pick: () => null })
    setState(ctx, { wallet: { ...ctx.state().wallet!, pendingSpins: 0 } })
    table.action({ action: 'spin', fine: false })
    expect(ctx.demoSpins).toBe(1)
    expect(ctx.spinOne).not.toHaveBeenCalled()
    setState(ctx, { wallet: { ...ctx.state().wallet!, pendingSpins: 2 } })
    table.action({ action: 'spin', fine: false })
    expect(ctx.spinOne).toHaveBeenCalledTimes(1)
    expect(ctx.demoSpins).toBe(1)
  })

  it('GIRAR solo está listo sin bola en juego', () => {
    const ctx = fakeContext({ demo: true })
    setState(ctx, { phase: 'idle' })
    expect(demoSpinReady(ctx)).toBe(true)
    setState(ctx, { phase: 'result' })
    expect(demoSpinReady(ctx)).toBe(true)
    for (const phase of ['spinning', 'landing'] as const) {
      setState(ctx, { phase })
      expect(demoSpinReady(ctx), phase).toBe(false)
    }
  })

  it.each(LOCALES.map(l => [l]))('%s: los textos caben en el panel (teclado y mando)', l => {
    const ctx = fakeContext({ demo: true, locale: l as Locale })
    for (const pad of [false, true]) {
      if (pad) {
        ctx.buttons = () => ({
          x: '✕',
          o: '○',
          tri: '△',
          sq: '□',
          start: 'START',
          sel: 'SELECT',
          auto: 'L1',
        })
      }
      for (const width of demoPanelRowWidths(ctx)) {
        // Márgenes de 6 px a cada lado y 4 px entre la tecla y su texto.
        expect(width, `${l}${pad ? ' (mando)' : ''}`).toBeLessThanOrEqual(DEMO_PANEL.w - 12)
      }
      // Pintar en los dos modos no falla.
      drawDemoPanel(fakeCanvas2d(), ctx, 40, true)
      drawDemoPanel(fakeCanvas2d(), ctx, 40, false)
    }
  })
})
