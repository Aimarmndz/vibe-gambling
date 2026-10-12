// SPDX-License-Identifier: AGPL-3.0-or-later
// El tapete europeo dibujado en una textura con píxeles enteros por casilla. Regla de legibilidad:
// en la pantalla de 320×240 cada texel debe ocupar **al menos** un píxel (si no, el filtro nearest
// se salta filas o columnas de texels y los trazos de 1 px de los números desaparecen: el 3 parecía
// una J). Con el plano de la mesa (ver SHOTS.table en world.ts) la fila de números más lejana mide
// ~15,7×17 px, así que la casilla es de 15×15 texels. La malla del tapete tiene un vértice en cada
// esquina de casilla (feltGrid): el tembleque y la UV affine siguen ahí, pero cada casilla se
// estira entera y sus números no se parten entre triángulos lejanos.
import { colorOf, coveredNumbers } from '@vibe-gambling/shared'
import type { BetSelection } from '@vibe-gambling/shared'
import type { CanvasTexture } from 'three'

import { drawText } from '../font/bitmap.ts'
import type { Translator } from '../i18n/index.ts'
import { LAYOUT_BOUNDS, OUTSIDE_ORDER, numberAt } from '../game/layout.ts'
import { PALETTE, pocketHex } from '../ui/palette.ts'
import { makeCanvas, seeded, toTexture } from './textures.ts'

/** Texels por unidad de casilla (ancho y fondo). */
export const SX = 15
export const SY = 15
/** Margen de paño alrededor del tapete (texels). */
const MX = 11
const MY = 9
export const TEX_W = MX * 2 + (LAYOUT_BOUNDS.maxX - LAYOUT_BOUNDS.minX) * SX
export const TEX_H = MY * 2 + (LAYOUT_BOUNDS.maxY - LAYOUT_BOUNDS.minY) * SY

/** De unidades del tapete a píxeles de la textura. */
export function toTex(x: number, y: number): [number, number] {
  return [MX + (x - LAYOUT_BOUNDS.minX) * SX, MY + (y - LAYOUT_BOUNDS.minY) * SY]
}

/** Rectángulo del tapete (en unidades) que cubre la textura completa. */
export const TEX_BOUNDS = Object.freeze({
  minX: LAYOUT_BOUNDS.minX - MX / SX,
  maxX: LAYOUT_BOUNDS.maxX + MX / SX,
  minY: LAYOUT_BOUNDS.minY - MY / SY,
  maxY: LAYOUT_BOUNDS.maxY + MY / SY,
})

/** Rejilla de la malla del tapete: un vértice en cada borde de casilla y en los de la textura. */
export interface FeltGrid {
  /** Cortes en x y en y, en unidades del tapete (crecientes). */
  xs: number[]
  ys: number[]
  /** Coordenadas de textura de cada corte (u de izquierda a derecha, v de arriba abajo). */
  us: number[]
  vs: number[]
}

export function feltGrid(): FeltGrid {
  const xs = [TEX_BOUNDS.minX]
  for (let x = LAYOUT_BOUNDS.minX; x <= LAYOUT_BOUNDS.maxX; x++) xs.push(x)
  xs.push(TEX_BOUNDS.maxX)
  const ys = [TEX_BOUNDS.minY]
  for (let y = LAYOUT_BOUNDS.minY; y <= LAYOUT_BOUNDS.maxY; y++) ys.push(y)
  ys.push(TEX_BOUNDS.maxY)
  return {
    xs,
    ys,
    us: xs.map(x => toTex(x, 0)[0] / TEX_W),
    vs: ys.map(y => toTex(0, y)[1] / TEX_H),
  }
}

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
      // Centro entero: las mayúsculas (7 filas) quedan centradas sin medio texel de desfase.
      drawText(ctx, text, px, Math.floor(py) - 3, { color, align: 'center', shadow })
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
        drawText(ctx, '♦', px, Math.floor(py) - 7, {
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
