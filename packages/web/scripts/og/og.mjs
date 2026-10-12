// SPDX-License-Identifier: AGPL-3.0-or-later
// Genera public/og.png (1200×630): captura la ventana en modo demo y la monta en card.html.
// Uso, con `pnpm dev` levantado (WEB_DEV_LOCAL_CONFIG=1 vale):
//   node packages/web/scripts/og/og.mjs http://localhost:5173
import { chromium } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.argv[2]
if (!base) {
  console.error('uso: node og.mjs <url de la web en desarrollo>')
  process.exit(1)
}
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
  await game.waitForTimeout(800)
  const shot = await game.screenshot({ type: 'png' })
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } })
  await card.goto(pathToFileURL(resolve(here, 'card.html')).href)
  await card.locator('#shot').evaluate(
    (img, src) => {
      img.src = src
    },
    `data:image/png;base64,${shot.toString('base64')}`,
  )
  await card.waitForTimeout(500)
  await card.screenshot({ path: resolve(here, '../../public/og.png') })
  console.log('public/og.png generado')
} finally {
  await browser.close()
}
