// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
// Página /privacy: lo que depende de la instancia sale de /config.json (nunca de la oficial).
import { webConfigSchema } from '@vibe-gambling/shared'
import type { WebConfig } from '@vibe-gambling/shared'
import { describe, expect, it } from 'vitest'

import { translator } from './translators.ts'
import {
  fillParts,
  formatDuration,
  PRIVACY_SECTIONS,
  renderPrivacy,
  sectionParagraphs,
} from '../src/pages/privacy.ts'
import { testWebConfig } from './fixtures.ts'

const en = translator('en')
const es = translator('es')

function render(web: WebConfig | null, tr = en): HTMLElement {
  const root = document.createElement('div')
  renderPrivacy(root, web, tr)
  return root
}

/** Texto de una sección (sus párrafos). */
function section(web: WebConfig | null, id: (typeof PRIVACY_SECTIONS)[number], tr = en): string {
  return sectionParagraphs(id, web, tr)
    .map(p => p.textContent)
    .join('\n')
}

/** Copia de la configuración de test con otra `site.instance` y otro bloque `privacy`. */
function withInstance(
  instance: Partial<WebConfig['site']['instance']>,
  privacy: Partial<WebConfig['privacy']> = {},
): WebConfig {
  return webConfigSchema.parse({
    ...testWebConfig,
    privacy: { ...testWebConfig.privacy, ...privacy },
    site: { ...testWebConfig.site, instance: { ...testWebConfig.site.instance, ...instance } },
  })
}

