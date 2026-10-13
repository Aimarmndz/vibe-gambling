// SPDX-License-Identifier: AGPL-3.0-or-later
// Fuego "doom fire" para ON FIRE: una rejilla de intensidades que nace en la fila de abajo y se
// propaga hacia arriba enfriándose al azar. Paleta de 5 tonos (docs/DISENO-V2.md, "ON FIRE"); se
// avanza a los fotogramas por segundo de los sprites (`fx.onFire.spriteFps`), no a los del juego.
import { PALETTE } from '../../ui/palette.ts'

/** Tonos de frío a caliente (el 0 es transparente). */
export const FIRE_PALETTE: readonly string[] = Object.freeze([
  PALETTE.carpet,
  PALETTE.red,
  PALETTE.fire1,
  PALETTE.fire2,
  PALETTE.goldHi,
])

const COLORS = FIRE_PALETTE.length
/** Probabilidad de que una celda se enfríe un nivel al subir una fila. */
const DECAY = 0.6

export class DoomFire {
  readonly w: number
  readonly h: number
  /** Intensidad máxima: la justa para que la llama llegue a lo alto de la rejilla. */
  readonly max: number
  private readonly cells: Uint8Array
  private readonly random: () => number
  private lit = true

  /** `random` inyectable para que las pruebas sean deterministas. */
  constructor(w: number, h: number, random: () => number = Math.random) {
    this.w = Math.max(1, Math.round(w))
    this.h = Math.max(2, Math.round(h))
    this.cells = new Uint8Array(this.w * this.h)
    this.max = Math.max(COLORS, Math.round(this.h * DECAY))
    this.random = random
    this.ignite()
  }

  /** Enciende la fila de abajo al máximo. */
  ignite(): void {
    this.lit = true
    this.cells.fill(this.max, (this.h - 1) * this.w)
  }

  /** Apaga la fuente: el fuego se consume solo en unos pasos. */
  extinguish(): void {
    this.lit = false
    this.cells.fill(0, (this.h - 1) * this.w)
  }

  /** Intensidad (0 = nada, `max` = máximo) de una celda. */
  at(x: number, y: number): number {
    return this.cells[y * this.w + x] ?? 0
  }

  /** Un paso de propagación. */
  step(): void {
    const { w, h, cells } = this
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w; x++) {
        const below = cells[(y + 1) * w + x]!
        if (below === 0) {
          cells[y * w + x] = 0
          continue
        }
        const r = this.random()
        const decay = r < DECAY ? 1 : 0
        // El viento: la llama se desplaza 0 o 1 columna a un lado.
        const dst = Math.min(w - 1, Math.max(0, x - Math.floor(r * 3) + 1))
        cells[y * w + dst] = Math.max(0, below - decay)
      }
    }
    if (!this.lit) cells.fill(0, (h - 1) * w)
  }

  /** ¿Queda algo encendido? */
  alive(): boolean {
    return this.cells.some(v => v > 0)
  }

  /** Tono (1–5) de una intensidad, o 0 si está apagada. */
  private tone(v: number): number {
    return v <= 0 ? 0 : Math.min(COLORS, Math.floor(((v - 1) * COLORS) / this.max) + 1)
  }

  /** Pinta la rejilla con su esquina superior izquierda en (x, y), un píxel por celda. */
  draw(g: CanvasRenderingContext2D, x: number, y: number): void {
    for (let j = 0; j < this.h; j++) {
      // Por tramos del mismo tono: pocas llamadas a fillRect.
      let run = 0
      let start = 0
      for (let i = 0; i <= this.w; i++) {
        const tone = i < this.w ? this.tone(this.cells[j * this.w + i]!) : -1
        if (tone === run) continue
        if (run > 0) {
          g.fillStyle = FIRE_PALETTE[run - 1]!
          g.fillRect(x + start, y + j, i - start, 1)
        }
        run = tone
        start = i
      }
    }
  }
}
