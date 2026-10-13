// SPDX-License-Identifier: AGPL-3.0-or-later
// Capa de iconos 3D del menú: una escena propia con cámara ortográfica en píxeles de 320×240 y el
// material PSX (sombreado plano, vertex snapping), que se compone encima de la interfaz (capa 5 de
// docs/DISENO-V2.md). Las pantallas piden iconos mientras se pintan (`icon()`); al acabar el
// fotograma se esconden los que nadie ha pedido.
import { Mesh, OrthographicCamera, Scene, Vector3 } from 'three'
import type { BufferGeometry, ShaderMaterial, Color } from 'three'

import { createPsxMaterial, createPsxUniforms } from '../psxMaterial.ts'
import type { PsxUniforms } from '../psxMaterial.ts'
import { buildIcon, stackMesh } from './meshes.ts'
import type { IconKind } from './meshes.ts'

export type { IconKind } from './meshes.ts'

/** Ángulo de 3/4 en el que descansan los iconos quietos (radianes). */
export const REST_YAW = -0.6
/** Inclinación hacia la cámara: se ven un poco desde arriba, como en `icons-sheet.png`. */
export const TILT = 0.38

export interface IconOptions {
  /** Giro alrededor del eje vertical (radianes). Por defecto, el de 3/4. */
  yaw?: number
  /** Multiplica el color (1.12 el seleccionado, 0.72 los demás). */
  brightness?: number
  /** Solo para la pila: cuántas fichas (1–10). */
  count?: number
  /** Inclinación propia (por defecto `TILT`). */
  tilt?: number
}

/** Lo que necesitan las pantallas para pedir iconos (los tests pasan uno de mentira). */
export interface IconSink {
  /** Pinta un icono centrado en (x, y) px; `size` px por unidad de malla. */
  icon(kind: IconKind, x: number, y: number, size: number, opts?: IconOptions): void
}

/** Un icono que no pinta nada (tests, o sin WebGL). */
export const NO_ICONS: IconSink = { icon: () => undefined }

/** Ángulo de un icono que da una vuelta cada `periodMs` (0 si está quieto). */
export function spinAngle(t: number, periodMs: number, still: boolean): number {
  if (still || periodMs <= 0) return REST_YAW
  return REST_YAW + ((t * 1000) / periodMs) * Math.PI * 2
}

/**
 * Vaivén alrededor del ángulo de 3/4 (±`amp` radianes): para los iconos grandes y planos (banco,
 * libro), que de canto no se leen.
 */
export function swingAngle(t: number, periodMs: number, amp: number, still: boolean): number {
  if (still || periodMs <= 0) return REST_YAW
  return REST_YAW + Math.sin(((t * 1000) / periodMs) * Math.PI * 2) * amp
}

/** Bob del icono seleccionado: ±amp px con periodo `periodMs`, redondeado al píxel. */
export function bobOffset(t: number, periodMs: number, amp: number, still: boolean): number {
  if (still || periodMs <= 0) return 0
  return Math.round(Math.sin(((t * 1000) / periodMs) * Math.PI * 2) * amp)
}

interface Slot {
  mesh: Mesh
  material: ShaderMaterial
  used: boolean
}

export class MenuIconLayer implements IconSink {
  readonly scene = new Scene()
  readonly camera: OrthographicCamera
  readonly uniforms: PsxUniforms
  private readonly geometries = new Map<string, BufferGeometry>()
  private readonly slots = new Map<string, Slot[]>()

  constructor(width: number, height: number) {
    // Píxeles de la pantalla virtual: x a la derecha, y hacia abajo (como el canvas 2D).
    this.camera = new OrthographicCamera(0, width, 0, -height, -200, 200)
    this.camera.position.set(0, 0, 100)
    this.camera.lookAt(new Vector3(0, 0, 0))
    this.camera.position.set(0, 0, 100)
    this.camera.updateMatrixWorld()
    const u = createPsxUniforms(width, height)
    // Luz de los iconos (docs/DISENO-V2.md): direccional (−0,55, 0,75, 0,6), ambiente 0,42, sin
    // lámpara ni niebla.
    u.uLightDir.value.set(-0.55, 0.75, 0.6).normalize()
    u.uLightColor.value.setRGB(0.72, 0.72, 0.72)
    u.uAmbient.value.setRGB(0.42, 0.42, 0.42)
    u.uPointColor.value.setRGB(0, 0, 0)
    u.uFogNear.value = 1e5
    u.uFogFar.value = 2e5
    this.uniforms = u
  }

  /** Vertex snapping (tembleque) como el del mundo: se apaga con movimiento reducido. */
  setSnap(on: boolean): void {
    this.uniforms.uSnap.value = on ? 1 : 0
  }

  /** Empieza un fotograma: todos los iconos quedan libres. */
  begin(): void {
    for (const list of this.slots.values()) for (const s of list) s.used = false
  }

  /** Acaba el fotograma: se esconden los que no se han pedido. */
  end(): void {
    for (const list of this.slots.values()) for (const s of list) s.mesh.visible = s.used
  }

  /** ¿Hay algún icono en pantalla en este fotograma? */
  active(): boolean {
    for (const list of this.slots.values()) if (list.some(s => s.used)) return true
    return false
  }

  icon(kind: IconKind, x: number, y: number, size: number, opts: IconOptions = {}): void {
    const key = kind === 'stack' ? `stack:${Math.max(1, Math.min(10, opts.count ?? 7))}` : kind
    const slot = this.slot(key, kind, opts.count)
    slot.used = true
    const { mesh, material } = slot
    mesh.visible = true
    mesh.position.set(Math.round(x), -Math.round(y), 0)
    mesh.scale.setScalar(size)
    mesh.rotation.set(opts.tilt ?? TILT, opts.yaw ?? REST_YAW, 0, 'XYZ')
    ;(material.uniforms.uColor!.value as Color).setScalar(opts.brightness ?? 1)
  }

  private slot(key: string, kind: IconKind, count: number | undefined): Slot {
    let list = this.slots.get(key)
    if (!list) {
      list = []
      this.slots.set(key, list)
    }
    const free = list.find(s => !s.used)
    if (free) return free
    let geometry = this.geometries.get(key)
    if (!geometry) {
      geometry = kind === 'stack' ? stackMesh(count ?? 7) : buildIcon(kind)
      this.geometries.set(key, geometry)
    }
    const material = createPsxMaterial(this.uniforms, { vertexColors: true })
    const mesh = new Mesh(geometry, material)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    const slot = { mesh, material, used: false }
    list.push(slot)
    return slot
  }
}
