// SPDX-License-Identifier: AGPL-3.0-or-later
// Rayos del premio gordo: cuñas alternas de dos colores alrededor de un centro, píxel a píxel (sin
// el antialias de los trazados del canvas, que dejaría bordes a medio tono antes del dithering).
// El ángulo de cada píxel se calcula una vez; cada fotograma solo se decide la cuña.
import { PSX_HEIGHT, PSX_WIDTH } from '../pipeline.ts'

export interface RayStyle {
  /** Número de cuñas (par: alternan los dos colores). */
  count: number
  colors: readonly [string, string]
  /** Opacidad 0–1. */
  alpha: number
}

function rgba(hex: string, alpha: number): number {
  const n = parseInt(hex.slice(1), 16)
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  // ImageData en little-endian: ABGR en un Uint32.
  return ((a << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0
}

export class Rays {
  private readonly cx: number
  private readonly cy: number
  private angles: Float32Array | null = null
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private image: ImageData | null = null

  constructor(cx: number, cy: number) {
    this.cx = cx
    this.cy = cy
  }

  private prepare(): boolean {
    if (this.ctx) return true
    const c = document.createElement('canvas')
    c.width = PSX_WIDTH
    c.height = PSX_HEIGHT
    const g = c.getContext('2d')
    if (!g) return false
    this.canvas = c
    this.ctx = g
    this.image = g.createImageData(PSX_WIDTH, PSX_HEIGHT)
    const angles = new Float32Array(PSX_WIDTH * PSX_HEIGHT)
    for (let y = 0; y < PSX_HEIGHT; y++) {
      for (let x = 0; x < PSX_WIDTH; x++) {
        // 0–1 = una vuelta, empezando a las 12 en sentido horario.
        const a = Math.atan2(x + 0.5 - this.cx, this.cy - (y + 0.5)) / (Math.PI * 2)
        angles[y * PSX_WIDTH + x] = a < 0 ? a + 1 : a
      }
    }
    this.angles = angles
    return true
  }

  /** Pinta los rayos girados `degrees` grados sobre `g`. */
  draw(g: CanvasRenderingContext2D, style: RayStyle, degrees: number): void {
    if (!this.prepare()) return
    const angles = this.angles!
    const image = this.image!
    const px = new Uint32Array(image.data.buffer)
    const a = rgba(style.colors[0], style.alpha)
    const b = rgba(style.colors[1], style.alpha)
    const turn = degrees / 360
    const n = Math.max(2, style.count)
    for (let i = 0; i < px.length; i++) {
      let k = angles[i]! - turn
      k -= Math.floor(k)
      px[i] = Math.floor(k * n) % 2 === 0 ? a : b
    }
    this.ctx!.putImageData(image, 0, 0)
    g.drawImage(this.canvas!, 0, 0)
  }
}

/** Relleno de pantalla completa de un color con opacidad (flash, tintes). */
export function fillScreen(g: CanvasRenderingContext2D, color: string, alpha: number): void {
  if (alpha <= 0) return
  g.save()
  g.globalAlpha = Math.min(1, alpha)
  g.fillStyle = color
  g.fillRect(0, 0, PSX_WIDTH, PSX_HEIGHT)
  g.restore()
}
