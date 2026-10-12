// SPDX-License-Identifier: AGPL-3.0-or-later
// Prepara una release EN LOCAL: sube la versión en todos los manifiestos, cierra la sección
// `Unreleased` de CHANGELOG.md, hace el commit `chore(release): vX.Y.Z` (con Signed-off-by) y
// la etiqueta anotada `vX.Y.Z`. No empuja nada: el push lo hace una persona (docs/RELEASING.md).
//
// Uso:
//   node scripts/release.ts <major|minor|patch|premajor|preminor|prepatch|prerelease|X.Y.Z>
//        [--preid rc] [--dry-run]
//   node scripts/release.ts --draft     # imprime las entradas generadas desde la última etiqueta
//
// Las notas de la versión salen de `Unreleased` si tiene algo escrito a mano; si está vacía, se
// generan desde los Conventional Commits desde la última etiqueta `v*`. Si la versión pedida es
// la actual y aún no tiene etiqueta (la primera release), solo se fecha su sección y se etiqueta.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import {
  entriesFromCommits,
  findSection,
  parseChangelog,
  releaseSection,
  renderChangelog,
  UNRELEASED,
} from './lib/changelog.ts'
import type { Commit } from './lib/changelog.ts'
import { git, gitOrNull, projectInfo, ROOT } from './lib/repo.ts'
import {
  bumpSemVer,
  compareSemVer,
  formatSemVer,
  isBump,
  isPrerelease,
  mustParseSemVer,
  parseSemVer,
} from './lib/semver.ts'
import { checkVersions, collectVersionFields, writeVersion } from './lib/versions.ts'

// Rama desde la que se publica (política del repo, ver docs/RELEASING.md).
const RELEASE_BRANCH = 'main'
const CHANGELOG = 'CHANGELOG.md'
const USAGE =
  'usage: node scripts/release.ts <major|minor|patch|premajor|preminor|prepatch|prerelease|X.Y.Z> [--preid rc] [--dry-run]\n' +
  '       node scripts/release.ts --draft'

