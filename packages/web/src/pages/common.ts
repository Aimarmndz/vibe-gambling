// SPDX-License-Identifier: AGPL-3.0-or-later
// Piezas comunes de las páginas HTML (landing y privacidad): textos con data-i18n, idioma y pie.
import type { Locale, WebConfig } from '@vibe-gambling/shared'

import { loadPrefs, safeStorage, savePrefs } from '../app/prefs.ts'
import { CATALOGS, createTranslator, detectLocale } from '../i18n/index.ts'
import type { MessageKey, Translator } from '../i18n/index.ts'

export function initialLocale(): Locale {
  return loadPrefs(safeStorage('local')).locale ?? detectLocale(navigator.languages)
}

/** Guarda el idioma elegido (lo comparten la landing, la privacidad y la ventana del juego). */
export function rememberLocale(locale: Locale): void {
  const storage = safeStorage('local')
  savePrefs(storage, { ...loadPrefs(storage), locale })
}

function isKey(key: string, locale: Locale): key is MessageKey {
  return key in CATALOGS[locale]
}

/** Rellena todos los elementos con `data-i18n="clave"`. */
export function applyI18n(root: ParentNode, tr: Translator): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n ?? ''
    if (isKey(key, tr.locale)) el.textContent = tr.t(key)
    else console.warn(`[i18n] clave desconocida: ${key}`)
  })
  document.documentElement.lang = tr.locale
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

export function externalLink(href: string, text: string): HTMLAnchorElement {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text)
}

/**
 * Pie siempre visible: "Created by Aimar — github.com/Aimarmndz · Fake coins only. If real
 * gambling worries you: …" con los enlaces de ayuda del idioma, el descargo de marcas y enlaces.
 */
export function renderFooter(
  root: HTMLElement,
  web: WebConfig,
  tr: Translator,
  onLanguage: () => void,
): void {
  root.replaceChildren()
  const author = web.site.author
  const line1 = el('p')
  line1.append(
    `${tr.t('footer.createdBy', { author: author.name })} — `,
    externalLink(author.url, author.url.replace(/^https?:\/\//, '')),
    ` · ${tr.t('footer.fakeCoins')} `,
  )
  const help = web.site.helpLinks[tr.locale] ?? []
  help.forEach((link, i) => {
    if (i > 0) line1.append(' · ')
    line1.append(externalLink(link.url, link.label))
  })
  const line2 = el('p', { class: 'muted' }, tr.t('footer.disclaimer'))
  const nav = el('p', { class: 'footer-nav' })
  const lang = el('button', { type: 'button', class: 'lang' }, tr.t('footer.language'))
  lang.addEventListener('click', onLanguage)
  nav.append(
    el('a', { href: '/' }, tr.t('footer.home')),
    ' · ',
    el('a', { href: '/privacy' }, tr.t('footer.privacy')),
    ' · ',
    externalLink(web.site.repoUrl, tr.t('footer.source')),
    ' · ',
    lang,
  )
  root.append(line1, line2, nav)
}

/** Página con idioma intercambiable: vuelve a pintar todo al cambiarlo. */
export function withLanguage(render: (tr: Translator) => void): void {
  let locale = initialLocale()
  const paint = () => render(createTranslator(locale))
  const toggle = () => {
    locale = locale === 'en' ? 'es' : 'en'
    rememberLocale(locale)
    paint()
  }
  document
    .querySelectorAll<HTMLButtonElement>('[data-lang-toggle]')
    .forEach(b => b.addEventListener('click', toggle))
  document.addEventListener('vg:toggle-language', toggle)
  paint()
}

export { el }
