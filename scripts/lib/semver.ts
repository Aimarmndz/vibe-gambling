// SPDX-License-Identifier: AGPL-3.0-or-later
// SemVer 2.0 mínimo para las releases: analizar, comparar y subir versiones `X.Y.Z[-pre]`.
// No admite metadatos de build (`+…`): no los usamos y así cada versión tiene una sola forma.

export interface SemVer {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** Identificadores de pre-release (`rc.1` → `['rc', 1]`); vacío en una versión estable. */
  readonly prerelease: readonly (string | number)[]
}

export const BUMPS = [
  'major',
  'minor',
  'patch',
  'premajor',
  'preminor',
  'prepatch',
  'prerelease',
] as const
export type Bump = (typeof BUMPS)[number]

// Números sin ceros a la izquierda; identificadores de pre-release alfanuméricos con guiones.
const NUMBER = '0|[1-9]\\d*'
const IDENTIFIER = `(?:${NUMBER}|\\d*[A-Za-z-][0-9A-Za-z-]*)`
const SEMVER_RE = new RegExp(
  `^(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`,
)

export function isBump(value: string): value is Bump {
  return (BUMPS as readonly string[]).includes(value)
}

/** Analiza una versión; devuelve `null` si no es SemVer válido (sin `v` delante). */
export function parseSemVer(text: string): SemVer | null {
  const match = SEMVER_RE.exec(text)
  if (match === null) return null
  const [, major, minor, patch, pre] = match
  const numbers = [major, minor, patch].map(Number)
  if (numbers.some(n => !Number.isSafeInteger(n))) return null
  return {
    major: numbers[0] ?? 0,
    minor: numbers[1] ?? 0,
    patch: numbers[2] ?? 0,
    prerelease:
      pre === undefined ? [] : pre.split('.').map(id => (/^\d+$/.test(id) ? Number(id) : id)),
  }
}

/** Como `parseSemVer`, pero lanza un error legible si la versión no es válida. */
export function mustParseSemVer(text: string, what = 'version'): SemVer {
  const version = parseSemVer(text)
  if (version === null) throw new Error(`${what} "${text}" is not a valid SemVer (X.Y.Z[-pre])`)
  return version
}

export function formatSemVer(version: SemVer): string {
  const core = `${version.major}.${version.minor}.${version.patch}`
  return version.prerelease.length === 0 ? core : `${core}-${version.prerelease.join('.')}`
}

export function isPrerelease(version: SemVer): boolean {
  return version.prerelease.length > 0
}

/** Orden de precedencia de SemVer 2.0 (§11): negativo si `a < b`, 0 si iguales, positivo si `a > b`. */
export function compareSemVer(a: SemVer, b: SemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  // Una versión estable va por delante de cualquiera de sus pre-releases.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < length; i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    // Los numéricos van antes que los alfanuméricos; entre iguales, orden numérico o ASCII.
    if (typeof x === 'number' && typeof y === 'number') return x - y
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return 0
}

/**
 * Sube una versión con la misma semántica que `npm version`:
 * `patch` sobre `1.2.3-rc.1` publica `1.2.3`; `prerelease` sobre `1.2.3` da `1.2.4-<preid>.0`.
 */
export function bumpSemVer(version: SemVer, bump: Bump, preid: string): SemVer {
  const pre = isPrerelease(version)
  const { major, minor, patch } = version
  const first = [preid, 0]
  switch (bump) {
    case 'major':
      return pre && minor === 0 && patch === 0
        ? { major, minor: 0, patch: 0, prerelease: [] }
        : { major: major + 1, minor: 0, patch: 0, prerelease: [] }
    case 'minor':
      return pre && patch === 0
        ? { major, minor, patch: 0, prerelease: [] }
        : { major, minor: minor + 1, patch: 0, prerelease: [] }
    case 'patch':
      return pre
        ? { major, minor, patch, prerelease: [] }
        : { major, minor, patch: patch + 1, prerelease: [] }
    case 'premajor':
      return { major: major + 1, minor: 0, patch: 0, prerelease: first }
    case 'preminor':
      return { major, minor: minor + 1, patch: 0, prerelease: first }
    case 'prepatch':
      return { major, minor, patch: patch + 1, prerelease: first }
    case 'prerelease': {
      if (!pre) return { major, minor, patch: patch + 1, prerelease: first }
      const last = version.prerelease.at(-1)
      // Misma serie (`rc.3` → `rc.4`); si cambia el identificador, empieza otra (`beta.2` → `rc.0`).
      if (version.prerelease[0] === preid && typeof last === 'number') {
        return { major, minor, patch, prerelease: [...version.prerelease.slice(0, -1), last + 1] }
      }
      return { major, minor, patch, prerelease: first }
    }
  }
}
