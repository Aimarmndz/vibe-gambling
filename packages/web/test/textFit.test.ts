// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
// Todo el texto cabe donde se pinta, en los cuatro idiomas (el francés y el alemán son los más
// largos): dentro de los 320 px del framebuffer y dentro de la ventana en la que cae. Recorre las
// páginas del menú, el aviso de pendientes, el préstamo y cada animación de espectáculo (normal y
// con movimiento reducido) a lo largo de toda su línea de tiempo.
import { LOCALES } from '@vibe-gambling/shared/i18n'
import type { Locale } from '@vibe-gambling/shared'
import { describe, expect, it, vi } from 'vitest'

import type { AppContext } from '../src/app/context.ts'
import { clientConfig } from '../src/config.ts'
import type * as Bitmap from '../src/font/bitmap.ts'
import type { FxKit } from '../src/render/fx/kit.ts'
import type * as Text from '../src/render/fx/text.ts'
import type * as Draw from '../src/ui/draw.ts'
import type { MenuPage } from '../src/ui/menu/page.ts'
import { AchievementsPage } from '../src/ui/menu/pages/achievements.ts'
import { BankPage } from '../src/ui/menu/pages/bank.ts'
import { CreditsPage } from '../src/ui/menu/pages/credits.ts'
import { HowToPage } from '../src/ui/menu/pages/howTo.ts'
import { MainMenuPage } from '../src/ui/menu/pages/main.ts'
import { MemoryCardPage } from '../src/ui/menu/pages/memoryCard.ts'
import { PendingPage } from '../src/ui/menu/pages/pending.ts'
import { RankingPage } from '../src/ui/menu/pages/ranking.ts'
import { SettingsPage } from '../src/ui/menu/pages/settings.ts'
import { StatsPage } from '../src/ui/menu/pages/stats.ts'
import { BankruptScreen } from '../src/ui/screens/bankrupt.ts'
import { FallacyScreen } from '../src/ui/screens/fallacy.ts'
import { GreenScreen } from '../src/ui/screens/green.ts'
import { LoanScreen } from '../src/ui/screens/loan.ts'
import { PendingNoticeScreen } from '../src/ui/screens/pending.ts'
import { PrizeScreen } from '../src/ui/screens/prize.ts'
import { PushScreen } from '../src/ui/screens/pushToProd.ts'
import type { FxScreen } from '../src/render/fx/fxScreen.ts'
import { wallet } from './fixtures.ts'
import { STATS, achievementsFixture, fakeCanvas2d, fakeContext, setState } from './menuFixtures.ts'
import type { FakeContext } from './menuFixtures.ts'
import { fakeHost } from './menuHost.ts'

interface Box {
  x: number
  y: number
  w: number
  h: number
}
interface Painted {
  text: string
  left: number
  right: number
  /** Punto de anclaje (el x que se pasa, según la alineación): decide en qué ventana cae. */
  ax: number
  y: number
}

// Lo que se pinta en cada fotograma: ventanas y textos (con su caja), sin canvas de verdad.
const frame = { windows: [] as Box[], texts: [] as Painted[], rotated: 0 }

function record(text: string, x: number, y: number, width: number, align = 'left'): void {
  // Los sellos girados se pintan en coordenadas trasladadas: no cuentan.
  if (frame.rotated > 0) return
  const left = Math.round(align === 'center' ? x - width / 2 : align === 'right' ? x - width : x)
  frame.texts.push({ text, left, right: left + width, ax: Math.round(x), y })
}

vi.mock('../src/font/bitmap.ts', async importOriginal => {
  const real = await importOriginal<typeof Bitmap>()
  return {
    ...real,
    drawText: (
      _g: unknown,
      text: string,
      x: number,
      y: number,
      style: { scale?: number; align?: string },
    ) => {
      const w = real.measure(text, style.scale ?? 1)
      record(text, x, y, w, style.align)
      return w
    },
  }
})

vi.mock('../src/render/fx/text.ts', async importOriginal => {
  const real = await importOriginal<typeof Text>()
  const bitmap = await vi.importActual<typeof Bitmap>('../src/font/bitmap.ts')
  return {
    ...real,
    drawFancyText: (
      _g: unknown,
      text: string,
      x: number,
      y: number,
      style: { scale: number; align?: string },
    ) => {
      const w = bitmap.measure(text, style.scale)
      record(text, x, y, w, style.align)
      return { x, y, w, h: 12 * style.scale }
    },
    drawRotated: (
      g: CanvasRenderingContext2D,
      _cx: number,
      _cy: number,
      _deg: number,
      paint: (g: CanvasRenderingContext2D) => void,
    ) => {
      frame.rotated++
      try {
        paint(g)
      } finally {
        frame.rotated--
      }
    },
  }
})

vi.mock('../src/ui/draw.ts', async importOriginal => {
  const real = await importOriginal<typeof Draw>()
  return {
    ...real,
    drawWindow: (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
      frame.windows.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: h })
    },
  }
})

