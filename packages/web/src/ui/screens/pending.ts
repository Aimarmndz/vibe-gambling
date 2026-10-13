// SPDX-License-Identifier: AGPL-3.0-or-later
// Aviso al abrir la ventana con tiradas pendientes (una vez por apertura, `hud-open-notice.png`):
// pila 3D, "TIENES / 20 TIRADAS / PENDIENTES"; ✕ va a la pantalla de tiradas pendientes del menú
// y ○ lo deja para luego. La pantalla de tiradas pendientes está en `ui/menu/pages/pending.ts`.
import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, measure } from '../../font/bitmap.ts'
import { pendingSpins } from '../../game/state.ts'
import { spinAngle } from '../../render/menuIcons/layer.ts'
import { dim, drawWindow } from '../draw.ts'
import { GRADIENTS, drawGradientText } from '../menu/kit.ts'
import { stackChips } from '../menu/pages/pending.ts'
import { PALETTE } from '../palette.ts'

export class PendingNoticeScreen implements Screen {
  readonly id = 'pendingNotice'
  private readonly ctx: AppContext

  constructor(ctx: AppContext) {
    this.ctx = ctx
  }

  action(e: ActionEvent): void {
    if (e.action === 'accept' || e.action === 'spin') {
      this.ctx.pop(this)
      this.ctx.showPending()
      return
    }
    if (e.action === 'back' || e.action === 'start') {
      this.ctx.sfx.play('back')
      this.ctx.pop(this)
    }
  }

  pointer(kind: 'move' | 'down' | 'leave'): boolean {
    if (kind === 'down') this.action({ action: 'accept', fine: false })
    return true
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const count = pendingSpins(this.ctx.state())
    const b = this.ctx.buttons()
    dim(g, 0.55)
    drawWindow(g, 40, 70, 240, 92)
    this.ctx.menuIcons().icon('stack', 76, 109, 15, {
      count: stackChips(count),
      yaw: spinAngle(t, this.ctx.client.menu.iconSpinMs * 2, this.ctx.reducedMotion),
      tilt: 0.3,
    })
    drawText(g, tr.t('pending.noticeLine1'), 100, 82, { color: PALETTE.cream, shadow: PALETTE.ink })
    drawGradientText(
      g,
      tr.plural('pending.noticeLine2', count, { n: tr.n(count) }),
      100,
      95,
      GRADIENTS.gold,
      {
        scale: 2,
        shadow: PALETTE.ink,
      },
    )
    drawGradientText(g, tr.plural('pending.noticeLine3', count), 100, 114, GRADIENTS.gold, {
      scale: 2,
      shadow: PALETTE.ink,
    })
    drawText(g, tr.t('pending.noticeSub'), 160, 138, {
      color: PALETTE.cream,
      align: 'center',
      shadow: PALETTE.ink,
    })
    // ✕ IR A TIRADAS · ○ LUEGO: símbolos en oro, etiquetas en crema.
    const go = tr.t('pending.noticeGo')
    const later = tr.t('pending.noticeLater')
    const parts: [string, string][] = [
      [b.x, go],
      [b.o, later],
    ]
    let width = 0
    parts.forEach(([key, label], i) => {
      width += (i > 0 ? 20 : 0) + measureLabel(key, label)
    })
    let x = Math.round(160 - width / 2)
    parts.forEach(([key, label], i) => {
      if (i > 0) x += 20
      x += drawText(g, key, x, 150, { color: PALETTE.gold, shadow: PALETTE.ink }) + 4
      x += drawText(g, label, x, 150, { color: PALETTE.gold, shadow: PALETTE.ink })
    })
  }
}

function measureLabel(key: string, label: string): number {
  return measure(key) + 4 + measure(label)
}