describe('página de privacidad', () => {
  it('pinta las nueve secciones con su título, en los dos idiomas', () => {
    for (const tr of [en, es]) {
      const root = render(testWebConfig, tr)
      const titles = [...root.querySelectorAll('h2')].map(h => h.textContent)
      expect(titles).toHaveLength(PRIVACY_SECTIONS.length)
      expect(new Set(titles).size).toBe(PRIVACY_SECTIONS.length)
      for (const p of root.querySelectorAll('p')) expect(p.textContent).not.toMatch(/\{\w+\}/)
    }
  })

  it('quién opera la instancia y dónde está salen de la configuración', () => {
    const where = section(testWebConfig, 'where')
    expect(where).toContain('Test Operator')
    expect(where).toContain('a test box in the EU')
    expect(where).not.toMatch(/IONOS|Aimar|Cloudflare/)
    expect(section(testWebConfig, 'where', es)).toContain('una máquina de pruebas en la UE')
    const link = sectionParagraphs('where', testWebConfig, en)[0]!.querySelector('a')!
    expect(link.getAttribute('href')).toBe('https://example.invalid/operator')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('nombra el proxy de red (que ve la IP) solo si la instancia tiene uno', () => {
    expect(section(testWebConfig, 'where')).toMatch(/Test CDN .*IP address/)
    expect(section(withInstance({ networkProxy: null }), 'where')).not.toContain('proxy')
  })

  it('dice de dónde carga el navegador los avatares (que ve la IP)', () => {
    expect(section(testWebConfig, 'where')).toContain('avatars.example.invalid')
    const two = withInstance(
      {},
      { imageOrigins: ['https://a.example.invalid', 'http://localhost:8788'] },
    )
    expect(section(two, 'where')).toContain('a.example.invalid, localhost:8788')
    const none = section(withInstance({}, { imageOrigins: [] }), 'where')
    expect(none).toContain(en.t('privacy.where.noImages'))
    // Un origen que no es URL (no pasaría el contrato) se enseña tal cual, sin romper la página.
    const odd = { ...testWebConfig, privacy: { ...testWebConfig.privacy, imageOrigins: ['?'] } }
    expect(section(odd, 'where')).toContain('straight from ?,')
  })

  it('los plazos salen del servidor y la retención de las copias de la configuración', () => {
    const howLong = section(testWebConfig, 'howLong')
    expect(howLong).toContain('365 days for the plugin and 30 days for the window')
    expect(howLong).toContain('1 minute, single use')
    expect(howLong).toContain('Backups are kept for 14 days')
    expect(section(testWebConfig, 'howLong', es)).toContain('se guardan 14 días')
    const noBackups = section(withInstance({ backupRetentionDays: null }), 'howLong')
    expect(noBackups).toContain(en.t('privacy.howLong.noBackups'))
    expect(noBackups).not.toContain('Backups are kept')
    expect(section(withInstance({ backupRetentionDays: 1 }), 'howLong')).toContain('for 1 day,')
  })

  it('cuánto vive la IP en memoria sale de la ventana del límite del servidor', () => {
    expect(section(testWebConfig, 'howLong')).toContain('Your IP address: 1 minute in memory')
    const ten = withInstance({}, { ipMemorySeconds: 600 })
    expect(section(ten, 'howLong')).toContain('Your IP address: 10 minutes in memory')
    expect(section(ten, 'howLong', es)).toContain('Tu IP: 10 minutos en memoria')
    // Lo que se guarda ya no promete un plazo escrito a mano.
    expect(section(ten, 'stored')).not.toMatch(/minute/)
    expect(section(ten, 'stored', es)).not.toMatch(/minuto/)
  })

  it('el contacto enlaza al de la instancia', () => {
    const [p] = sectionParagraphs('contact', testWebConfig, en)
    const links = [...p!.querySelectorAll('a')].map(a => a.getAttribute('href'))
    expect(links).toEqual(['https://example.invalid/operator', 'https://example.invalid/contact'])
    expect(p!.textContent).toContain('example.invalid/contact')
  })

  it('cuenta que se guarda cuándo empezó y terminó cada turno', () => {
    expect(section(testWebConfig, 'stored')).toMatch(/turns \(when each one started and ended/)
    expect(section(testWebConfig, 'stored', es)).toMatch(/turnos \(cuándo empezó y terminó/)
  })

  it('cuenta el SO "other" y que no se guarda la IP', () => {
    expect(section(testWebConfig, 'sent')).toContain('win32 or other')
    expect(section(testWebConfig, 'sent', es)).toContain('win32 u other')
    expect(section(testWebConfig, 'stored')).toMatch(/IP address .*never written down/)
  })

  it('sin configuración, la política se lee igual y avisa de lo que falta', () => {
    const root = render(null)
    expect(root.querySelectorAll('h2')).toHaveLength(PRIVACY_SECTIONS.length)
    const unknown = en.t('privacy.instance.unknown')
    for (const id of ['where', 'howLong', 'contact'] as const) {
      expect(section(null, id)).toContain(unknown)
    }
    expect(root.querySelectorAll('a')).toHaveLength(0)
    expect(root.textContent).toContain(en.t('privacy.sent.body'))
  })
})

describe('fillParts', () => {
  it('mete nodos y textos en los marcadores, en orden', () => {
    const a = document.createElement('a')
    const parts = fillParts('{x} and {y}.', { x: a, y: 'text' })
    expect(parts).toEqual([a, ' and ', 'text', '.'])
  })

  it('un nodo repetido sale en todos sus marcadores (no se mueve de uno a otro)', () => {
    const a = document.createElement('a')
    a.textContent = 'link'
    const p = document.createElement('p')
    p.append(...fillParts('{x} and {x}', { x: a }))
    expect(p.textContent).toBe('link and link')
    expect(p.querySelectorAll('a')).toHaveLength(2)
  })

  it('deja a la vista los marcadores sin valor', () => {
    expect(fillParts('a {missing} b', {}).join('')).toBe('a {missing} b')
    expect(fillParts('no markers', {})).toEqual(['no markers'])
    expect(fillParts('{x}', { x: 'only' })).toEqual(['only'])
  })
})

describe('formatDuration', () => {
  it('usa la mayor unidad exacta, con singular y plural por idioma', () => {
    expect(formatDuration(86_400, en)).toBe('1 day')
    expect(formatDuration(2_592_000, en)).toBe('30 days')
    expect(formatDuration(7_200, en)).toBe('2 hours')
    expect(formatDuration(3_600, es)).toBe('1 hora')
    expect(formatDuration(60, es)).toBe('1 minuto')
    expect(formatDuration(90, en)).toBe('90 seconds')
    expect(formatDuration(1, es)).toBe('1 segundo')
    expect(formatDuration(31_536_000, es)).toBe('365 días')
    expect(formatDuration(1_209_600_000, es)).toBe('14.000 días')
  })
})
