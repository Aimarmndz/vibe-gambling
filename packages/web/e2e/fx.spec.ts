// SPDX-License-Identifier: AGPL-3.0-or-later
// Animaciones de espectáculo en el navegador de verdad (servidor compilado con su CSP), forzadas
// con el modo demo (`/play?demo&fx=…`): que ninguna salga antes de que caiga la bola, que se
// salten con ✕, la versión con movimiento reducido y capturas de varios fotogramas de cada una en
// docs/screenshots/fx-*.png (a ×2 exacto, sin CRT, para compararlas con docs/design/v2/sb-*.png).
import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

import type { GameState } from '../src/game/state.ts'
import { shot } from './support.ts'

interface FxHooks {
  state(): GameState
  screens(): string[]
  fx(): {
    current: string | null
    queued: string[]
    coins: number
    notice: string | null
    /** Avisos de logro en pantalla o esperando. */
    notices: number
  }
}

const hooks = (page: Page) =>
  page.evaluate(() => {
    const vg = (window as unknown as { __vg?: FxHooks }).__vg
    return vg ? { state: vg.state(), screens: vg.screens(), fx: vg.fx() } : null
  })

/** Errores de cada página (se comprueban al cerrarla con `done`). */
const pageErrors = new WeakMap<Page, string[]>()

/** Cierra la página comprobando que no ha habido errores. */
async function done(page: Page): Promise<void> {
  expect(pageErrors.get(page) ?? []).toEqual([])
  await page.context().close()
}

/** Abre la demo con una animación forzada (sin arranque, sin "cómo se juega", sin CRT). */
async function open(browser: Browser, kind: string, reduced = false): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 640, height: 480 },
    locale: 'es-ES',
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  })
  const page = await context.newPage()
  const errors: string[] = []
  pageErrors.set(page, errors)
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => {
    localStorage.setItem('vibe-gambling:tip-seen', '1')
    localStorage.setItem(
      'vibe-gambling:prefs',
      JSON.stringify({ sound: true, crt: false, quality: 'high', locale: 'es' }),
    )
  })
  await page.goto(`/play?demo&noboot&fx=${kind}`)
  await page.waitForFunction(() => (window as unknown as { __vg?: FxHooks }).__vg?.state().user)
  return page
}

/**
 * Espera a que empiece la animación `id` comprobando en cada sondeo que, mientras la bola gira o
 * cae, no hay ninguna animación ni aviso en pantalla (nada destripa el resultado).
 */
async function waitFx(page: Page, id: string, timeout = 40_000): Promise<number> {
  const start = Date.now()
  for (;;) {
    const h = await hooks(page)
    if (h) {
      const { phase } = h.state
      if (phase === 'spinning' || phase === 'landing') {
        expect(h.fx.current?.startsWith('fx:') ?? false).toBe(false)
        expect(h.fx.notice).toBeNull()
      }
      if (h.fx.current === id) return Date.now()
    }
    if (Date.now() - start > timeout) throw new Error(`no llegó ${id}`)
    await page.waitForTimeout(25)
  }
}

/** Capturas en los instantes (ms desde `t0`) indicados. */
async function frames(page: Page, t0: number, name: string, at: Record<string, number>) {
  for (const [suffix, ms] of Object.entries(at)) {
    const wait = ms - (Date.now() - t0)
    if (wait > 0) await page.waitForTimeout(wait)
    await shot(page, `fx-${name}-${suffix}`)
  }
}

