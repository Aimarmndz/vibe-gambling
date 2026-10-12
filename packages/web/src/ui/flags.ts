// SPDX-License-Identifier: AGPL-3.0-or-later
// Banderas de los idiomas (pixel art de `locales/<idioma>/flag.json`): en el framebuffer del
// juego y, para la landing y /privacy, en un <canvas> diminuto que el CSS escala sin suavizar.
import type { Flag } from '@vibe-gambling/shared/i18n'

/** Pinta la bandera con su esquina superior izquierda en (x, y), a escala entera. */
export function drawFlag(
  g: CanvasRenderingContext2D,
  flag: Flag,
  x: number,
  y: number,
  scale = 1,
): void {
  flag.pixels.forEach((row, j) => {
    // Tramos seguidos del mismo color en un solo rectángulo.
    let start = 0
    for (let i = 1; i <= row.length; i++) {
      if (i < row.length && row[i] === row[start]) continue
      g.fillStyle = flag.palette[row[start]!]!
      g.fillRect(x + start * scale, y + j * scale, (i - start) * scale, scale)
      start = i
    }
  })
}

/** <canvas> con la bandera a tamaño real (el CSS la escala con `image-rendering: pixelated`). */
export function flagCanvas(doc: Document, flag: Flag): HTMLCanvasElement {
  const canvas = doc.createElement('canvas')
  canvas.width = flag.width
  canvas.height = flag.height
  canvas.className = 'flag'
  canvas.setAttribute('aria-hidden', 'true')
  const g = canvas.getContext('2d')
  if (g) drawFlag(g, flag, 0, 0)
  return canvas
}
