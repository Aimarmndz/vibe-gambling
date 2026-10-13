// SPDX-License-Identifier: AGPL-3.0-or-later
// Capa FX 3D (docs/DISENO-V2.md, "Orden de capas", capa 5): fichas low-poly que llueven o vuelan y
// la copa de los logros, con el mismo material PSX (vertex snapping, luz por vértice) y su propia
// cámara ortográfica en píxeles de 320×240 (x a la derecha, y hacia abajo), para que la física
// vaya en px/s² como dice el diseño. Se compone después de la interfaz y antes del dithering.
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  OrthographicCamera,
  Scene,
  Vector2,
} from 'three'
import type { BufferGeometry, ShaderMaterial } from 'three'

import { CHIP_COLORS, PALETTE } from '../../ui/palette.ts'
import { PSX_HEIGHT, PSX_WIDTH } from '../pipeline.ts'
import { createPsxMaterial, createPsxUniforms } from '../psxMaterial.ts'
import type { PsxUniforms } from '../psxMaterial.ts'
import { chipEdgeTexture, chipFaceTexture } from '../textures.ts'

/** Colores de las fichas que llueven: las de la mesa más el oro de las monedas. */
export const RAIN_COLORS: readonly string[] = Object.freeze([
  CHIP_COLORS[1]!,
  PALETTE.chipBlue,
  CHIP_COLORS[3]!,
  PALETTE.gold,
  CHIP_COLORS[0]!,
])

interface Coin {
  mesh: Mesh
  x: number
  y: number
  vx: number
  vy: number
  /** Giro (rad/s) en cada eje. */
  spin: [number, number, number]
  /** Segundos que le quedan (null = hasta salir de la pantalla). */
  ttl: number | null
  /** Si se recicla desde abajo al salir (lluvia continua). */
  loop: boolean
  /** Fichas que caen hacia un punto (el saldo del préstamo): se paran en él. */
  floorY: number | null
}

export interface CoinSpawn {
  x: number
  y: number
  vx: number
  vy: number
  color?: string
  ttl?: number | null
  loop?: boolean
  floorY?: number | null
  /** Escala de la ficha (1 = 15 px de diámetro). */
  size?: number
}

/** Generador de azar inyectable (los tests y la demo quieren repetir la misma lluvia). */
export type Random = () => number

/** Copa de los logros: torno de 10 lados en oro y dos asas (caja de ±1 unidad). */
function trophyGeometry(): BufferGeometry[] {
  const profile = [
    [0.0, -1.0],
    [0.55, -1.0],
    [0.55, -0.85],
    [0.18, -0.75],
    [0.14, -0.3],
    [0.3, -0.15],
    [0.7, 0.2],
    [0.8, 0.95],
    [0.68, 0.95],
    [0.58, 0.3],
    [0.0, 0.2],
  ].map(([x, y]) => new Vector2(x, y))
  const cup = new LatheGeometry(profile, 10).toNonIndexed()
  cup.computeVertexNormals()
  const handle = new BoxGeometry(0.18, 0.55, 0.18).toNonIndexed()
  handle.computeVertexNormals()
  return [cup, handle]
}

export class FxScene3d {
  readonly scene = new Scene()
  readonly camera: OrthographicCamera
  private readonly uniforms: PsxUniforms
  private readonly coinGeo: BufferGeometry
  private readonly materials = new Map<string, ShaderMaterial[]>()
  private readonly edge = chipEdgeTexture()
  private readonly face = chipFaceTexture()
  private readonly coins: Coin[] = []
  private readonly pool: Mesh[] = []
  private readonly trophies: Group[] = []
  private readonly trophyParts: BufferGeometry[]
  private readonly trophyGold: ShaderMaterial
  private readonly trophyDark: ShaderMaterial
  private readonly gravity: number
  private readonly budget: number
  private readonly random: Random

