// SPDX-License-Identifier: AGPL-3.0-or-later
// Pipeline PSX en tres pasadas:
//   1. La escena 3D a un render target de 320×240 (sin antialias, filtro nearest).
//   2. Compuesto con la capa de interfaz (canvas 2D de 320×240) y reducción a color de 15 bits
//      (5 bits por canal) con dithering ordenado Bayer 4×4, como hacía la consola.
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
uniform float uDither;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;

// Matriz de Bayer 4x4 (umbrales de 0 a 15).
float bayer(ivec2 p) {
  int i = (p.x & 3) + ((p.y & 3) << 2);
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}

void main() {
  vec3 scene = texture(uScene, vUv).rgb;
  vec4 ui = texture(uUi, vUv);
  vec3 c = mix(scene, ui.rgb, ui.a);
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

export class PsxPipeline {
  readonly renderer: WebGLRenderer
  readonly uiCanvas: HTMLCanvasElement
  readonly ui: CanvasRenderingContext2D
  private readonly sceneTarget = lowResTarget()
  private readonly composeTarget = lowResTarget()
  private readonly uiTexture: CanvasTexture
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

    this.uiCanvas = document.createElement('canvas')
    this.uiCanvas.width = PSX_WIDTH
    this.uiCanvas.height = PSX_HEIGHT
    const ui = this.uiCanvas.getContext('2d')
    if (!ui) throw new Error('canvas 2D no disponible')
    ui.imageSmoothingEnabled = false
    this.ui = ui
    this.uiTexture = new CanvasTexture(this.uiCanvas)
    this.uiTexture.minFilter = this.uiTexture.magFilter = NearestFilter
    this.uiTexture.generateMipmaps = false
    this.uiTexture.colorSpace = NoColorSpace

    this.compose = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: quadVertex,
      fragmentShader: composeFragment,
      uniforms: {
        uScene: { value: this.sceneTarget.texture },
        uUi: { value: this.uiTexture },
        uDither: { value: 1 },
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

  render(scene: Scene, camera: Camera): void {
    const r = this.renderer
    this.compose.uniforms.uDither!.value = this.options.dither ? 1 : 0
    this.display.uniforms.uCrt!.value = this.options.crt ? 1 : 0
    this.uiTexture.needsUpdate = true

    r.setRenderTarget(this.sceneTarget)
    r.clear()
    r.render(scene, camera)

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
