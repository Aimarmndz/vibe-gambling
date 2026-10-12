// SPDX-License-Identifier: AGPL-3.0-or-later
// Material "PSX": vertex snapping a la rejilla de 320×240, UV sin corrección de perspectiva (affine),
// luz Gouraud por vértice, niebla por vértice y sin mipmaps.
// GLSL ES 3.00 (WebGL2) no tiene `noperspective`: se interpola uv·w y w (con corrección de perspectiva)
// y se divide en el fragment, que deja la interpolación lineal en pantalla, como la de la consola.
import { Color, DoubleSide, FrontSide, GLSL3, ShaderMaterial, Vector2, Vector3 } from 'three'
import type { Texture } from 'three'

/** Uniformes compartidos por todos los materiales de la escena (se cambian una vez por frame). */
export interface PsxUniforms {
  uResolution: { value: Vector2 }
  uSnap: { value: number }
  uFogColor: { value: Color }
  uFogNear: { value: number }
  uFogFar: { value: number }
  uLightDir: { value: Vector3 }
  uLightColor: { value: Color }
  uAmbient: { value: Color }
  uPointPos: { value: Vector3 }
  uPointColor: { value: Color }
}

export function createPsxUniforms(width: number, height: number): PsxUniforms {
  return {
    uResolution: { value: new Vector2(width, height) },
    uSnap: { value: 1 },
    uFogColor: { value: new Color(0x0a0c22) },
    uFogNear: { value: 6 },
    uFogFar: { value: 17 },
    uLightDir: { value: new Vector3(-0.35, 1, 0.5).normalize() },
    uLightColor: { value: new Color(0.78, 0.72, 0.6) },
    uAmbient: { value: new Color(0.32, 0.32, 0.42) },
    uPointPos: { value: new Vector3(0, 4.5, -1) },
    uPointColor: { value: new Color(0.55, 0.45, 0.3) },
  }
}

const vertexShader = /* glsl */ `
uniform vec2 uResolution;
uniform float uSnap;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uPointPos;
uniform vec3 uPointColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uColor;
uniform float uUnlit;
uniform float uSpecular;

out vec3 vUvW;
out vec3 vLight;
out float vFog;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mv;
  // Vertex snapping: la posición en pantalla se redondea al píxel de 320x240 (el tembleque).
  if (uSnap > 0.5 && clip.w > 0.0) {
    vec2 grid = uResolution * 0.5;
    clip.xy = clip.w * (floor(clip.xy / clip.w * grid + 0.5) / grid);
  }
  gl_Position = clip;
  vUvW = vec3(uv * clip.w, clip.w);

  // Luz por vértice (Gouraud), como el hardware de la época: una direccional y una lámpara.
  vec3 n = normalize(normalMatrix * normal);
  vec3 L = normalize((viewMatrix * vec4(uLightDir, 0.0)).xyz);
  vec3 toLamp = (viewMatrix * vec4(uPointPos, 1.0)).xyz - mv.xyz;
  float dist = length(toLamp);
  float lamp = max(dot(n, toLamp / dist), 0.0) / (1.0 + dist * dist * 0.03);
  vec3 lit = uAmbient + uLightColor * max(dot(n, L), 0.0) + uPointColor * lamp;
  vec3 V = normalize(-mv.xyz);
  float spec = pow(max(dot(n, normalize(L + V)), 0.0), 20.0) * uSpecular;

  vec3 base = uColor;
#ifdef USE_COLOR
  base *= color;
#endif
  vLight = mix(base * lit + vec3(spec), base, uUnlit);
  vFog = clamp((-mv.z - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float uHasMap;
uniform vec3 uFogColor;

in vec3 vUvW;
in vec3 vLight;
in float vFog;
layout(location = 0) out highp vec4 outColor;

void main() {
  vec2 uvAffine = vUvW.xy / vUvW.z;
  vec4 tex = uHasMap > 0.5 ? texture(map, uvAffine) : vec4(1.0);
  // Sin mezcla de transparencias: los texeles casi transparentes se descartan, como en la época.
  if (tex.a < 0.5) discard;
  vec3 c = tex.rgb * vLight;
  c = mix(c, uFogColor, vFog);
  outColor = vec4(c, 1.0);
}
`

export interface PsxMaterialOptions {
  map?: Texture | null
  color?: number | Color
  vertexColors?: boolean
  /** 0 = iluminado, 1 = sin luz (pantallas, letreros). */
  unlit?: number
  specular?: number
  doubleSided?: boolean
}

export function createPsxMaterial(
  shared: PsxUniforms,
  opts: PsxMaterialOptions = {},
): ShaderMaterial {
  const color = opts.color instanceof Color ? opts.color : new Color(opts.color ?? 0xffffff)
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms: {
      ...shared,
      map: { value: opts.map ?? null },
      uHasMap: { value: opts.map ? 1 : 0 },
      uColor: { value: color },
      uUnlit: { value: opts.unlit ?? 0 },
      uSpecular: { value: opts.specular ?? 0 },
    },
    vertexColors: opts.vertexColors ?? false,
    side: opts.doubleSided ? DoubleSide : FrontSide,
  })
  return material
}
