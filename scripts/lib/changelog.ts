// SPDX-License-Identifier: AGPL-3.0-or-later
// CHANGELOG.md en formato Keep a Changelog 1.1 (https://keepachangelog.com/en/1.1.0/):
// leerlo por secciones, sacar las notas de una versión, generar entradas desde Conventional
// Commits y cerrar `Unreleased` en una versión nueva con sus enlaces de comparación.

export const UNRELEASED = 'Unreleased'

/** Categorías de Keep a Changelog, en el orden en que se escriben. */
export const CATEGORIES = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
] as const
export type Category = (typeof CATEGORIES)[number]

export interface Section {
  /** `Unreleased` o la versión (`0.1.0`). */
  readonly name: string
  /** Fecha `AAAA-MM-DD` (las versiones publicadas la llevan; `Unreleased` no). */
  readonly date: string | null
  /** Cuerpo de la sección sin el título, sin líneas en blanco al principio ni al final. */
  readonly body: string
}

export interface Changelog {
  /** Todo lo que va antes de la primera sección (título e introducción). */
  readonly preamble: string
  readonly sections: readonly Section[]
}

const SECTION_RE = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\s*$/
const LINK_RE = /^\[[^\]]+\]: \S+\s*$/

const trimBlankLines = (lines: readonly string[]): string =>
  lines
    .join('\n')
    .replace(/^\s*\n/, '')
    .trimEnd()

/** Analiza el CHANGELOG. Las definiciones de enlaces del final se descartan: se regeneran. */
export function parseChangelog(text: string): Changelog {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const preamble: string[] = []
  const sections: { name: string; date: string | null; lines: string[] }[] = []
  for (const line of lines) {
    const match = SECTION_RE.exec(line)
    if (match !== null && match[1] !== undefined) {
      sections.push({ name: match[1], date: match[2] ?? null, lines: [] })
    } else if (LINK_RE.test(line)) {
      continue
    } else {
      ;(sections.at(-1)?.lines ?? preamble).push(line)
    }
  }
  const names = new Set<string>()
  for (const section of sections) {
    if (names.has(section.name))
      throw new Error(`CHANGELOG.md: duplicated section [${section.name}]`)
    names.add(section.name)
  }
  return {
    preamble: trimBlankLines(preamble),
    sections: sections.map(section => ({
      name: section.name,
      date: section.date,
      body: trimBlankLines(section.lines),
    })),
  }
}

/** Escribe el CHANGELOG con los enlaces de comparación al final, generados desde `repoUrl`. */
export function renderChangelog(changelog: Changelog, repoUrl: string): string {
  const parts = [changelog.preamble]
  for (const section of changelog.sections) {
    const title = `## [${section.name}]${section.date === null ? '' : ` - ${section.date}`}`
    parts.push(section.body === '' ? title : `${title}\n\n${section.body}`)
  }
  const links = compareLinks(
    changelog.sections.map(section => section.name),
    repoUrl,
  )
  if (links.length > 0) parts.push(links.join('\n'))
  return `${parts.join('\n\n')}\n`
}

/**
 * Enlaces de Keep a Changelog: cada versión compara con la anterior; la más antigua enlaza a su
 * release; `Unreleased` compara la última versión con `HEAD`. Los nombres van del más nuevo al
 * más antiguo, como en el archivo.
 */
export function compareLinks(names: readonly string[], repoUrl: string): string[] {
  const versions = names.filter(name => name !== UNRELEASED)
  const links: string[] = []
  if (names.includes(UNRELEASED)) {
    const latest = versions[0]
    links.push(
      latest === undefined
        ? `[${UNRELEASED}]: ${repoUrl}/commits/HEAD`
        : `[${UNRELEASED}]: ${repoUrl}/compare/v${latest}...HEAD`,
    )
  }
  versions.forEach((version, index) => {
    // Una estable compara con la estable anterior (sus notas cubren todo ese tramo); una
    // pre-release, con la versión inmediatamente anterior.
    const stable = !version.includes('-')
    const previous = versions.slice(index + 1).find(older => !stable || !older.includes('-'))
    links.push(
      previous === undefined
        ? `[${version}]: ${repoUrl}/releases/tag/v${version}`
        : `[${version}]: ${repoUrl}/compare/v${previous}...v${version}`,
    )
  })
  return links
}

