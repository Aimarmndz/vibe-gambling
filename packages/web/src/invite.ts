// SPDX-License-Identifier: AGPL-3.0-or-later
// Página /r/<código> del Programa de Afiliados Piramidal (legalmente distinto): quién te invita,
// qué ganas y cómo entrar. El contenido está en pages/invite.ts. Sin nada de terceros salvo el
// avatar de GitHub de quien invita (como en el ranking).
// Primero de todo: zod sin `new Function` (CSP sin 'unsafe-eval'), ver zodJitless.ts.
import './zodJitless.ts'
import './styles/landing.css'

import { clientConfig, loadWebConfig } from './config.ts'
import type { Translator } from './i18n/index.ts'
import { fetchReferralLookup } from './net/api.ts'
import { applyI18n, renderFooter, withLanguage } from './pages/common.ts'
import { codeFromPath, renderInvite, stateOf } from './pages/invite.ts'
import type { InviteState } from './pages/invite.ts'

async function main(): Promise<void> {
  const web = await loadWebConfig()
  const code = codeFromPath(location.pathname)
  let state: InviteState = code ? { kind: 'loading' } : { kind: 'missing' }
  let tr: Translator | null = null
  const paint = () => {
    if (tr) renderInvite(document, { web, tr, code, state })
  }

  // Botones de copiar: cada uno copia el texto de su `<code>`.
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(button => {
    button.addEventListener('click', () => {
      const text = document.getElementById(button.dataset.copy ?? '')?.textContent ?? ''
      navigator.clipboard.writeText(text).then(
        () => {
          if (!tr) return
          button.textContent = tr.t('landing.copied')
          setTimeout(
            () => tr && (button.textContent = tr.t('landing.copy')),
            clientConfig.ui.toastMs,
          )
        },
        (error: unknown) => console.warn('[invite] no se pudo copiar', error),
      )
    })
  })

  await withLanguage(next => {
    tr = next
    applyI18n(document, next)
    document.title = next.t('invite.title')
    paint()
    renderFooter(document.getElementById('footer')!, web, next)
  })

  if (code) {
    fetchReferralLookup(code).then(
      lookup => {
        state = stateOf(lookup)
        paint()
      },
      (error: unknown) => {
        // Sin respuesta no se sabe si existe: se trata como inexistente (se puede jugar igual).
        console.warn('[invite] no se pudo comprobar el código', error)
        state = { kind: 'missing' }
        paint()
      },
    )
  }
}

main().catch((error: unknown) => console.error('[invite] error al arrancar', error))