/** Fecha local `AAAA-MM-DD` (la del día en que se prepara la release). */
function today(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Última etiqueta `v*` alcanzable desde HEAD, o `null` si no hay ninguna. Con `stableOnly`
 * se saltan las pre-releases: las notas de una versión estable cuentan todo lo que hay desde la
 * estable anterior, aunque ya saliera en sus `-rc`.
 */
function lastTag(stableOnly = false): string | null {
  const exclude = stableOnly ? ['--exclude', 'v*-*'] : []
  return gitOrNull(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', ...exclude])
}

/** Commits (sin merges) desde `since` hasta HEAD, en orden cronológico. */
function commitsSince(since: string | null): Commit[] {
  const range = since === null ? ['HEAD'] : [`${since}..HEAD`]
  const output = git(['log', '--no-merges', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', ...range])
  return output
    .split('\x1e')
    .map(record => record.replace(/^\n/, ''))
    .filter(record => record !== '')
    .map(record => {
      const [hash = '', subject = '', body = ''] = record.split('\x1f')
      return { hash, subject, body }
    })
}

interface Plan {
  readonly from: string
  readonly to: string
  readonly tag: string
  readonly changelog: string
  readonly notes: string
  readonly problems: string[]
  readonly warnings: string[]
}

function plan(target: string, preid: string): Plan {
  const problems: string[] = []
  const warnings: string[] = []

  // 1. Estado de git: rama, árbol limpio y etiqueta libre.
  const branch = gitOrNull(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch !== RELEASE_BRANCH) {
    problems.push(
      `releases are cut from "${RELEASE_BRANCH}", not from "${branch ?? 'detached HEAD'}"`,
    )
  }
  const dirty = git(['status', '--porcelain', '--untracked-files=normal'])
  if (dirty !== '') {
    problems.push(`the working tree is not clean:\n${dirty.replace(/^/gm, '      ')}`)
  }

  // 2. Versiones: sincronizadas antes de empezar, y la nueva por delante de la actual.
  const current = checkVersions()
  problems.push(...current.problems)
  const from = mustParseSemVer(current.version, 'current version')
  const to = isBump(target) ? bumpSemVer(from, target, preid) : parseSemVer(target)
  if (to === null) throw new Error(`"${target}" is neither a bump nor a valid version\n${USAGE}`)
  const toText = formatSemVer(to)
  const tag = `v${toText}`
  if (gitOrNull(['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`]) !== null) {
    problems.push(`tag ${tag} already exists`)
  }
  // Nunca se salta una versión: la actual tiene que estar etiquetada antes de pasar a otra.
  if (toText !== current.version && isFirstRelease(current.version)) {
    problems.push(
      `the current version ${current.version} was never tagged: release it first (\`pnpm release ${current.version}\`)`,
    )
  }
  const order = compareSemVer(to, from)
  if (order < 0 || (order === 0 && !isFirstRelease(toText))) {
    problems.push(`${toText} is not ahead of the current version ${current.version}`)
  }

  // 3. CHANGELOG: `Unreleased` escrito a mano o, si está vacío, generado desde los commits.
  const { repoUrl } = projectInfo()
  const changelog = parseChangelog(readFileSync(join(ROOT, CHANGELOG), 'utf8'))
  const curated = findSection(changelog, UNRELEASED)?.body ?? ''
  let body = curated
  const generate = findSection(changelog, toText) === undefined && curated === ''
  if (generate) {
    const since = lastTag(!isPrerelease(to))
    const generated = entriesFromCommits(commitsSince(since), repoUrl)
    if (generated.unconventional.length > 0) {
      warnings.push(
        `commits that are not Conventional Commits (left out of the changelog):\n${generated.unconventional
          .map(subject => `      ${subject}`)
          .join('\n')}`,
      )
    }
    body = generated.body
    if (body === '') {
      problems.push(
        `nothing user-facing since ${since ?? 'the first commit'}: no feat/fix/perf/refactor commits and [${UNRELEASED}] is empty`,
      )
    }
  }
  let rendered = ''
  let notes = ''
  if (!generate || body !== '') {
    try {
      const released = releaseSection(changelog, toText, today(), body)
      rendered = renderChangelog(released, repoUrl)
      notes = findSection(released, toText)?.body ?? ''
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { from: current.version, to: toText, tag, changelog: rendered, notes, problems, warnings }
}

/** La versión actual se puede "publicar" tal cual solo si nunca se etiquetó (primera release). */
function isFirstRelease(version: string): boolean {
  return gitOrNull(['rev-parse', '--quiet', '--verify', `refs/tags/v${version}`]) === null
}

function apply(release: Plan): void {
  const changelogPath = join(ROOT, CHANGELOG)
  const touched = [...new Set([...collectVersionFields().map(f => f.file), CHANGELOG])]
  // Copia de lo que había, para dejarlo todo como estaba si algo falla antes del commit.
  const backup = new Map(touched.map(file => [file, readFileSync(join(ROOT, file), 'utf8')]))
  try {
    if (release.from !== release.to) writeVersion(release.from, release.to)
    writeFileSync(changelogPath, release.changelog)
    const after = checkVersions()
    if (after.problems.length > 0 || after.version !== release.to) {
      throw new Error(`versions do not agree after the bump:\n  - ${after.problems.join('\n  - ')}`)
    }
    git(['add', '--', ...touched])
    // Primera release de una versión ya fechada hoy: no hay nada que commitear, se etiqueta HEAD.
    const nothingStaged = gitOrNull(['diff', '--cached', '--quiet']) !== null
    if (!nothingStaged) {
      git(['commit', '--signoff', '--quiet', '-m', `chore(release): ${release.tag}`])
    }
  } catch (error) {
    for (const [file, text] of backup) writeFileSync(join(ROOT, file), text)
    gitOrNull(['reset', '--quiet', '--', ...touched])
    throw error
  }
  // Etiqueta anotada con las notas de la versión (si `tag.gpgSign` está activo, git la firma).
  git([
    'tag',
    '--annotate',
    '--cleanup=verbatim',
    release.tag,
    '-m',
    `${release.tag}\n\n${release.notes}`,
  ])
}

function main(): number {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean', default: false },
        draft: { type: 'boolean', default: false },
        preid: { type: 'string', default: 'rc' },
      },
    })
  } catch (error) {
    console.error(`release: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`)
    return 2
  }
  const { values, positionals } = parsed

  if (values.draft) {
    const since = lastTag()
    const { body, unconventional } = entriesFromCommits(commitsSince(since), projectInfo().repoUrl)
    console.log(
      `<!-- entries since ${since ?? 'the first commit'}; review them and write them in English under [${UNRELEASED}] -->\n`,
    )
    console.log(body === '' ? '(nothing user-facing)' : body)
    if (unconventional.length > 0) {
      console.log(`\n<!-- not Conventional Commits, left out:\n${unconventional.join('\n')}\n-->`)
    }
    return 0
  }

  const [target, ...extra] = positionals
  if (target === undefined || extra.length > 0) {
    console.error(USAGE)
    return 2
  }
  if (!/^[0-9A-Za-z-]+$/.test(values.preid)) {
    console.error(`release: --preid must be alphanumeric (got "${values.preid}")`)
    return 2
  }

  const release = plan(target, values.preid)
  const dryRun = values['dry-run']
  console.log(
    `release: ${release.from} → ${release.to} (tag ${release.tag})${dryRun ? ' [dry run]' : ''}`,
  )
  for (const warning of release.warnings) console.warn(`  ! ${warning}`)
  if (release.notes !== '') {
    console.log(`\n--- notes for ${release.tag} ---\n${release.notes}\n--- end of notes ---\n`)
  }

  if (dryRun) {
    if (release.problems.length > 0) {
      console.warn('A real run would stop here:')
      for (const problem of release.problems) console.warn(`  - ${problem}`)
    } else {
      console.log('Dry run OK: a real run would bump the manifests, update CHANGELOG.md,')
      console.log(`commit "chore(release): ${release.tag}" (signed off) and tag ${release.tag}.`)
    }
    return 0
  }

  if (release.problems.length > 0) {
    console.error('release: cannot release:')
    for (const problem of release.problems) console.error(`  - ${problem}`)
    return 1
  }
  apply(release)
  console.log(
    `Committed "chore(release): ${release.tag}" and tagged ${release.tag} (nothing pushed).`,
  )
  console.log('Check it, then publish it (see docs/RELEASING.md):')
  console.log(`  git push --atomic origin ${RELEASE_BRANCH} ${release.tag}`)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`release: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
