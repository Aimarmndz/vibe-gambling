// SPDX-License-Identifier: AGPL-3.0-or-later
// Lo que comparten todas las pantallas de la ventana: traducción, configuración, estado, envío
// de mensajes, sonido, preferencias y la pila de pantallas.
import type { LeaderboardBoard, LeaderboardResponse, WebConfig } from '@vibe-gambling/shared'

import type { Sfx } from '../audio/sfx.ts'
import type { WebClientConfig } from '../config.ts'
import type { SpinAllStatus } from '../game/spinAll.ts'
import type { GameState } from '../game/state.ts'
import type { Translator } from '../i18n/index.ts'
import type { LinkStatus, Outgoing } from '../net/link.ts'
import type { Hits } from '../ui/draw.ts'
import type { ActionEvent } from './input.ts'
import type { Prefs } from './prefs.ts'

export interface Screen {
  /** Identificador estable (los nombres de clase se minifican en la build). */
  readonly id: string
  /** Si tapa del todo lo que hay debajo (no hace falta pintar las pantallas inferiores). */
  readonly opaque?: boolean
  /** Si deja ver el cursor del tapete. */
  readonly showsTable?: boolean
  draw(ctx: CanvasRenderingContext2D, t: number): void
  action(event: ActionEvent): void
  /** Ratón sobre la pantalla virtual. Devuelve true si lo ha usado. */
  pointer?(kind: 'move' | 'down' | 'leave', x: number, y: number): boolean
  wheel?(delta: number): void
  update?(dt: number, t: number): void
  /**
   * Franja vertical (píxeles de 320×240) donde pueden salir los avisos sin tapar nada importante.
   * Sin ella, encima de la barra inferior de la mesa.
   */
  toastBand?(): { top: number; bottom: number }
}

export interface ButtonLabels {
  x: string
  o: string
  tri: string
  sq: string
  start: string
  /** SELECT: GIRAR una tirada pendiente. */
  sel: string
}

export type ToastKind = 'info' | 'error' | 'save' | 'money'

export interface AppContext {
  readonly web: WebConfig
  readonly client: WebClientConfig
  readonly demo: boolean
  readonly reducedMotion: boolean
  readonly hits: Hits
  readonly sfx: Sfx
  tr: Translator
  prefs: Prefs
  setPrefs(patch: Partial<Prefs>): void
  state(): GameState
  send(msg: Outgoing): boolean
  push(screen: Screen): void
  pop(screen?: Screen): void
  toast(text: string, kind?: ToastKind): void
  buttons(): ButtonLabels
  /** Id de la zona clicable bajo el ratón (para resaltarla). */
  hoverId(): string | null
  openLink(url: string): void
  /** Ficha mínima de la mesa. */
  minChip(): number
  /** ¿Se puede pedir ahora el préstamo? */
  loanAvailable(): boolean
  /** Estado de la conexión con el servidor. */
  connection(): LinkStatus
  /** Enseña "cómo se juega" (el giro lo lanza un prompt en Claude Code). */
  showTip(): void
  /** Abre el diálogo del préstamo. */
  offerLoan(): void
  /** Ranking de la temporada (del servidor, o uno de mentira en el modo demo). */
  leaderboard(board: LeaderboardBoard, limit: number): Promise<LeaderboardResponse>
  /** Puesto propio en el ranking de arruinados (null si no se sabe). */
  brokeRank(): Promise<number | null>
  /** GIRAR: gasta una tirada pendiente con el giro normal. Devuelve si se ha pedido. */
  spinPending(): boolean
  /** GIRAR TODAS: empieza el bucle de tiradas rápidas. Devuelve si ha empezado. */
  spinAllPending(): boolean
  /** Estado del bucle de GIRAR TODAS. */
  spinAll(): SpinAllStatus
  /** Abre la pantalla de tiradas pendientes. */
  showPending(): void
}
