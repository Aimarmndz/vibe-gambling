// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
// Navegación del menú v2: rejilla (teclas, ratón, volver), barrido entre pantallas, cada página
// con sus acciones, lo que se anuncia por `aria-live` y que todo lo que se pinta existe en la
// fuente y no deja marcadores sin rellenar, en los cuatro idiomas.
import { LOCALES } from '@vibe-gambling/shared/i18n'
import { ACHIEVEMENTS } from '@vibe-gambling/shared'
import type { LeaderboardResponse } from '@vibe-gambling/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Bitmap from '../src/font/bitmap.ts'
import { hasGlyph, measure } from '../src/font/bitmap.ts'
import type { MenuPage } from '../src/ui/menu/page.ts'
import { AchievementsPage } from '../src/ui/menu/pages/achievements.ts'
import { BankPage } from '../src/ui/menu/pages/bank.ts'
import { CreditsPage } from '../src/ui/menu/pages/credits.ts'
import { HowToPage } from '../src/ui/menu/pages/howTo.ts'
import { MAIN_ITEMS, MainMenuPage, gridMove, tileRect } from '../src/ui/menu/pages/main.ts'
import { MemoryCardPage, blockMove } from '../src/ui/menu/pages/memoryCard.ts'
import { PendingPage } from '../src/ui/menu/pages/pending.ts'
import { RankingPage } from '../src/ui/menu/pages/ranking.ts'
import { SETTING_IDS, SettingsPage } from '../src/ui/menu/pages/settings.ts'
import { StatsPage } from '../src/ui/menu/pages/stats.ts'
import { SpinAllHud } from '../src/ui/menu/spinAllHud.ts'
import { PALETTE } from '../src/ui/palette.ts'
import { MenuScreen } from '../src/ui/screens/menu.ts'
import { PendingNoticeScreen } from '../src/ui/screens/pending.ts'
import { msg, resolved, wallet } from './fixtures.ts'
import {
  BANK,
  STATS,
  achievementsFixture,
  fakeCanvas2d,
  fakeContext,
  setState,
} from './menuFixtures.ts'
import type { FakeContext } from './menuFixtures.ts'
import { fakeHost } from './menuHost.ts'
import { translator } from './translators.ts'

// Lo que pintan las pantallas (texto y color), sin canvas de verdad.
const painted: { text: string; color: string }[] = []
vi.mock('../src/font/bitmap.ts', async importOriginal => {
  const real = await importOriginal<typeof Bitmap>()
  return {
    ...real,
    drawText: (
      _g: unknown,
      text: string,
      _x: number,
      _y: number,
      style: { scale?: number; color: string },
    ) => {
      painted.push({ text, color: style.color })
      return real.measure(text, style.scale ?? 1)
    },
  }
})

const press = (screen: { action(e: { action: string; fine: boolean }): unknown }, action: string) =>
  screen.action({ action, fine: false } as never)

beforeEach(() => {
  painted.length = 0
})

