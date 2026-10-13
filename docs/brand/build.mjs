// SPDX-License-Identifier: AGPL-3.0-or-later
// Genera los PNG de la marca a partir de los SVG de píxeles de esta carpeta (la fuente de verdad) y
// los iconos de la web en packages/web/public (favicon.svg, favicon.ico, apple-touch-icon.png,
// icon-192.png, icon-512.png, logo-mark.svg y site.webmanifest).
// Uso: `node docs/brand/build.mjs` desde la raíz del repo. Usa el Chromium de Playwright que ya
// instala packages/web (`pnpm --filter @vibe-gambling/web exec playwright install chromium`).
// Nada sale a la red: el SVG se carga como data URL y se rasteriza a escala entera.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../..')
const webDir = join(repo, 'packages/web')
const publicDir = join(webDir, 'public')
const require = createRequire(join(webDir, 'package.json'))
const { chromium } = require('@playwright/test')
// La paleta del juego es la única fuente de los colores (Node ejecuta el .ts sin compilar).
const { PALETTE } = await import(join(webDir, 'src/ui/palette.ts'))

/** Fondo del avatar del repo y de los iconos de la web: el azul noche del menú. */
const AVATAR_BG = PALETTE.night
const AVATAR_SIZE = 500
/** Escala entera de la marca de 32 px dentro del avatar (32 × 14 = 448 px, margen de 26 px). */
const AVATAR_SCALE = 14

/**
 * Iconos cuadrados de la web: tamaño final, escala entera de la marca de 32 y fondo opaco (iOS y
 * Android rellenan la transparencia con negro o blanco a su antojo).
 */
const WEB_ICONS = [
  { file: 'apple-touch-icon.png', size: 180, scale: 5 },
  { file: 'icon-192.png', size: 192, scale: 5 },
  { file: 'icon-512.png', size: 512, scale: 14 },
]
/** Tamaños del favicon.ico: el de 16 sale de la marca redibujada y los demás, a escala entera. */
const ICO_SIZES = [
  { size: 16, source: 'small', scale: 1 },
  { size: 32, source: 'large', scale: 1 },
  { size: 48, source: 'small', scale: 3 },
]

/** Lee un SVG de la carpeta y devuelve su data URL y su tamaño en píxeles de la rejilla. */
function loadSvg(name) {
  const text = readFileSync(join(here, name), 'utf8')
  const match = /viewBox="0 0 (\d+) (\d+)"/.exec(text)
  if (!match) throw new Error(`${name}: no tiene un viewBox "0 0 w h"`)
  const url = `data:image/svg+xml;base64,${Buffer.from(text).toString('base64')}`
  return { url, w: Number(match[1]), h: Number(match[2]) }
}

/** Página con una sola imagen a escala entera sobre fondo transparente (o de color). */
function html(svg, scale, { size, background } = {}) {
  const w = svg.w * scale
  const h = svg.h * scale
  const box = size ?? { w, h }
  const left = Math.floor((box.w - w) / 2)
  const top = Math.floor((box.h - h) / 2)
  return `<!doctype html><html><body style="margin:0;background:${background ?? 'transparent'}">
<div style="position:relative;width:${box.w}px;height:${box.h}px;background:${background ?? 'transparent'}">
<img src="${svg.url}" width="${w}" height="${h}" style="position:absolute;left:${left}px;top:${top}px;image-rendering:pixelated">
</div></body></html>`
}