export function findSection(changelog: Changelog, name: string): Section | undefined {
  return changelog.sections.find(section => section.name === name)
}

/**
 * Publica `version` con fecha `date`: si ya existe su sección (primera release de una versión
 * ya escrita a mano), solo le pone la fecha; si no, la crea con `body` justo debajo de
 * `Unreleased`, que queda vacía.
 */
export function releaseSection(
  changelog: Changelog,
  version: string,
  date: string,
  body: string,
): Changelog {
  const existing = findSection(changelog, version)
  if (existing !== undefined && (findSection(changelog, UNRELEASED)?.body ?? '') !== '') {
    // Se perderían entradas: o van a la sección de la versión, o a la siguiente release.
    throw new Error(
      `CHANGELOG.md: [${version}] already exists and [${UNRELEASED}] is not empty; merge them by hand`,
    )
  }
  const others = changelog.sections.filter(
    section => section.name !== UNRELEASED && section.name !== version,
  )
  const released: Section = { name: version, date, body: existing?.body ?? body.trim() }
  if (released.body === '') throw new Error(`CHANGELOG.md: release ${version} has no entries`)
  return {
    preamble: changelog.preamble,
    sections: [{ name: UNRELEASED, date: null, body: '' }, released, ...others],
  }
}

export interface Commit {
  readonly hash: string
  readonly subject: string
  readonly body: string
}

export interface ParsedCommit {
  readonly type: string
  readonly scope: string | null
  readonly breaking: boolean
  readonly description: string
}

const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/

export function parseConventionalCommit(commit: Commit): ParsedCommit | null {
  const match = CONVENTIONAL_RE.exec(commit.subject.trim())
  if (match === null || match[1] === undefined || match[4] === undefined) return null
  return {
    type: match[1].toLowerCase(),
    scope: match[2] ?? null,
    breaking: match[3] === '!' || /^BREAKING[ -]CHANGE: /m.test(commit.body),
    description: match[4],
  }
}

/**
 * Categoría de Keep a Changelog de cada tipo de commit. Lo interno (docs, test, build, ci,
 * chore, style) no sale en el CHANGELOG salvo que rompa compatibilidad.
 */
export function categoryOf(commit: ParsedCommit): Category | null {
  if (commit.scope === 'security' && (commit.type === 'fix' || commit.type === 'feat')) {
    return 'Security'
  }
  switch (commit.type) {
    case 'feat':
      return 'Added'
    case 'fix':
      return 'Fixed'
    case 'perf':
    case 'refactor':
    case 'revert':
      return 'Changed'
    case 'deprecate':
      return 'Deprecated'
    case 'remove':
      return 'Removed'
    default:
      return commit.breaking ? 'Changed' : null
  }
}

export interface GeneratedEntries {
  /** Cuerpo de la sección en Markdown (vacío si no hay nada que contar). */
  readonly body: string
  /** Asuntos que no siguen Conventional Commits (para avisar). */
  readonly unconventional: readonly string[]
}

/** Genera el cuerpo de una sección agrupando los commits por categoría. */
export function entriesFromCommits(commits: readonly Commit[], repoUrl: string): GeneratedEntries {
  const groups = new Map<Category, string[]>()
  const unconventional: string[] = []
  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit)
    if (parsed === null) {
      unconventional.push(commit.subject)
      continue
    }
    // Los commits de release no son cambios del proyecto.
    if (parsed.type === 'chore' && parsed.scope === 'release') continue
    const category = categoryOf(parsed)
    if (category === null) continue
    const scope = parsed.scope === null ? '' : `**${parsed.scope}:** `
    const breaking = parsed.breaking ? '**Breaking:** ' : ''
    const link = `([${commit.hash.slice(0, 7)}](${repoUrl}/commit/${commit.hash}))`
    const list = groups.get(category) ?? []
    list.push(`- ${breaking}${scope}${parsed.description} ${link}`)
    groups.set(category, list)
  }
  const body = CATEGORIES.filter(category => groups.has(category))
    .map(category => `### ${category}\n\n${(groups.get(category) ?? []).join('\n')}`)
    .join('\n\n')
  return { body, unconventional }
}