describe('rejilla del menú principal', () => {
  it('←→ dan la vuelta en la fila y ↑↓ cambian de fila sin saltar de columna', () => {
    // 6 arriba y 5 abajo, cada fila centrada: ↑↓ van a la casilla de centro más cercano.
    expect(gridMove(0, 'left')).toBe(5)
    expect(gridMove(5, 'right')).toBe(0)
    expect(gridMove(6, 'left')).toBe(10)
    expect(gridMove(10, 'right')).toBe(6)
    expect(gridMove(2, 'down')).toBe(8)
    expect(gridMove(8, 'down')).toBe(2)
    expect(gridMove(6, 'up')).toBe(0)
    expect(gridMove(5, 'down')).toBe(10)
    expect(gridMove(10, 'up')).toBe(4)
    expect(gridMove(3, 'accept')).toBe(3)
    expect(tileRect(0)).toEqual({ x: 10, y: 30, w: 46, h: 52 })
    expect(tileRect(10)).toEqual({ x: 239, y: 87, w: 46, h: 52 })
    expect(MAIN_ITEMS).toHaveLength(11)
    // Ninguna casilla se sale de la pantalla ni pisa la ventana de información (y = 150).
    MAIN_ITEMS.forEach((_, i) => {
      const r = tileRect(i)
      expect(r.x).toBeGreaterThanOrEqual(8)
      expect(r.x + r.w).toBeLessThanOrEqual(312)
      expect(r.y + r.h).toBeLessThan(150)
    })
  })

  it('teclas: mover suena y se anuncia; ✕ abre; ○ en la primera cierra el menú', () => {
    const ctx = fakeContext()
    const menu = new MenuScreen(ctx)
    expect(menu.id).toBe('menu')
    expect(ctx.sounds).toContain('menuOpen')
    press(menu, 'right')
    expect(ctx.sounds.at(-1)).toBe('move')
    expect(ctx.announced.at(-1)).toMatch(/^TIRADAS\. 3 tiradas guardadas/)
    press(menu, 'accept')
    expect(menu.id).toBe('pending')
    press(menu, 'back')
    expect(menu.id).toBe('menu')
    expect(ctx.popped).toBe(0)
    press(menu, 'start')
    expect(ctx.popped).toBe(1)
    // Cerrar dos veces no hace nada más.
    menu.close()
    expect(ctx.popped).toBe(1)
  })

  it('cada casilla abre su pantalla y CONTINUAR vuelve a la mesa', () => {
    const ids = [
      'pending',
      'stats',
      'achievements',
      'leaderboard',
      'referral',
      'bank',
      'memoryCard',
      'settings',
      'howTo',
      'credits',
    ]
    MAIN_ITEMS.forEach((item, i) => {
      const ctx = fakeContext()
      const host = fakeHost(ctx)
      const page = new MainMenuPage(host)
      page.index = i
      press(page, 'accept')
      if (item.id === 'resume') expect(host.closes).toBe(1)
      else expect(host.opened[0]?.id).toBe(ids[i - 1])
    })
    // SELECT abre las tiradas pendientes desde cualquier casilla.
    const host = fakeHost(fakeContext())
    expect(press(new MainMenuPage(host), 'spin')).toBe(true)
    expect(host.opened[0]?.id).toBe('pending')
  })

  it('ratón: pasar por encima elige (y suena) y el clic abre', () => {
    const ctx = fakeContext()
    const host = fakeHost(ctx)
    const page = new MainMenuPage(host)
    ctx.hover = 'menu:tile:bank'
    page.draw(fakeCanvas2d(), 0)
    expect(page.index).toBe(6)
    expect(ctx.sounds).toContain('move')
    const r = tileRect(2)
    ctx.hits.at(r.x + 3, r.y + 3)?.onClick()
    expect(host.opened[0]?.id).toBe('stats')
  })

  it('insignias: el número de pendientes y el punto oro con un logro sin ver', () => {
    const ctx = fakeContext()
    const page = new MainMenuPage(fakeHost(ctx))
    page.draw(fakeCanvas2d(), 0)
    expect(painted.map(p => p.text)).toContain('3')
    expect(ctx.achievements().hasUnseen()).toBe(false)
    ctx.achievements().receive(
      msg({
        type: 'achievement.unlocked',
        achievement: { ...achievementsFixture(['big_win']).find(a => a.id === 'big_win')! },
      }),
    )
    expect(ctx.achievements().hasUnseen()).toBe(true)
    // Al abrir LOGROS se apaga.
    new AchievementsPage(fakeHost(ctx)).enter()
    expect(ctx.achievements().hasUnseen()).toBe(false)
  })
})

describe('barrido entre pantallas', () => {
  it('tapa, cambia a mitad y destapa; una pulsación a mitad va ya a la página nueva', () => {
    const ctx = fakeContext({ reducedMotion: false })
    const menu = new MenuScreen(ctx)
    const half = ctx.client.menu.wipeMs / 2000
    menu.update(0, 0)
    press(menu, 'right')
    press(menu, 'accept')
    // Aún tapando: sigue la página de antes.
    menu.update(0.01, 0.01)
    expect(menu.id).toBe('menu')
    menu.update(0.01, half + 0.01)
    expect(menu.id).toBe('pending')
    menu.update(0.01, half * 3)
    // Otro barrido: ○ durante la tapa cambia ya y la pulsación siguiente es para la nueva.
    press(menu, 'back')
    expect(menu.id).toBe('pending')
    press(menu, 'right')
    expect(menu.id).toBe('menu')
    menu.draw(fakeCanvas2d(), half * 3)
  })

  it('con movimiento reducido no hay barrido: corte seco', () => {
    const ctx = fakeContext({ reducedMotion: true })
    const menu = new MenuScreen(ctx)
    press(menu, 'down')
    press(menu, 'accept')
    expect(menu.id).toBe('bank')
  })

  it('abre directamente en tiradas pendientes (desde la mesa o el aviso)', () => {
    const ctx = fakeContext()
    const menu = new MenuScreen(ctx, 'pending')
    expect(menu.id).toBe('pending')
    expect(ctx.announced.at(-1)).toMatch(/3 TIRADAS PENDIENTES/)
    press(menu, 'back')
    expect(ctx.popped).toBe(1)
    expect(menu.toastBand()).toEqual({ top: 24, bottom: 218 })
  })
})

