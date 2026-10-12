// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests de la sincronización de versiones entre manifiestos.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { checkVersions, collectVersionFields, replaceVersionInText } from '../lib/versions.ts'
import type { VersionField } from '../lib/versions.ts'

const field = (file: string, value: unknown, path: string[] = ['version']): VersionField => ({
  file,
  path,
  value,
})

describe('collectVersionFields', () => {
  it('covers the root, every workspace package, the plugin and the marketplace', () => {
    const files = collectVersionFields().map(f => `${f.file}#${f.path.join('.')}`)
    assert.equal(files[0], 'package.json#version')
    for (const expected of [
      'packages/server/package.json#version',
      'packages/mod/.claude-plugin/plugin.json#version',
      '.claude-plugin/marketplace.json#metadata.version',
    ]) {
      assert.ok(files.includes(expected), expected)
    }
  })

  it('agrees on one version in the repository', () => {
    assert.deepEqual(checkVersions().problems, [])
  })
})

describe('checkVersions', () => {
  it('reports missing, different and invalid versions', () => {
    const report = checkVersions([
      field('package.json', '1.2.3'),
      field('a/package.json', '1.2.4'),
      field('b/plugin.json', undefined),
    ])
    assert.equal(report.version, '1.2.3')
    assert.deepEqual(report.problems, [
      'a/package.json → version is "1.2.4", expected "1.2.3"',
      'b/plugin.json → version is missing (expected "1.2.3")',
    ])
    assert.equal(checkVersions([field('package.json', 'v1')]).problems.length, 1)
  })
})

describe('replaceVersionInText', () => {
  it('changes only the version values and keeps the formatting', () => {
    const text =
      '{\n  "name": "x",\n  "version": "0.1.0",\n  "deps": { "y": "0.1.0" },\n  "metadata": { "version": "0.1.0" }\n}\n'
    assert.equal(
      replaceVersionInText(text, 'x.json', '0.1.0', '0.2.0-rc.0'),
      text.replaceAll('"version": "0.1.0"', '"version": "0.2.0-rc.0"'),
    )
  })

  it('treats the old version literally, not as a pattern', () => {
    const text = '{ "version": "0.1.0", "other": { "version": "0x1y0" } }'
    assert.equal(
      replaceVersionInText(text, 'x.json', '0.1.0', '1.0.0'),
      text.replace('0.1.0', '1.0.0'),
    )
  })
})
