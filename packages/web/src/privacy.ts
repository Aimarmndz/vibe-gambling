// SPDX-License-Identifier: AGPL-3.0-or-later
// Página /privacy (en todos los idiomas de locales/): qué se guarda, para qué, dónde, cuánto tiempo y cómo borrar la cuenta.
// El contenido (y lo que depende de la instancia) está en pages/privacy.ts.
// Sin analíticas ni cookies de seguimiento: esta página no carga nada de terceros.
// Primero de todo: zod sin `new Function` (CSP sin 'unsafe-eval'), ver zodJitless.ts.
import './zodJitless.ts'
import './styles/landing.css'

import type { WebConfig } from '@vibe-gambling/shared'

import { loadWebConfig } from './config.ts'
import { applyI18n, el, renderFooter, withLanguage } from './pages/common.ts'
import { renderPrivacy } from './pages/privacy.ts'

async function main(): Promise<void> {
  let web: WebConfig | null = null
  try {
    web = await loadWebConfig()
  } catch (error) {
    // La política se puede leer igual: faltan los datos de la instancia (se avisa) y el pie.
    console.warn('[privacy] sin configuración de la instancia', error)
  }
  await withLanguage(tr => {
    applyI18n(document, tr)
    document.title = `${tr.t('privacy.title')} — vibe-gambling`
    renderPrivacy(document.getElementById('sections')!, web, tr)
    const footer = document.getElementById('footer')!
    if (web) {
      renderFooter(footer, web, tr)
    } else {
      footer.replaceChildren(el('p', { class: 'muted' }, tr.t('footer.disclaimer')))
    }
  })
}

main().catch((error: unknown) => console.error('[privacy] error al arrancar', error))