describe('tiradas pendientes', () => {
  it('✕ GIRAR y □ TODAS piden al servidor y cierran para ver la bola; ←→ cambian de botón', () => {
    const ctx = fakeContext()
    const host = fakeHost(ctx)
    const page = new PendingPage(host)
    press(page, 'accept')
    expect(ctx.spinOne).toHaveBeenCalledTimes(1)
    expect(host.closes).toBe(1)
    press(page, 'right')
    press(page, 'accept')
    expect(ctx.spinEvery).toHaveBeenCalledTimes(1)
    press(page, 'chip')
    press(page, 'spin')
    expect(ctx.spinEvery).toHaveBeenCalledTimes(2)
    expect(ctx.spinOne).toHaveBeenCalledTimes(2)
    // Si el servidor no deja (mesa ocupada), no se cierra.
    ctx.spinOne.mockReturnValue(false)
    press(page, 'spin')
    expect(host.closes).toBe(4)
    expect(page.help().map(h => h.label)).toContain('GIRAR TODAS')
  })

  it('sin pendientes: ventana vacía y solo VOLVER', () => {
    const ctx = fakeContext()
    setState(ctx, { wallet: wallet({ pendingSpins: 0 }), shown: wallet({ pendingSpins: 0 }) })
    const page = new PendingPage(fakeHost(ctx))
    expect(press(page, 'accept')).toBe(false)
    expect(press(page, 'left')).toBe(true)
    expect(page.help()).toHaveLength(1)
    page.draw(fakeCanvas2d(), 0)
    expect(painted.map(p => p.text)).toContain('0 PENDIENTES')
    expect(page.describe()).toBe(ctx.tr.t('pending.none'))
  })
})

describe('ajustes', () => {
  it('cambia sonido, volumen (con tope), CRT, calidad, idioma y clasificación', () => {
    const ctx = fakeContext({ reducedMotion: false })
    const page = new SettingsPage(fakeHost(ctx))
    const at = (id: (typeof SETTING_IDS)[number]) => {
      page.index = SETTING_IDS.indexOf(id)
    }
    at('sound')
    press(page, 'accept')
    expect(ctx.prefs.sound).toBe(false)
    at('volume')
    press(page, 'right')
    expect(ctx.prefs.volume).toBe(8)
    press(page, 'left')
    press(page, 'left')
    expect(ctx.prefs.volume).toBe(6)
    at('crt')
    press(page, 'right')
    expect(ctx.prefs.crt).toBe(false)
    at('quality')
    press(page, 'left')
    expect(ctx.prefs.quality).toBe('low')
    at('language')
    press(page, 'right')
    expect(ctx.sent.at(-1)).toEqual({ type: 'settings.update', locale: 'fr' })
    expect(ctx.prefs.locale).toBe('fr')
    at('leaderboard')
    press(page, 'accept')
    expect(ctx.sent.at(-1)).toEqual({ type: 'settings.update', hidden: true })
    expect(ctx.announced.at(-1)).toMatch(/CLASIFICACIÓN/)
  })

  it('movimiento reducido es de solo lectura (↑↓ lo saltan) y cerrar sesión pide confirmar', () => {
    const ctx = fakeContext({ reducedMotion: true })
    const page = new SettingsPage(fakeHost(ctx))
    page.index = SETTING_IDS.indexOf('leaderboard')
    press(page, 'down')
    expect(SETTING_IDS[page.index]).toBe('logout')
    press(page, 'accept')
    expect(ctx.logouts).toBe(0)
    expect(ctx.announced.at(-1)).toMatch(/SEGURO/)
    press(page, 'accept')
    expect(ctx.logouts).toBe(1)
    // El CRT no se puede elegir con movimiento reducido.
    page.index = SETTING_IDS.indexOf('volume')
    press(page, 'down')
    expect(SETTING_IDS[page.index]).toBe('quality')
    expect(page.value('reducedMotion')).toBe('SISTEMA: SÍ')
  })

  it('en la demo no hay clasificación ni sesión que cerrar', () => {
    const ctx = fakeContext({ demo: true })
    const page = new SettingsPage(fakeHost(ctx))
    page.index = SETTING_IDS.indexOf('language')
    press(page, 'down')
    expect(SETTING_IDS[page.index]).toBe('sound')
  })

  it('clic en una bandera elige ese idioma al momento', () => {
    const ctx = fakeContext()
    const page = new SettingsPage(fakeHost(ctx))
    page.draw(fakeCanvas2d(), 0)
    const flag = ctx.hits.at(300, 113)
    flag?.onClick()
    expect(ctx.sent.at(-1)).toMatchObject({ type: 'settings.update' })
  })
})

