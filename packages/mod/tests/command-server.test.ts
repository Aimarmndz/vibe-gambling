// SPDX-License-Identifier: AGPL-3.0-or-later
// `/vibe-server`: enseña el servidor y lo cambia solo si `/api/meta` habla nuestro protocolo.
import { expect, test } from 'claude-code/testing'

import { SERVER, TEST_OPTIONS, startSession, world, command } from './support/harness.ts'

const meta = (protocol: number, isOfficial: boolean, name = 'Casino de Pruebas') => ({
  json: { v: 1, protocol, name, isOfficial, serverVersion: '1.0.0', publicUrl: SERVER },
})

test('without arguments it shows the current server', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: { '/api/meta': meta(1, true) } })
  await startSession($, w)
  const { text } = await command($, 'vibe-server')
  expect(text).toBe(`🎰 Server: ${SERVER} — Casino de Pruebas (official)`)
})

test(
  'says so when the current server does not answer',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: { '/api/meta': { fail: true } } })
    await startSession($, w)
    expect((await command($, 'vibe-server')).text).toBe(`🎰 Server: ${SERVER} (unreachable)`)
  },
)

test(
  'switches to a compatible self-hosted server through the plugin config',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, { routes: { '/api/meta': meta(1, false, 'My Basement') } })
    await startSession($, w)
    const { text } = await command($, 'vibe-server', 'http://casino.test/')
    expect(text).toContain('Now playing at http://casino.test — My Basement (self-hosted)')
    expect(w.configSets).toEqual([{ key: 'vibe-gambling.serverUrl', value: 'http://casino.test' }])
    expect(w.to('/api/meta')[0]?.url).toBe('http://casino.test/api/meta')
  },
)

test('`default` goes back to the URL in the manifest', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: { '/api/meta': meta(1, true) } })
  await startSession($, w)
  await command($, 'vibe-server', 'default')
  expect(w.to('/api/meta')[0]?.url).toBe('https://default.casino.test/api/meta')
  expect(w.configSets).toEqual([
    { key: 'vibe-gambling.serverUrl', value: 'https://default.casino.test' },
  ])
})

test(
  'refuses bad URLs, unreachable servers and other protocol versions',
  { options: TEST_OPTIONS },
  async ($, on) => {
    let protocol = 2
    const w = world(on, { routes: { '/api/meta': () => meta(protocol, false) } })
    await startSession($, w)
    expect((await command($, 'vibe-server', 'ftp://nope')).text).toBe(
      '"ftp://nope" is not an http(s) URL.',
    )
    expect((await command($, 'vibe-server', 'https://x.test/?a=1')).text).toContain(
      'not an http(s) URL',
    )
    expect((await command($, 'vibe-server', SERVER)).text).toBe(
      `${SERVER} speaks protocol v2, this mod speaks v1. Server not changed.`,
    )
    protocol = 1
    const offline = world
    void offline
    expect(w.configSets).toEqual([])
  },
)

test('reports when the config change is refused', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: { '/api/meta': meta(1, false) }, configDeny: 'locked by policy' })
  await startSession($, w)
  expect((await command($, 'vibe-server', SERVER)).text).toBe(
    "Couldn't save the server: locked by policy",
  )
})

test('an unreachable new server is not saved', { options: TEST_OPTIONS }, async ($, on) => {
  const w = world(on, { routes: {} })
  await startSession($, w)
  expect((await command($, 'vibe-server', 'https://other.test')).text).toBe(
    "Couldn't reach https://other.test/api/meta. Server not changed.",
  )
  expect(w.configSets).toEqual([])
})