/** Comprueba el fotograma pintado: cada texto dentro de su ventana (la más pequeña que lo contiene). */
function check(where: string, problems: Set<string>, skip: readonly string[] = []): void {
  for (const t of frame.texts) {
    if (skip.some(s => t.text.includes(s))) continue
    // Trama de palos del fondo del menú: se recorta a la pantalla.
    if (/^[♠♥♦♣]$/u.test(t.text)) continue
    const inside = frame.windows
      .filter(w => t.ax >= w.x && t.ax <= w.x + w.w && t.y >= w.y && t.y < w.y + w.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0]
    const lo = inside ? inside.x + 1 : 0
    const hi = inside ? inside.x + inside.w - 1 : 320
    if (t.left < lo || t.right > hi) {
      problems.add(
        `${where}: «${t.text.slice(0, 60)}» ocupa ${t.left}..${t.right}, cabe en ${lo}..${hi}`,
      )
    }
  }
  frame.windows.length = 0
  frame.texts.length = 0
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

function kitFor(ctx: FakeContext, reduced: boolean): FxKit {
  ;(ctx as unknown as { sfx: unknown }).sfx = { play: () => undefined, playFx: () => undefined }
  return {
    ctx: ctx as unknown as AppContext,
    cfg: clientConfig.fx,
    reduced,
    coins: {
      fountain: () => true,
      stopLoop: () => undefined,
      clear: () => undefined,
      spawn: () => true,
      fly: () => true,
      setTrophy: () => undefined,
    } as unknown as FxKit['coins'],
    rays: { draw: () => undefined } as unknown as FxKit['rays'],
    shake: () => undefined,
    desaturate: () => undefined,
    announce: () => undefined,
  }
}

/** Recorre una animación entera (y un poco más), fotograma a fotograma. */
function run(screen: FxScreen, where: string, problems: Set<string>, skip: string[] = []) {
  for (let ms = 0; ms < 16_000 && !screen.isClosed; ms += 40) {
    screen.update(0.04)
    screen.draw(fakeCanvas2d(), ms / 1000)
    screen.drawFx(fakeCanvas2d(), ms / 1000)
    check(where, problems, skip)
  }
}

const PAGES: [string, new (host: ReturnType<typeof fakeHost>) => MenuPage, string][] = [
  ['main', MainMenuPage, 'right'],
  ['pending', PendingPage, 'right'],
  ['stats', StatsPage, 'right'],
  ['achievements', AchievementsPage, 'down'],
  ['bank', BankPage, 'down'],
  ['ranking', RankingPage, 'right'],
  ['memoryCard', MemoryCardPage, 'right'],
  ['settings', SettingsPage, 'down'],
  ['howTo', HowToPage, 'right'],
  ['credits', CreditsPage, 'down'],
]

describe('el texto cabe donde se pinta', () => {
  it.each(LOCALES.map(l => [l]))(
    '%s: menú, aviso de pendientes, préstamo y espectáculo',
    async l => {
      const locale = l as Locale
      const problems = new Set<string>()
      // Cifras de dos dígitos (racha, préstamos) y grandes (deuda), como en una partida larga.
      const big = { balance: 2, debt: 1_234_567, loans: 12, pendingSpins: 88, spins: 1234 }
      for (const [name, Page, step] of PAGES) {
        for (let moves = 0; moves < 4; moves++) {
          const ctx = fakeContext({
            locale,
            loanAvailable: name === 'bank',
            achievements: achievementsFixture(['first_spin', 'night_owl', 'first_ruin']),
            state: { wallet: wallet(big), shown: wallet({ ...big, bestStreak: 12 }) },
          })
          // Mejor racha de tres cifras en ESTADÍSTICAS.
          ctx.progressReply.stats = Promise.resolve({ ...STATS, bestStreak: 123 })
          const page = new Page(fakeHost(ctx))
          page.enter?.(0)
          await settle()
          for (let i = 0; i < moves; i++) page.action?.({ action: step, fine: false } as never)
          frame.windows.length = 0
          frame.texts.length = 0
          page.draw(fakeCanvas2d(), 1 + moves)
          // Los créditos suben por la pantalla a propósito (recortados a su zona).
          check(`${name}#${moves}`, problems, name === 'credits' ? [''] : [])
        }
      }
      {
        const ctx = fakeContext({ locale, state: { wallet: wallet(big), shown: wallet(big) } })
        new PendingNoticeScreen(ctx as unknown as AppContext).draw(fakeCanvas2d(), 1)
        check('pendingNotice', problems)
      }
      for (const reduced of [false, true]) {
        const ctx = fakeContext({ locale, reducedMotion: reduced })
        setState(ctx, {
          phase: 'result',
          shown: wallet({ balance: 0, debt: 1000, netWorth: -1000 }),
        })
        const kit = kitFor(ctx, reduced)
        const tag = reduced ? ':reducido' : ''
        const noop = () => undefined
        for (const [tier, net, multiple] of [
          ['big', 123_456, 8],
          ['mega', 12_345_678, 35],
          ['straight', 35_000_000_000, 35],
        ] as const) {
          run(
            new PrizeScreen(kit, { tier, net, netMultiple: multiple, number: 36 }, noop),
            `prize:${tier}${tag}`,
            problems,
          )
        }
        run(new GreenScreen(kit, true, noop), `green${tag}`, problems)
        run(new PushScreen(kit, 2, noop), `push${tag}`, problems)
        run(new BankruptScreen(kit, noop, noop), `bankrupt${tag}`, problems)
        run(
          new FallacyScreen(kit, { color: 'black', count: 12, recent: [2, 4, 6] }, noop),
          `fallacy${tag}`,
          problems,
        )
        const loan = new LoanScreen(ctx as unknown as AppContext, kit)
        const fine = ctx.tr.t('loan.fine')
        for (let ms = 0; ms < 2000; ms += 40) {
          loan.update(0.04)
          loan.draw(fakeCanvas2d(), ms / 1000)
          check(`loan${tag}`, problems, [fine.slice(0, 12)])
        }
        loan.granted(1000, wallet({ balance: 1000, debt: 1000, loans: 1 }))
        for (let ms = 0; ms < 8000; ms += 40) {
          loan.update(0.04)
          loan.draw(fakeCanvas2d(), ms / 1000)
          // La letra pequeña cruza la barra inferior "demasiado rápido", a propósito.
          check(`loan:granted${tag}`, problems, [fine.slice(0, 12)])
        }
      }
      expect([...problems]).toEqual([])
    },
  )
})
