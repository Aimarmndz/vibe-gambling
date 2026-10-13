// SPDX-License-Identifier: AGPL-3.0-or-later
// Rótulos grandes de espectáculo con la fuente Polygone 12: degradado de 4 bandas horizontales a
// escalones sobre la altura de las mayúsculas, contorno de tinta y sombra dura
// (docs/DISENO-V2.md, "Paleta"). Siempre a escala entera. Se componen en un canvas aparte y se
// guardan en caché, porque un rótulo cambia de escala unas pocas veces y no cada fotograma.
import { CAP_HEIGHT, CAP_TOP, FONT_ROWS, drawText, measure } from '../../font/bitmap.ts'
import type { Align } from '../../font/bitmap.ts'
import { PALETTE } from '../../ui/palette.ts'

/** Cuatro colores, de arriba abajo. */
export type Bands = readonly [string, string, string, string]

export const GRADIENTS = Object.freeze({
  gold: ['#ffe08a', '#f2c14e', '#f2c14e', '#a8761e'] as Bands,
  fire: ['#ffe08a', '#ffd04a', '#ff7a1f', '#c1272d'] as Bands,
  green: ['#c8f7d8', '#6ee08a', '#17a05d', '#1d6b3a'] as Bands,
  red: ['#ff9aa4', '#ff5a6a', '#c1272d', '#5a0d12'] as Bands,
})

export interface FancyStyle {
  scale: number
  bands: Bands
  /** Grosor del contorno de tinta (0 = sin contorno). */
  outline?: number
  /** Color de la sombra dura (por defecto `jackpotBottom`); null = sin sombra. */
  shadow?: string | null
  /** Desplazamiento de la sombra; por defecto max(2, escala / 2). */
  shadowPx?: number
  align?: Align
  /**
   * Brillo diagonal de 6 px que cruza el rótulo: posición 0–1 de izquierda a derecha, o null.
   * Con brillo no se usa la caché (cambia cada fotograma).
   */
  sheen?: number | null
}

const cache = new Map<string, HTMLCanvasElement>()
const CACHE_MAX = 48

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  const c = document.createElement('canvas')
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  const g = c.getContext('2d')
  if (!g) return null
  g.imageSmoothingEnabled = false
  return [c, g]
}

/** Copia de `mask` teñida de un color (conserva el alfa). */
function tint(mask: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const made = canvas(mask.width, mask.height)
  if (!made) return mask
  const [c, g] = made
  g.drawImage(mask, 0, 0)
  g.globalCompositeOperation = 'source-in'
  g.fillStyle = color
  g.fillRect(0, 0, c.width, c.height)
  return c
}

function compose(text: string, style: FancyStyle): HTMLCanvasElement | null {
  const scale = style.scale
  const outline = style.outline ?? 1
  const shadowPx =
    style.shadow === null ? 0 : (style.shadowPx ?? Math.max(2, Math.floor(scale / 2)))
  const pad = outline + 1
  const w = measure(text, scale) + pad * 2 + shadowPx
  const h = FONT_ROWS * scale + pad * 2 + shadowPx
  const base = canvas(w, h)
  if (!base) return null
  const [maskCanvas, mask] = base
  // Máscara en blanco: el texto con la parte de arriba de las mayúsculas en `pad + CAP_TOP·escala`.
  drawText(mask, text, pad, pad + CAP_TOP * scale, { color: '#ffffff', scale })

  const out = canvas(w, h)
  if (!out) return null
  const [result, g] = out
  if (shadowPx > 0) {
    const shadow = tint(maskCanvas, style.shadow ?? PALETTE.jackpotBottom)
    // La sombra lleva también el contorno, para que no quede un hueco entre los dos.
    for (let dy = -outline; dy <= outline; dy++) {
      for (let dx = -outline; dx <= outline; dx++) g.drawImage(shadow, dx + shadowPx, dy + shadowPx)
    }
  }
  if (outline > 0) {
    const ink = tint(maskCanvas, PALETTE.ink)
    for (let dy = -outline; dy <= outline; dy++) {
      for (let dx = -outline; dx <= outline; dx++) if (dx || dy) g.drawImage(ink, dx, dy)
    }
  }
  // Degradado a escalones: 4 bandas sobre la altura de las mayúsculas; lo que sobresale (tildes,
  // descendentes) toma la banda más cercana.
  const fill = canvas(w, h)
  if (!fill) return null
  const [fillCanvas, fg] = fill
  const top = pad + CAP_TOP * scale
  const capH = CAP_HEIGHT * scale
  for (let i = 0; i < 4; i++) {
    const y0 = i === 0 ? 0 : top + Math.round((capH * i) / 4)
    const y1 = i === 3 ? h : top + Math.round((capH * (i + 1)) / 4)
    fg.fillStyle = style.bands[i]!
    fg.fillRect(0, y0, w, y1 - y0)
  }
  // Las bandas, recortadas a la forma de las letras.
  fg.globalCompositeOperation = 'destination-in'
  fg.drawImage(maskCanvas, 0, 0)
  g.drawImage(fillCanvas, 0, 0)
  return result
}

