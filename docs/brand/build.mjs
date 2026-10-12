// SPDX-License-Identifier: AGPL-3.0-or-later
// Genera los PNG de la marca a partir de los SVG de píxeles de esta carpeta (la fuente de verdad).
// Uso: `node docs/brand/build.mjs` desde la raíz del repo. Usa el Chromium de Playwright que ya
// instala packages/web (`pnpm --filter @vibe-gambling/web exec playwright install chromium`).
// Nada sale a la red: el SVG se carga como data URL y se rasteriza a escala entera.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '../../packages/web/package.json'))
const { chromium } = require('@playwright/test')

/** Fondo del avatar del repo: el azul noche del menú (`night` en la paleta del juego). */
const AVATAR_BG = '#0d1240'
const AVATAR_SIZE = 500
/** Escala entera de la marca de 32 px dentro del avatar (32 × 14 = 448 px, margen de 26 px). */
const AVATAR_SCALE = 14

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
    console.log(`${file.replace(`${here}/`, '')} ${size.w}×${size.h}`)
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
} finally {
  await browser.close()
}
