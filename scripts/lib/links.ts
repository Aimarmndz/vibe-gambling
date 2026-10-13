// SPDX-License-Identifier: AGPL-3.0-or-later
// Enlaces de los Markdown del repo: extrae destinos (Markdown y HTML), calcula las anclas de los
// títulos como las calcula GitHub y comprueba que cada enlace relativo apunta a algo que existe.
// La lógica es pura; `scripts/check-links.ts` lee los archivos y la usa.

/** Un enlace encontrado en un Markdown, con su línea (1-based). */
export interface FoundLink {
  readonly target: string
  readonly line: number
}

/** Un enlace roto, listo para enseñar. */
export interface BrokenLink {
  readonly file: string
  readonly line: number
  readonly target: string
  readonly reason: string
}

/** Lo que necesita `checkLinks` del sistema de archivos (inyectable para los tests). */
export interface LinkFs {
  exists(path: string): boolean
  isDirectory(path: string): boolean
  read(path: string): string
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const ATX_RE = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/
// `](destino)` sirve para enlaces e imágenes, también anidadas (`[![alt](img)](href)`).
const INLINE_LINK_RE = /\]\(\s*<?([^\s)>]+)>?/g
const REFERENCE_DEF_RE = /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/
const HTML_ATTR_RE = /\b(src|href|srcset)\s*=\s*"([^"]*)"/gi
const HTML_ID_RE = /<[a-z][^>]*?\s(?:id|name)\s*=\s*"([^"]+)"/gi
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/** Quita los fragmentos de código en línea (`` `x` ``) para no confundirlos con enlaces. */
function stripInlineCode(line: string): string {
  return line.replace(/(`+)[^`]*?\1/g, match => ' '.repeat(match.length))
}

/** Recorre las líneas que no están dentro de un bloque de código cercado. */
function* proseLines(markdown: string): Generator<{ text: string; line: number }> {
  let fence: string | null = null
  const lines = markdown.split(/\r?\n/)
  for (const [index, text] of lines.entries()) {
    const match = FENCE_RE.exec(text)
    if (fence !== null) {
      if (match?.[1] !== undefined && match[1][0] === fence[0] && match[1].length >= fence.length) {
        fence = null
      }
      continue
    }
    if (match?.[1] !== undefined) {
      fence = match[1]
      continue
    }
    yield { text, line: index + 1 }
  }
}

/** Texto visible de un título en Markdown, como lo pinta GitHub antes de sacar el ancla. */
function headingText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\*+/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1')
}

/** Ancla de un título según el algoritmo de GitHub (github-slugger), sin duplicados. */
export function slugify(text: string): string {
  return headingText(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** Todas las anclas de un Markdown: títulos (ATX y setext, con `-1`, `-2`… si se repiten) e ids HTML. */
export function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>()
  const seen = new Map<string, number>()
  const add = (slug: string): void => {
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    anchors.add(count === 0 ? slug : `${slug}-${String(count)}`)
  }
  let previous: string | null = null
  for (const { text } of proseLines(markdown)) {
    const atx = ATX_RE.exec(text)
    if (atx?.[1] !== undefined) {
      add(slugify(atx[1]))
      previous = null
    } else if (
      previous !== null &&
      SETEXT_RE.test(text) &&
      !/^\s*([|>-]|\d+\.|[*+]\s)/.test(previous)
    ) {
      add(slugify(previous))
      previous = null
    } else {
      previous = text.trim() === '' ? null : text
    }
    for (const match of text.matchAll(HTML_ID_RE)) {
      if (match[1] !== undefined) anchors.add(match[1])
    }
  }
  return anchors
}

/** Destinos de los enlaces e imágenes de un Markdown (Markdown en línea, referencias y HTML). */
export function linksOf(markdown: string): FoundLink[] {
  const links: FoundLink[] = []
  for (const { text, line } of proseLines(markdown)) {
    const prose = stripInlineCode(text)
    for (const match of prose.matchAll(INLINE_LINK_RE)) {
      if (match[1] !== undefined) links.push({ target: match[1], line })
    }
    const reference = REFERENCE_DEF_RE.exec(prose)
    if (reference?.[1] !== undefined) links.push({ target: reference[1], line })
    for (const match of prose.matchAll(HTML_ATTR_RE)) {
      const [, attribute, value] = match
      if (attribute === undefined || value === undefined) continue
      // `srcset` lleva varias URL separadas por comas, cada una con su descriptor opcional.
      const targets =
        attribute.toLowerCase() === 'srcset'
          ? value.split(',').map(candidate => candidate.trim().split(/\s+/)[0] ?? '')
          : [value]
      for (const target of targets) if (target !== '') links.push({ target, line })
    }
  }
  return links
}

/** Une una ruta relativa a la carpeta del archivo (`/x` es relativa a la raíz, como en GitHub). */
export function resolveTarget(fromFile: string, path: string): string {
  const base = path.startsWith('/') ? [] : fromFile.split('/').slice(0, -1)
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') base.pop()
    else base.push(part)
  }
  return base.join('/')
}

/** Comprueba los enlaces relativos y las anclas de cada Markdown. Las URL absolutas no se tocan. */
export function checkLinks(files: readonly string[], fs: LinkFs): BrokenLink[] {
  const broken: BrokenLink[] = []
  const anchorCache = new Map<string, Set<string>>()
  const anchorsFor = (path: string): Set<string> => {
    let anchors = anchorCache.get(path)
    if (anchors === undefined) {
      anchors = anchorsOf(fs.read(path))
      anchorCache.set(path, anchors)
    }
    return anchors
  }

  for (const file of files) {
    for (const { target, line } of linksOf(fs.read(file))) {
      if (SCHEME_RE.test(target) || target.startsWith('//')) continue
      const hashAt = target.indexOf('#')
      const rawPath = (hashAt === -1 ? target : target.slice(0, hashAt)).replace(/\?.*$/, '')
      const anchor = hashAt === -1 ? null : target.slice(hashAt + 1)
      let path: string
      try {
        path = rawPath === '' ? file : resolveTarget(file, decodeURIComponent(rawPath))
      } catch {
        broken.push({ file, line, target, reason: 'malformed URL encoding' })
        continue
      }
      if (path === '' || !fs.exists(path)) {
        broken.push({ file, line, target, reason: 'file not found' })
        continue
      }
      if (anchor === null || anchor === '' || !path.toLowerCase().endsWith('.md')) continue
      if (fs.isDirectory(path)) continue
      let wanted: string
      try {
        wanted = decodeURIComponent(anchor)
      } catch {
        broken.push({ file, line, target, reason: 'malformed URL encoding' })
        continue
      }
      if (!anchorsFor(path).has(wanted)) {
        broken.push({ file, line, target, reason: `no heading or id "${wanted}" in ${path}` })
      }
    }
  }
  return broken
}
