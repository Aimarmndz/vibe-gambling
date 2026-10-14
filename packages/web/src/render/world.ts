// SPDX-License-Identifier: AGPL-3.0-or-later
// La escena: una mesa de casino en un salón en penumbra. Tapete, ruleta, fichas apiladas en cada
// apuesta, el cursor del mando y el "dolly" que marca el número ganador.
import { selectionKey } from '@vibe-gambling/shared'
import type { Bet } from '@vibe-gambling/shared'
import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three'
import type { ShaderMaterial, Texture } from 'three'

import type { Point } from '../game/layout.ts'
import { anchorOf, cellCenter } from '../game/layout.ts'
import { PALETTE } from '../ui/palette.ts'
import { FeltLayout, feltGrid } from './feltLayout.ts'
import { createPsxMaterial, createPsxUniforms } from './psxMaterial.ts'
import type { PsxUniforms } from './psxMaterial.ts'
import {
  brassTexture,
  carpetTexture,
  chipEdgeTexture,
  chipFaceTexture,
  feltTexture,
  numberAtlasTexture,
  seeded,
  woodTexture,
} from './textures.ts'
import { CHIP_SKINS, FELT_SKINS, chipColor } from './skins.ts'
import type { ChipSkin, ChipStyle, FeltSkin } from './skins.ts'
import { buildWheel, placeBall } from './wheel.ts'
import type { WheelParts } from './wheel.ts'

/** Tamaño de una casilla del tapete en el mundo. */
const CELL_W = 0.5
const CELL_D = 0.6
/** Profundidad (z) del borde superior de las filas de números. */
const LAYOUT_Z0 = -0.3
const FELT_Y = 0
export const WHEEL_CENTER = new Vector3(0, FELT_Y, -2.95)

/** Del tapete (unidades de casilla) al mundo. */
export function layoutToWorld(p: Point): Vector3 {
  return new Vector3((p.x - 6) * CELL_W, FELT_Y, LAYOUT_Z0 + p.y * CELL_D)
}

export function worldToLayout(v: Vector3): Point {
  return { x: v.x / CELL_W + 6, y: (v.z - LAYOUT_Z0) / CELL_D }
}

/** Descompone una cantidad en fichas (de mayor a menor), con un tope de fichas visibles. */
export function chipStack(amount: number, chips: readonly number[], max = 8): number[] {
  const sorted = [...chips].sort((a, b) => b - a)
  const out: number[] = []
  let left = amount
  for (const value of sorted) {
    while (left >= value && out.length < max) {
      out.push(value)
      left -= value
    }
  }
  if (out.length === 0 && amount > 0) out.push(Math.min(...chips))
  return out.reverse()
}

export interface Shot {
  position: Vector3
  target: Vector3
  fov: number
}

export const SHOTS: Readonly<Record<'table' | 'wheel' | 'boot', Shot>> = Object.freeze({
  // fov 39: la fila de números más lejana mide ≥ 15 px por casilla (un píxel por texel, ver
  // feltLayout.ts); con más campo de visión los números del tapete pierden trazos.
  table: { position: new Vector3(0, 9.6, 4.6), target: new Vector3(0, 0, 0.2), fov: 39 },
  wheel: { position: new Vector3(0, 4.6, 0.2), target: new Vector3(0, 0, -3.35), fov: 40 },
  boot: { position: new Vector3(0, 0, 6), target: new Vector3(0, 0, 0), fov: 40 },
})

