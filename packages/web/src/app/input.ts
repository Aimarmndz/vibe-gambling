// SPDX-License-Identifier: AGPL-3.0-or-later
// Entrada como un mando: flechas + ✕ (aceptar) / ○ (atrás) / △ (retirar) / □ (ficha) / START /
// SELECT (girar una tirada pendiente) / L1 (solo en la demo: AUTO ↔ PAUSA).
// Funciona con teclado, con un gamepad de verdad (API Gamepad, mapeo estándar) y con el ratón.

export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'accept'
  | 'back'
  | 'clear'
  | 'chip'
  | 'start'
  | 'mute'
  /** GIRAR: gasta una tirada pendiente (en la demo sin pendientes, lanza una tirada ya). */
  | 'spin'
  /** Solo en la demo: AUTO (gira sola) ↔ PAUSA. */
  | 'auto'

export interface ActionEvent {
  action: Action
  /** Movimiento fino (Mayús o gatillo): media casilla. */
  fine: boolean
  /** Ficha elegida directamente con las teclas 1–9. */
  chipIndex?: number
}

const KEYS: Readonly<Record<string, Action>> = Object.freeze({
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  x: 'accept',
  ' ': 'accept',
  Enter: 'accept',
  o: 'back',
  Escape: 'back',
  Backspace: 'back',
  c: 'clear',
  Delete: 'clear',
  z: 'chip',
  p: 'start',
  m: 'mute',
  g: 'spin',
  a: 'auto',
})

/** Traduce una tecla a una acción del mando (o null si no es nuestra). */
export function keyToAction(key: string, shift: boolean): ActionEvent | null {
  if (/^[1-9]$/.test(key)) return { action: 'chip', fine: false, chipIndex: Number(key) - 1 }
  const action = KEYS[key] ?? KEYS[key.toLowerCase()]
  return action ? { action, fine: shift } : null
}

/** Botones del mapeo estándar de la API Gamepad. */
const PAD_BUTTONS: readonly [number, Action][] = [
  [0, 'accept'],
  [1, 'back'],
  [2, 'chip'],
  [3, 'clear'],
  [4, 'auto'],
  [8, 'spin'],
  [9, 'start'],
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
]

export interface InputHandlers {
  action(event: ActionEvent): void
  /** Ratón en coordenadas de la pantalla virtual (320×240); `down` = clic principal. */
  pointer(kind: 'move' | 'down' | 'leave', x: number, y: number): void
  /** Rueda del ratón: cambia de ficha. */
  wheel(delta: number): void
  /** Primer gesto del usuario (para desbloquear el audio). */
  gesture(): void
}

export class Input {
  /** Si el último control usado fue un gamepad (para enseñar ✕ ○ △ □ en vez de teclas). */
  usingPad = false
  private padPrev: boolean[] = []
  private stickHeld: Action | null = null
  private stickRepeatAt = 0
  private readonly handlers: InputHandlers
  private readonly toVirtual: (clientX: number, clientY: number) => [number, number] | null

  constructor(
    target: HTMLElement,
    handlers: InputHandlers,
    toVirtual: (clientX: number, clientY: number) => [number, number] | null,
  ) {
    this.handlers = handlers
    this.toVirtual = toVirtual
    window.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const ev = keyToAction(e.key, e.shiftKey)
      handlers.gesture()
      if (!ev) return
      e.preventDefault()
      this.usingPad = false
      handlers.action(ev)
    })
    target.addEventListener('pointermove', e => {
      const v = this.toVirtual(e.clientX, e.clientY)
      handlers.pointer(v ? 'move' : 'leave', v?.[0] ?? -1, v?.[1] ?? -1)
    })
    target.addEventListener('pointerleave', () => handlers.pointer('leave', -1, -1))
    target.addEventListener('pointerdown', e => {
      handlers.gesture()
      if (e.button === 2) {
        handlers.action({ action: 'back', fine: false })
        return
      }
      if (e.button !== 0) return
      const v = this.toVirtual(e.clientX, e.clientY)
      if (v) handlers.pointer('down', v[0], v[1])
    })
    target.addEventListener('contextmenu', e => e.preventDefault())
    target.addEventListener(
      'wheel',
      e => {
        e.preventDefault()
        handlers.wheel(Math.sign(e.deltaY))
      },
      { passive: false },
    )
  }

  /** Lee los gamepads (se llama una vez por frame). */
  pollGamepads(now: number): void {
    const pads = navigator.getGamepads?.() ?? []
    const pad = pads.find(p => p !== null && p.connected)
    if (!pad) return
    const fine = (pad.buttons[6]?.pressed ?? false) || (pad.buttons[7]?.pressed ?? false)
    PAD_BUTTONS.forEach(([index, action]) => {
      const pressed = pad.buttons[index]?.pressed ?? false
      if (pressed && !this.padPrev[index]) {
        this.usingPad = true
        this.handlers.gesture()
        this.handlers.action({ action, fine })
      }
      this.padPrev[index] = pressed
    })
    // Stick izquierdo con autorepetición.
    const [ax = 0, ay = 0] = pad.axes
    const dir: Action | null =
      Math.abs(ax) > 0.6
        ? ax > 0
          ? 'right'
          : 'left'
        : Math.abs(ay) > 0.6
          ? ay > 0
            ? 'down'
            : 'up'
          : null
    if (dir && (dir !== this.stickHeld || now >= this.stickRepeatAt)) {
      this.usingPad = true
      this.handlers.action({ action: dir, fine })
      this.stickRepeatAt = now + (dir === this.stickHeld ? 120 : 380)
    }
    this.stickHeld = dir
  }
}
