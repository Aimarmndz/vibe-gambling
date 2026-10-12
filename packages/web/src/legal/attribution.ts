// SPDX-License-Identifier: AGPL-3.0-or-later
// Atribución del autor que exigen los términos adicionales 7(b) de LICENSE: "Created by Aimar
// (github.com/Aimarmndz)" en el pie de la landing, en los créditos de la ventana y en la pantalla
// de arranque. Solo se puede traducir "Created by"; el nombre y la URL salen de config/site.json.
import type { WebConfig } from '@vibe-gambling/shared'

import type { Translator } from '../i18n/index.ts'

export type Author = WebConfig['site']['author']

export interface Attribution {
  /** Texto completo, p. ej. "Created by Aimar (github.com/Aimarmndz)". */
  text: string
  /** Trozos para pintarlo con enlace: `before` + enlace(`label` → `href`) + `after`. */
  before: string
  label: string
  href: string
  after: string
}

/** URL del autor tal como se enseña: sin esquema ni barra final. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
}

export function attribution(author: Author, tr: Translator): Attribution {
  const label = displayUrl(author.url)
  const text = tr.t('legal.createdBy', { author: author.name, url: label })
  const at = text.lastIndexOf(label)
  return {
    text,
    before: text.slice(0, at),
    label,
    href: author.url,
    after: text.slice(at + label.length),
  }
}