export class World {
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(42, 4 / 3, 0.1, 60)
  readonly uniforms: PsxUniforms
  readonly felt = new FeltLayout()
  readonly wheel: WheelParts
  private readonly chipsGroup = new Group()
  private readonly cursor: Mesh
  private readonly dolly: Mesh
  private readonly chipSide: Map<string, ShaderMaterial> = new Map()
  private readonly chipFaces: Map<string, ShaderMaterial> = new Map()
  private readonly chipTex: Map<ChipStyle, { edge: Texture; face: Texture }> = new Map()
  private readonly chipGeo = new CylinderGeometry(0.16, 0.16, 0.045, 10)
  private readonly raycaster = new Raycaster()
  private readonly feltPlane = new Plane(new Vector3(0, 1, 0), -FELT_Y)
  private readonly signs: Mesh[] = []
  private chipKey = ''
  private chipStyle: ChipSkin = CHIP_SKINS.classic
  private clothSkin: FeltSkin = FELT_SKINS.classic
  private readonly cloth: Mesh
  /** Tapete de la TIENDA en uso (lo pinta `felt.update`). */
  feltSkin: FeltSkin = FELT_SKINS.classic
  private readonly tex = {
    wood: woodTexture(),
    brass: brassTexture(),
    numbers: numberAtlasTexture(),
    felt: feltTexture(),
    carpet: carpetTexture(),
    chipEdge: chipEdgeTexture(),
    chipFace: chipFaceTexture(),
  }

