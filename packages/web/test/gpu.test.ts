// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
// Aviso de WebGL por software: la detección (contexto con `failIfMajorPerformanceCaveat` y nombre
// del renderer, con la lista de config/web.json), el parámetro `?gpu=software` y el diálogo.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { LOCALES } from '@vibe-gambling/shared/i18n'
import type { Locale } from '@vibe-gambling/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clientConfig, parseClientConfig } from '../src/config.ts'
import { detectSoftwareGpu, isSoftwareRenderer, rendererName } from '../src/render/gpu.ts'
import type { ContextFactory, ProbeContext } from '../src/render/gpu.ts'
import { browserFamily, showGpuWarning, splitStep } from '../src/ui/gpuWarning.ts'
import { translator } from './translators.ts'

// happy-dom cambia el `URL` global: la ruta sale de import.meta.dirname.
const here = import.meta.dirname
const patterns = clientConfig.gpu.softwareRenderers

/** Contexto de mentira con el renderer dado (y si da o no la extensión de depuración). */
function fakeGl(renderer: string, debugInfo = true): ProbeContext & { lost: boolean } {
  const gl = {
    RENDERER: 0x1f01,
    lost: false,
    getExtension(name: string): unknown {
      if (name === 'WEBGL_debug_renderer_info') return debugInfo ? {} : null
      if (name === 'WEBGL_lose_context') return { loseContext: () => (gl.lost = true) }
      return null
    },
    getParameter(pname: number): unknown {
      if (pname === 0x9246) return renderer
      if (pname === 0x1f01) return 'WebKit WebGL'
      return null
    },
  }
  return gl
}

/** Fábrica que da `strict` con la opción de rendimiento y `loose` sin ella. */
function factory(strict: ProbeContext | null, loose: ProbeContext | null): ContextFactory {
  return attributes => (attributes.failIfMajorPerformanceCaveat ? strict : loose)
}

