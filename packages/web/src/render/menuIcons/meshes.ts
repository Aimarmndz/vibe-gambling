// SPDX-License-Identifier: AGPL-3.0-or-later
// Las mallas de los iconos 3D del menú (docs/DISENO-V2.md, "Iconos 3D"), en código y a mano,
// dentro de una caja de ±1 unidad. Son geometría de forma, no configuración: cambiarlas es cambiar
// el dibujo.
import type { BufferGeometry, Color } from 'three'

import { CHIP_COLORS, PALETTE } from '../../ui/palette.ts'
import { MeshBuilder, paletteColor } from './builder.ts'
import type { Vec } from './builder.ts'

export const ICON_KINDS = [
  'chip',
  'stack',
  'bars',
  'trophy',
  'trophyLocked',
  'crown',
  'bank',
  'memoryCard',
  'gear',
  'book',
  'gem',
  'chipDim',
  'pyramid',
] as const
export type IconKind = (typeof ICON_KINDS)[number]

const C = (hex: string): Color => paletteColor(hex)
const shade = (hex: string, k: number): Color => paletteColor(hex).multiplyScalar(k)

/** Pseudoazar fijo (mulberry32): los desplazamientos de la pila siempre son los mismos. */
export function fixedRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface ChipColors {
  edge: Color
  insert: Color
  ring: Color
  center: Color
}

/**
 * Una ficha: cilindro de `sides` lados, radio r, alto h, apoyada en y0. Cara de arriba con centro,
 * aro y canto con inserciones cada `every` lados (también en la cara).
 */
function chip(
  b: MeshBuilder,
  r: number,
  h: number,
  y0: number,
  sides: number,
  every: number,
  colors: ChipColors,
  offset: readonly [number, number] = [0, 0],
): void {
  const [ox, oz] = offset
  const at = (rr: number, y: number, k: number): Vec => {
    const ang = (k / sides) * Math.PI * 2
    return [ox + Math.cos(ang) * rr, y, oz - Math.sin(ang) * rr]
  }
  const edgeOf = (k: number) => (k % every === 0 ? colors.insert : colors.edge)
  const y1 = y0 + h
  for (let k = 0; k < sides; k++) {
    b.quad(at(r, y0, k), at(r, y0, k + 1), at(r, y1, k + 1), at(r, y1, k), edgeOf(k))
    // Cara de arriba: canto exterior (con inserciones), aro oro y centro.
    b.quad(at(0.66 * r, y1, k), at(r, y1, k), at(r, y1, k + 1), at(0.66 * r, y1, k + 1), edgeOf(k))
    b.quad(
      at(0.56 * r, y1, k),
      at(0.66 * r, y1, k),
      at(0.66 * r, y1, k + 1),
      at(0.56 * r, y1, k + 1),
      colors.ring,
    )
    b.tri([ox, y1, oz], at(0.56 * r, y1, k), at(0.56 * r, y1, k + 1), colors.center)
    // Cara de abajo, lisa.
    b.tri([ox, y0, oz], at(r, y0, k + 1), at(r, y0, k), colors.edge)
  }
}

const RED_CHIP: () => ChipColors = () => ({
  edge: C(PALETTE.red),
  insert: C(PALETTE.cream),
  ring: C(PALETTE.gold),
  center: C(PALETTE.cream),
})

function chipMesh(dim: boolean): BufferGeometry {
  const b = new MeshBuilder()
  const colors = dim
    ? {
        edge: C(PALETTE.frameInner),
        insert: C(PALETTE.muted),
        ring: C(PALETTE.goldDark),
        center: C(PALETTE.creamLo),
      }
    : RED_CHIP()
  chip(b, 1, 0.2, -0.1, 24, 3, colors)
  return b.build()
}