const outDir = join(here, 'png')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const render = async (file, svg, scale, opts = {}) => {
    const size = opts.size ?? { w: svg.w * scale, h: svg.h * scale }
    await page.setViewportSize({ width: size.w, height: size.h })
    await page.setContent(html(svg, scale, opts))
    await page.locator('img').evaluate(img => img.decode())
    const png = await page.screenshot({
      clip: { x: 0, y: 0, width: size.w, height: size.h },
      omitBackground: !opts.background,
    })
    writeFileSync(file, png)
    console.log(`${relative(repo, file)} ${size.w}×${size.h}`)
  }

  const mark = loadSvg('logo-mark.svg')
  const mark16 = loadSvg('logo-mark-16.svg')
  // 16 px sale de la versión dibujada a mano; el resto, de la rejilla de 32 a escala entera.
  await render(join(outDir, 'logo-mark-16.png'), mark16, 1)
  for (const size of [32, 64, 128, 256, 512]) {
    await render(join(outDir, `logo-mark-${size}.png`), mark, size / mark.w)
  }
  // Logotipo completo: solo escalas enteras (×2, ×4, ×8) para que cada píxel siga siendo cuadrado.
  for (const [name, file] of [
    ['logo', 'logo.svg'],
    ['logo-light', 'logo-light.svg'],
  ]) {
    const svg = loadSvg(file)
    for (const scale of [2, 4, 8]) {
      await render(join(outDir, `${name}@${scale}x.png`), svg, scale)
    }
  }
  await render(join(here, 'avatar.png'), mark, AVATAR_SCALE, {
    size: { w: AVATAR_SIZE, h: AVATAR_SIZE },
    background: AVATAR_BG,
  })

  // Iconos de la web.
  writeFileSync(join(publicDir, 'favicon.svg'), publicSvg('logo-mark-16.svg'))
  writeFileSync(join(publicDir, 'logo-mark.svg'), publicSvg('logo-mark.svg'))
  console.log('packages/web/public/favicon.svg, logo-mark.svg')
  for (const icon of WEB_ICONS) {
    await render(join(publicDir, icon.file), mark, icon.scale, {
      size: { w: icon.size, h: icon.size },
      background: AVATAR_BG,
    })
  }
  const sources = { small: mark16, large: mark }
  const entries = []
  for (const entry of ICO_SIZES) {
    const svg = sources[entry.source]
    await page.setViewportSize({ width: entry.size, height: entry.size })
    await page.setContent(html(svg, entry.scale))
    await page.locator('img').evaluate(img => img.decode())
    const png = await page.screenshot({
      clip: { x: 0, y: 0, width: entry.size, height: entry.size },
      omitBackground: true,
    })
    entries.push({ size: entry.size, png })
  }
  writeFileSync(join(publicDir, 'favicon.ico'), ico(entries))
  console.log(`packages/web/public/favicon.ico ${ICO_SIZES.map(e => e.size).join('/')}`)
  writeFileSync(join(publicDir, 'site.webmanifest'), `${JSON.stringify(manifest(), null, 2)}\n`)
  console.log('packages/web/public/site.webmanifest')
} finally {
  await browser.close()
}

/**
 * Copia de un SVG de la marca para servirla en la web, con un aviso de que es generada (el SPDX y
 * el dibujo quedan igual).
 */
function publicSvg(name) {
  const text = readFileSync(join(here, name), 'utf8')
  const start = text.indexOf('<svg')
  if (start < 0) throw new Error(`${name}: no tiene <svg>`)
  return (
    '<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->\n' +
    `<!-- Generado por docs/brand/build.mjs desde docs/brand/${name}: no lo edites aquí. -->\n` +
    text.slice(start)
  )
}

/** Empaqueta PNG en un .ico (formato ICO con imágenes PNG dentro, válido desde Windows Vista). */
function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach(({ size, png }, i) => {
    const at = i * 16
    // 0 significa 256 en los campos de ancho y alto de un byte.
    dir.writeUInt8(size >= 256 ? 0 : size, at)
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1)
    dir.writeUInt8(0, at + 2)
    dir.writeUInt8(0, at + 3)
    dir.writeUInt16LE(1, at + 4)
    dir.writeUInt16LE(32, at + 6)
    dir.writeUInt32LE(png.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...entries.map(e => e.png)])
}

/** Manifiesto de la web: nombre y descripción de los textos en inglés, colores de la paleta. */
function manifest() {
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
  const landing = JSON.parse(readFileSync(join(repo, 'locales/en/landing.json'), 'utf8'))
  return {
    name: landing['landing.title'],
    short_name: pkg.name,
    description: landing['landing.description'],
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'browser',
    background_color: PALETTE.ink,
    theme_color: PALETTE.ink,
    icons: [
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
      ...WEB_ICONS.filter(i => i.file.startsWith('icon-')).map(i => ({
        src: `/${i.file}`,
        sizes: `${i.size}x${i.size}`,
        type: 'image/png',
      })),
    ],
  }
}
