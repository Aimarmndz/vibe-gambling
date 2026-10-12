// SPDX-License-Identifier: AGPL-3.0-or-later
// Pantallas de aviso a pantalla completa: sin sesión ("no hay memory card"), enlace caducado,
// sesión terminada o error de configuración.
import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, wrap } from '../../font/bitmap.ts'
import { dim, drawMemoryCardIcon, drawWindow } from '../draw.ts'
import { PALETTE } from '../palette.ts'

export interface MessageOptions {
  title: string
  lines: string[]
  /** Pie opcional con una acción (por ejemplo, ir a la portada). */
  footer?: string
  onAccept?: () => void
  card?: boolean
}

export class MessageScreen implements Screen {
  readonly id = 'message'
  readonly opaque = true
  private readonly ctx: AppContext
  private readonly opts: MessageOptions

  constructor(ctx: AppContext, opts: MessageOptions) {
    this.ctx = ctx
    this.opts = opts
  }

  action(e: ActionEvent): void {
    if (e.action === 'accept' && this.opts.onAccept) this.opts.onAccept()
  }

  pointer(kind: 'move' | 'down' | 'leave'): boolean {
    if (kind === 'down' && this.opts.onAccept) this.opts.onAccept()
    return true
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    dim(g, 0.7)
    drawWindow(g, 20, 40, 280, 160, { top: '#1b2368', bottom: PALETTE.ink })
    let y = 54
    if (this.opts.card) {
      drawMemoryCardIcon(g, 154, 50, Math.floor(t * 2) % 2 === 0)
      y = 74
    }
    for (const line of wrap(this.opts.title, 260, 2)) {
      drawText(g, line, 160, y, {
        color: PALETTE.gold,
        scale: 2,
        align: 'center',
        shadow: PALETTE.ink,
      })
      y += 20
    }
    y += 4
    for (const text of this.opts.lines) {
      for (const line of wrap(text, 260)) {
        drawText(g, line, 160, y, { color: PALETTE.cream, align: 'center', shadow: PALETTE.ink })
        y += 11
      }
      y += 3
    }
    if (this.opts.footer) {
      drawText(g, this.opts.footer, 160, 186, { color: PALETTE.muted, align: 'center' })
    }
  }
}