  constructor(opts: { gravityPxS2: number; maxCoins: number; random?: Random; snap: boolean }) {
    this.gravity = opts.gravityPxS2
    this.budget = opts.maxCoins
    this.random = opts.random ?? Math.random
    this.camera = new OrthographicCamera(0, PSX_WIDTH, 0, -PSX_HEIGHT, 1, 400)
    this.camera.position.set(0, 0, 200)
    this.camera.lookAt(0, 0, 0)
    this.camera.updateProjectionMatrix()
    const u = createPsxUniforms(PSX_WIDTH, PSX_HEIGHT)
    // Luz de los iconos (docs/DISENO-V2.md, "Iconos 3D"): direccional (−0,55, 0,75, 0,6) y
    // ambiente 0,42; sin lámpara ni niebla (la cámara ortográfica está a 200 px).
    u.uLightDir.value.set(-0.55, 0.75, 0.6).normalize()
    u.uLightColor.value.setScalar(0.72)
    u.uAmbient.value.setScalar(0.42)
    u.uPointColor.value.setScalar(0)
    u.uFogNear.value = 10_000
    u.uFogFar.value = 20_000
    u.uSnap.value = opts.snap ? 1 : 0
    this.uniforms = u
    // Ficha de 15 px de diámetro y 3 de canto, 12 lados (como en sb-bigwin-tiers.png).
    this.coinGeo = new CylinderGeometry(7.5, 7.5, 3, 12)
    this.trophyParts = trophyGeometry()
    this.trophyGold = createPsxMaterial(u, { color: new Color(PALETTE.gold), specular: 0.5 })
    this.trophyDark = createPsxMaterial(u, { color: new Color(PALETTE.goldDark) })
  }

  /** Fichas en pantalla ahora mismo. */
  get coinCount(): number {
    return this.coins.length
  }

  /** ¿Hay algo que pintar? (si no, la capa ni se compone). */
  get busy(): boolean {
    return this.coins.length > 0 || this.trophies.some(t => t.visible)
  }

  private materialsFor(color: string): ShaderMaterial[] {
    let list = this.materials.get(color)
    if (!list) {
      const c = new Color(color)
      const side = createPsxMaterial(this.uniforms, { map: this.edge, color: c })
      const face = createPsxMaterial(this.uniforms, { map: this.face, color: c, specular: 0.3 })
      list = [side, face, face]
      this.materials.set(color, list)
    }
    return list
  }

  /** Lanza una ficha. Devuelve false si ya se ha llegado al presupuesto (`fx.maxCoins`). */
  spawn(s: CoinSpawn): boolean {
    if (this.coins.length >= this.budget) return false
    const color = s.color ?? RAIN_COLORS[Math.floor(this.random() * RAIN_COLORS.length)]!
    const mesh = this.pool.pop() ?? new Mesh(this.coinGeo)
    mesh.material = this.materialsFor(color)
    mesh.scale.setScalar(s.size ?? 1)
    mesh.rotation.set(this.random() * Math.PI, this.random() * Math.PI, this.random() * Math.PI)
    mesh.visible = true
    this.scene.add(mesh)
    const r = this.random
    this.coins.push({
      mesh,
      x: s.x,
      y: s.y,
      vx: s.vx,
      vy: s.vy,
      spin: [(r() - 0.5) * 14, (r() - 0.5) * 10, (r() - 0.5) * 12],
      ttl: s.ttl ?? null,
      loop: s.loop ?? false,
      floorY: s.floorY ?? null,
    })
    this.place(this.coins[this.coins.length - 1]!)
    return true
  }

  /** Una ficha del fondo hacia arriba, en abanico (la lluvia del premio). */
  fountain(loop: boolean): boolean {
    const r = this.random
    return this.spawn({
      x: 20 + r() * (PSX_WIDTH - 40),
      y: PSX_HEIGHT + 10,
      vx: (r() - 0.5) * 220,
      vy: -(360 + r() * 220),
      loop,
    })
  }

