// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests de la copia generada del manifiesto del mod (versión y valores por defecto).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isModManifestFresh, renderManifest } from '../lib/mod-manifest.ts'

const manifest = (data: unknown): string => JSON.stringify(data)

describe('renderManifest', () => {
  it('exports the version and every userConfig default', () => {
    const text = renderManifest(
      manifest({
        version: '1.2.3-rc.0',
        userConfig: {
          serverUrl: { type: 'string', default: 'https://casino.example' },
          autoOpen: { type: 'boolean', default: false },
        },
      }),
    )
    assert.match(text, /^\/\/ SPDX-License-Identifier: AGPL-3\.0-or-later\n/)
    assert.match(text, /export const PLUGIN_VERSION = "1\.2\.3-rc\.0"/)
    assert.match(
      text,
      /export const USER_CONFIG_DEFAULTS = \{"serverUrl":"https:\/\/casino\.example","autoOpen":false\} as const/,
    )
  })

  it('refuses a version that is not SemVer', () => {
    for (const version of [undefined, 1, '1.2', 'v1.2.3']) {
      assert.throws(() => renderManifest(manifest({ version, userConfig: {} })), /SemVer/)
    }
  })

  it('refuses an option without a default', () => {
    assert.throws(
      () => renderManifest(manifest({ version: '1.0.0', userConfig: { x: { type: 'string' } } })),
      /"x".*default/,
    )
    assert.throws(() => renderManifest(manifest({ version: '1.0.0' })), /userConfig/)
    assert.throws(() => renderManifest('[]'), /objeto JSON/)
  })
})

describe('isModManifestFresh', () => {
  it('the committed copy matches packages/mod/.claude-plugin/plugin.json', async () => {
    assert.equal(await isModManifestFresh(), true)
  })
})
