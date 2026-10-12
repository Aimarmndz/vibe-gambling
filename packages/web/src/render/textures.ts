// SPDX-License-Identifier: AGPL-3.0-or-later
// Texturas procedurales pequeñas (32–128 px), dibujadas en código: madera, metal, tapete, moqueta,
// fichas y números del cilindro. Sin mipmaps y con filtro nearest, como en la época.
import { CanvasTexture, NearestFilter, NoColorSpace, RepeatWrapping } from 'three'

import { colorOf } from '@vibe-gambling/shared'

import { drawText } from '../font/bitmap.ts'
import { PALETTE, pocketHex } from '../ui/palette.ts'

/** PRNG determinista (mulberry32): las texturas salen siempre iguales. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D no disponible')
  ctx.imageSmoothingEnabled = false
  return [canvas, ctx]
}

export function toTexture(canvas: HTMLCanvasElement, repeat = false): CanvasTexture {
  const tex = new CanvasTexture(canvas)
  tex.magFilter = NearestFilter
  tex.minFilter = NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = NoColorSpace
  if (repeat) tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)))
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`
}

/** Madera del borde de la mesa y del cuenco de la ruleta. */
export function woodTexture(): CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64)
  const rnd = seeded(7)
  for (let y = 0; y < 64; y++) {
    const band = Math.sin(y * 0.55 + Math.sin(y * 0.13) * 3) * 0.5 + 0.5
    for (let x = 0; x < 64; x++) {
      const f = 0.72 + band * 0.22 + (rnd() - 0.5) * 0.12
      ctx.fillStyle = shade(PALETTE.wood, f)
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return toTexture(c, true)
}

/** Latón del cono central y de los separadores. */
export function brassTexture(): CanvasTexture {
  const [c, ctx] = makeCanvas(32, 32)
  const rnd = seeded(11)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const f = 0.8 + Math.sin((x + y) * 0.4) * 0.12 + (rnd() - 0.5) * 0.1
      ctx.fillStyle = shade(PALETTE.gold, f)
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return toTexture(c, true)
}

/** Paño verde liso (se repite debajo de la ruleta). */
export function feltTexture(): CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64)
  const rnd = seeded(3)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      ctx.fillStyle = shade(PALETTE.felt, 0.9 + (rnd() - 0.5) * 0.16)
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return toTexture(c, true)
}

/** Moqueta de casino: rombos y puntos dorados sobre granate. */
export function carpetTexture(): CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64)
  ctx.fillStyle = PALETTE.carpet
  ctx.fillRect(0, 0, 64, 64)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = Math.abs((x % 32) - 16)
      const dy = Math.abs((y % 32) - 16)
      if (dx + dy === 12 || dx + dy === 13) {
        ctx.fillStyle = PALETTE.carpetLine
        ctx.fillRect(x, y, 1, 1)
      }
      if (dx + dy < 3) {
        ctx.fillStyle = PALETTE.goldDark
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }
  return toTexture(c, true)
}

/** Canto de una ficha: franjas blancas sobre el color (se tiñe con el color del material). */
export function chipEdgeTexture(): CanvasTexture {
  const [c, ctx] = makeCanvas(32, 8)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 32, 8)
  ctx.fillStyle = '#5a5a5a'
  for (let x = 0; x < 32; x += 8) ctx.fillRect(x, 0, 4, 8)
  return toTexture(c, true)
}

/** Cara de una ficha: aro exterior a franjas e interior liso. */
export function chipFaceTexture(): CanvasTexture {
  const [c, ctx] = makeCanvas(32, 32)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 15.5
      const dy = y - 15.5
      const r = Math.hypot(dx, dy)
      const a = Math.atan2(dy, dx)
      let v = 255
      if (r > 11 && Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8) % 2 === 0) v = 110
      if (r > 8 && r < 9.2) v = 200
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fillRect(x, y, 1, 1)
    }
  }
  return toTexture(c)
}

/**
 * Atlas de números del cilindro: celdas de 16×16, 8 por fila; el número `n` va en la celda `n`,
 * ya con el fondo de su color (rojo, negro o verde) y la cifra en crema.
 */
export function numberAtlasTexture(): CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128)
  ctx.fillStyle = PALETTE.ink
  ctx.fillRect(0, 0, 128, 128)
  for (let n = 0; n <= 36; n++) {
    const x = (n % 8) * 16
    const y = Math.floor(n / 8) * 16
    ctx.fillStyle = pocketHex(colorOf(n))
    ctx.fillRect(x, y, 16, 16)
    drawText(ctx, String(n), x + 8, y + 5, { color: PALETTE.cream, align: 'center' })
  }
  return toTexture(c)
}

export const NUMBER_ATLAS_CELLS = 8
