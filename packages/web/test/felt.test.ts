// SPDX-License-Identifier: AGPL-3.0-or-later
// Legibilidad del tapete: con el plano de la mesa, cada casilla ocupa en la pantalla de 320×240 al
// menos tantos píxeles como texels tiene (si no, el filtro nearest se come trazos de los números),
// y la malla tiene un vértice en cada esquina de casilla (la UV affine no parte los números).
import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { LAYOUT_BOUNDS } from '../src/game/layout.ts'
import {
  SX,
  SY,
  TEX_H,
  TEX_W,
  feltGrid,
  labelRoom,
  tightWidth,
  toTex,
} from '../src/render/feltLayout.ts'
import { PSX_HEIGHT, PSX_WIDTH } from '../src/render/pipeline.ts'
import { SHOTS, feltGeometry, layoutToWorld } from '../src/render/world.ts'
import { CATALOGS } from './translators.ts'

function tableCamera(): PerspectiveCamera {
  const shot = SHOTS.table
  const cam = new PerspectiveCamera(shot.fov, PSX_WIDTH / PSX_HEIGHT, 0.1, 60)
  cam.position.copy(shot.position)
  cam.lookAt(shot.target)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  return cam
}

/** Punto del tapete en píxeles de la pantalla virtual, redondeado como el vertex snapping. */
function screenPx(cam: PerspectiveCamera, x: number, y: number): [number, number] {
  const v = layoutToWorld({ x, y }).project(cam)
  return [Math.round(((v.x + 1) / 2) * PSX_WIDTH), Math.round(((1 - v.y) / 2) * PSX_HEIGHT)]
}

describe('tapete', () => {
  it('cada casilla mide en pantalla al menos un píxel por texel (también con el snapping)', () => {
    const cam = tableCamera()
    for (let y = LAYOUT_BOUNDS.minY; y < LAYOUT_BOUNDS.maxY; y++) {
      for (let x = LAYOUT_BOUNDS.minX; x < LAYOUT_BOUNDS.maxX; x++) {
        const [x0, y0] = screenPx(cam, x, y)
        const [x1] = screenPx(cam, x + 1, y)
        const [, y1] = screenPx(cam, x, y + 1)
        expect(x1 - x0, `ancho de la casilla (${x}, ${y})`).toBeGreaterThanOrEqual(SX)
        expect(y1 - y0, `alto de la casilla (${x}, ${y})`).toBeGreaterThanOrEqual(SY)
      }
    }
  })

  it('la malla tiene un vértice en cada borde de casilla, con su texel exacto', () => {
    const grid = feltGrid()
    for (let x = LAYOUT_BOUNDS.minX; x <= LAYOUT_BOUNDS.maxX; x++) expect(grid.xs).toContain(x)
    for (let y = LAYOUT_BOUNDS.minY; y <= LAYOUT_BOUNDS.maxY; y++) expect(grid.ys).toContain(y)
    grid.xs.forEach((x, i) => expect(grid.us[i]! * TEX_W).toBeCloseTo(toTex(x, 0)[0], 6))
    grid.ys.forEach((y, i) => expect(grid.vs[i]! * TEX_H).toBeCloseTo(toTex(0, y)[1], 6))
    expect(grid.us[0]).toBeCloseTo(0, 6)
    expect(grid.us.at(-1)).toBeCloseTo(1, 6)
    expect(grid.vs[0]).toBeCloseTo(0, 6)
    expect(grid.vs.at(-1)).toBeCloseTo(1, 6)
  })

  it('la geometría mira hacia arriba (se ve desde la cámara)', () => {
    const geo = feltGeometry()
    const pos = geo.getAttribute('position')
    const index = geo.getIndex()!
    const grid = feltGrid()
    expect(pos.count).toBe(grid.xs.length * grid.ys.length)
    expect(index.count).toBe((grid.xs.length - 1) * (grid.ys.length - 1) * 6)
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [0, 1, 2].map(k =>
        new Vector3().fromBufferAttribute(pos, index.getX(t + k)),
      ) as [Vector3, Vector3, Vector3]
      const normal = b.clone().sub(a).cross(c.clone().sub(a))
      expect(normal.y).toBeGreaterThan(0)
    }
  })
})

describe('rótulos del tapete en todos los idiomas', () => {
  it('caben en su casilla (como mucho con las letras pegadas)', () => {
    const cells: Record<string, number> = {
      'felt.column': 1,
      'felt.dozen1': 4,
      'felt.dozen2': 4,
      'felt.dozen3': 4,
      'felt.even': 2,
      'felt.odd': 2,
      'felt.low': 2,
      'felt.high': 2,
    }
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, n] of Object.entries(cells)) {
        const text = catalog[key as keyof typeof catalog]
        expect(tightWidth(text), `${locale}:${key}`).toBeLessThanOrEqual(labelRoom(n))
      }
    }
  })
})
