// SPDX-License-Identifier: AGPL-3.0-or-later
// Piezas comunes de las páginas HTML (landing y privacidad): textos con data-i18n, idioma y pie.
import { forLocale } from '@vibe-gambling/shared'
import type { Locale, WebConfig } from '@vibe-gambling/shared'

import { loadPrefs, safeStorage, savePrefs } from '../app/prefs.ts'
import { attribution } from '../legal/attribution.ts'
import { webUrl } from '../net/urls.ts'
import { LANGUAGES, applyDocumentLanguage, detectLocale, loadTranslator } from '../i18n/index.ts'
import type { Translator } from '../i18n/index.ts'
import { flagCanvas } from '../ui/flags.ts'

/** Idioma inicial: el guardado por el usuario → el del navegador → inglés. */
export function initialLocale(): Locale {
  return loadPrefs(safeStorage('local')).locale ?? detectLocale(navigator.languages)
}

/** Guarda el idioma elegido (lo comparten la landing, la privacidad y la ventana del juego). */
export function rememberLocale(locale: Locale): void {
  const storage = safeStorage('local')
  savePrefs(storage, { ...loadPrefs(storage), locale })
}

/** Rellena todos los elementos con `data-i18n="clave"`. */
export function applyI18n(root: ParentNode, tr: Translator): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n ?? ''
    if (tr.has(key)) el.textContent = tr.t(key)
    else console.warn(`[i18n] clave desconocida: ${key}`)
  })
  applyDocumentLanguage(tr)
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  if (text !== undefined) node.textContent = text
  return node
}

/** Enlace externo en otra pestaña; si la URL no es http(s), solo el texto (sin enlace). */
export function externalLink(href: string, text: string): HTMLAnchorElement | HTMLSpanElement {
  const safe = webUrl(href)
  if (!safe) return el('span', {}, text)
  return el('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, text)
}

/**
 * Pie siempre visible: "Created by Aimar (github.com/Aimarmndz) · Fake coins only. If real
 * gambling worries you: …" con los enlaces de ayuda del idioma, el descargo de marcas y enlaces.
 */
export function renderFooter(root: HTMLElement, web: WebConfig, tr: Translator): void {
  root.replaceChildren()
  // Atribución obligatoria (términos 7(b) de LICENSE), con la URL del autor como enlace.
  const credit = attribution(web.site.author, tr)
  const line1 = el('p')
  const who = el('span', { class: 'attribution' })
  who.append(credit.before, externalLink(credit.href, credit.label), credit.after)
  line1.append(who, ` · ${tr.t('footer.fakeCoins')} `)
  const help = forLocale(web.site.helpLinks, tr.locale)
  help.forEach((link, i) => {
    if (i > 0) line1.append(' · ')
    line1.append(externalLink(link.url, link.label))
  })
  const line2 = el('p', { class: 'muted' }, tr.t('footer.disclaimer'))
  const nav = el('p', { class: 'footer-nav' })
  nav.append(
    el('a', { href: '/' }, tr.t('footer.home')),
    ' · ',
    el('a', { href: '/privacy' }, tr.t('footer.privacy')),
    ' · ',
    externalLink(web.site.repoUrl, tr.t('footer.source')),
  )
  root.append(line1, line2, nav)
}

/**
 * Selector de idioma con banderas: un botón por idioma, con `lang` y `aria-label` en el propio
 * idioma ("Français"), `aria-pressed` en el actual y la bandera en pixel art.
 */
export function renderLanguagePicker(
  root: HTMLElement,
  tr: Translator,
  onPick: (locale: Locale) => void,
): void {
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', tr.t('footer.languages'))
  // Se crean una vez; al cambiar de idioma solo cambia cuál está pulsado (y el foco no se pierde).
  if (root.childElementCount !== LANGUAGES.length) {
    root.replaceChildren(
      ...LANGUAGES.map(language => {
        const button = el('button', {
          type: 'button',
          class: 'lang-option',
          lang: language.meta.bcp47,
          title: language.meta.nativeName,
          'aria-label': language.meta.nativeName,
          'data-locale': language.code,
        })
        button.append(flagCanvas(document, language.flag))
        button.addEventListener('click', () => onPick(language.code))
        return button
      }),
    )
  }
  root.querySelectorAll<HTMLButtonElement>('[data-locale]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.locale === tr.locale))
  })
}

/**
 * Página con idioma intercambiable: carga el idioma inicial, pinta los selectores
 * (`[data-lang-picker]`) y vuelve a pintar todo al elegir otro, que queda guardado.
 */
export async function withLanguage(render: (tr: Translator) => void): Promise<void> {
  let current = await loadTranslator(initialLocale())
  let request = 0
  const paint = () => {
    render(current)
    document
      .querySelectorAll<HTMLElement>('[data-lang-picker]')
      .forEach(root => renderLanguagePicker(root, current, pick))
  }
  const pick = (locale: Locale) => {
    if (locale === current.locale) return
    const mine = ++request
    rememberLocale(locale)
    loadTranslator(locale).then(
      tr => {
        if (mine !== request) return
        current = tr
        paint()
      },
      (error: unknown) => console.error('[i18n] no se pudo cargar el idioma', locale, error),
    )
  }
  paint()
}

export { el }