  /**
   * Ficha que vuela de un punto a otro en arco en `seconds` (gravedad incluida): la velocidad
   * inicial se calcula para llegar justo, y desaparece al llegar.
   */
  fly(
    from: { x: number; y: number },
    to: { x: number; y: number },
    seconds: number,
    color?: string,
  ) {
    const t = Math.max(0.05, seconds)
    return this.spawn({
      x: from.x,
      y: from.y,
      vx: (to.x - from.x) / t,
      vy: (to.y - from.y - 0.5 * this.gravity * t * t) / t,
      ttl: t,
      size: 0.8,
      ...(color ? { color } : {}),
    })
  }

  /** La lluvia deja de reciclar fichas: las que hay caen y se van. */
  stopLoop(): void {
    for (const c of this.coins) c.loop = false
  }

  /** Quita todas las fichas. */
  clear(): void {
    for (const c of this.coins) this.release(c)
    this.coins.length = 0
  }

  private release(c: Coin): void {
    c.mesh.visible = false
    this.scene.remove(c.mesh)
    this.pool.push(c.mesh)
  }

  private place(c: Coin): void {
    // Posición redondeada a píxel (movimiento en escalones); el vertex snapping hace el resto.
    c.mesh.position.set(Math.round(c.x), -Math.round(c.y), 0)
  }

  /** Avanza la física `dt` segundos. */
  update(dt: number): void {
    const g = this.gravity
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i]!
      c.vy += g * dt
      c.x += c.vx * dt
      c.y += c.vy * dt
      c.mesh.rotation.x += c.spin[0] * dt
      c.mesh.rotation.y += c.spin[1] * dt
      c.mesh.rotation.z += c.spin[2] * dt
      if (c.floorY !== null && c.y >= c.floorY) {
        c.y = c.floorY
        c.vx = 0
        c.vy = 0
        c.spin = [0, 0, 0]
        c.ttl ??= 0.4
      }
      if (c.ttl !== null) c.ttl -= dt
      const gone = c.ttl !== null ? c.ttl <= 0 : c.y > PSX_HEIGHT + 20 && c.vy > 0
      if (gone) {
        if (c.loop) {
          // Lluvia continua: vuelve a salir desde abajo.
          const r = this.random
          c.x = 20 + r() * (PSX_WIDTH - 40)
          c.y = PSX_HEIGHT + 10
          c.vx = (r() - 0.5) * 220
          c.vy = -(360 + r() * 220)
        } else {
          this.release(c)
          this.coins.splice(i, 1)
          continue
        }
      }
      this.place(c)
    }
  }

  /**
   * Coloca (o esconde, con null) la copa `index`: centro en píxeles, tamaño en px por unidad de
   * malla y ángulo de giro en radianes.
   */
  setTrophy(index: number, at: { x: number; y: number; size: number; angle: number } | null) {
    while (this.trophies.length <= index) {
      const group = new Group()
      const [cup, handle] = this.trophyParts as [BufferGeometry, BufferGeometry]
      group.add(new Mesh(cup, this.trophyGold))
      for (const side of [-1, 1]) {
        const h = new Mesh(handle, this.trophyDark)
        h.position.set(side * 0.85, 0.5, 0)
        group.add(h)
      }
      group.visible = false
      this.scene.add(group)
      this.trophies.push(group)
    }
    const t = this.trophies[index]!
    t.visible = at !== null
    if (!at) return
    t.position.set(Math.round(at.x), -Math.round(at.y), 0)
    t.scale.setScalar(at.size)
    // Un poco inclinada hacia la cámara, como los iconos del menú.
    t.rotation.set(0.25, at.angle, 0)
  }

  /** Tembleque (vertex snapping) según el movimiento reducido. */
  setSnap(on: boolean): void {
    this.uniforms.uSnap.value = on ? 1 : 0
  }
}
