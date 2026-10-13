// SPDX-License-Identifier: AGPL-3.0-or-later
// Ruleta europea low-poly hecha en código: cuenco de madera, pista de la bola, aro de números,
// casillas con sus separadores y el cono central. Las 37 casillas siguen WHEEL_ORDER y colorOf.
import { POCKET_COUNT, WHEEL_ORDER, colorOf } from '@vibe-gambling/shared'
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  Vector2,
} from 'three'
import type { Texture } from 'three'

import { PALETTE, pocketHex } from '../ui/palette.ts'
import { createPsxMaterial } from './psxMaterial.ts'
import type { PsxUniforms } from './psxMaterial.ts'
import { NUMBER_ATLAS_CELLS } from './textures.ts'

const TAU = Math.PI * 2
const STEP = TAU / POCKET_COUNT

/** Medidas de la ruleta (unidades de mundo). */
export const WHEEL = Object.freeze({
  pocketInner: 1.1,
  pocketOuter: 1.52,
  plateOuter: 1.9,
  trackInner: 1.94,
  trackOuter: 2.26,
  rimOuter: 2.5,
  pocketY: 0.1,
  plateY: 0.2,
  trackYInner: 0.3,
  trackYOuter: 0.4,
  rimY: 0.52,
  ballRadius: 0.075,
})

/** Radio y altura de la bola según su posición (1 = pista, 0 = casilla). */
export function ballPlacement(radius01: number, lift: number): { r: number; y: number } {
  const rPocket = (WHEEL.pocketInner + WHEEL.pocketOuter) / 2
  const rTrack = WHEEL.trackInner + 0.1
  const yPocket = WHEEL.pocketY + WHEEL.ballRadius
  const yTrack = WHEEL.trackYInner + 0.03 + WHEEL.ballRadius
  return {
    r: rPocket + (rTrack - rPocket) * radius01,
    y: yPocket + (yTrack - yPocket) * radius01 + lift * 0.3,
  }
}

/** Punto en el ángulo φ (convención de spin.ts: antihorario visto desde arriba). */
function at(r: number, phi: number, y: number): [number, number, number] {
  return [r * Math.cos(phi), y, -r * Math.sin(phi)]
}

/** Aro dividido en las 37 casillas, con color por vértice y, si hay atlas, UV por número. */
function ringGeometry(
  rIn: number,
  rOut: number,
  yIn: number,
  yOut: number,
  opts: { atlas: boolean; darken: number },
): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const uv: number[] = []
  const nrm: number[] = []
  const c = new Color()
  for (let i = 0; i < POCKET_COUNT; i++) {
    const n = WHEEL_ORDER[i]!
    const mid = -i * STEP
    const a0 = mid - STEP / 2
    const a1 = mid + STEP / 2
    c.set(pocketHex(colorOf(n))).multiplyScalar(opts.darken)
    if (opts.atlas) c.setRGB(1, 1, 1)
    const cu = (n % NUMBER_ATLAS_CELLS) / NUMBER_ATLAS_CELLS
    const cv = 1 - Math.floor(n / NUMBER_ATLAS_CELLS) / NUMBER_ATLAS_CELLS
    const cell = 1 / NUMBER_ATLAS_CELLS
    // Cuatro esquinas: interior/exterior × ángulo menor/mayor. La cifra mira hacia fuera.
    const q = [
      { p: at(rIn, a0, yIn), t: [cu + cell, cv - cell] },
      { p: at(rOut, a0, yOut), t: [cu + cell, cv] },
      { p: at(rOut, a1, yOut), t: [cu, cv] },
      { p: at(rIn, a1, yIn), t: [cu, cv - cell] },
    ]
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const v = q[k]!
      pos.push(...v.p)
      col.push(c.r, c.g, c.b)
      uv.push(v.t[0]!, v.t[1]!)
      nrm.push(0, 1, 0)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3))
  g.computeVertexNormals()
  return g
}

function lathe(points: [number, number][], segments: number): LatheGeometry {
  return new LatheGeometry(
    points.map(([r, y]) => new Vector2(r, y)),
    segments,
  )
}

export interface WheelParts {
  /** Grupo completo (se coloca en la mesa). */
  root: Group
  /** Parte que gira (casillas, números, cono). */
  rotor: Group
  ball: Mesh
  /**
   * Ilumina la casilla `n` del color `hex` (el 0 en ¡VERDE!), o la deja como estaba con null.
   * Cambia solo los colores por vértice de esa casilla (6 vértices).
   */
  glow(n: number | null, hex: string): void
}

