// SPDX-License-Identifier: AGPL-3.0-or-later
// Detección del navegador con un SO falso: Chromium en modo app en Linux, macOS y Windows, y
// el navegador por defecto si no hay ninguno.
import { describe, expect, test } from 'claude-code/testing'

import {
  browserCandidates,
  findBrowser,
  isSafeWindowUrl,
  launchCommand,
} from '../hooks/lib/browser.ts'
import {
  LOGGED_IN,
  SERVER,
  TEST_OPTIONS,
  happyCasino,
  playTurn,
  startSession,
  world,
} from './support/harness.ts'

const URL_PLAY = `${SERVER}/play?code=${'C'.repeat(43)}`
const SIZE = { width: 960, height: 720 }

describe('candidates', () => {
  test('prefer Chrome, then Chromium, Brave, Edge and Vivaldi', () => {
    const names = [...new Set(browserCandidates('linux', {}).map(c => c.name))]
    expect(names).toEqual(['Chrome', 'Chromium', 'Brave', 'Edge', 'Vivaldi'])
    expect(browserCandidates('linux', { home: '/home/x' }).map(c => c.path)).toContain(
      '/home/x/.local/share/flatpak/exports/bin/com.brave.Browser',
    )
  })

  test('macOS looks in /Applications and ~/Applications', () => {
    const paths = browserCandidates('darwin', { home: '/Users/x' }).map(c => c.path)
    expect(paths[0]).toBe('/Applications/Google Chrome.app')
    expect(paths).toContain('/Users/x/Applications/Brave Browser.app')
  })

  test('Windows looks in Program Files and LocalAppData', () => {
    const paths = browserCandidates('win32', {
      programFiles: 'C:\\Program Files',
      programFilesX86: 'C:\\Program Files (x86)',
      localAppData: 'C:\\Users\\x\\AppData\\Local',
    }).map(c => c.path)
    expect(paths[0]).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    expect(paths).toContain(
      'C:\\Users\\x\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    )
    expect(paths).toContain('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
  })

  test('an unknown OS has none', () => {
    expect(browserCandidates('other', {})).toEqual([])
  })

  test('findBrowser returns the first that exists', async () => {
    const found = await findBrowser(
      'linux',
      {},
      async path => path === '/snap/bin/chromium' || path === '/usr/bin/vivaldi',
    )
    expect(found).toEqual({ name: 'Chromium', path: '/snap/bin/chromium', kind: 'binary' })
    expect(await findBrowser('linux', {}, async () => false)).toBeNull()
  })
})

describe('launch commands', () => {
  test('linux: detached app window, or xdg-open', () => {
    const chrome = { name: 'Chrome', path: '/usr/bin/google-chrome', kind: 'binary' as const }
    expect(launchCommand('linux', chrome, URL_PLAY, SIZE)).toEqual([
      'sh',
      '-c',
      '"$@" </dev/null >/dev/null 2>&1 &',
      'vibe-gambling',
      '/usr/bin/google-chrome',
      `--app=${URL_PLAY}`,
      '--window-size=960,720',
    ])
    expect(launchCommand('linux', null, URL_PLAY, SIZE)).toEqual([
      'sh',
      '-c',
      '"$@" </dev/null >/dev/null 2>&1 &',
      'vibe-gambling',
      'xdg-open',
      URL_PLAY,
    ])
  })

  test('macOS: open -na App --args, or open', () => {
    const brave = {
      name: 'Brave',
      path: '/Applications/Brave Browser.app',
      kind: 'macApp' as const,
    }
    expect(launchCommand('darwin', brave, URL_PLAY, SIZE)).toEqual([
      'open',
      '-na',
      '/Applications/Brave Browser.app',
      '--args',
      `--app=${URL_PLAY}`,
      '--window-size=960,720',
    ])
    expect(launchCommand('darwin', null, URL_PLAY, SIZE)).toEqual(['open', URL_PLAY])
  })

  test('Windows: cmd /c start, with a quoted title', () => {
    const edge = {
      name: 'Edge',
      path: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      kind: 'binary' as const,
    }
    expect(launchCommand('win32', edge, URL_PLAY, SIZE)).toEqual([
      'cmd',
      '/d',
      '/c',
      'start',
      'vibe gambling',
      edge.path,
      `--app=${URL_PLAY}`,
      '--window-size=960,720',
    ])
    expect(launchCommand('win32', null, URL_PLAY, SIZE)).toEqual([
      'cmd',
      '/d',
      '/c',
      'start',
      'vibe gambling',
      URL_PLAY,
    ])
  })

  test('Windows: a browser path that cmd would interpret falls back to the default browser', () => {
    // Un usuario de Windows llamado `A&calc` (sin espacios, así que el argv no va entre
    // comillas): `cmd` ejecutaría lo que va detrás del `&`. Igual con `|`, `<`, `>`, `^`, `%`, `"`.
    for (const user of ['A&calc', 'A|calc', 'A^B', '%PATH%', 'A>out', 'A<in', 'A"B', 'A!B']) {
      const brave = {
        name: 'Brave',
        path: `C:\\Users\\${user}\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
        kind: 'binary' as const,
      }
      expect(launchCommand('win32', brave, URL_PLAY, SIZE), user).toEqual([
        'cmd',
        '/d',
        '/c',
        'start',
        'vibe gambling',
        URL_PLAY,
      ])
    }
    // Las rutas normales (espacios, paréntesis, letras con tilde) siguen valiendo.
    const edge = {
      name: 'Edge',
      path: 'C:\\Users\\José (dev)\\AppData\\Local\\Microsoft\\Edge\\Application\\msedge.exe',
      kind: 'binary' as const,
    }
    expect(launchCommand('win32', edge, URL_PLAY, SIZE)?.[5]).toBe(edge.path)
  })

  test('an unknown OS with no browser cannot open anything', () => {
    expect(launchCommand('other', null, URL_PLAY, SIZE)).toBeNull()
  })

  test('only same-origin URLs without shell metacharacters are opened', () => {
    expect(isSafeWindowUrl(URL_PLAY, SERVER)).toBe(true)
    expect(isSafeWindowUrl('http://casino.test.evil.test/play', SERVER)).toBe(false)
    expect(isSafeWindowUrl(`${SERVER}/play?code=a&calc.exe`, SERVER)).toBe(false)
    expect(isSafeWindowUrl(`${SERVER}/play?code="x"`, SERVER)).toBe(false)
    expect(isSafeWindowUrl('--disable-web-security', SERVER)).toBe(false)
    expect(isSafeWindowUrl('file:///etc/passwd', SERVER)).toBe(false)
  })
})

describe('with a fake OS', () => {
  test('macOS with Chrome', { options: TEST_OPTIONS }, async ($, on) => {
    const w = world(on, {
      routes: happyCasino(false),
      store: LOGGED_IN,
      uname: 'Darwin',
      env: { HOME: '/Users/player' },
      files: ['/Users/player/Applications/Google Chrome.app'],
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.runs.at(-1)?.slice(0, 4)).toEqual([
      'open',
      '-na',
      '/Users/player/Applications/Google Chrome.app',
      '--args',
    ])
  })

  test('Windows with Edge only', { options: TEST_OPTIONS }, async ($, on) => {
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    const w = world(on, {
      routes: happyCasino(false),
      store: LOGGED_IN,
      env: {
        OS: 'Windows_NT',
        ProgramFiles: 'C:\\Program Files',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      },
      files: [edge],
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.logs).toEqual([])
    expect(w.checked.some(path => path.endsWith('Edge\\Application\\msedge.exe'))).toBe(true)
    expect(w.runs.some(argv => argv[0] === 'uname')).toBe(false)
    expect(w.runs.at(-1)).toEqual([
      'cmd',
      '/d',
      '/c',
      'start',
      'vibe gambling',
      edge,
      `--app=${URL_PLAY}`,
      '--window-size=800,600',
    ])
    expect(w.to('/api/turn/start')[0]?.body).toMatchObject({ os: 'win32' })
  })

  test(
    'Linux without any Chromium falls back to xdg-open',
    { options: TEST_OPTIONS },
    async ($, on) => {
      const w = world(on, { routes: happyCasino(false), store: LOGGED_IN })
      await startSession($, w)
      await playTurn($, w)
      expect(w.runs.at(-1)?.slice(-2)).toEqual(['xdg-open', URL_PLAY])
    },
  )

  test('a launcher that fails is logged, not shown', { options: TEST_OPTIONS }, async ($, on) => {
    const w = world(on, { routes: happyCasino(false), store: LOGGED_IN, launchExit: 127 })
    await startSession($, w)
    await playTurn($, w)
    expect(w.logs.some(line => line.includes('ha salido con 127'))).toBe(true)
    expect(w.toasts.filter(t => t.includes('window'))).toEqual([])
  })
})
