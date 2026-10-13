// SPDX-License-Identifier: AGPL-3.0-or-later
// Pipeline PSX en tres pasadas:
//   1. La escena 3D a un render target de 320×240 (sin antialias, filtro nearest), y las capas 3D
//      superpuestas (iconos de menú, fichas que llueven) a otros dos con alfa: una quieta y otra
//      que tiembla con la sacudida (docs/DISENO-V2.md, "Orden de capas").
//   2. Compuesto: mundo (con sacudida) → interfaz (canvas 2D) → 3D quieto → FX 2D (canvas 2D, con
//      sacudida) → 3D que tiembla, y reducción a color de 15 bits (5 bits por canal) con dithering
//      ordenado Bayer 4×4, como hacía la consola.
//   3. Escalado al canvas real con relación 4:3 y bandas negras: nearest y entero si cabe, o el
//      filtro CRT (scanlines, curvatura suave, aberración/sangrado de color y viñeta).
import {
  CanvasTexture,
  GLSL3,
  LinearSRGBColorSpace,
  Mesh,
  NearestFilter,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three'
import type { Camera } from 'three'

export const PSX_WIDTH = 320
export const PSX_HEIGHT = 240

/** ¿Hay WebGL2 en este navegador? */
export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('webgl2') !== null
  } catch {
    return false
  }
}

/** Rectángulo 4:3 donde se pinta la imagen. Escala entera si se pierde poco (píxeles iguales). */
export function letterbox(width: number, height: number): Vector4 {
  const exact = Math.min(width / PSX_WIDTH, height / PSX_HEIGHT)
  const whole = Math.floor(exact)
  const scale = whole >= 1 && whole / exact >= 0.85 ? whole : exact
  const w = Math.round(PSX_WIDTH * scale)
  const h = Math.round(PSX_HEIGHT * scale)
  return new Vector4(Math.floor((width - w) / 2), Math.floor((height - h) / 2), w, h)
}

const quadVertex = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const composeFragment = /* glsl */ `
uniform sampler2D uScene;
uniform sampler2D uUi;
uniform sampler2D uStill3d;
uniform sampler2D uFx;
uniform sampler2D uShake3d;
uniform float uDither;
uniform float uHasStill;
uniform float uHasFx;
uniform float uHasShake;
/** Sacudida en fracción de pantalla (desplazamiento entero de píxeles ya dividido). */
uniform vec2 uShake;
/** Desaturado del mundo 3D (0–1), para BANCARROTA. */
uniform float uDesaturate;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;

// Matriz de Bayer 4x4 (umbrales de 0 a 15).
float bayer(ivec2 p) {
  int i = (p.x & 3) + ((p.y & 3) << 2);
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}

void main() {
  // La sacudida mueve el mundo y las capas FX; el HUD y los menús se quedan quietos.
  vec2 suv = vUv - uShake;
  vec3 scene = texture(uScene, clamp(suv, 0.0, 1.0)).rgb;
  scene = mix(scene, vec3(dot(scene, vec3(0.299, 0.587, 0.114))), uDesaturate);
  vec4 ui = texture(uUi, vUv);
  vec3 c = mix(scene, ui.rgb, ui.a);
  if (uHasStill > 0.5) {
    vec4 still = texture(uStill3d, vUv);
    c = mix(c, still.rgb, still.a);
  }
  bool inside = suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0;
  if (uHasFx > 0.5 && inside) {
    vec4 fx = texture(uFx, suv);
    c = mix(c, fx.rgb, fx.a);
  }
  if (uHasShake > 0.5 && inside) {
    vec4 shaken = texture(uShake3d, suv);
    c = mix(c, shaken.rgb, shaken.a);
  }
  // 15 bits: 32 niveles por canal. El umbral de Bayer reparte el error en un patrón fijo.
  float t = uDither > 0.5 ? bayer(ivec2(gl_FragCoord.xy)) : 0.5;
  c = floor(clamp(c, 0.0, 1.0) * 31.0 + t) / 31.0;
  outColor = vec4(c, 1.0);
}
`

