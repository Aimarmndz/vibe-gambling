// SPDX-License-Identifier: AGPL-3.0-or-later
// Página /privacy (EN/ES): qué se guarda, para qué, dónde, cuánto tiempo y cómo borrar la cuenta.
// Sin analíticas ni cookies de seguimiento: esta página no carga nada de terceros.
import './styles/landing.css'

import type { WebConfig } from '@vibe-gambling/shared'

import { loadWebConfig } from './config.ts'
import type { MessageKey } from './i18n/index.ts'
import { applyI18n, el, renderFooter, withLanguage } from './pages/common.ts'

/** Secciones de la página, en orden. Cada una tiene `<id>.title` y `<id>.body` en i18n. */
const SECTIONS = [
  'sent',
  'stored',
  'why',
  'where',
  'howLong',
  'cookies',
  'leaderboard',
  'delete',
  'contact',
] as const

async function main(): Promise<void> {
  let web: WebConfig | null = null
  try {
    web = await loadWebConfig()
  } catch (error) {
    // La política se puede leer igual: solo falta el pie con los enlaces de la instancia.
    console.warn('[privacy] sin configuración de la instancia', error)
  }
  withLanguage(tr => {
    applyI18n(document, tr)
    document.title = `${tr.t('privacy.title')} — vibe-gambling`
    const root = document.getElementById('sections')!
    root.replaceChildren(
      ...SECTIONS.flatMap(id => [
        el('h2', {}, tr.t(`privacy.${id}.title` as MessageKey)),
        el('p', {}, tr.t(`privacy.${id}.body` as MessageKey)),
      ]),
    )
    const footer = document.getElementById('footer')!
    if (web) {
      renderFooter(footer, web, tr, () => document.dispatchEvent(new Event('vg:toggle-language')))
    } else {
      footer.replaceChildren(el('p', { class: 'muted' }, tr.t('footer.disclaimer')))
    }
  })
}

main().catch((error: unknown) => console.error('[privacy] error al arrancar', error))