/** Pila de `count` fichas de 16 lados, con colores rojo/azul/verde/negro/oro y desplazamientos fijos. */
export function stackMesh(count: number): BufferGeometry {
  const b = new MeshBuilder()
  const rnd = fixedRandom(7)
  const tones = [PALETTE.red, PALETTE.chipBlue, CHIP_COLORS[3]!, PALETTE.black, PALETTE.gold]
  const n = Math.max(1, Math.min(10, count))
  const pitch = 0.22
  const y0 = -(n * pitch) / 2
  for (let i = 0; i < n; i++) {
    const tone = tones[(i * 3) % tones.length]!
    const isTop = i === n - 1
    chip(
      b,
      0.95,
      0.2,
      y0 + i * pitch,
      16,
      4,
      {
        edge: C(isTop ? PALETTE.gold : tone),
        insert: C(PALETTE.cream),
        ring: C(isTop ? PALETTE.goldDark : PALETTE.gold),
        center: C(isTop ? PALETTE.cream : PALETTE.creamLo),
      },
      [(rnd() - 0.5) * 0.07, (rnd() - 0.5) * 0.07],
    )
  }
  return b.build()
}

function barsMesh(): BufferGeometry {
  const b = new MeshBuilder()
  b.box([0, -0.85, 0], [1.9, 0.14, 1], {
    side: shade(PALETTE.frameInner, 0.8),
    top: C(PALETTE.frameInner),
  })
  const bars: [number, number, string][] = [
    [-0.55, 0.7, PALETTE.loss],
    [0, 1.2, PALETTE.gold],
    [0.55, 1.75, PALETTE.win],
  ]
  for (const [x, h, hex] of bars) {
    b.box([x, -0.78 + h / 2, 0.05], [0.42, h, 0.42], C(hex))
  }
  return b.build()
}

function trophyMesh(locked: boolean): BufferGeometry {
  const b = new MeshBuilder()
  const metal = C(locked ? '#4a4e78' : PALETTE.gold)
  const dark = shade(locked ? '#4a4e78' : PALETTE.goldDark, 0.7)
  // Pie, tallo y cáliz (perfil de abajo arriba).
  const outer: [number, number][] = [
    [0.55, -1],
    [0.55, -0.88],
    [0.22, -0.78],
    [0.12, -0.55],
    [0.12, -0.25],
    [0.3, -0.12],
    [0.62, 0.15],
    [0.78, 0.55],
    [0.8, 0.9],
  ]
  b.lathe(outer, 10, () => metal, undefined, metal)
  // Interior oscurecido: un disco bajo el borde.
  b.disc(0.74, 0.86, 10, () => dark, 1)
  // Asas.
  b.box([-0.92, 0.42, 0], [0.18, 0.55, 0.18], metal)
  b.box([0.92, 0.42, 0], [0.18, 0.55, 0.18], metal)
  return b.build()
}

function crownMesh(): BufferGeometry {
  const b = new MeshBuilder()
  const gold = C(PALETTE.gold)
  const inner = shade(PALETTE.goldDark, 0.7)
  const r = 0.85
  const sides = 10
  // Desfase para que en el ángulo de reposo (3/4) una punta mire de frente a la cámara.
  const phase = -0.35
  const at = (rr: number, y: number, k: number): Vec => {
    const a = (k / sides) * Math.PI * 2 + phase
    return [Math.cos(a) * rr, y, -Math.sin(a) * rr]
  }
  const y0 = -0.75
  const y1 = y0 + 0.7
  for (let k = 0; k < sides; k++) {
    b.quad(at(r, y0, k), at(r, y0, k + 1), at(r, y1, k + 1), at(r, y1, k), gold)
  }
  // Por dentro (se ve al girar): mismo aro, caras hacia dentro.
  for (let k = 0; k < sides; k++) {
    b.quad(
      at(r * 0.98, y0, k + 1),
      at(r * 0.98, y0, k),
      at(r * 0.98, y1, k),
      at(r * 0.98, y1, k + 1),
      inner,
    )
  }
  for (let k = 0; k < sides; k++) b.tri([0, y0, 0], at(r, y0, k + 1), at(r, y0, k), inner)
  // Cinco puntas (triángulos con grosor) y una gema en la base de cada una.
  for (let p = 0; p < 5; p++) {
    // Puntas estrechas, con hueco entre ellas (se ve el borde del aro).
    const k = p * 2
    const a = at(r, y1, k + 0.35)
    const c = at(r, y1, k + 1.65)
    const tip = at(r * 0.92, y1 + 0.75, k + 1)
    b.tri(a, c, tip, gold)
    b.tri(c, a, tip, inner)
    const mid = at(r * 1.02, y0 + 0.35, k + 1)
    const gem = C(p % 2 === 0 ? PALETTE.red : PALETTE.chipBlue)
    b.box(mid, [0.18, 0.18, 0.18], gem)
  }
  return b.build()
}

