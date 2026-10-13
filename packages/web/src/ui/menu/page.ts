// SPDX-License-Identifier: AGPL-3.0-or-later
// Contrato entre el menú v2 (`MenuScreen`, que pone fondo, cabecera, ayuda, barrido y sonidos) y
// cada una de sus pantallas (las páginas).
import type { AppContext } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import type { IconKind, IconSink } from '../../render/menuIcons/layer.ts'
import type { HelpItem } from './kit.ts'

export interface MenuHost {
  readonly ctx: AppContext
  /** Iconos 3D (los que quedan bajo el barrido no se pintan). */
  readonly icons: IconSink
  /** Movimiento reducido: sin giros, sin bob, sin barridos, cursor quieto. */
  readonly still: boolean
  /** Abre una página encima de la actual (con barrido y sonido de abrir). */
  open(page: MenuPage): void
  /** Vuelve a la página anterior; desde la primera, cierra el menú. */
  back(): void
  /** Cierra el menú entero (vuelve a la mesa). */
  close(): void
  /** Separación actual de las esquinas del cursor (respiración). */
  cornerGap(t: number): number
}

export interface MenuPage {
  /** Identificador estable (lo usan los tests E2E). */
  readonly id: string
  /** Icono 3D de la cabecera. */
  readonly icon: IconKind
  title(): string
  /** Dato de contexto a la derecha de la cabecera. */
  headerRight?(): string | undefined
  /** Ayuda inferior. */
  help(): HelpItem[]
  draw(g: CanvasRenderingContext2D, t: number): void
  /** Devuelve true si la ha usado; si no, ○ y START vuelven atrás. */
  action(e: ActionEvent): boolean
  pointer?(kind: 'move' | 'down' | 'leave', x: number, y: number): boolean
  wheel?(delta: number): void
  update?(dt: number, t: number): void
  /** Al quedar a la vista (también al volver a ella). */
  enter?(t: number): void
  /** Texto para la región `aria-live` al entrar. */
  describe?(): string
}
