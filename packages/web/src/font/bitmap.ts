// SPDX-License-Identifier: AGPL-3.0-or-later
// Texto con la fuente bitmap Polygone 12 sobre un canvas 2D, píxel a píxel y en múltiplos enteros.
// Los mapas de bits salen de polygone12.json (generado por scripts/build_font.py).
import atlas from './polygone12.json'

interface GlyphData {
  w: number
  y: number
  r: string[]
}

const GLYPHS = atlas.glyphs as Record<string, GlyphData>

/** Filas de la rejilla de la fuente y fila de la parte de arriba de las mayúsculas. */
export const FONT_ROWS = atlas.rows
export const CAP_TOP = 3
/** Altura de las mayúsculas (en píxeles, escala 1). */
export const CAP_HEIGHT = 7
/** Interlineado recomendado (escala 1). */
export const LINE_HEIGHT = 11

/** ¿Tiene glifo este carácter? Los que no (emojis, por ejemplo) no se pintan. */
export function hasGlyph(ch: string): boolean {
  return ch in GLYPHS
}

/**
 * Quita lo que la fuente no sabe pintar (emojis de las frases compartidas con el mod, que en la
 * terminal sí se ven) y los espacios que dejan colgando: "Recuperando lo perdido 📈" no puede
 * acabar en "Recuperando lo perdido ".
 */
export function printable(text: string): string {
  let out = ''
  for (const ch of text) out += ch === '\n' || hasGlyph(ch) ? ch : ' '
  return out
    .split('\n')
    .map(line => line.replace(/ {2,}/g, ' ').trim())
    .join('\n')
}

function glyphsOf(text: string): GlyphData[] {
  const out: GlyphData[] = []
  for (const ch of text) {
    const g = GLYPHS[ch]
    if (g) out.push(g)
  }
  return out
}

/**
 * Columnas con tinta de un glifo: dónde empieza (`left`) y cuánto ocupa (`width`). Sirve para
 * apretar rótulos sin que los glifos con aire a los lados (el "1") desperdicien sitio.
 */
export function inkBounds(ch: string): { left: number; width: number } {
  const g = GLYPHS[ch]
  if (!g) return { left: 0, width: 0 }
  let left = g.w
  let right = -1
  for (const row of g.r) {
    const first = row.indexOf('#')
    if (first >= 0) left = Math.min(left, first)
    right = Math.max(right, row.lastIndexOf('#'))
  }
  return right < 0 ? { left: 0, width: g.w } : { left, width: right - left + 1 }
}

/** Ancho en píxeles de un texto (sin el espacio final del último glifo). */
export function measure(text: string, scale = 1): number {
  const glyphs = glyphsOf(text)
  if (glyphs.length === 0) return 0
  const w = glyphs.reduce((acc, g) => acc + g.w + 1, 0) - 1
  return w * scale
}

/** Parte un texto en líneas que caben en `maxWidth` píxeles (respeta los saltos de línea). */
export function wrap(text: string, maxWidth: number, scale = 1): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate, scale) <= maxWidth || !line) {
        line = candidate
      } else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

export type Align = 'left' | 'center' | 'right'

export interface TextStyle {
  color: string
  scale?: number
  align?: Align
  /** Color de la sombra (1 píxel abajo a la derecha, como en los menús de la época). */
  shadow?: string
}

/** Atlas de glifos teñidos: uno por color, construido la primera vez que se usa. */
class GlyphAtlas {
  private readonly offsets = new Map<string, number>()
  private readonly mask: HTMLCanvasElement
  private readonly tinted = new Map<string, HTMLCanvasElement>()

  constructor() {
    const entries = Object.entries(GLYPHS)
    const width = entries.reduce((acc, [, g]) => acc + g.w + 1, 0)
    this.mask = document.createElement('canvas')
    this.mask.width = width
    this.mask.height = FONT_ROWS
    const ctx = this.mask.getContext('2d')
    if (!ctx) throw new Error('canvas 2D no disponible')
    const img = ctx.createImageData(width, FONT_ROWS)
    let x = 0
    for (const [ch, g] of entries) {
      this.offsets.set(ch, x)
      g.r.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          if (row[i] !== '#') continue
          const k = ((g.y + j) * width + x + i) * 4
          img.data[k] = img.data[k + 1] = img.data[k + 2] = img.data[k + 3] = 255
        }
      })
      x += g.w + 1
    }
    ctx.putImageData(img, 0, 0)
  }

  offset(ch: string): number | undefined {
    return this.offsets.get(ch)
  }

  sheet(color: string): HTMLCanvasElement {
    let sheet = this.tinted.get(color)
    if (!sheet) {
      sheet = document.createElement('canvas')
      sheet.width = this.mask.width
      sheet.height = this.mask.height
      const ctx = sheet.getContext('2d')
      if (!ctx) throw new Error('canvas 2D no disponible')
      ctx.drawImage(this.mask, 0, 0)
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = color
      ctx.fillRect(0, 0, sheet.width, sheet.height)
      this.tinted.set(color, sheet)
    }
    return sheet
  }
}

let shared: GlyphAtlas | null = null
function glyphAtlas(): GlyphAtlas {
  shared ??= new GlyphAtlas()
  return shared
}

/**
 * Pinta un texto. `x` es el borde según la alineación e `y` la parte de arriba de las mayúsculas.
 * Devuelve el ancho pintado.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
): number {
  const scale = style.scale ?? 1
  const width = measure(text, scale)
  const align = style.align ?? 'left'
  const cx = Math.round(align === 'center' ? x - width / 2 : align === 'right' ? x - width : x)
  const top = Math.round(y - CAP_TOP * scale)
  if (style.shadow) {
    drawRun(ctx, text, cx + scale, top + scale, style.shadow, scale)
  }
  drawRun(ctx, text, cx, top, style.color, scale)
  return width
}

function drawRun(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  color: string,
  scale: number,
): void {
  const a = glyphAtlas()
  const sheet = a.sheet(color)
  let cx = x
  for (const ch of text) {
    const g = GLYPHS[ch]
    const sx = a.offset(ch)
    if (!g || sx === undefined) continue
    ctx.drawImage(sheet, sx, 0, g.w, FONT_ROWS, cx, top, g.w * scale, FONT_ROWS * scale)
    cx += (g.w + 1) * scale
  }
}