  constructor(width: number, height: number) {
    this.uniforms = createPsxUniforms(width, height)
    const u = this.uniforms
    this.scene.background = new Color(u.uFogColor.value)

    // Suelo de moqueta y cuerpo de la mesa.
    const floor = new Mesh(
      tiled(new PlaneGeometry(44, 44, 8, 8), 14),
      createPsxMaterial(u, { map: this.tex.carpet }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -1.4
    const body = new Mesh(
      new BoxGeometry(11, 1.4, 11.2, 4, 1, 4),
      createPsxMaterial(u, { map: this.tex.wood, color: 0x9a7a66 }),
    )
    body.position.set(0, FELT_Y - 0.72, -1.6)
    // Paño liso y tapete con el diseño europeo encima.
    const cloth = (this.cloth = new Mesh(
      tiled(new PlaneGeometry(10.2, 10.4, 20, 20), 5),
      createPsxMaterial(u, { map: this.tex.felt }),
    ))
    cloth.rotation.x = -Math.PI / 2
    // El paño va debajo del tapete: se pinta antes y sin escribir profundidad (sin z-fighting).
    cloth.renderOrder = 1
    ;(cloth.material as ShaderMaterial).depthWrite = false
    cloth.position.set(0, FELT_Y, -1.6)
    // Tapete: una malla con un vértice en cada esquina de casilla (ver feltGrid).
    const decal = new Mesh(feltGeometry(), createPsxMaterial(u, { map: this.felt.texture }))
    decal.renderOrder = 2
    // Barandilla de madera.
    const railMat = createPsxMaterial(u, { map: this.tex.wood, specular: 0.15 })
    const rails: [number, number, number, number][] = [
      [0, 3.5, 10.6, 0.4],
      [0, -6.8, 10.6, 0.4],
      [-5.3, -1.65, 0.4, 10.7],
      [5.3, -1.65, 0.4, 10.7],
    ]
    for (const [x, z, w, d] of rails) {
      const rail = new Mesh(new BoxGeometry(w, 0.28, d, Math.ceil(w), 1, Math.ceil(d)), railMat)
      rail.position.set(x, FELT_Y + 0.1, z)
      this.scene.add(rail)
    }
    this.scene.add(floor, body, cloth, decal)

    // Máquinas tragaperras al fondo, en la niebla, con pantallas que parpadean.
    const rnd = seeded(21)
    for (let i = 0; i < 9; i++) {
      const x = -12 + i * 3
      const cabinet = new Mesh(
        new BoxGeometry(1.6, 3, 1.2),
        createPsxMaterial(u, { color: 0x2a2440 }),
      )
      cabinet.position.set(x, 0.1, -14 - rnd() * 1.5)
      const screen = new Mesh(
        new PlaneGeometry(1.1, 0.8),
        createPsxMaterial(u, { color: 0xffffff, unlit: 1 }),
      )
      screen.position.set(0, 0.6, 0.61)
      cabinet.add(screen)
      this.signs.push(screen)
      this.scene.add(cabinet)
    }

    // Ruleta.
    this.wheel = buildWheel(u, this.tex)
    this.wheel.root.position.copy(WHEEL_CENTER)
    this.wheel.root.scale.setScalar(0.9)
    this.scene.add(this.wheel.root)

    // Fichas, cursor y dolly.
    this.scene.add(this.chipsGroup)
    this.cursor = new Mesh(
      new TorusGeometry(0.2, 0.035, 3, 12),
      createPsxMaterial(u, { color: new Color(PALETTE.gold), unlit: 1 }),
    )
    this.cursor.rotation.x = -Math.PI / 2
    this.scene.add(this.cursor)
    this.dolly = new Mesh(
      new CylinderGeometry(0.1, 0.13, 0.22, 8),
      createPsxMaterial(u, { color: new Color(PALETTE.cream), specular: 0.6 }),
    )
    this.dolly.visible = false
    this.scene.add(this.dolly)

    this.setShot(SHOTS.table)
  }

  setShot(shot: Shot): void {
    this.camera.position.copy(shot.position)
    this.camera.fov = shot.fov
    this.camera.lookAt(shot.target)
    this.camera.updateProjectionMatrix()
  }

  /** Mezcla de dos planos de cámara (0 = a, 1 = b). */
  blendShots(a: Shot, b: Shot, t: number): void {
    const pos = a.position.clone().lerp(b.position, t)
    const target = a.target.clone().lerp(b.target, t)
    this.camera.position.copy(pos)
    this.camera.fov = a.fov + (b.fov - a.fov) * t
    this.camera.lookAt(target)
    this.camera.updateProjectionMatrix()
  }

  /** Punto del tapete bajo un píxel de la pantalla de 320×240, o null si no cae en la mesa. */
  pick(px: number, py: number, width: number, height: number): Point | null {
    const ndc = new Vector2((px / width) * 2 - 1, -((py / height) * 2 - 1))
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = new Vector3()
    if (!this.raycaster.ray.intersectPlane(this.feltPlane, hit)) return null
    return worldToLayout(hit)
  }

  setCursor(p: Point | null, time: number): void {
    this.cursor.visible = p !== null
    if (!p) return
    const v = layoutToWorld(p)
    this.cursor.position.set(v.x, FELT_Y + 0.03 + Math.abs(Math.sin(time * 4)) * 0.06, v.z)
    this.cursor.rotation.z = time * 1.5
  }

  setWinner(n: number | null): void {
    this.dolly.visible = n !== null
    if (n === null) return
    const v = layoutToWorld(cellCenter(n))
    this.dolly.position.set(v.x, FELT_Y + 0.11, v.z)
  }

  /**
   * Cosméticos de la TIENDA: tapete (paño y tiza del diseño) y juego de fichas. Solo rehace lo que
   * cambia; las texturas de cada estilo de ficha se crean la primera vez que hacen falta.
   */
  setSkins(felt: FeltSkin, chips: ChipSkin): void {
    this.feltSkin = felt
    if (felt !== this.clothSkin) {
      this.clothSkin = felt
      const material = this.cloth.material as ShaderMaterial
      const old = material.uniforms.map?.value as Texture | undefined
      const next = feltTexture(felt)
      if (material.uniforms.map) material.uniforms.map.value = next
      old?.dispose()
    }
    if (chips !== this.chipStyle) {
      this.chipStyle = chips
      this.chipKey = ''
    }
  }

  private chipTextures(style: ChipStyle): { edge: Texture; face: Texture } {
    let found = this.chipTex.get(style)
    if (!found) {
      found =
        style === 'classic'
          ? { edge: this.tex.chipEdge, face: this.tex.chipFace }
          : { edge: chipEdgeTexture(style), face: chipFaceTexture(style) }
      this.chipTex.set(style, found)
    }
    return found
  }

  private chipMaterials(index: number): ShaderMaterial[] {
    const skin = this.chipStyle
    const color = chipColor(skin, index)
    const key = `${skin.style}:${color}`
    let side = this.chipSide.get(key)
    let face = this.chipFaces.get(key)
    if (!side || !face) {
      const tex = this.chipTextures(skin.style)
      side = createPsxMaterial(this.uniforms, { map: tex.edge, color: new Color(color) })
      face = createPsxMaterial(this.uniforms, {
        map: tex.face,
        color: new Color(color),
        specular: skin.style === 'coin' ? 0.6 : 0.25,
      })
      this.chipSide.set(key, side)
      this.chipFaces.set(key, face)
    }
    return [side, face, face]
  }

  /** Reconstruye las pilas de fichas del boleto (solo si cambió, también el juego de fichas). */
  setChips(bets: readonly Bet[], chipValues: readonly number[]): void {
    const key = JSON.stringify([
      this.chipStyle.style,
      bets.map(b => [selectionKey(b.selection), b.amount]),
    ])
    if (key === this.chipKey) return
    this.chipKey = key
    this.chipsGroup.clear()
    const order = [...chipValues].sort((a, b) => a - b)
    for (const bet of bets) {
      const anchor = layoutToWorld(anchorOf(bet.selection))
      const jitter = seeded(hash(selectionKey(bet.selection)))
      chipStack(bet.amount, chipValues).forEach((value, i) => {
        const mesh = new Mesh(this.chipGeo, this.chipMaterials(Math.max(0, order.indexOf(value))))
        mesh.position.set(
          anchor.x + (jitter() - 0.5) * 0.04,
          FELT_Y + 0.03 + i * 0.047,
          anchor.z + (jitter() - 0.5) * 0.04,
        )
        mesh.rotation.y = jitter() * Math.PI
        this.chipsGroup.add(mesh)
      })
    }
  }

  /** Gira el cilindro y coloca la bola (ángulos en la convención de spin.ts). */
  setWheel(wheelAngle: number, ballAngle: number, radius01: number, lift: number): void {
    this.wheel.rotor.rotation.y = wheelAngle
    placeBall(this.wheel.ball, ballAngle, radius01, lift)
  }

  /** Animaciones ambientales: parpadeo de las tragaperras. */
  tick(time: number): void {
    this.signs.forEach((sign, i) => {
      const m = sign.material as ShaderMaterial
      const phase = Math.floor(time * 2 + i * 1.7) % 4
      const colors = [PALETTE.gold, PALETTE.red, '#3f7bff', PALETTE.win]
      ;(m.uniforms.uColor!.value as Color).set(colors[(phase + i) % 4]!).multiplyScalar(0.8)
    })
  }

  /** Ajustes de calidad: tembleque (vertex snapping) y niebla. */
  setSnap(on: boolean): void {
    this.uniforms.uSnap.value = on ? 1 : 0
  }
}

/** Malla del tapete sobre el paño, mirando hacia arriba, con las UV de feltGrid. */
export function feltGeometry(): BufferGeometry {
  const grid = feltGrid()
  const positions: number[] = []
  const uvs: number[] = []
  const normals: number[] = []
  for (let j = 0; j < grid.ys.length; j++) {
    for (let i = 0; i < grid.xs.length; i++) {
      const v = layoutToWorld({ x: grid.xs[i]!, y: grid.ys[j]! })
      positions.push(v.x, FELT_Y + 0.004, v.z)
      // La textura del canvas va volteada (flipY): v = 1 es la fila de arriba.
      uvs.push(grid.us[i]!, 1 - grid.vs[j]!)
      normals.push(0, 1, 0)
    }
  }
  const cols = grid.xs.length
  const index: number[] = []
  for (let j = 0; j + 1 < grid.ys.length; j++) {
    for (let i = 0; i + 1 < cols; i++) {
      const a = j * cols + i
      const b = a + 1
      const c = a + cols
      const d = c + 1
      // Sentido antihorario visto desde arriba (+y).
      index.push(a, c, b, b, c, d)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geo.setIndex(index)
  return geo
}

/** Repite la textura `times` veces (el shader PSX usa las UV tal cual, sin `texture.repeat`). */
function tiled<T extends BufferGeometry>(geometry: T, times: number): T {
  const uv = geometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * times, uv.getY(i) * times)
  return geometry
}

function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}
