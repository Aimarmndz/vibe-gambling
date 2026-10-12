// SPDX-License-Identifier: AGPL-3.0-or-later
// Metadatos de previsualización absolutos: Twitter/X no acepta `og:image` relativo.
import { describe, expect, it } from 'vitest'

import { absolutizeMeta } from '../../src/http/html.ts'

const page = `<!doctype html><html><head>
<meta property="og:type" content="website" />
<meta property="og:url" content="/" />
<meta property="og:image" content="/og.png" />
<meta property="og:image:width" content="1200" />
<meta
  name="twitter:image"
  content="og.png?v=1&amp;x=2"
/>
<meta name="description" content="/no-es-una-url" />
<meta property="og:image:alt" content="/tampoco" />
</head><body><p>og:image /og.png</p></body></html>`

describe('absolutizeMeta', () => {
  it('completa og:url, og:image y twitter:image con PUBLIC_URL', () => {
    const out = absolutizeMeta(page, 'https://vibe.test')
    expect(out).toContain('<meta property="og:url" content="https://vibe.test/" />')
    expect(out).toContain('<meta property="og:image" content="https://vibe.test/og.png" />')
    expect(out).toContain('content="https://vibe.test/og.png?v=1&amp;x=2"')
  })

  it('no toca el resto del documento ni otros metadatos', () => {
    const out = absolutizeMeta(page, 'https://vibe.test')
    expect(out).toContain('<meta property="og:image:width" content="1200" />')
    expect(out).toContain('<meta name="description" content="/no-es-una-url" />')
    expect(out).toContain('<meta property="og:image:alt" content="/tampoco" />')
    expect(out).toContain('<p>og:image /og.png</p>')
  })

  it('respeta las URLs ya absolutas y no inventa otros esquemas', () => {
    const html = [
      '<meta property="og:image" content="https://cdn.test/a.png">',
      '<meta property="og:url" content="javascript:alert(1)">',
    ].join('')
    expect(absolutizeMeta(html, 'https://vibe.test')).toBe(html)
  })

  it('escapa la URL resultante dentro del atributo', () => {
    const out = absolutizeMeta('<meta property="og:url" content="/a&quot;b">', 'https://vibe.test')
    expect(out).toBe('<meta property="og:url" content="https://vibe.test/a%22b">')
  })
})
