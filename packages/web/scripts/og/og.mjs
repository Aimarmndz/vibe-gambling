// SPDX-License-Identifier: AGPL-3.0-or-later
// Genera public/og.png (1200×630): captura la ventana en modo demo y la monta en card.html.
// Con tamaño y salida genera otras tarjetas, p. ej. el social preview de GitHub (1280×640).
// Uso, con `pnpm dev` levantado (WEB_DEV_LOCAL_CONFIG=1 vale) o contra la pila de desarrollo:
//   node packages/web/scripts/og/og.mjs http://localhost:5173
//   node packages/web/scripts/og/og.mjs http://localhost:8787 1280 640 docs/launch/social-preview.png
import { chromium } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [base, width = '1200', height = '630', output] = process.argv.slice(2)
if (!base) {
  console.error('uso: node og.mjs <url de la web> [ancho alto salida]')
  process.exit(1)
}
const out = output ? resolve(process.cwd(), output) : resolve(here, '../../public/og.png')
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const game = await browser.newPage({ viewport: { width: 960, height: 720 }, locale: 'en-US' })
  await game.goto(`${base}/play?demo=manual&noboot`)
  await game.waitForTimeout(1500)
  await game.keyboard.press('ArrowRight')
  await game.keyboard.press('x')
  await game.keyboard.press('ArrowUp')
  await game.keyboard.press('x')
  // Espera a que se vaya el aviso de "apuesta lista" para que no tape el tapete.
  await game.waitForTimeout(5000)
  const shot = await game.screenshot({ type: 'png' })
  const card = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } })
  await card.goto(pathToFileURL(resolve(here, 'card.html')).href)
  await card.locator('#shot').evaluate(
    (img, src) => {
      img.src = src
    },
    `data:image/png;base64,${shot.toString('base64')}`,
  )
  await card.waitForTimeout(500)
  await card.screenshot({ path: out })
  console.log(`${out} generado`)
} finally {
  await browser.close()
}