/** Brillo diagonal sobre las letras (no sobre el contorno). */
function withSheen(src: HTMLCanvasElement, text: string, style: FancyStyle, at: number) {
  const made = canvas(src.width, src.height)
  if (!made) return src
  const [c, g] = made
  g.drawImage(src, 0, 0)
  const outline = style.outline ?? 1
  const pad = outline + 1
  const stripe = canvas(src.width, src.height)
  if (!stripe) return src
  const [sc, sg] = stripe
  sg.fillStyle = PALETTE.goldHi
  // Franja de 6 px inclinada 45°, a escalones de píxel, recortada a las letras.
  const x0 = Math.round(at * (src.width + src.height)) - src.height
  for (let y = 0; y < src.height; y++) sg.fillRect(x0 + (src.height - y), y, 6, 1)
  // La máscara se compone aparte: cada glifo es un drawImage y en `destination-in` cada uno
  // borraría lo que queda fuera de su rectángulo.
  const mask = canvas(src.width, src.height)
  if (!mask) return src
  drawText(mask[1], text, pad, pad + CAP_TOP * style.scale, {
    color: '#ffffff',
    scale: style.scale,
  })
  sg.globalCompositeOperation = 'destination-in'
  sg.drawImage(mask[0], 0, 0)
  g.drawImage(sc, 0, 0)
  return c
}

export interface Drawn {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Pinta un rótulo. `x` según la alineación e `y` la parte de arriba de las mayúsculas, como
 * `drawText`. Devuelve la caja pintada (sin la sombra).
 */
export function drawFancyText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: FancyStyle,
): Drawn {
  const scale = style.scale
  const outline = style.outline ?? 1
  const pad = outline + 1
  const width = measure(text, scale)
  const align = style.align ?? 'left'
  const left = Math.round(align === 'center' ? x - width / 2 : align === 'right' ? x - width : x)
  const top = Math.round(y - CAP_TOP * scale)
  const key = `${text}|${scale}|${style.bands.join()}|${outline}|${style.shadow}|${style.shadowPx}`
  let img = cache.get(key) ?? null
  if (!img) {
    img = compose(text, style)
    if (!img) return { x: left, y: top, w: width, h: FONT_ROWS * scale }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
    cache.set(key, img)
  }
  const sheen = style.sheen
  const final = sheen !== undefined && sheen !== null ? withSheen(img, text, style, sheen) : img
  g.drawImage(final, left - pad, top - pad)
  return { x: left, y: top, w: width, h: FONT_ROWS * scale }
}

/** Ancho de un rótulo (sin contorno ni sombra). */
export function fancyWidth(text: string, scale: number): number {
  return measure(text, scale)
}

/**
 * Texto girado (sellos): se compone recto y se gira con vecino más cercano, así que los píxeles
 * siguen siendo píxeles (en escalera, como en la época).
 */
export function drawRotated(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  degrees: number,
  paint: (g: CanvasRenderingContext2D) => void,
): void {
  g.save()
  g.imageSmoothingEnabled = false
  g.translate(Math.round(cx), Math.round(cy))
  g.rotate((degrees * Math.PI) / 180)
  paint(g)
  g.restore()
}
