// SPDX-License-Identifier: AGPL-3.0-or-later
// Contenido de la página /privacy. Lo que depende de la instancia (quién la opera, dónde está,
// el proxy de red, el contacto, la retención de las copias) sale de `site.instance` de
// /config.json, y lo que solo sabe el servidor (de dónde se cargan los avatares, cuánto duran las
// sesiones y los enlaces, cuánto vive la IP en memoria) de `privacy`. Así una instancia autoalojada nunca dice que es la oficial.
import { forLocale } from '@vibe-gambling/shared'
import type { WebConfig } from '@vibe-gambling/shared'

import type { MessageKey, Translator } from '../i18n/index.ts'
import { el, externalLink } from './common.ts'

/** Secciones de la página, en orden. Cada una tiene `privacy.<id>.title` en i18n. */
export const PRIVACY_SECTIONS = [
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
export type PrivacySection = (typeof PRIVACY_SECTIONS)[number]

type Part = string | Node

/**
 * Rellena `{marcador}` con texto o nodos (enlaces). Los textos van siempre como texto, nunca como
 * HTML; un marcador sin valor se deja tal cual para que se note en vez de desaparecer.
 */
export function fillParts(template: string, parts: Readonly<Record<string, Part>>): Part[] {
  const out: Part[] = []
  const used = new Set<Node>()
  let last = 0
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const value = parts[match[1]!]
    if (value === undefined) continue
    if (match.index > last) out.push(template.slice(last, match.index))
    // Un nodo solo puede estar en un sitio del DOM: si el marcador se repite, va una copia.
    if (typeof value !== 'string' && used.has(value)) out.push(value.cloneNode(true))
    else {
      if (typeof value !== 'string') used.add(value)
      out.push(value)
    }
    last = match.index + match[0].length
  }
  if (last < template.length) out.push(template.slice(last))
  return out
}

/** Unidades de mayor a menor, en segundos. */
const UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
] as const

/**
 * Duración legible con la mayor unidad que la divide exacta ("30 days", "1 minute"). Los plazos
 * de la configuración son múltiplos redondos; si no, se cuenta en segundos, sin redondear nunca.
 */
export function formatDuration(seconds: number, tr: Translator): string {
  // Con segundos enteros siempre hay unidad; el `??` es para el caso imposible de no tenerla.
  const [unit, size] = UNITS.find(([, s]) => seconds % s === 0) ?? (['second', 1] as const)
  const n = seconds / size
  const plural = new Intl.PluralRules(tr.locale).select(n) === 'one' ? 'one' : 'other'
  return tr.t(`privacy.unit.${unit}.${plural}` as MessageKey, { n: tr.n(n) })
}

/** Host (con puerto si lo hay) de un origen, para enseñarlo sin el esquema. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

function paragraph(parts: readonly Part[]): HTMLParagraphElement {
  const p = el('p')
  p.append(...parts)
  return p
}

/** Párrafos de una sección según la configuración de la instancia (null si no se pudo cargar). */
export function sectionParagraphs(
  id: PrivacySection,
  web: WebConfig | null,
  tr: Translator,
): HTMLParagraphElement[] {
  const text = (key: MessageKey, parts: Readonly<Record<string, Part>> = {}) =>
    paragraph(fillParts(tr.t(key), parts))
  const instance = web?.site.instance
  const operator = () =>
    instance ? externalLink(instance.operator.url, instance.operator.name) : ''
  switch (id) {
    case 'sent':
      return [text('privacy.sent.body'), text('privacy.sent.commands')]
    case 'stored':
      return [text('privacy.stored.body'), text('privacy.stored.not')]
    case 'why':
      return [text('privacy.why.body'), text('privacy.why.basis')]
    case 'where': {
      if (!web || !instance) return [text('privacy.instance.unknown')]
      const out = [
        text('privacy.where.instance', {
          operator: operator(),
          hosting: forLocale(instance.hosting, tr.locale),
        }),
      ]
      if (instance.networkProxy) {
        out.push(text('privacy.where.proxy', { proxy: instance.networkProxy }))
      }
      const images = web.privacy.imageOrigins.map(hostOf)
      out.push(
        images.length > 0
          ? text('privacy.where.images', { origins: images.join(', ') })
          : text('privacy.where.noImages'),
      )
      out.push(text('privacy.where.github'))
      return out
    }
    case 'howLong': {
      const out = [text('privacy.howLong.body')]
      if (!web || !instance) return [...out, text('privacy.instance.unknown')]
      out.push(
        text('privacy.howLong.sessions', {
          mod: formatDuration(web.privacy.modSessionTtlSeconds, tr),
          web: formatDuration(web.privacy.webSessionTtlSeconds, tr),
        }),
        text('privacy.howLong.link', { link: formatDuration(web.privacy.linkCodeTtlSeconds, tr) }),
        text('privacy.howLong.ip', { ip: formatDuration(web.privacy.ipMemorySeconds, tr) }),
        instance.backupRetentionDays === null
          ? text('privacy.howLong.noBackups')
          : text('privacy.howLong.backups', {
              backups: formatDuration(instance.backupRetentionDays * 86_400, tr),
            }),
      )
      return out
    }
    case 'cookies':
      return [text('privacy.cookies.body')]
    case 'leaderboard': {
      const out = [text('privacy.leaderboard.body')]
      // Regla antiabuso: solo si la instancia la tiene activada (y se sabe con cuántos días).
      const days = web?.game.minAccountAgeDays ?? 0
      if (days > 0) out.push(text('privacy.leaderboard.newAccounts', { days: tr.n(days) }))
      return out
    }
    case 'delete':
      return [text('privacy.delete.body'), text('privacy.delete.rights')]
    case 'contact':
      if (!instance) return [text('privacy.instance.unknown')]
      return [
        text('privacy.contact.body', {
          operator: operator(),
          contact: externalLink(instance.contact.url, instance.contact.label),
        }),
      ]
  }
}

/** Pinta todas las secciones (título y párrafos) en `root`. */
export function renderPrivacy(root: HTMLElement, web: WebConfig | null, tr: Translator): void {
  root.replaceChildren(
    ...PRIVACY_SECTIONS.flatMap(id => [
      el('h2', {}, tr.t(`privacy.${id}.title` as MessageKey)),
      ...sectionParagraphs(id, web, tr),
    ]),
  )
}
