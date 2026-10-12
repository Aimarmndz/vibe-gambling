// SPDX-License-Identifier: AGPL-3.0-or-later
// Menú de lista al estilo de la época: cursor ► dorado que parpadea, ↑↓ para moverse, ←→ para
// cambiar valores, ✕ para aceptar y ○ para volver. También responde al ratón.
import type { ActionEvent } from '../app/input.ts'
import type { AppContext } from '../app/context.ts'
import { drawText } from '../font/bitmap.ts'
import { PALETTE } from './palette.ts'

export interface MenuItem {
  label: () => string
  /** Valor a la derecha (ajustes). */
  value?: () => string
  accept?: () => void
  /** Cambiar el valor con ←→ (dir = −1 | 1). */
  change?: (dir: number) => void
  disabled?: () => boolean
  /**
   * Pinta el valor a mano en vez de `value` (p. ej. las banderas del idioma). Se llama después de
   * registrar la zona clicable de la fila, así que las suyas quedan por encima.
   */
  drawValue?: (
    g: CanvasRenderingContext2D,
    right: number,
    y: number,
    selected: boolean,
    t: number,
  ) => void
}

export class ListMenu {
  index = 0
  readonly items: MenuItem[]
  private readonly ctx: AppContext
  private readonly id: string

  constructor(ctx: AppContext, id: string, items: MenuItem[]) {
    this.ctx = ctx
    this.id = id
    this.items = items
  }

  private enabled(i: number): boolean {
    return !(this.items[i]?.disabled?.() ?? false)
  }

  private move(dir: number): void {
    const n = this.items.length
    for (let step = 1; step <= n; step++) {
      const next = (this.index + dir * step + n * 4) % n
      if (this.enabled(next)) {
        this.index = next
        this.ctx.sfx.play('move')
        return
      }
    }
  }

  /** Devuelve true si la acción era del menú. */
  action(e: ActionEvent): boolean {
    const item = this.items[this.index]
    switch (e.action) {
      case 'up':
        this.move(-1)
        return true
      case 'down':
        this.move(1)
        return true
      case 'left':
      case 'right':
        if (item?.change && this.enabled(this.index)) {
          item.change(e.action === 'left' ? -1 : 1)
          this.ctx.sfx.play('move')
          return true
        }
        return false
      case 'accept':
        if (!item || !this.enabled(this.index)) return true
        if (item.accept) {
          this.ctx.sfx.play('accept')
          item.accept()
        } else if (item.change) {
          item.change(1)
          this.ctx.sfx.play('move')
        }
        return true
      default:
        return false
    }
  }

  /** Pinta las filas desde (x, y) con `rowH` de alto y `w` de ancho (para el valor a la derecha). */
  draw(
    g: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    rowH: number,
    t: number,
  ): void {
    const hover = this.ctx.hoverId()
    this.items.forEach((item, i) => {
      const ry = y + i * rowH
      const selected = i === this.index
      const enabled = this.enabled(i)
      const color = !enabled ? PALETTE.line : selected ? PALETTE.gold : PALETTE.cream
      if (selected && Math.floor(t * 2.5) % 2 === 0) {
        drawText(g, '►', x, ry, { color: PALETTE.gold, shadow: PALETTE.ink })
      }
      drawText(g, item.label(), x + 10, ry, { color, shadow: PALETTE.ink })
      if (item.value) {
        const v = item.value()
        const text = item.change ? `◄ ${v} ►` : v
        drawText(g, text, x + w, ry, { color, align: 'right', shadow: PALETTE.ink })
      }
      const hitId = `${this.id}:${i}`
      this.ctx.hits.add({
        x: x - 2,
        y: ry - 3,
        w: w + 4,
        h: rowH,
        id: hitId,
        onClick: () => {
          this.index = i
          this.action({ action: 'accept', fine: false })
        },
      })
      if (hover === hitId && this.index !== i && enabled) this.index = i
      item.drawValue?.(g, x + w, ry, selected, t)
    })
  }
}