describe('detección de WebGL por software', () => {
  it('la lista de config/web.json trae los rasterizadores conocidos', () => {
    for (const name of [
      'Google SwiftShader',
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      'llvmpipe (LLVM 17.0.6, 256 bits)',
      'softpipe',
      'Microsoft Basic Render Driver',
      'Software Rasterizer',
    ]) {
      expect(isSoftwareRenderer(name, patterns), name).toBe(true)
    }
    for (const name of [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)',
      'Apple M2',
      'Mesa Intel(R) UHD Graphics 620 (KBL GT2)',
      'AMD Radeon RX 7800 XT (radeonsi, navi32, LLVM 17.0.6)',
    ]) {
      expect(isSoftwareRenderer(name, patterns), name).toBe(false)
    }
  })

  it('el contexto exigente falla y el normal no: el navegador avisa de que irá lento', () => {
    const loose = fakeGl('Google SwiftShader')
    const check = detectSoftwareGpu(patterns, false, factory(null, loose))
    expect(check).toEqual({ software: true, reason: 'caveat', renderer: 'Google SwiftShader' })
    // El contexto de prueba se libera.
    expect(loose.lost).toBe(true)
  })

  it('con contexto exigente, decide el nombre del renderer', () => {
    const soft = detectSoftwareGpu(patterns, false, factory(fakeGl('llvmpipe (LLVM 17)'), null))
    expect(soft).toMatchObject({ software: true, reason: 'renderer' })
    const gpu = fakeGl('Apple M2')
    expect(detectSoftwareGpu(patterns, false, factory(gpu, null))).toEqual({
      software: false,
      reason: null,
      renderer: 'Apple M2',
    })
    expect(gpu.lost).toBe(true)
  })

  it('sin WEBGL_debug_renderer_info usa el renderer genérico (que no delata nada)', () => {
    const gl = fakeGl('llvmpipe', false)
    expect(rendererName(gl)).toBe('WebKit WebGL')
    expect(detectSoftwareGpu(patterns, false, factory(gl, null)).software).toBe(false)
  })

  it('sin WebGL2 de ningún tipo no es "software" (de eso se encarga el aviso de sin WebGL)', () => {
    expect(detectSoftwareGpu(patterns, false, factory(null, null)).software).toBe(false)
  })

  it('?gpu=software lo fuerza sin crear contextos', () => {
    const create = vi.fn<ContextFactory>(() => null)
    expect(detectSoftwareGpu(patterns, true, create)).toEqual({
      software: true,
      reason: 'forced',
      renderer: null,
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('la lista se valida con zod: vacía o con cadenas vacías no arranca', () => {
    const raw = JSON.parse(readFileSync(resolve(here, '../../../config/web.json'), 'utf8')) as {
      gpu: { softwareRenderers: string[] }
    }
    expect(() => parseClientConfig(raw)).not.toThrow()
    expect(() => parseClientConfig({ ...raw, gpu: { softwareRenderers: [] } })).toThrow(/gpu/)
    expect(() => parseClientConfig({ ...raw, gpu: { softwareRenderers: [''] } })).toThrow(/gpu/)
    const { gpu: _gpu, ...withoutGpu } = raw
    expect(() => parseClientConfig(withoutGpu)).toThrow(/gpu/)
  })
})

describe('diálogo del aviso', () => {
  const UA = {
    chrome:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
    safari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mount(): void {
    const html = readFileSync(resolve(here, '../play.html'), 'utf8')
    const dialog = /<dialog[\s\S]*?<\/dialog>/.exec(html)?.[0]
    if (!dialog) throw new Error('play.html sin el diálogo del aviso')
    document.body.innerHTML = `<canvas id="screen" tabindex="0"></canvas>${dialog}`
  }

  it('reconoce la familia del navegador para poner primero sus instrucciones', () => {
    expect(browserFamily(UA.chrome)).toBe('chrome')
    expect(browserFamily(UA.edge)).toBe('chrome')
    expect(browserFamily(UA.firefox)).toBe('firefox')
    expect(browserFamily(UA.safari)).toBe('safari')
  })

  it.each(LOCALES.map(l => [l]))('%s: cada paso empieza por el navegador y no enlaza nada', l => {
    const tr = translator(l as Locale)
    for (const family of ['chrome', 'firefox', 'safari'] as const) {
      const step = tr.t(`gpu.${family}`)
      const parts = splitStep(step)
      expect(parts, step).not.toBeNull()
      expect(parts!.name).toMatch(family === 'chrome' ? /Chrome/ : new RegExp(family, 'i'))
      // Los navegadores bloquean los enlaces chrome:// y about:: solo el texto de la ruta.
      expect(step).not.toMatch(/chrome:\/\/|about:/)
    }
  })

  it('se abre con el foco en ENTENDIDO, ordena por navegador y no deja pasar las teclas', () => {
    mount()
    const canvas = document.getElementById('screen')!
    const onNever = vi.fn()
    const dialog = showGpuWarning({
      tr: translator('es'),
      onNever,
      returnFocus: canvas,
      userAgent: UA.firefox,
    })!
    expect(dialog.open).toBe(true)
    expect(document.getElementById('gpu-title')!.textContent).toBe('TU NAVEGADOR DIBUJA A MANO')
    const items = [...document.querySelectorAll<HTMLLIElement>('#gpu-steps li')]
    expect(items.map(li => li.dataset.browser)).toEqual(['firefox', 'chrome', 'safari'])
    expect(items[0]!.className).toBe('current')
    expect(items[0]!.querySelector('strong')!.textContent).toBe('Firefox')
    expect(document.activeElement?.id).toBe('gpu-ok')
    // Escape o Enter dentro del aviso no llegan al juego (escucha en window).
    const game = vi.fn()
    window.addEventListener('keydown', game)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(game).not.toHaveBeenCalled()
    document.getElementById('gpu-ok')!.click()
    expect(dialog.open).toBe(false)
    expect(onNever).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(canvas)
    // Cerrado, las teclas vuelven al juego.
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
    expect(game).toHaveBeenCalledTimes(1)
    window.removeEventListener('keydown', game)
  })

  it('NO VOLVER A MOSTRAR guarda la preferencia y cierra', () => {
    mount()
    const onNever = vi.fn()
    const dialog = showGpuWarning({
      tr: translator('en'),
      onNever,
      returnFocus: null,
      userAgent: UA.chrome,
    })!
    expect(document.getElementById('gpu-never')!.textContent).toBe('DON’T SHOW AGAIN')
    document.getElementById('gpu-never')!.click()
    expect(onNever).toHaveBeenCalledTimes(1)
    expect(dialog.open).toBe(false)
  })

  it('sin el diálogo en la página no hace nada', () => {
    const shown = showGpuWarning({
      tr: translator('es'),
      onNever: () => undefined,
      returnFocus: null,
    })
    expect(shown).toBeNull()
  })
})
