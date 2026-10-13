// SPDX-License-Identifier: AGPL-3.0-or-later
// ¿Dibuja el navegador WebGL por software? (aceleración por hardware desactivada, sin drivers o en
// una máquina virtual). La ruleta funciona igual, pero va a tirones: la ventana lo avisa.
// Va aparte de pipeline.ts (junto a `hasWebGL2()`) para no arrastrar Three.js a la entrada de
// /play: esto se comprueba antes de cargar el juego.

/** Por qué se cree que es software. */
export type SoftwareReason = 'caveat' | 'renderer' | 'forced'

export interface GpuCheck {
  software: boolean
  reason: SoftwareReason | null
  /** Nombre del renderer, si el navegador lo da (solo para el registro de la consola). */
  renderer: string | null
}

/** Lo mínimo de un contexto WebGL que hace falta aquí (los tests pasan uno de mentira). */
export interface ProbeContext {
  getExtension(name: string): unknown
  getParameter(pname: number): unknown
  readonly RENDERER: number
}

/** Crea un contexto webgl2 de prueba en un canvas nuevo (o null si no se puede). */
export type ContextFactory = (attributes: WebGLContextAttributes) => ProbeContext | null

/** `UNMASKED_RENDERER_WEBGL` de `WEBGL_debug_renderer_info` (constante de la especificación). */
const UNMASKED_RENDERER_WEBGL = 0x9246

function browserFactory(attributes: WebGLContextAttributes): ProbeContext | null {
  try {
    // Un canvas por intento: un canvas devuelve siempre el primer contexto que se le pidió.
    return document.createElement('canvas').getContext('webgl2', attributes)
  } catch {
    return null
  }
}

/** Libera el contexto de prueba (los navegadores limitan cuántos puede haber vivos). */
function release(gl: ProbeContext): void {
  const lose = gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null
  lose?.loseContext()
}

/** Nombre del renderer: el de `WEBGL_debug_renderer_info` si está, si no el genérico. */
export function rendererName(gl: ProbeContext): string | null {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const raw = gl.getParameter(info ? UNMASKED_RENDERER_WEBGL : gl.RENDERER)
    return typeof raw === 'string' && raw.trim() !== '' ? raw : null
  } catch {
    return null
  }
}

/** ¿Delata el nombre del renderer un rasterizador por software? (sin distinguir mayúsculas) */
export function isSoftwareRenderer(name: string, patterns: readonly string[]): boolean {
  const lower = name.toLowerCase()
  return patterns.some(p => lower.includes(p.toLowerCase()))
}

/**
 * Detecta WebGL por software:
 * 1. Un contexto con `failIfMajorPerformanceCaveat` que falla cuando uno normal sí sale: el propio
 *    navegador dice que va a ir lento (así lo hacen Chrome y Firefox con el rasterizador de CPU).
 * 2. Si no, el nombre del renderer contiene alguno de `patterns` (config/web.json, `gpu`).
 * `force` (el parámetro `?gpu=software`, para los tests) solo cambia el resultado de esta función.
 */
export function detectSoftwareGpu(
  patterns: readonly string[],
  force = false,
  create: ContextFactory = browserFactory,
): GpuCheck {
  if (force) return { software: true, reason: 'forced', renderer: null }
  const strict = create({ failIfMajorPerformanceCaveat: true })
  if (!strict) {
    const loose = create({})
    if (!loose) return { software: false, reason: null, renderer: null }
    const renderer = rendererName(loose)
    release(loose)
    return { software: true, reason: 'caveat', renderer }
  }
  const renderer = rendererName(strict)
  release(strict)
  if (renderer && isSoftwareRenderer(renderer, patterns)) {
    return { software: true, reason: 'renderer', renderer }
  }
  return { software: false, reason: null, renderer }
}
