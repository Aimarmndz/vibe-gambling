// SPDX-License-Identifier: AGPL-3.0-or-later
// Constructor de mallas low-poly para los iconos del menú: triángulos sueltos (sin índices) con
// color por vértice y normal por cara, así el material PSX las pinta con sombreado plano.
import { BufferGeometry, Color, Float32BufferAttribute, LinearSRGBColorSpace, Vector3 } from 'three'

export type Vec = readonly [number, number, number]

/**
 * Color de la paleta tal cual: la tubería PSX trabaja con los valores sRGB sin convertir (salida
 * `LinearSRGBColorSpace`), así que el hex se lee como si ya fuera lineal.
 */
export function paletteColor(hex: string): Color {
  return new Color().setStyle(hex, LinearSRGBColorSpace)
}

export class MeshBuilder {
  private readonly pos: number[] = []
  private readonly col: number[] = []
  private readonly nrm: number[] = []
  private readonly a = new Vector3()
  private readonly b = new Vector3()
  private readonly c = new Vector3()

  /** Triángulo en sentido antihorario visto desde fuera. */
  tri(p: Vec, q: Vec, r: Vec, color: Color): this {
    this.a.set(...p)
    this.b.set(...q)
    this.c.set(...r)
    const n = this.c.clone().sub(this.b).cross(this.a.clone().sub(this.b)).normalize()
    for (const v of [p, q, r]) {
      this.pos.push(...v)
      this.col.push(color.r, color.g, color.b)
      this.nrm.push(n.x, n.y, n.z)
    }
    return this
  }

  quad(p: Vec, q: Vec, r: Vec, s: Vec, color: Color): this {
    return this.tri(p, q, r, color).tri(p, r, s, color)
  }

  /** Caja alineada con los ejes, de centro `c` y medidas `w × h × d`. `colors`: cara por cara. */
  box(
    center: Vec,
    size: Vec,
    color: Color | { side: Color; top?: Color; front?: Color; bottom?: Color },
  ): this {
    const [cx, cy, cz] = center
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2]
    const side = color instanceof Color ? color : color.side
    const top = color instanceof Color ? color : (color.top ?? side)
    const front = color instanceof Color ? color : (color.front ?? side)
    const bottom = color instanceof Color ? color : (color.bottom ?? side)
    const x0 = cx - hx
    const x1 = cx + hx
    const y0 = cy - hy
    const y1 = cy + hy
    const z0 = cz - hz
    const z1 = cz + hz
    // Delante (+z), detrás, derecha, izquierda, arriba y abajo.
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], front)
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], side)
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], side)
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], side)
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top)
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], bottom)
    return this
  }

  /**
   * Sólido de revolución alrededor del eje Y: `profile` son pares (radio, altura) de abajo arriba.
   * `colorAt(i)` da el color del tramo i (entre el punto i y el i+1). Cierra arriba y abajo si el
   * radio del extremo no es 0.
   */
  lathe(
    profile: readonly (readonly [number, number])[],
    sides: number,
    colorAt: (segment: number, side: number) => Color,
    capTop?: Color,
    capBottom?: Color,
  ): this {
    const at = (r: number, y: number, k: number): Vec => {
      const ang = (k / sides) * Math.PI * 2
      return [Math.cos(ang) * r, y, -Math.sin(ang) * r]
    }
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i]!
      const [r1, y1] = profile[i + 1]!
      for (let k = 0; k < sides; k++) {
        const color = colorAt(i, k)
        const a = at(r0, y0, k)
        const b = at(r0, y0, k + 1)
        const c = at(r1, y1, k + 1)
        const d = at(r1, y1, k)
        if (r0 > 0 && r1 > 0) this.quad(a, b, c, d, color)
        else if (r0 > 0) this.tri(a, b, c, color)
        else this.tri(a, c, d, color)
      }
    }
    const last = profile[profile.length - 1]!
    const first = profile[0]!
    if (capTop && last[0] > 0) this.disc(last[0], last[1], sides, () => capTop, 1)
    if (capBottom && first[0] > 0) this.disc(first[0], first[1], sides, () => capBottom, -1)
    return this
  }

  /** Disco horizontal de radio r a la altura y, mirando arriba (dir 1) o abajo (−1). */
  disc(r: number, y: number, sides: number, colorAt: (side: number) => Color, dir: 1 | -1): this {
    const at = (k: number): Vec => {
      const ang = (k / sides) * Math.PI * 2
      return [Math.cos(ang) * r, y, -Math.sin(ang) * r]
    }
    for (let k = 0; k < sides; k++) {
      if (dir > 0) this.tri([0, y, 0], at(k), at(k + 1), colorAt(k))
      else this.tri([0, y, 0], at(k + 1), at(k), colorAt(k))
    }
    return this
  }

  /** Anillo horizontal plano entre r0 y r1 a la altura y (mirando arriba o abajo). */
  annulus(
    r0: number,
    r1: number,
    y: number,
    sides: number,
    colorAt: (side: number) => Color,
    dir: 1 | -1,
  ): this {
    const at = (r: number, k: number): Vec => {
      const ang = (k / sides) * Math.PI * 2
      return [Math.cos(ang) * r, y, -Math.sin(ang) * r]
    }
    for (let k = 0; k < sides; k++) {
      const a = at(r0, k)
      const b = at(r1, k)
      const c = at(r1, k + 1)
      const d = at(r0, k + 1)
      if (dir > 0) this.quad(a, b, c, d, colorAt(k))
      else this.quad(a, d, c, b, colorAt(k))
    }
    return this
  }

  /** Prisma: un polígono (x, y) del plano XY extruido en z entre −depth/2 y +depth/2. */
  extrude(
    polygon: readonly (readonly [number, number])[],
    depth: number,
    color: Color,
    face?: Color,
  ) {
    const z0 = -depth / 2
    const z1 = depth / 2
    const n = polygon.length
    const front = face ?? color
    // Tapas en abanico desde el centroide (vale para polígonos estrellados respecto a él).
    const cx = polygon.reduce((s, p) => s + p[0], 0) / n
    const cy = polygon.reduce((s, p) => s + p[1], 0) / n
    for (let i = 0; i < n; i++) {
      const [ax, ay] = polygon[i]!
      const [bx, by] = polygon[(i + 1) % n]!
      this.tri([cx, cy, z1], [ax, ay, z1], [bx, by, z1], front)
      this.tri([cx, cy, z0], [bx, by, z0], [ax, ay, z0], front)
      this.quad([ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1], color)
    }
    return this
  }

  build(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3))
    // Los iconos no tienen textura: UV a cero para el material PSX (que siempre las interpola).
    g.setAttribute(
      'uv',
      new Float32BufferAttribute(new Array((this.pos.length / 3) * 2).fill(0), 2),
    )
    g.computeBoundingSphere()
    return g
  }
}