const displayFragment = /* glsl */ `
uniform sampler2D uImage;
uniform float uCrt;
uniform vec2 uSource;
uniform vec2 uOutput;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;

vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  uv *= 1.0 + vec2(uv.y * uv.y, uv.x * uv.x) * 0.045;
  return uv * 0.5 + 0.5;
}

vec3 sampleSource(vec2 uv) {
  return texture(uImage, uv).rgb;
}

void main() {
  if (uCrt < 0.5) {
    outColor = vec4(sampleSource(vUv), 1.0);
    return;
  }
  vec2 uv = curve(vUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 px = 1.0 / uSource;
  // Aberración cromática y sangrado horizontal (el compuesto de la tele).
  float r = sampleSource(uv + vec2(px.x * 0.7, 0.0)).r;
  float g = sampleSource(uv).g;
  float b = sampleSource(uv - vec2(px.x * 0.7, 0.0)).b;
  vec3 col = vec3(r, g, b);
  vec3 bleed = sampleSource(uv - vec2(px.x, 0.0)) + sampleSource(uv + vec2(px.x, 0.0));
  col = mix(col, bleed * 0.5, 0.22);
  // Scanlines: una línea oscura entre cada fila de 240.
  float line = abs(cos(3.14159265 * uv.y * uSource.y));
  col *= 1.0 - 0.32 * line * line;
  // Máscara de apertura suave según la columna real de la pantalla.
  int mx = int(mod(gl_FragCoord.x, 3.0));
  vec3 mask = mx == 0 ? vec3(1.06, 0.97, 0.97) : mx == 1 ? vec3(0.97, 1.06, 0.97) : vec3(0.97, 0.97, 1.06);
  col *= mask;
  // Viñeta y compensación de brillo.
  float v = pow(16.0 * uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y), 0.22);
  col *= v * 1.14;
  outColor = vec4(col, 1.0);
}
`

function fullscreenQuad(material: ShaderMaterial): [Scene, Mesh] {
  const scene = new Scene()
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  scene.add(mesh)
  return [scene, mesh]
}

/** Una escena 3D que se pinta encima de la interfaz (iconos de menú, fichas que llueven). */
export interface Overlay3d {
  scene: Scene
  camera: Camera
  /** Si tiembla con la sacudida (capa 5 de FX) o se queda quieta (iconos de los menús). */
  shake: boolean
}

function lowResTarget(): WebGLRenderTarget {
  const rt = new WebGLRenderTarget(PSX_WIDTH, PSX_HEIGHT, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
  })
  rt.texture.colorSpace = NoColorSpace
  return rt
}

export interface PipelineOptions {
  crt: boolean
  dither: boolean
}

function canvas2d(): [HTMLCanvasElement, CanvasRenderingContext2D, CanvasTexture] {
  const canvas = document.createElement('canvas')
  canvas.width = PSX_WIDTH
  canvas.height = PSX_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D no disponible')
  ctx.imageSmoothingEnabled = false
  const texture = new CanvasTexture(canvas)
  texture.minFilter = texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = NoColorSpace
  return [canvas, ctx, texture]
}

export class PsxPipeline {
  readonly renderer: WebGLRenderer
  readonly uiCanvas: HTMLCanvasElement
  readonly ui: CanvasRenderingContext2D
  /** Capa FX 2D (flash, rayos, rótulos de espectáculo, llamas): tiembla con la sacudida. */
  readonly fx: CanvasRenderingContext2D
  /**
   * Sacudida en píxeles enteros de 320×240 (x a la derecha, y hacia abajo). Mueve el mundo y las
   * capas FX; la interfaz no.
   */
  readonly shake = { x: 0, y: 0 }
  /** Si la capa FX 2D tiene algo este fotograma (si no, no se sube la textura). */
  fxDirty = false
  /** Desaturado del mundo 3D (0 = color, 1 = gris). */
  desaturate = 0
  private readonly sceneTarget = lowResTarget()
  private readonly composeTarget = lowResTarget()
  private readonly stillTarget = lowResTarget()
  private readonly shakeTarget = lowResTarget()
  private readonly overlays: Overlay3d[] = []
  private readonly uiTexture: CanvasTexture
  private readonly fxTexture: CanvasTexture
  private readonly compose: ShaderMaterial
  private readonly display: ShaderMaterial
  private readonly composeScene: Scene
  private readonly displayScene: Scene
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private viewport = new Vector4(0, 0, PSX_WIDTH, PSX_HEIGHT)
  options: PipelineOptions = { crt: true, dither: true }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.outputColorSpace = LinearSRGBColorSpace
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.autoClear = false

    ;[this.uiCanvas, this.ui, this.uiTexture] = canvas2d()
    ;[, this.fx, this.fxTexture] = canvas2d()

