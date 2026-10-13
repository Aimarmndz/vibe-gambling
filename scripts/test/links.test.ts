// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests del comprobador de enlaces de los Markdown (node:test; `pnpm test:scripts`).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { anchorsOf, checkLinks, linksOf, resolveTarget, slugify } from '../lib/links.ts'
import type { LinkFs } from '../lib/links.ts'

/** Sistema de archivos en memoria: rutas de archivo → contenido; las carpetas se deducen. */
function memoryFs(files: Record<string, string>): LinkFs {
  const isDirectory = (path: string): boolean =>
    Object.keys(files).some(file => file.startsWith(`${path}/`))
  return {
    exists: path => path in files || isDirectory(path),
    isDirectory,
    read: path => {
      const content = files[path]
      if (content === undefined) throw new Error(`no such file: ${path}`)
      return content
    },
  }
}

describe('slugify', () => {
  it('follows the GitHub anchors', () => {
    assert.equal(slugify('How to play'), 'how-to-play')
    assert.equal(slugify('Credits and license'), 'credits-and-license')
    assert.equal(slugify('Español'), 'español')
    assert.equal(slugify('Cómo se juega: tiradas y pagos'), 'cómo-se-juega-tiradas-y-pagos')
    assert.equal(slugify('🎰 The `/bet` command'), '-the-bet-command')
    assert.equal(slugify('**Bold** and _italic_ and [a link](x.md)'), 'bold-and-italic-and-a-link')
    assert.equal(slugify('snake_case stays'), 'snake_case-stays')
    assert.equal(slugify('Self-hosting (your own casino)'), 'self-hosting-your-own-casino')
  })
})

describe('anchorsOf', () => {
  it('collects ATX and setext headings, duplicates and HTML ids', () => {
    const anchors = anchorsOf(
      [
        '# Title',
        '## Install',
        '## Install',
        'Setext title',
        '============',
        '',
        '| a | b |',
        '| - | - |',
        '',
        '<a id="custom-anchor"></a>',
        '```md',
        '## Not a heading',
        '```',
      ].join('\n'),
    )
    for (const anchor of ['title', 'install', 'install-1', 'setext-title', 'custom-anchor']) {
      assert.ok(anchors.has(anchor), anchor)
    }
    assert.ok(!anchors.has('not-a-heading'))
  })

  it('does not take a thematic break after a list or a table as a heading', () => {
    const anchors = anchorsOf(['- item', '---', '| a |', '---'].join('\n'))
    assert.deepEqual([...anchors], [])
  })
})

describe('linksOf', () => {
  it('finds Markdown, nested image, reference and HTML targets with their line', () => {
    const links = linksOf(
      [
        'See [docs](docs/A.md#intro) and [![badge](img/b.svg)](https://x.test).',
        '[ref]: ../LICENSE',
        '<picture><source srcset="logo.svg, logo@2x.svg 2x"><img src="logo-light.svg"></picture>',
        'Inline `[not](a-link.md)` code.',
        '```',
        '[also](not-a-link.md)',
        '```',
      ].join('\n'),
    )
    assert.deepEqual(
      links.map(link => `${String(link.line)}:${link.target}`),
      [
        '1:docs/A.md#intro',
        '1:img/b.svg',
        '1:https://x.test',
        '2:../LICENSE',
        '3:logo.svg',
        '3:logo@2x.svg',
        '3:logo-light.svg',
      ],
    )
  })
})

describe('resolveTarget', () => {
  it('resolves relative to the file and absolute to the repo root', () => {
    assert.equal(resolveTarget('docs/A.md', '../README.md'), 'README.md')
    assert.equal(resolveTarget('docs/A.md', './B.md'), 'docs/B.md')
    assert.equal(resolveTarget('docs/A.md', '/LICENSE'), 'LICENSE')
  })
})

describe('checkLinks', () => {
  const fs = memoryFs({
    'README.md': [
      '# Project',
      '## Install',
      '[Install](#install) · [Missing](#missing) · [Español](README.es.md#instalación)',
      '![gif](docs/demo.gif) ![gone](docs/gone.gif) [docs](docs) [web](https://example.test)',
      '[bad anchor](docs/A.md#nope) [code anchor](src/x.ts#L10) [space](docs/My%20File.md)',
    ].join('\n'),
    'README.es.md': '# Proyecto\n## Instalación\n[English](README.md#install)',
    'docs/demo.gif': '',
    'docs/A.md': '# A',
    'docs/My File.md': '# Mine',
    'src/x.ts': '',
  })

  it('reports missing files and anchors, and nothing else', () => {
    const broken = checkLinks(['README.md', 'README.es.md'], fs)
    assert.deepEqual(
      broken.map(link => `${link.file}:${String(link.line)}:${link.target}`),
      ['README.md:3:#missing', 'README.md:4:docs/gone.gif', 'README.md:5:docs/A.md#nope'],
    )
  })
})