describe('datos del servidor', () => {
  it('ESTADÍSTICAS pide la temporada, la anuncia y cambia con ←→', async () => {
    const ctx = fakeContext()
    const page = new StatsPage(fakeHost(ctx))
    page.enter(0)
    expect(ctx.progressCalls).toEqual([['stats', undefined]])
    await Promise.resolve()
    await Promise.resolve()
    expect(ctx.announced.at(-1)).toMatch(/Temporada 2026-10: 4 tiradas/)
    expect(page.headerRight()).toBe('◄ TEMPORADA 2026-10 ►')
    // Con el ratón: ◄ de la cabecera va a la anterior.
    page.draw(fakeCanvas2d(), 0)
    const left = 314 - measure(page.headerRight()!)
    ctx.hits.at(left + 1, 5)?.onClick()
    expect(ctx.progressCalls.at(-1)).toEqual(['stats', '2026-09'])
    press(page, 'left')
    expect(ctx.progressCalls).toHaveLength(2)
    ctx.hits.at(310, 5)?.onClick()
    expect(ctx.progressCalls.at(-1)).toEqual(['stats', '2026-10'])
  })

  it('no pide nada mientras cae la bola (no destripa el resultado)', () => {
    const ctx = fakeContext({ state: { phase: 'landing' } })
    const stats = new StatsPage(fakeHost(ctx))
    const bank = new BankPage(fakeHost(ctx))
    stats.enter(0)
    bank.enter()
    stats.update(0, 0)
    bank.update()
    expect(ctx.progressCalls).toEqual([])
    setState(ctx, { phase: 'idle' })
    stats.update(0, 0)
    bank.update()
    expect(ctx.progressCalls.map(c => c[0])).toEqual(['stats', 'bank'])
  })

  it('una respuesta que llega con la bola ya cayendo se descarta y se vuelve a pedir', async () => {
    // Pedidas con la mesa quieta; el servidor resuelve la ronda antes de contestar.
    const ctx = fakeContext()
    const stats = new StatsPage(fakeHost(ctx))
    const bank = new BankPage(fakeHost(ctx))
    let answerStats: (s: typeof STATS) => void = () => undefined
    let answerBank: (b: Awaited<FakeContext['progressReply']['bank']>) => void = () => undefined
    ctx.progressReply.stats = new Promise(r => (answerStats = r))
    ctx.progressReply.bank = new Promise(r => (answerBank = r))
    stats.enter(0)
    bank.enter()
    const announced = ctx.announced.length
    setState(ctx, { phase: 'landing' })
    answerStats(STATS)
    answerBank(BANK)
    await Promise.resolve()
    await Promise.resolve()
    // Nada pintado ni anunciado con la bola cayendo.
    expect(ctx.announced).toHaveLength(announced)
    expect(stats.headerRight()).toBe('TEMPORADA 2026-10')
    stats.update(0, 0)
    bank.update()
    expect(ctx.progressCalls).toHaveLength(2)
    // Al caer, se vuelven a pedir (y ahora sí se enseñan).
    ctx.progressReply.stats = Promise.resolve(STATS)
    ctx.progressReply.bank = Promise.resolve(BANK)
    setState(ctx, { phase: 'result' })
    stats.update(0, 0)
    bank.update()
    expect(ctx.progressCalls.map(c => c[0])).toEqual(['stats', 'bank', 'stats', 'bank'])
    await Promise.resolve()
    await Promise.resolve()
    expect(ctx.announced.join(' ')).toMatch(/4 tiradas/)
  })

  it('el ranking y el puesto propio que llegan con la bola cayendo se vuelven a pedir', async () => {
    const ctx = fakeContext()
    let answerBoard: (b: LeaderboardResponse) => void = () => undefined
    let answerRank: (r: number | null) => void = () => undefined
    const board = vi.fn(() => new Promise<LeaderboardResponse>(r => (answerBoard = r)))
    const rank = vi.fn(() => new Promise<number | null>(r => (answerRank = r)))
    ctx.leaderboard = board
    ctx.brokeRank = rank
    const page = new RankingPage(fakeHost(ctx))
    page.update()
    expect(board).toHaveBeenCalledTimes(1)
    setState(ctx, { phase: 'landing' })
    answerBoard({ v: 1, board: 'broke', season: '2026-10', rows: [] } as never)
    answerRank(7)
    await Promise.resolve()
    await Promise.resolve()
    expect(ctx.announced).toEqual([])
    page.update()
    expect(board).toHaveBeenCalledTimes(1)
    setState(ctx, { phase: 'idle' })
    page.update()
    expect(board).toHaveBeenCalledTimes(2)
    expect(rank).toHaveBeenCalledTimes(2)
  })

  it('si el servidor no contesta, lo dice', async () => {
    const ctx = fakeContext()
    ctx.progressReply.stats = Promise.reject(new Error('caído'))
    ctx.progressReply.bank = Promise.reject(new Error('caído'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const stats = new StatsPage(fakeHost(ctx))
    const bank = new BankPage(fakeHost(ctx))
    stats.enter(0)
    bank.enter()
    await new Promise(r => setTimeout(r, 0))
    stats.draw(fakeCanvas2d(), 0)
    bank.draw(fakeCanvas2d(), 0)
    expect(painted.map(p => p.text)).toContain(ctx.tr.t('stats.error'))
    expect(painted.map(p => p.text)).toContain(ctx.tr.t('bank.error'))
    warn.mockRestore()
  })

  it('BANCO: ↑↓ recorren el historial y la letra pequeña; ✕ pide el préstamo si se puede', async () => {
    const ctx = fakeContext({ loanAvailable: true })
    const host = fakeHost(ctx)
    const page = new BankPage(host)
    page.enter()
    await Promise.resolve()
    await Promise.resolve()
    expect(ctx.announced.at(-1)).toMatch(/Deuda 330/)
    press(page, 'up')
    for (let i = 0; i < 40; i++) press(page, 'down')
    page.draw(fakeCanvas2d(), 0)
    expect(painted.some(p => p.text.includes('ruleta') || p.text.includes('Hacker'))).toBe(true)
    press(page, 'accept')
    expect(host.closes).toBe(1)
    expect(ctx.loans).toBe(1)
  })

  it('LOGROS: ↑↓ mueven (con desplazamiento) y anuncian la fila', () => {
    const ctx = fakeContext()
    const page = new AchievementsPage(fakeHost(ctx))
    // Hasta el último secreto del catálogo ("Demasiado grande para caer").
    const lastHidden = ACHIEVEMENTS.map(a => a.hidden).lastIndexOf(true)
    for (let i = 0; i < lastHidden; i++) press(page, 'down')
    expect(ctx.announced.at(-1)).toMatch(/\?\?\?/)
    page.wheel(-1)
    page.draw(fakeCanvas2d(), 0)
    expect(painted.map(p => p.text)).toContain('???')
    expect(page.headerRight()).toBe(
      `2/${ACHIEVEMENTS.length} · ${Math.floor((2 / ACHIEVEMENTS.length) * 100)} %`,
    )
  })
})

describe('las demás pantallas', () => {
  it('MEMORY CARD: rejilla de 5×3 y resumen de la partida', () => {
    expect(blockMove(0, 'left')).toBe(4)
    expect(blockMove(0, 'up')).toBe(10)
    expect(blockMove(14, 'down')).toBe(4)
    const ctx = fakeContext()
    const page = new MemoryCardPage(fakeHost(ctx))
    press(page, 'right')
    expect(ctx.announced.at(-1)).toBe(ctx.tr.t('mc.freeInfo'))
    press(page, 'left')
    expect(ctx.announced.at(-1)).toMatch(/Temporada 2026-10/)
    expect(press(page, 'accept')).toBe(false)
  })

  it('CÓMO SE JUEGA: ←→ pasan página (sin salirse) con el roce de papel', () => {
    const ctx = fakeContext()
    const page = new HowToPage(fakeHost(ctx, false))
    press(page, 'left')
    expect(page.headerRight()).toBe('PÁGINA 1/4')
    press(page, 'right')
    press(page, 'accept')
    expect(page.headerRight()).toBe('PÁGINA 3/4')
    expect(ctx.sounds.filter(s => s === 'page')).toHaveLength(2)
    page.update(0, 0.05)
    page.draw(fakeCanvas2d(), 0.05)
    page.draw(fakeCanvas2d(), 5)
    expect(ctx.announced.at(-1)).toContain(String(ctx.web.game.pendingSpins.max))
  })

  it('CRÉDITOS: ✕ abre la ayuda con el juego del idioma y ↑↓ desplazan', () => {
    const ctx = fakeContext()
    const page = new CreditsPage(fakeHost(ctx))
    page.enter(0)
    press(page, 'accept')
    expect(press(page, 'down')).toBe(true)
    page.wheel(1)
    expect(ctx.links).toHaveLength(ctx.web.site.helpLinks.es?.length ? 1 : 0)
  })

  it('CLASIFICACIÓN: ←→ cambian de pestaña, incluido el Salón de la Ruina', async () => {
    const ctx = fakeContext()
    const page = new RankingPage(fakeHost(ctx))
    press(page, 'left')
    await Promise.resolve()
    expect(page.headerRight()).toBeUndefined()
    page.draw(fakeCanvas2d(), 0)
    expect(painted.map(p => p.text)).toContain(ctx.tr.t('lb.hallEmpty'))
    expect(press(page, 'accept')).toBe(true)
    expect(ctx.links).toEqual([])
  })

  describe('CLASIFICACIÓN con una cuenta de GitHub nueva', () => {
    const others = (n: number): LeaderboardResponse => ({
      v: 1,
      board: 'broke',
      season: '2026-10',
      seasons: ['2026-10'],
      players: n,
      rows: Array.from({ length: n }, (_, i) => ({
        login: `player${i + 1}`,
        avatarUrl: `https://example.invalid/${i}.png`,
        profileUrl: `https://example.invalid/player${i + 1}`,
        rank: i + 1,
        netWorth: -1000 + i,
        balance: 0,
        debt: 1000 - i,
        spins: 10,
        currentStreak: 0,
        bestStreak: 0,
      })),
    })
    const newAccount = { minAgeDays: 30, rankedFrom: '2026-11-12T12:00:00.000Z' }

    async function open(ctx: FakeContext, rank: number | null) {
      ctx.leaderboard = () => Promise.resolve(others(10))
      ctx.brokeRank = () => Promise.resolve(rank)
      const page = new RankingPage(fakeHost(ctx))
      await new Promise(r => setTimeout(r, 0))
      painted.length = 0
      page.draw(fakeCanvas2d(), 0)
      return page
    }
    const logins = () => painted.map(p => p.text).filter(t => /^player\d+$|\(TÚ\)/.test(t))

    it('la última fila dice desde cuándo sales, sin inventarse un puesto', async () => {
      const ctx = fakeContext()
      setState(ctx, { user: { ...ctx.state().user!, newAccount } })
      await open(ctx, null)
      const line = painted.find(p => p.text.startsWith('Cuenta de GitHub nueva'))
      expect(line?.text).toBe('Cuenta de GitHub nueva: sales el 12 nov 2026')
      expect(line?.color).toBe(PALETTE.gold)
      // Nueve jugadores y el aviso: ni tu fila ni un puesto falso.
      expect(logins()).toEqual(Array.from({ length: 9 }, (_, i) => `player${i + 1}`))
      expect(ctx.announced.join(' ')).toContain('sales el 12 nov 2026')
    })

    it('también en el Salón de la Ruina y mientras carga', async () => {
      const ctx = fakeContext({ locale: 'en' })
      setState(ctx, { user: { ...ctx.state().user!, newAccount } })
      ctx.leaderboard = () => new Promise(() => undefined)
      const page = new RankingPage(fakeHost(ctx))
      page.draw(fakeCanvas2d(), 0)
      expect(painted.map(p => p.text)).toContain('New GitHub account: listed from Nov 12, 2026')
      press(page, 'left')
      await Promise.resolve()
      painted.length = 0
      page.draw(fakeCanvas2d(), 0)
      expect(painted.map(p => p.text)).toContain('New GitHub account: listed from Nov 12, 2026')
    })

    it('oculto no se le promete nada; con la cuenta antigua vuelve tu fila con su puesto', async () => {
      const hidden = fakeContext()
      setState(hidden, { user: { ...hidden.state().user!, hidden: true, newAccount } })
      await open(hidden, null)
      expect(painted.some(p => p.text.startsWith('Cuenta de GitHub nueva'))).toBe(false)
      expect(logins()).toHaveLength(10)

      const old = fakeContext()
      setState(old, { user: { ...old.state().user!, newAccount: null } })
      await open(old, 42)
      expect(painted.some(p => p.text.startsWith('Cuenta de GitHub nueva'))).toBe(false)
      expect(logins().at(-1)).toBe('tester (TÚ)')
      expect(painted.map(p => p.text)).toContain('42')
    })
  })

  it('aviso de pendientes al abrir: ✕ va a las tiradas y ○ lo deja para luego', () => {
    const ctx = fakeContext()
    const shown = vi.fn()
    ctx.showPending = shown
    const notice = new PendingNoticeScreen(ctx)
    notice.draw(fakeCanvas2d(), 0)
    expect(painted.map(p => p.text)).toContain('3 TIRADAS')
    press(notice, 'accept')
    expect(shown).toHaveBeenCalled()
    press(notice, 'back')
    expect(ctx.popped).toBe(2)
  })

  it('GIRAR TODAS: progreso y últimas, anunciadas por aria-live', () => {
    const ctx = fakeContext()
    const hud = new SpinAllHud()
    const tr = ctx.tr
    const running = { running: true, spun: 0, ended: null }
    expect(hud.see(ctx.state(), running, tr)).toBeNull()
    setState(ctx, {
      lastRound: resolved({ result: 22, color: 'black', net: -150 }),
      phase: 'result',
    })
    const text = hud.see(ctx.state(), running, tr)
    expect(text).toBe('Tirada 1 de 4: 22 negro, -150.')
    expect(hud.see(ctx.state(), running, tr)).toBeNull()
    hud.draw(fakeCanvas2d(), ctx.state(), tr, ctx.buttons())
    expect(painted.map(p => p.text)).toContain('1 / 4')
    expect(hud.see(ctx.state(), { running: false, spun: 1, ended: 'user' }, tr)).toBeNull()
  })
})

describe('todo lo que se pinta existe en la fuente, en los cuatro idiomas', () => {
  const pages: [string, (ctx: FakeContext) => MenuPage][] = [
    ['main', ctx => new MainMenuPage(fakeHost(ctx))],
    ['pending', ctx => new PendingPage(fakeHost(ctx))],
    ['stats', ctx => new StatsPage(fakeHost(ctx))],
    ['achievements', ctx => new AchievementsPage(fakeHost(ctx))],
    ['bank', ctx => new BankPage(fakeHost(ctx))],
    ['ranking', ctx => new RankingPage(fakeHost(ctx))],
    ['memory', ctx => new MemoryCardPage(fakeHost(ctx))],
    ['settings', ctx => new SettingsPage(fakeHost(ctx))],
    ['howTo', ctx => new HowToPage(fakeHost(ctx))],
    ['credits', ctx => new CreditsPage(fakeHost(ctx))],
  ]

  it.each(LOCALES)('%s', async locale => {
    for (const [name, make] of pages) {
      const ctx = fakeContext({ locale, loanAvailable: name === 'bank' })
      const page = make(ctx)
      page.enter?.(0)
      await Promise.resolve()
      await Promise.resolve()
      painted.length = 0
      page.draw(fakeCanvas2d(), 1)
      const menu = new MenuScreen(ctx)
      menu.draw(fakeCanvas2d(), 1)
      const texts = [
        ...painted.map(p => p.text),
        page.title(),
        page.headerRight?.() ?? '',
        ...page.help().map(h => h.label),
        page.describe?.() ?? '',
      ]
      for (const text of texts) {
        expect(text, `${name} (${locale})`).not.toMatch(/[{}]/)
        for (const ch of text) expect(hasGlyph(ch) || ch === '\n', `${name}: «${text}»`).toBe(true)
      }
    }
    expect(translator(locale).t('menu.item.stats')).not.toBe('menu.item.stats')
    expect(STATS.series.length).toBeGreaterThan(0)
  })
})
