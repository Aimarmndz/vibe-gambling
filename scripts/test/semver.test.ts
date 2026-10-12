// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests del SemVer de las releases (node:test; `pnpm test:scripts`).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  bumpSemVer,
  compareSemVer,
  formatSemVer,
  mustParseSemVer,
  parseSemVer,
} from '../lib/semver.ts'
import type { Bump } from '../lib/semver.ts'

const bump = (version: string, kind: Bump, preid = 'rc'): string =>
  formatSemVer(bumpSemVer(mustParseSemVer(version), kind, preid))

describe('parseSemVer', () => {
  it('parses stable and pre-release versions', () => {
    assert.deepEqual(parseSemVer('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
    assert.deepEqual(parseSemVer('0.2.0-rc.1')?.prerelease, ['rc', 1])
    assert.equal(formatSemVer(mustParseSemVer('1.0.0-alpha.beta.7')), '1.0.0-alpha.beta.7')
  })

  it('rejects what is not strict SemVer', () => {
    for (const bad of [
      'v1.2.3',
      '1.2',
      '01.2.3',
      '1.2.3-',
      '1.2.3+build',
      '1.2.3-rc..1',
      ' 1.2.3',
    ]) {
      assert.equal(parseSemVer(bad), null, bad)
    }
    assert.throws(() => mustParseSemVer('nope'), /not a valid SemVer/)
  })
})

describe('compareSemVer', () => {
  it('follows the SemVer 2.0 precedence', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.1.0',
      '2.0.0',
    ].map(v => mustParseSemVer(v))
    for (let i = 0; i < ordered.length - 1; i++) {
      const [a, b] = [ordered[i], ordered[i + 1]]
      assert.ok(a !== undefined && b !== undefined)
      assert.ok(compareSemVer(a, b) < 0, `${formatSemVer(a)} < ${formatSemVer(b)}`)
      assert.ok(compareSemVer(b, a) > 0)
      assert.equal(compareSemVer(a, a), 0)
    }
  })
})

describe('bumpSemVer', () => {
  it('bumps stable versions', () => {
    assert.equal(bump('0.1.0', 'patch'), '0.1.1')
    assert.equal(bump('0.1.3', 'minor'), '0.2.0')
    assert.equal(bump('0.9.3', 'major'), '1.0.0')
  })

  it('releases a pre-release as the stable version it leads to', () => {
    assert.equal(bump('0.2.0-rc.3', 'minor'), '0.2.0')
    assert.equal(bump('0.2.1-rc.3', 'patch'), '0.2.1')
    assert.equal(bump('2.0.0-rc.0', 'major'), '2.0.0')
    assert.equal(bump('0.2.1-rc.0', 'minor'), '0.3.0')
  })

  it('starts and continues pre-release series', () => {
    assert.equal(bump('0.1.0', 'preminor'), '0.2.0-rc.0')
    assert.equal(bump('0.1.0', 'premajor', 'beta'), '1.0.0-beta.0')
    assert.equal(bump('0.1.0', 'prepatch'), '0.1.1-rc.0')
    assert.equal(bump('0.1.0', 'prerelease'), '0.1.1-rc.0')
    assert.equal(bump('0.2.0-rc.0', 'prerelease'), '0.2.0-rc.1')
    assert.equal(bump('0.2.0-beta.4', 'prerelease'), '0.2.0-rc.0')
  })
})