    this.compose = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: quadVertex,
      fragmentShader: composeFragment,
      uniforms: {
        uScene: { value: this.sceneTarget.texture },
        uUi: { value: this.uiTexture },
        uStill3d: { value: this.stillTarget.texture },
        uFx: { value: this.fxTexture },
        uShake3d: { value: this.shakeTarget.texture },
        uDither: { value: 1 },
        uHasStill: { value: 0 },
        uHasFx: { value: 0 },
        uHasShake: { value: 0 },
        uShake: { value: new Vector2(0, 0) },
        uDesaturate: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.display = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: quadVertex,
      fragmentShader: displayFragment,
      uniforms: {
        uImage: { value: this.composeTarget.texture },
        uCrt: { value: 1 },
        uSource: { value: new Vector2(PSX_WIDTH, PSX_HEIGHT) },
        uOutput: { value: new Vector2(1, 1) },
      },
      depthTest: false,
      depthWrite: false,
    })
    ;[this.composeScene] = fullscreenQuad(this.compose)
    ;[this.displayScene] = fullscreenQuad(this.display)
  }

  /** Ajusta el canvas al tamaño en pantalla (con la densidad de píxeles del dispositivo). */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(cssWidth, cssHeight, false)
    const size = new Vector2()
    this.renderer.getDrawingBufferSize(size)
    this.viewport = letterbox(size.x, size.y)
    ;(this.display.uniforms.uOutput!.value as Vector2).set(this.viewport.z, this.viewport.w)
  }

  /** Rectángulo de la imagen en píxeles CSS (para traducir el ratón a 320×240). */
  cssViewport(pixelRatio: number): { x: number; y: number; w: number; h: number } {
    const v = this.viewport
    return { x: v.x / pixelRatio, y: v.y / pixelRatio, w: v.z / pixelRatio, h: v.w / pixelRatio }
  }

  /**
   * Registra una escena 3D que se pinta encima de la interfaz (varias a la vez, en orden de
   * registro). `shake: true` la mete en la capa que tiembla (FX); por defecto, quieta (menús).
   */
  addOverlay(scene: Scene, camera: Camera, opts: { shake?: boolean } = {}): void {
    this.removeOverlay(scene)
    this.overlays.push({ scene, camera, shake: opts.shake ?? false })
  }

  removeOverlay(scene: Scene): void {
    const i = this.overlays.findIndex(o => o.scene === scene)
    if (i >= 0) this.overlays.splice(i, 1)
  }

  /** Pinta las capas 3D de un tipo en su target (limpio, con alfa 0). Devuelve si hay alguna. */
  private renderOverlays(target: WebGLRenderTarget, shake: boolean): boolean {
    const list = this.overlays.filter(o => o.shake === shake)
    if (list.length === 0) return false
    const r = this.renderer
    r.setRenderTarget(target)
    r.setClearAlpha(0)
    r.clear()
    r.setClearAlpha(1)
    for (const o of list) {
      // Cada capa con su propio z-buffer limpio (no se tapan con la de debajo por profundidad).
      r.clearDepth()
      r.render(o.scene, o.camera)
    }
    return true
  }

  render(scene: Scene, camera: Camera): void {
    const r = this.renderer
    const u = this.compose.uniforms
    u.uDither!.value = this.options.dither ? 1 : 0
    this.display.uniforms.uCrt!.value = this.options.crt ? 1 : 0
    this.uiTexture.needsUpdate = true
    u.uHasFx!.value = this.fxDirty ? 1 : 0
    u.uDesaturate!.value = Math.min(1, Math.max(0, this.desaturate))
    if (this.fxDirty) this.fxTexture.needsUpdate = true
    ;(u.uShake!.value as Vector2).set(
      Math.round(this.shake.x) / PSX_WIDTH,
      // En la textura, v crece hacia arriba: una sacudida hacia abajo resta.
      -Math.round(this.shake.y) / PSX_HEIGHT,
    )

    r.setRenderTarget(this.sceneTarget)
    r.clear()
    r.render(scene, camera)
    u.uHasStill!.value = this.renderOverlays(this.stillTarget, false) ? 1 : 0
    u.uHasShake!.value = this.renderOverlays(this.shakeTarget, true) ? 1 : 0

    r.setRenderTarget(this.composeTarget)
    r.render(this.composeScene, this.quadCamera)

    r.setRenderTarget(null)
    r.setViewport(
      0,
      0,
      r.domElement.width / r.getPixelRatio(),
      r.domElement.height / r.getPixelRatio(),
    )
    r.clear()
    const v = this.viewport
    const pr = r.getPixelRatio()
    r.setViewport(v.x / pr, v.y / pr, v.z / pr, v.w / pr)
    r.render(this.displayScene, this.quadCamera)
  }
}
