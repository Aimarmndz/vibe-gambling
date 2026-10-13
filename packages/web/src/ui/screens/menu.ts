// SPDX-License-Identifier: AGPL-3.0-or-later
// El menú v2 (START): una sola pantalla opaca que pone la plantilla común (fondo de palos,
// cabecera con su icono 3D, ayuda inferior), lleva la pila de páginas y hace el barrido de bloques
// entre ellas con sus sonidos (docs/DISENO-V2.md, "Menús"). Cada página está en `ui/menu/pages/`.
import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import type { IconKind, IconOptions, IconSink } from '../../render/menuIcons/layer.ts'
import { HEADER_ICON, cornerGap, drawHeader, drawHelp, drawMenuBackground } from '../menu/kit.ts'
import type { MenuHost, MenuPage } from '../menu/page.ts'
import { MainMenuPage } from '../menu/pages/main.ts'
import { PendingPage } from '../menu/pages/pending.ts'
import { drawWipe, pointCovered, wipeFrame } from '../menu/wipe.ts'
import type { WipeFrame } from '../menu/wipe.ts'

interface Wipe {
  start: number
  /** Qué hacer al quedar la pantalla tapada (cambiar de página o cerrar el menú). */
  swap: () => void
  swapped: boolean
}

export type MenuStart = 'main' | 'pending'

export class MenuScreen implements Screen, MenuHost {
  readonly opaque = true
  readonly ctx: AppContext
  readonly still: boolean
  readonly icons: IconSink
  private readonly pages: MenuPage[] = []
  private wipe: Wipe | null = null
  private frame: WipeFrame = { phase: 'done', frontier: 0 }
  private time = 0
  private closed = false

  constructor(ctx: AppContext, start: MenuStart = 'main') {
    this.ctx = ctx
    this.still = ctx.reducedMotion
    const sink = ctx.menuIcons()
    // Los iconos van por encima de la interfaz: los que quedan bajo el barrido no se pintan.
    this.icons = {
      icon: (kind: IconKind, x: number, y: number, size: number, opts?: IconOptions) => {
        if (pointCovered(this.frame, x, y)) return
        sink.icon(kind, x, y, size, opts)
      },
    }
    const first: MenuPage = start === 'pending' ? new PendingPage(this) : new MainMenuPage(this)
    this.pages.push(first)
    this.ctx.sfx.play('menuOpen')
    first.enter?.(0)
    this.describe(first)
  }

  /** El id de la página de arriba (los tests E2E lo leen en `__vg.screens()`). */
  get id(): string {
    return this.page().id
  }

  private page(): MenuPage {
    return this.pages[this.pages.length - 1]!
  }

  cornerGap(t: number): number {
    return cornerGap(t, this.ctx.client.menu.cursorBreatheMs, this.still)
  }

  private describe(page: MenuPage): void {
    const text = page.describe?.() ?? page.title()
    this.ctx.announce(text)
  }

  /** Cambia de página con barrido (o al momento con movimiento reducido). */
  private transition(swap: () => void): void {
    this.finishCover()
    if (this.still || this.ctx.client.menu.wipeMs <= 0) {
      swap()
      return
    }
    this.wipe = { start: this.time, swap, swapped: false }
  }

  /**
   * Si la pantalla aún se está tapando, el cambio se hace ya y el barrido sigue destapando: una
   * pulsación durante el barrido es para la página nueva, nunca se pierde.
   */
  private finishCover(): void {
    const wipe = this.wipe
    if (!wipe || wipe.swapped) return
    wipe.swapped = true
    wipe.start = this.time - this.ctx.client.menu.wipeMs / 2000
    this.frame = wipeFrame(this.ctx.client.menu.wipeMs / 2, this.ctx.client.menu.wipeMs)
    this.ctx.hits.clear()
    wipe.swap()
  }

  open(page: MenuPage): void {
    this.ctx.sfx.play('menuOpen')
    this.transition(() => {
      this.pages.push(page)
      page.enter?.(this.time)
      this.describe(page)
    })
  }

  back(): void {
    this.ctx.sfx.play('back')
    if (this.pages.length <= 1) {
      this.close()
      return
    }
    this.transition(() => {
      this.pages.pop()
      const page = this.page()
      page.enter?.(this.time)
      this.describe(page)
    })
  }

  close(): void {
    this.finishCover()
    if (this.closed) return
    this.closed = true
    this.ctx.pop(this)
  }

  action(e: ActionEvent): void {
    // Mientras se tapa la pantalla, la pulsación es ya para la página que llega.
    this.finishCover()
    if (this.page().action(e)) return
    if (e.action === 'back' || e.action === 'start') this.back()
  }

  pointer(kind: 'move' | 'down' | 'leave', x: number, y: number): boolean {
    if (kind === 'down') this.finishCover()
    return this.page().pointer?.(kind, x, y) ?? true
  }

  wheel(delta: number): void {
    this.page().wheel?.(delta)
  }

  update(dt: number, t: number): void {
    this.time = t
    const wipe = this.wipe
    if (wipe) {
      const elapsed = (t - wipe.start) * 1000
      this.frame = wipeFrame(elapsed, this.ctx.client.menu.wipeMs)
      if (!wipe.swapped && this.frame.phase !== 'cover') {
        wipe.swapped = true
        // Las zonas clicables eran de la página que se va.
        this.ctx.hits.clear()
        wipe.swap()
      }
      if (this.frame.phase === 'done') this.wipe = null
    }
    this.page().update?.(dt, t)
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { menu } = this.ctx.client
    const page = this.page()
    drawMenuBackground(g, t, menu.patternPxPerS, this.still)
    page.draw(g, t)
    drawHeader(g, page.title(), page.headerRight?.())
    this.icons.icon(page.icon, HEADER_ICON.x, HEADER_ICON.y, HEADER_ICON.size)
    drawHelp(g, page.help())
    if (this.wipe) drawWipe(g, this.frame)
  }

  /** Avisos encima de la ayuda, sin tapar la cabecera. */
  toastBand(): { top: number; bottom: number } {
    return { top: 24, bottom: 218 }
  }
}
