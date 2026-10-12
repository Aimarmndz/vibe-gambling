// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests del CHANGELOG (Keep a Changelog) y de su generación desde Conventional Commits.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  compareLinks,
  entriesFromCommits,
  findSection,
  parseChangelog,
  parseConventionalCommit,
  releaseSection,
  renderChangelog,
} from '../lib/changelog.ts'
import { projectInfo, ROOT } from '../lib/repo.ts'

const REPO = 'https://example.test/acme/app'
const commit = (
  subject: string,
  body = '',
  hash = 'a'.repeat(40),
): { hash: string; subject: string; body: string } => ({
  hash,
  subject,
  body,
})

const SAMPLE = `# Changelog

Intro.

## [Unreleased]

### Added

- New thing.

## [0.1.0] - 2026-01-02

### Fixed

- Old bug.

[Unreleased]: ${REPO}/compare/v0.1.0...HEAD
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`

describe('parseChangelog / renderChangelog', () => {
  it('round-trips the repository CHANGELOG.md byte for byte', () => {
    const text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
    assert.equal(renderChangelog(parseChangelog(text), projectInfo().repoUrl), text)
  })

  it('reads sections, dates and bodies', () => {
    const changelog = parseChangelog(SAMPLE)
    assert.equal(changelog.preamble, '# Changelog\n\nIntro.')
    assert.deepEqual(
      changelog.sections.map(s => [s.name, s.date]),
      [
        ['Unreleased', null],
        ['0.1.0', '2026-01-02'],
      ],
    )
    assert.equal(findSection(changelog, '0.1.0')?.body, '### Fixed\n\n- Old bug.')
  })

  it('rejects duplicated sections', () => {
    assert.throws(() => parseChangelog('## [1.0.0]\n\n## [1.0.0]\n'), /duplicated/)
  })
})

describe('releaseSection', () => {
  it('moves Unreleased into a new dated version and regenerates the links', () => {
    const changelog = parseChangelog(SAMPLE)
    const body = findSection(changelog, 'Unreleased')?.body ?? ''
    const text = renderChangelog(releaseSection(changelog, '0.2.0', '2026-03-04', body), REPO)
    assert.match(
      text,
      /## \[Unreleased\]\n\n## \[0\.2\.0\] - 2026-03-04\n\n### Added\n\n- New thing\./,
    )
    assert.match(text, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v0\\.2\\.0\\.\\.\\.HEAD`))
    assert.match(text, new RegExp(`\\[0\\.2\\.0\\]: ${REPO}/compare/v0\\.1\\.0\\.\\.\\.v0\\.2\\.0`))
    assert.match(text, new RegExp(`\\[0\\.1\\.0\\]: ${REPO}/releases/tag/v0\\.1\\.0`))
  })

  it('only dates a version that is already written (first release)', () => {
    const changelog = parseChangelog(SAMPLE.replace('### Added\n\n- New thing.\n\n', ''))
    const released = releaseSection(changelog, '0.1.0', '2026-05-06', '')
    assert.deepEqual(findSection(released, '0.1.0'), {
      name: '0.1.0',
      date: '2026-05-06',
      body: '### Fixed\n\n- Old bug.',
    })
  })

  it('never drops Unreleased entries or releases an empty version', () => {
    assert.throws(
      () => releaseSection(parseChangelog(SAMPLE), '0.1.0', '2026-05-06', ''),
      /merge them/,
    )
    assert.throws(
      () => releaseSection(parseChangelog('## [Unreleased]\n'), '1.0.0', '2026-05-06', ''),
      /no entries/,
    )
  })

  it('compares a stable version with the previous stable one, skipping its pre-releases', () => {
    assert.deepEqual(
      compareLinks(['Unreleased', '0.2.0', '0.2.0-rc.1', '0.2.0-rc.0', '0.1.0'], REPO),
      [
        `[Unreleased]: ${REPO}/compare/v0.2.0...HEAD`,
        `[0.2.0]: ${REPO}/compare/v0.1.0...v0.2.0`,
        `[0.2.0-rc.1]: ${REPO}/compare/v0.2.0-rc.0...v0.2.0-rc.1`,
        `[0.2.0-rc.0]: ${REPO}/compare/v0.1.0...v0.2.0-rc.0`,
        `[0.1.0]: ${REPO}/releases/tag/v0.1.0`,
      ],
    )
  })

  it('links Unreleased to the commits while there is no version yet', () => {
    assert.deepEqual(compareLinks(['Unreleased'], REPO), [`[Unreleased]: ${REPO}/commits/HEAD`])
  })
})

describe('entriesFromCommits', () => {
  it('parses Conventional Commits, scopes and breaking changes', () => {
    assert.deepEqual(parseConventionalCommit(commit('feat(mod)!: add x')), {
      type: 'feat',
      scope: 'mod',
      breaking: true,
      description: 'add x',
    })
    assert.equal(parseConventionalCommit(commit('fix: y', 'BREAKING CHANGE: z'))?.breaking, true)
    assert.equal(parseConventionalCommit(commit('Update stuff')), null)
  })

  it('groups user-facing commits by Keep a Changelog category and skips the rest', () => {
    const { body, unconventional } = entriesFromCommits(
      [
        commit('feat(web): add a wheel', '', '1'.repeat(40)),
        commit('fix(security): escape a header', '', '2'.repeat(40)),
        commit('fix(server): stop a leak', '', '3'.repeat(40)),
        commit('refactor!: rename the API', '', '4'.repeat(40)),
        commit('docs: typo'),
        commit('chore(release): v0.1.0'),
        commit('Merge stuff'),
      ],
      REPO,
    )
    assert.equal(
      body,
      [
        '### Added',
        '',
        `- **web:** add a wheel ([1111111](${REPO}/commit/${'1'.repeat(40)}))`,
        '',
        '### Changed',
        '',
        `- **Breaking:** rename the API ([4444444](${REPO}/commit/${'4'.repeat(40)}))`,
        '',
        '### Fixed',
        '',
        `- **server:** stop a leak ([3333333](${REPO}/commit/${'3'.repeat(40)}))`,
        '',
        '### Security',
        '',
        `- **security:** escape a header ([2222222](${REPO}/commit/${'2'.repeat(40)}))`,
      ].join('\n'),
    )
    assert.deepEqual(unconventional, ['Merge stuff'])
  })
})
