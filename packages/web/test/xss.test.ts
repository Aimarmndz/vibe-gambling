// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
// Datos hostiles del servidor (logins, etiquetas, URLs) en las páginas HTML: se pintan como texto
// (nunca como HTML) y los enlaces que no son http(s) no se convierten en enlaces.
import { webConfigSchema } from '@vibe-gambling/shared'
import { describe, expect, it } from 'vitest'

import { createTranslator } from '../src/i18n/index.ts'
import { externalLink, renderFooter } from '../src/pages/common.ts'
import { testWebConfig } from './fixtures.ts'

const payload = '<img src=x onerror="globalThis.pwned=1">'

describe('XSS en las páginas', () => {
  it('externalLink pinta el texto tal cual y descarta esquemas peligrosos', () => {
    const ok = externalLink('https://github.com/x', payload)
    expect(ok.tagName).toBe('A')
    expect(ok.textContent).toBe(payload)
    expect(ok.querySelector('img')).toBeNull()
    expect(ok.getAttribute('rel')).toBe('noopener noreferrer')
    const bad = externalLink('javascript://github.com/%0Aalert(1)', 'perfil')
    expect(bad.tagName).toBe('SPAN')
    expect(bad.getAttribute('href')).toBeNull()
  })

  it('el pie no ejecuta nada aunque la configuración de la instancia sea hostil', () => {
    const web = webConfigSchema.parse({
      ...testWebConfig,
      site: {
        ...testWebConfig.site,
        author: { name: payload, url: 'javascript://evil.test/%0Aalert(1)' },
        helpLinks: { en: [{ label: payload, url: 'data:text/html,hola' }], es: [] },
      },
    })
    const footer = document.createElement('footer')
    renderFooter(footer, web, createTranslator('en'), () => undefined)
    expect(footer.querySelector('img')).toBeNull()
    expect(footer.textContent).toContain(payload)
    for (const a of footer.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^(javascript|data):/i)
    }
    expect((globalThis as { pwned?: number }).pwned).toBeUndefined()
  })
})
