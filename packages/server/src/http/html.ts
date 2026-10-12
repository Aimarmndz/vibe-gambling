// SPDX-License-Identifier: AGPL-3.0-or-later
// Ajustes del HTML de la web al servirlo. La build de Vite no sabe en qué dominio vivirá, así que
// sus metadatos de previsualización llevan rutas relativas ("/og.png"); Twitter/X y otros solo
// aceptan URLs absolutas, y aquí se completan con PUBLIC_URL.

/** Metadatos cuyo `content` es una URL que tiene que ser absoluta. */
const ABSOLUTE_META = ['og:url', 'og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image']

const META_TAG = /<meta\b[^>]*>/gi
const ATTR = /\s([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Reescribe a absolutas (respecto a `publicUrl`) las URLs de og:url, og:image y twitter:image.
 * Las que ya son absolutas se quedan como están. El resto del documento no se toca.
 */
export function absolutizeMeta(html: string, publicUrl: string): string {
  const base = new URL(publicUrl)
  return html.replace(META_TAG, tag => {
    const attrs = new Map<string, string>()
    for (const [, name, value] of tag.matchAll(ATTR)) attrs.set(name!.toLowerCase(), value!)
    const key = attrs.get('property') ?? attrs.get('name')
    const content = attrs.get('content')
    if (!key || content === undefined || !ABSOLUTE_META.includes(key.toLowerCase())) return tag
    const url = new URL(unescapeAttr(content), base)
    // Solo URLs web: cualquier otra cosa se deja como venía en la build.
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return tag
    const absolute = url.href
    return tag.replace(/(\scontent\s*=\s*")[^"]*(")/i, (_m, a: string, b: string) => {
      return `${a}${escapeAttr(absolute)}${b}`
    })
  })
}