function bankMesh(): BufferGeometry {
  const b = new MeshBuilder()
  const stone = C(PALETTE.cream)
  const stoneSide = C(PALETTE.creamLo)
  const base = C(PALETTE.frame)
  b.box([0, -0.9, 0], [1.9, 0.2, 1.2], { side: shade(PALETTE.frame, 0.8), top: base })
  b.box([0, -0.72, 0], [1.7, 0.16, 1.05], { side: stoneSide, top: stone })
  for (const x of [-0.6, -0.2, 0.2, 0.6]) {
    b.box([x, -0.12, 0.25], [0.22, 1.05, 0.22], { side: stoneSide, front: stone })
  }
  // Fachada de atrás (pared en sombra entre columnas).
  b.box([0, -0.12, -0.15], [1.5, 1.05, 0.5], shade(PALETTE.frameInner, 0.9))
  b.box([0, 0.5, 0], [1.8, 0.18, 1.1], { side: stoneSide, top: stone, front: stone })
  // Frontón: prisma triangular con faldones rojos y triángulo oro delante.
  const roof = C(PALETTE.red)
  const roofLo = C(PALETTE.redLo)
  const z0 = -0.55
  const z1 = 0.55
  const L: Vec = [-0.95, 0.59, z1]
  const R: Vec = [0.95, 0.59, z1]
  const T: Vec = [0, 1.0, z1]
  const Lb: Vec = [-0.95, 0.59, z0]
  const Rb: Vec = [0.95, 0.59, z0]
  const Tb: Vec = [0, 1.0, z0]
  b.tri(L, R, T, stone)
  b.tri(Rb, Lb, Tb, stoneSide)
  b.quad(L, T, Tb, Lb, roof)
  b.quad(T, R, Rb, Tb, roofLo)
  // Triángulo oro del frontón, un pelo por delante.
  b.tri([-0.28, 0.66, z1 + 0.01], [0.28, 0.66, z1 + 0.01], [0, 0.88, z1 + 0.01], C(PALETTE.gold))
  return b.build()
}

function memoryCardMesh(): BufferGeometry {
  const b = new MeshBuilder()
  b.box([0, 0, 0], [1.25, 1.7, 0.16], {
    side: shade(PALETTE.frame, 0.75),
    front: C(PALETTE.frame),
  })
  // Etiqueta oro y muescas de tinta en la parte de arriba (por delante, un pelo fuera).
  b.box([0, 0.12, 0.085], [0.85, 0.75, 0.02], C(PALETTE.gold))
  b.box([0.05, -0.08, 0.1], [0.5, 0.08, 0.02], C(PALETTE.ink))
  for (const x of [-0.35, 0, 0.35]) b.box([x, 0.78, 0.085], [0.14, 0.16, 0.02], C(PALETTE.ink))
  b.box([-0.18, -0.55, 0.085], [0.5, 0.1, 0.02], C(PALETTE.ink))
  return b.build()
}