export function buildWheel(
  u: PsxUniforms,
  tex: { wood: Texture; brass: Texture; numbers: Texture },
): WheelParts {
  const root = new Group()
  const rotor = new Group()
  root.add(rotor)

  // Cuenco fijo: borde de madera y pista inclinada de la bola.
  const bowl = new Mesh(
    lathe(
      [
        [WHEEL.trackOuter, WHEEL.trackYOuter],
        [WHEEL.trackOuter + 0.04, WHEEL.rimY],
        [WHEEL.rimOuter, WHEEL.rimY],
        [WHEEL.rimOuter + 0.08, 0.3],
        [WHEEL.rimOuter + 0.1, 0],
      ],
      37,
    ),
    createPsxMaterial(u, { map: tex.wood }),
  )
  const track = new Mesh(
    lathe(
      [
        [WHEEL.trackInner, WHEEL.trackYInner],
        [WHEEL.trackOuter, WHEEL.trackYOuter],
      ].reverse() as [number, number][],
      37,
    ),
    createPsxMaterial(u, { color: 0x4a2a16 }),
  )
  root.add(bowl, track)

  // Aro de números (gira) y casillas.
  const plates = new Mesh(
    ringGeometry(WHEEL.pocketOuter, WHEEL.plateOuter, WHEEL.plateY, WHEEL.plateY + 0.02, {
      atlas: true,
      darken: 1,
    }),
    createPsxMaterial(u, { map: tex.numbers, vertexColors: true }),
  )
  const pockets = new Mesh(
    ringGeometry(WHEEL.pocketInner, WHEEL.pocketOuter, WHEEL.pocketY, WHEEL.pocketY, {
      atlas: false,
      darken: 0.8,
    }),
    createPsxMaterial(u, { vertexColors: true }),
  )
  // Pared exterior de las casillas (sube del fondo al aro de números).
  const wall = new Mesh(
    lathe(
      [
        [WHEEL.pocketOuter, WHEEL.plateY],
        [WHEEL.pocketOuter, WHEEL.pocketY],
      ],
      37,
    ),
    createPsxMaterial(u, { color: 0x2a1a10 }),
  )
  rotor.add(plates, pockets, wall)

  // Separadores de latón entre casillas.
  const brass = createPsxMaterial(u, { map: tex.brass, specular: 0.5 })
  const fret = new BoxGeometry(WHEEL.pocketOuter - WHEEL.pocketInner, 0.1, 0.025)
  for (let i = 0; i < POCKET_COUNT; i++) {
    const phi = -i * STEP - STEP / 2
    const m = new Mesh(fret, brass)
    const r = (WHEEL.pocketInner + WHEEL.pocketOuter) / 2
    const [x, , z] = at(r, phi, 0)
    m.position.set(x, WHEEL.pocketY + 0.05, z)
    m.rotation.y = phi
    rotor.add(m)
  }

  // Cono central y torreta con cuatro brazos.
  const cone = new Mesh(
    lathe(
      [
        [0.02, 0.62],
        [0.18, 0.6],
        [0.3, 0.42],
        [0.75, 0.2],
        [WHEEL.pocketInner, WHEEL.pocketY + 0.02],
      ],
      16,
    ),
    createPsxMaterial(u, { map: tex.brass, specular: 0.6 }),
  )
  rotor.add(cone)
  const arm = new BoxGeometry(0.9, 0.05, 0.05)
  for (let k = 0; k < 2; k++) {
    const m = new Mesh(arm, brass)
    m.position.y = 0.66
    m.rotation.y = (k * Math.PI) / 2
    rotor.add(m)
  }

  const ball = new Mesh(
    new IcosahedronGeometry(WHEEL.ballRadius, 1),
    createPsxMaterial(u, { color: new Color(PALETTE.cream), specular: 0.9 }),
  )
  root.add(ball)
  // Colores originales de las casillas, para apagar la que se ilumine.
  const pocketColors = pockets.geometry.getAttribute('color') as Float32BufferAttribute
  const original = Float32Array.from(pocketColors.array)
  let lit: number | null = null
  const glow = (n: number | null, hex: string) => {
    if (lit !== null) {
      const at0 = WHEEL_ORDER.indexOf(lit) * 6 * 3
      pocketColors.array.set(original.subarray(at0, at0 + 18), at0)
    }
    lit = n
    if (n !== null) {
      const c = new Color(hex)
      const i = WHEEL_ORDER.indexOf(n)
      for (let v = 0; v < 6; v++) pocketColors.setXYZ(i * 6 + v, c.r, c.g, c.b)
    }
    pocketColors.needsUpdate = true
  }
  return { root, rotor, ball, glow }
}

/** Coloca la bola (ángulo de mundo, relativo al grupo de la ruleta). */
export function placeBall(ball: Mesh, angle: number, radius01: number, lift: number): void {
  const { r, y } = ballPlacement(radius01, lift)
  const [x, , z] = at(r, angle, 0)
  ball.position.set(x, y, z)
}