test.describe('espectáculo', () => {
  test('MEGA WIN: nada antes de la caída, contador, lluvia, saltable', async ({ browser }) => {
    const page = await open(browser, 'mega')
    const t0 = await waitFx(page, 'fx:prize')
    const h = await hooks(page)
    // Ya se ha enseñado el resultado (la cartera descongelada) cuando empieza el premio.
    expect(h!.state.phase).toBe('result')
    expect(h!.fx.queued).toEqual(['result'])
    await frames(page, t0, 'mega', { '1-impact': 150, '2-count': 1100, '3-hold': 2900 })
    expect((await hooks(page))!.fx.coins).toBeGreaterThan(0)
    // ✕ cierra (ya está en el hold) y llega la pantalla de resultado de siempre.
    await page.keyboard.press('x')
    await page.waitForFunction(() =>
      (window as unknown as { __vg: FxHooks }).__vg.screens().includes('result'),
    )
    await done(page)
  })

  test('BIG WIN y ¡PLENO!: ✕ salta al final y otra ✕ cierra', async ({ browser }) => {
    const big = await open(browser, 'big')
    const t0 = await waitFx(big, 'fx:prize')
    await big.waitForTimeout(150)
    await big.keyboard.press('x')
    expect((await hooks(big))!.fx.current).toBe('fx:prize')
    await frames(big, t0, 'big', { '1-skipped': 0 })
    await big.keyboard.press('x')
    await big.waitForFunction(() =>
      (window as unknown as { __vg: FxHooks }).__vg.screens().includes('result'),
    )
    await done(big)
    const pleno = await open(browser, 'pleno')
    const t1 = await waitFx(pleno, 'fx:prize')
    await frames(pleno, t1, 'pleno', { '1-impact': 200, '2-hold': 2900 })
    await done(pleno)
  })

  test('¡VERDE!, verde con premio encadenado y PUSH TO PROD', async ({ browser }) => {
    const green = await open(browser, 'green')
    const t0 = await waitFx(green, 'fx:green')
    await frames(green, t0, 'green', { '1-blink': 60, '2-band': 450, '3-end': 1100 })
    await done(green)
    const chain = await open(browser, 'greenwin')
    const t1 = await waitFx(chain, 'fx:green')
    await frames(chain, t1, 'greenwin', { '1-chain': 1100 })
    await waitFx(chain, 'fx:prize')
    await done(chain)
    const push = await open(browser, 'push')
    const t2 = await waitFx(push, 'fx:push')
    await frames(push, t2, 'push', {
      '1-terminal': 200,
      '2-deployed': 550,
      '3-rocket': 900,
      '4-stamp': 1450,
    })
    await push.waitForFunction(() =>
      (window as unknown as { __vg: FxHooks }).__vg.screens().includes('result'),
    )
    await push.waitForTimeout(400)
    await shot(push, 'fx-push-5-result')
    await done(push)
  })

  test('Ludo-Crédito: ventanilla, contrato, firma, sello y monedas', async ({ browser }) => {
    const page = await open(browser, 'bank')
    await page.waitForFunction(() =>
      (window as unknown as { __vg: FxHooks }).__vg.screens().includes('loan'),
    )
    await page.waitForTimeout(500)
    await shot(page, 'fx-bank-0-offer')
    const before = (await hooks(page))!.state.shown!
    await page.keyboard.press('x')
    await page.waitForFunction(
      () => ((window as unknown as { __vg: FxHooks }).__vg.state().shown?.debt ?? 0) > 0,
    )
    const t0 = Date.now()
    await frames(page, t0, 'bank', {
      '1-contract': 300,
      '2-sign': 1000,
      '3-stamp': 1500,
      '4-coins': 2200,
      '5-debt': 3000,
    })
    const after = (await hooks(page))!.state.shown!
    expect(after.balance).toBeGreaterThan(before.balance)
    // La secuencia sigue en pantalla hasta ✕ (o su hold) y no se cierra con el préstamo.
    expect((await hooks(page))!.screens).toContain('loan')
    await page.keyboard.press('x')
    await page.keyboard.press('x')
    await page.waitForFunction(
      () => !(window as unknown as { __vg: FxHooks }).__vg.screens().includes('loan'),
    )
    await done(page)
  })

  test('BANCARROTA — CONTINUE? desemboca en la oferta del préstamo', async ({ browser }) => {
    const page = await open(browser, 'bankrupt')
    // Primero el resultado de siempre; al cerrarlo, la bancarrota.
    await page.waitForFunction(() =>
      (window as unknown as { __vg: FxHooks }).__vg.screens().includes('result'),
    )
    await page.waitForTimeout(700)
    await page.keyboard.press('x')
    const t0 = await waitFx(page, 'fx:bankrupt')
    await frames(page, t0, 'bankrupt', { '1-dark': 250, '2-glitch': 900, '3-count': 1500 })
    await page.keyboard.press('x')
    await page.waitForFunction(() =>
      (window as unknown as { __vg: FxHooks }).__vg.screens().includes('loan'),
    )
    await page.waitForTimeout(300)
    await shot(page, 'fx-bankrupt-4-offer')
    await done(page)
  })

  test('ON FIRE, falacia del jugador y aviso de logro (después del resultado)', async ({
    browser,
  }) => {
    const fire = await open(browser, 'fire')
    await fire.waitForFunction(() =>
      (window as unknown as { __vg: FxHooks }).__vg.screens().includes('result'),
    )
    await fire.waitForTimeout(700)
    await fire.keyboard.press('x')
    const t0 = await waitFx(fire, 'fx:fire')
    await frames(fire, t0, 'fire', { '1-flash': 120, '2-intro': 700, '3-loop': 2600 })
    await done(fire)

    const fallacy = await open(browser, 'fallacy')
    await fallacy.waitForFunction(() =>
      (window as unknown as { __vg: FxHooks }).__vg.screens().includes('result'),
    )
    await fallacy.waitForTimeout(700)
    await fallacy.keyboard.press('x')
    const t1 = await waitFx(fallacy, 'fx:fallacy')
    await frames(fallacy, t1, 'fallacy', { '1-title': 350, '2-truth': 1000 })
    await done(fallacy)

    const ach = await open(browser, 'achievement')
    // El logro llega con la ronda, pero su aviso espera a que caiga la bola y a que se cierre
    // el resultado (no tapa el número).
    await ach.waitForFunction(() =>
      (window as unknown as { __vg: FxHooks }).__vg.screens().includes('result'),
    )
    expect((await hooks(ach))!.fx.notice).toBeNull()
    await ach.waitForTimeout(700)
    await ach.keyboard.press('x')
    await ach.waitForFunction(
      () => (window as unknown as { __vg: FxHooks }).__vg.fx().notice !== null,
    )
    await ach.waitForTimeout(450)
    await shot(ach, 'fx-achievement-1')
    await done(ach)
  })

  test('contador de pendientes: sube y baja como un odómetro', async ({ browser }) => {
    const page = await open(browser, 'pending')
    await page.waitForFunction(
      () => (window as unknown as { __vg: FxHooks }).__vg.state().wallet?.pendingSpins === 20,
    )
    const t0 = Date.now()
    await frames(page, t0, 'pending', { '1-up': 60, '2-up-end': 500 })
    await page.waitForFunction(
      () => (window as unknown as { __vg: FxHooks }).__vg.state().wallet?.pendingSpins === 19,
    )
    const t1 = Date.now()
    await frames(page, t1, 'pending', { '3-down': 80 })
    await done(page)
  })

  test('movimiento reducido: versiones cortas y quietas', async ({ browser }) => {
    for (const [kind, id] of [
      ['mega', 'fx:prize'],
      ['green', 'fx:green'],
      ['push', 'fx:push'],
    ] as const) {
      const page = await open(browser, kind, true)
      const t0 = await waitFx(page, id)
      await frames(page, t0, `reduced-${kind}`, { '1': 300 })
      // Sin lluvia de fichas.
      expect((await hooks(page))!.fx.coins).toBe(0)
      await done(page)
    }
  })

  test('sin fugas: repetir el premio y abrir y cerrar el menú no deja recursos de GPU', async ({
    browser,
  }) => {
    const page = await open(browser, 'mega')
    type Gl = { geometries: number; textures: number; programs: number }
    const gl = () =>
      page.evaluate(
        () => (window as unknown as { __vg: { render(): { gl: Gl } } }).__vg.render().gl,
      )
    /** El premio entero: ✕ al final, ✕ cierra, ✕ quita el resultado; hasta la mesa quieta. */
    const prize = async () => {
      await waitFx(page, 'fx:prize')
      // Coste por fotograma con la lluvia de fichas al máximo (GL por software en el E2E).
      const deltas = await page.evaluate(
        () =>
          new Promise<number[]>(resolve => {
            const out: number[] = []
            let last = performance.now()
            const step = (now: number) => {
              out.push(now - last)
              last = now
              if (out.length < 90) requestAnimationFrame(step)
              else resolve(out)
            }
            requestAnimationFrame(step)
          }),
      )
      const sorted = deltas.slice(5).sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]!
      console.log(`[fx] MEGA WIN: mediana ${median.toFixed(1)} ms por fotograma`)
      expect(median).toBeLessThan(50)
      await expect
        .poll(
          async () => {
            const h = (await hooks(page))!
            // Y sin el aviso de logro de esta ronda (si no, saldría con la siguiente girando).
            const still = h.fx.current === null && h.fx.notices === 0
            if (h.state.phase === 'idle' && h.screens.length === 1 && still) return true
            await page.keyboard.press('x')
            return false
          },
          { timeout: 30_000, intervals: [300] },
        )
        .toBe(true)
      // Las fichas que quedaban en el aire terminan de caer y se devuelven al depósito.
      await expect.poll(async () => (await hooks(page))!.fx.coins, { timeout: 5_000 }).toBe(0)
    }
    const again = () =>
      page.evaluate(() => {
        void (window as unknown as { __vgDemo: { fx(k: string): Promise<void> } }).__vgDemo.fx(
          'mega',
        )
      })
    const menuRound = async () => {
      await page.keyboard.press('p')
      await page.waitForFunction(() =>
        (window as unknown as { __vg: FxHooks }).__vg.screens().includes('menu'),
      )
      // Con el barrido terminado: los iconos 3D de la rejilla ya se han pintado.
      await page.waitForTimeout(600)
      for (const key of ['ArrowRight', 'ArrowRight', 'x']) await page.keyboard.press(key)
      await page.waitForFunction(() =>
        (window as unknown as { __vg: FxHooks }).__vg.screens().includes('stats'),
      )
      await page.waitForTimeout(600)
      await page.keyboard.press('o')
      await page.keyboard.press('o')
      await page.waitForFunction(
        () => (window as unknown as { __vg: FxHooks }).__vg.screens().length === 1,
      )
    }
    // Calentamiento: todo lo que se crea una vez (materiales, iconos, rótulos) ya existe.
    await prize()
    await menuRound()
    await menuRound()
    await again()
    await prize()
    const base = await gl()
    for (let i = 0; i < 3; i++) {
      await again()
      await prize()
    }
    for (let i = 0; i < 15; i++) await menuRound()
    expect(await gl()).toEqual(base)
    await done(page)
  })
})
