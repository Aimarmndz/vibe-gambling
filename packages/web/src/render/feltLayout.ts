// SPDX-License-Identifier: AGPL-3.0-or-later
// El tapete europeo dibujado en una textura de 232×118 con píxeles enteros por casilla, para que
// en pantalla (320×240) salga casi 1:1 con su texel. Se redibuja al cambiar el cursor o el idioma.
import { colorOf, coveredNumbers } from '@vibe-gambling/shared'
import type { BetSelection } from '@vibe-gambling/shared'
import type { CanvasTexture } from 'three'

import { drawText } from '../font/bitmap.ts'
import type { Translator } from '../i18n/index.ts'
import { OUTSIDE_ORDER, numberAt } from '../game/layout.ts'
import { PALETTE, pocketHex } from '../ui/palette.ts'
import { makeCanvas, seeded, toTexture } from './textures.ts'

export const TEX_W = 232
export const TEX_H = 118
/** Píxeles por unidad de casilla y margen de la textura. */
const SX = 15
const SY = 20
const MX = 11
const MY = 9

/** De unidades del tapete a píxeles de la textura. */
export function toTex(x: number, y: number): [number, number] {
  return [MX + (x + 1) * SX, MY + y * SY]
}

/** Rectángulo del tapete (en unidades) que cubre la textura completa. */
export const TEX_BOUNDS = Object.freeze({
  minX: -1 - MX / SX,
  maxX: -1 + (TEX_W - MX) / SX,
  minY: -MY / SY,
  maxY: (TEX_H - MY) / SY,
})

export interface FeltView {
  /** Selección bajo el cursor (se ilumina). */
  hover: BetSelection | null
  /** Número ganador de la última ronda (se marca). */
  winner: number | null
}

export class FeltLayout {
  readonly texture: CanvasTexture
  private readonly ctx: CanvasRenderingContext2D
  private readonly base: HTMLCanvasElement
  private key = ''

  constructor() {
    const [canvas, ctx] = makeCanvas(TEX_W, TEX_H)
    this.ctx = ctx
    this.texture = toTexture(canvas)
    // Fondo de paño con grano, que no cambia nunca.
    const [base, bctx] = makeCanvas(TEX_W, TEX_H)
    const rnd = seeded(5)
    for (let y = 0; y < TEX_H; y++) {
      for (let x = 0; x < TEX_W; x++) {
        bctx.fillStyle = rnd() < 0.18 ? PALETTE.feltDark : PALETTE.felt
        bctx.fillRect(x, y, 1, 1)
      }
    }
    this.base = base
  }

  /** Redibuja solo si algo cambió. */
  update(view: FeltView, tr: Translator): void {
    const key = `${tr.locale}|${JSON.stringify(view.hover)}|${view.winner}`
    if (key === this.key) return
    this.key = key
    this.draw(view, tr)
    this.texture.needsUpdate = true
  }

  private draw(view: FeltView, tr: Translator): void {
    const ctx = this.ctx
    ctx.drawImage(this.base, 0, 0)
    const lit = new Set(view.hover ? coveredNumbers(view.hover) : [])
    if (view.hover && 'numbers' in view.hover && view.hover.numbers.includes(0)) lit.add(0)

    const box = (x: number, y: number, w: number, h: number, fill: string | null) => {
      const [px, py] = toTex(x, y)
      if (fill) {
        ctx.fillStyle = fill
        ctx.fillRect(px, py, w * SX, h * SY)
      }
      ctx.fillStyle = PALETTE.chalk
      ctx.fillRect(px, py, w * SX + 1, 1)
      ctx.fillRect(px, py + h * SY, w * SX + 1, 1)
      ctx.fillRect(px, py, 1, h * SY + 1)
      ctx.fillRect(px + w * SX, py, 1, h * SY + 1)
    }
    const label = (text: string, x: number, y: number, color: string = PALETTE.cream) => {
      const [px, py] = toTex(x, y)
      const shadow = color === PALETTE.ink ? undefined : PALETTE.ink
      drawText(ctx, text, px, py - 3, { color, align: 'center', shadow })
    }
    // Las apuestas interiores (hasta 6 números) se rellenan de oro; las exteriores solo se enmarcan.
    const wide = lit.size > 6
    const goldIf = (on: boolean, fill: string) => (on ? PALETTE.gold : fill)
    const textIf = (on: boolean) => (on ? PALETTE.ink : PALETTE.cream)

    // Cero.
    box(-1, 0, 1, 3, goldIf(lit.has(0), PALETTE.green))
    label('0', -0.5, 1.5, textIf(lit.has(0)))
    // Números.
    for (let col = 0; col < 12; col++) {
      for (let row = 0; row < 3; row++) {
        const n = numberAt(col, row)
        const on = lit.has(n)
        if (on && wide) {
          // Apuesta de muchos números (rojo, docena…): se conserva el color y se enmarca en oro.
          box(col, row, 1, 1, pocketHex(colorOf(n)))
          const [px, py] = toTex(col, row)
          ctx.strokeStyle = PALETTE.gold
          ctx.lineWidth = 1
          ctx.strokeRect(px + 1.5, py + 1.5, SX - 2, SY - 2)
          label(String(n), col + 0.5, row + 0.5, PALETTE.gold)
        } else {
          box(col, row, 1, 1, goldIf(on, pocketHex(colorOf(n))))
          label(String(n), col + 0.5, row + 0.5, textIf(on))
        }
        if (view.winner === n) {
          const [px, py] = toTex(col, row)
          ctx.fillStyle = PALETTE.cream
          ctx.fillRect(px + 2, py + 2, 3, 3)
        }
      }
    }
    // Columnas.
    for (let row = 0; row < 3; row++) {
      const on = view.hover?.kind === 'column' && view.hover.index === 3 - row
      box(12, row, 1, 1, on ? PALETTE.gold : null)
      label(tr.t('felt.column'), 12.5, row + 0.5, textIf(on))
    }
    // Docenas.
    for (let i = 0; i < 3; i++) {
      const on = view.hover?.kind === 'dozen' && view.hover.index === i + 1
      box(4 * i, 3, 4, 1, on ? PALETTE.gold : null)
      const key = (['felt.dozen1', 'felt.dozen2', 'felt.dozen3'] as const)[i]!
      label(tr.t(key), 4 * i + 2, 3.5, textIf(on))
    }
    // Sencillas: rojo y negro van con rombos, como en las mesas de verdad.
    OUTSIDE_ORDER.forEach((kind, i) => {
      const on = view.hover?.kind === kind
      box(2 * i, 4, 2, 1, on ? PALETTE.gold : null)
      if (kind === 'red' || kind === 'black') {
        const [px, py] = toTex(2 * i + 1, 4.5)
        const color = on ? PALETTE.ink : kind === 'red' ? PALETTE.red : PALETTE.black
        drawText(ctx, '♦', px, py - 7, {
          color,
          scale: 2,
          align: 'center',
        })
        return
      }
      const key = (
        { low: 'felt.low', even: 'felt.even', odd: 'felt.odd', high: 'felt.high' } as const
      )[kind]
      label(tr.t(key), 2 * i + 1, 4.5, textIf(on))
    })
  }
}