function gearMesh(): BufferGeometry {
  const b = new MeshBuilder()
  const teeth = 8
  const poly: [number, number][] = []
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2
    const w = (Math.PI * 2) / teeth
    // Diente: dos puntos fuera (r 1) y dos dentro (r 0.74).
    for (const [da, r] of [
      [-0.5, 0.74],
      [-0.3, 1],
      [0.05, 1],
      [0.25, 0.74],
    ] as const) {
      const ang = a + da * w
      poly.push([Math.cos(ang) * r, Math.sin(ang) * r])
    }
  }
  b.extrude(poly, 0.36, shade(PALETTE.steel, 0.75), C(PALETTE.steel))
  // Hexágono de tinta en el centro, por delante y por detrás.
  const hex: [number, number][] = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    hex.push([Math.cos(a) * 0.3, Math.sin(a) * 0.3])
  }
  b.extrude(hex, 0.38, C(PALETTE.ink))
  return b.build()
}

function bookMesh(): BufferGeometry {
  const b = new MeshBuilder()
  const cover = C(PALETTE.red)
  const coverSide = C(PALETTE.redLo)
  const pages = C(PALETTE.cream)
  // Tapas delante y detrás, lomo a la izquierda y el canto de páginas a la derecha.
  b.box([0, 0, 0.14], [1.3, 1.6, 0.06], { side: coverSide, front: cover })
  b.box([0, 0, -0.14], [1.3, 1.6, 0.06], { side: coverSide, front: cover })
  b.box([-0.62, 0, 0], [0.06, 1.6, 0.34], cover)
  b.box([0.04, 0, 0], [1.2, 1.5, 0.22], { side: pages, top: pages, front: pages })
  // Franja oro en la portada y marcapáginas.
  b.box([0, 0.48, 0.175], [1.0, 0.1, 0.01], C(PALETTE.gold))
  b.box([0.35, -0.86, 0.02], [0.08, 0.3, 0.02], C(PALETTE.gold))
  return b.build()
}

function gemMesh(): BufferGeometry {
  const b = new MeshBuilder()
  const hi = C(PALETTE.gold)
  const lo = C(PALETTE.goldDark)
  // Corona de la gema arriba y pabellón abajo, 8 lados.
  b.lathe(
    [
      [0, -0.9],
      [1, 0.15],
      [0.62, 0.55],
    ],
    8,
    seg => (seg === 0 ? lo : hi),
    shade(PALETTE.goldHi, 0.95),
  )
  return b.build()
}

/**
 * Pirámide escalonada del Programa de Afiliados (legalmente distinto): tres pisos oro, cada uno
 * más oscuro por los lados, y la cima suelta flotando encima (una pirámide de 4 caras goldHi).
 */
function pyramidMesh(): BufferGeometry {
  const b = new MeshBuilder()
  const tiers: [number, number, string][] = [
    [1.7, -0.85, PALETTE.goldDark],
    [1.2, -0.45, PALETTE.gold],
    [0.7, -0.05, PALETTE.gold],
  ]
  for (const [size, y, hex] of tiers) {
    b.box([0, y + 0.2, 0], [size, 0.4, size], {
      side: shade(hex, 0.8),
      front: C(hex),
      top: shade(PALETTE.goldHi, 0.95),
    })
  }
  // La cima, separada: la que lo ve todo (y cobra de todos).
  b.lathe(
    [
      [0.42, 0.5],
      [0, 0.95],
    ],
    4,
    () => C(PALETTE.goldHi),
    undefined,
    C(PALETTE.goldDark),
  )
  return b.build()
}

/** Construye la malla de un icono. */
export function buildIcon(kind: IconKind): BufferGeometry {
  switch (kind) {
    case 'chip':
      return chipMesh(false)
    case 'chipDim':
      return chipMesh(true)
    case 'stack':
      return stackMesh(7)
    case 'bars':
      return barsMesh()
    case 'trophy':
      return trophyMesh(false)
    case 'trophyLocked':
      return trophyMesh(true)
    case 'crown':
      return crownMesh()
    case 'bank':
      return bankMesh()
    case 'memoryCard':
      return memoryCardMesh()
    case 'gear':
      return gearMesh()
    case 'book':
      return bookMesh()
    case 'gem':
      return gemMesh()
    case 'pyramid':
      return pyramidMesh()
  }
}
