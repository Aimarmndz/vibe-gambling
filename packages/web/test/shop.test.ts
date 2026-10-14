// SPDX-License-Identifier: AGPL-3.0-or-later
// TIENDA en la ventana: la página (pestañas, comprar, armar, vestirse, financiar), el bolsillo en
// el estado (congelado mientras cae la bola), las líneas de la pantalla de resultado y la tienda de
// la demo con la misma lógica pura de shared.
import { serverMessageSchema } from '@vibe-gambling/shared'
import type { ServerMessage, Shop } from '@vibe-gambling/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { describeOutcome, PhraseMemory } from '../src/game/outcome.ts'
import { itemLines, percent, placeboVerdict, streakText } from '../src/game/shopView.ts'
import { INITIAL_STATE, inventoryWhileLanding, reduce, reveal } from '../src/game/state.ts'
import { DemoLink } from '../src/net/demo.ts'
import { DemoShop } from '../src/net/demoShop.ts'
import { withVersion } from '../src/net/link.ts'
import { ShopPage } from '../src/ui/menu/pages/shop.ts'
import { msg, resolved, testGame, testWebConfig, user, wallet } from './fixtures.ts'
import { INVENTORY, fakeContext, setState, shopFixture } from './menuFixtures.ts'
import { fakeHost } from './menuHost.ts'
import { translator } from './translators.ts'

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}
const press = (page: ShopPage, action: string) =>
  page.action({ action, fine: false } as Parameters<ShopPage['action']>[0])

async function openShop(opts: { shop?: Shop; balance?: number } = {}) {
  const ctx = fakeContext({
    state: {
      wallet: wallet({ balance: opts.balance ?? 500 }),
      shown: wallet({ balance: opts.balance ?? 500 }),
      inventory: INVENTORY,
      shownInventory: INVENTORY,
    },
  })
  ctx.progressReply.shop = Promise.resolve(opts.shop ?? shopFixture())
  const page = new ShopPage(fakeHost(ctx))
  page.enter()
  await settle()
  return { ctx, page }
}

describe('página TIENDA', () => {
  it('carga con shop.request y anuncia la pestaña y el primer objeto con su letra pequeña', async () => {
    const { ctx, page } = await openShop()
    expect(ctx.progressCalls).toEqual([['shop', undefined]])
    expect(page.tab).toBe('shop')
    expect(ctx.announced.at(-1)).toMatch(/^TIENDA\. PATA DE CONEJO™\. 70 monedas\. Letra pequeña/)
    expect(page.headerRight()).toBe('500 MONEDAS')
  })

  it('←→ cambian de pestaña (con vuelta) y ↑↓ mueven sin pisar los títulos', async () => {
    const { page } = await openShop()
    press(page, 'right')
    expect(page.tab).toBe('pocket')
    press(page, 'right')
    expect(page.tab).toBe('wardrobe')
    expect(page.selected()).toMatchObject({ kind: 'skin', slot: 'felt', skin: 'classic' })
    for (let i = 0; i < 5; i++) press(page, 'down')
    // El título FICHAS se salta.
    expect(page.selected()).toMatchObject({ kind: 'skin', slot: 'chips', skin: 'classic' })
    press(page, 'right')
    expect(page.tab).toBe('shop')
    press(page, 'left')
    expect(page.tab).toBe('wardrobe')
  })

  it('✕ compra con un requestId nuevo cada vez', async () => {
    const { ctx, page } = await openShop()
    press(page, 'accept')
    press(page, 'accept')
    const buys = ctx.sent as { type: string; itemId: string; requestId: string }[]
    expect(buys.map(b => [b.type, b.itemId])).toEqual([
      ['shop.buy', 'rabbit_foot'],
      ['shop.buy', 'rabbit_foot'],
    ])
    expect(buys[0]!.requestId).not.toBe(buys[1]!.requestId)
  })

  it('sin saldo: ¿Financiamos tu pata de conejo? abre el préstamo (si el banco presta)', async () => {
    const broke = await openShop({ balance: 3, shop: shopFixture({ canBorrow: true }) })
    expect(broke.page.footer().map(f => f.text)).toContain(
      '¿No te llega? ¿Financiamos tu pata de conejo?',
    )
    press(broke.page, 'accept')
    expect(broke.ctx.loans).toBe(1)
    expect(broke.ctx.sent).toEqual([])
    const poor = await openShop({ balance: 3 })
    press(poor.page, 'accept')
    expect(poor.ctx.loans).toBe(0)
    expect(poor.ctx.sounds.at(-1)).toBe('error')
  })

  it('agotado esta temporada: no deja comprar', async () => {
    const shop = shopFixture()
    shop.items = shop.items.map(i => (i.id === 'rabbit_foot' ? { ...i, bought: 3 } : i))
    const { ctx, page } = await openShop({ shop })
    expect(page.actionLabel(page.selected())).toBeNull()
    press(page, 'accept')
    expect(ctx.sent).toEqual([])
  })

  it('BOLSILLO: ✕ arma y desarma; git revert disponible se compra desde aquí', async () => {
    const inventory = {
      ...INVENTORY,
      revert: {
        roundId: '0b9a8d3c-6a39-4c4e-9f7b-1f9a6c2d3e41',
        refund: 120,
        until: '2026-10-12T10:02:00.000Z',
      },
    }
    const { ctx, page } = await openShop({ shop: shopFixture({ inventory }) })
    setState(ctx, { shownInventory: inventory, inventory })
    press(page, 'right')
    expect(page.rows().map(r => r.kind)).toEqual(['pocket', 'pocket', 'pocket', 'revert'])
    press(page, 'accept')
    press(page, 'down')
    press(page, 'accept')
    press(page, 'up')
    press(page, 'up')
    press(page, 'accept')
    expect(ctx.sent).toMatchObject([
      { type: 'item.arm', itemId: 'rabbit_foot', armed: false },
      { type: 'item.arm', itemId: 'insurance', armed: true },
      { type: 'shop.buy', itemId: 'revert' },
    ])
    expect(page.footer()[0]!.text).toBe('1/3 ARMADOS')
  })

  it('ARMARIO: ✕ se pone lo que tienes y compra lo que no', async () => {
    const { ctx, page } = await openShop()
    setState(ctx, { user: { ...user, felt: 'vaporwave', chipSkin: 'classic' } })
    press(page, 'left')
    expect(page.tab).toBe('wardrobe')
    press(page, 'accept') // el verde clásico: siempre tuyo
    press(page, 'down')
    press(page, 'accept') // azul Memory Card: no es tuyo
    for (let i = 0; i < 4; i++) press(page, 'down')
    press(page, 'down') // disquetes
    press(page, 'accept')
    expect(ctx.sent).toMatchObject([
      { type: 'settings.update', felt: 'classic' },
      { type: 'shop.buy', itemId: 'felt_memory_blue' },
      { type: 'shop.buy', itemId: 'chips_floppy' },
    ])
  })

  it('con la bola cayendo no pide la tienda (el Placebómetro destriparía el resultado)', async () => {
    const ctx = fakeContext({ state: { phase: 'landing' } })
    const page = new ShopPage(fakeHost(ctx))
    page.enter()
    expect(ctx.progressCalls).toEqual([])
    setState(ctx, { phase: 'result' })
    page.update()
    expect(ctx.progressCalls).toEqual([['shop', undefined]])
    // Un bolsillo nuevo (compra, armado) la vuelve a pedir.
    await settle()
    setState(ctx, { inventory: { ...INVENTORY } })
    page.update()
    expect(ctx.progressCalls).toHaveLength(2)
  })
})

describe('bolsillo en el estado', () => {
  const inv = msg({ type: 'inventory', inventory: INVENTORY, wallet: wallet(), event: 'bought' })

  it('hello e inventory lo guardan; con la bola cayendo se congela lo gastado', () => {
    let s = reduce(INITIAL_STATE, inv, 0).state
    expect(s.shownInventory).toEqual(INVENTORY)
    s = { ...s, phase: 'landing' }
    // Ronda resuelta: se gastan cargas y aparece git revert (diría que has perdido).
    const spent = {
      ...INVENTORY,
      items: INVENTORY.items.map(i => (i.id === 'rabbit_foot' ? { ...i, charges: 28 } : i)),
      revert: {
        roundId: '0b9a8d3c-6a39-4c4e-9f7b-1f9a6c2d3e41',
        refund: 20,
        until: '2026-10-12T10:02:00.000Z',
      },
    }
    s = reduce(
      s,
      msg({ type: 'inventory', inventory: spent, wallet: wallet(), event: 'consumed' }),
      0,
    ).state
    expect(s.shownInventory).toEqual(INVENTORY)
    // Comprar y armar sí se ven ya, sin destripar lo gastado.
    const bought = {
      ...spent,
      items: spent.items.map(i => (i.id === 'turbo' ? { ...i, charges: 2, armed: true } : i)),
    }
    const step = reduce(
      s,
      msg({ type: 'inventory', inventory: bought, wallet: wallet(), event: 'armed' }),
      0,
    )
    expect(step.effects).toEqual([{ type: 'inventory', event: 'armed' }])
    const shown = step.state.shownInventory!
    expect(shown.items.find(i => i.id === 'rabbit_foot')?.charges).toBe(29)
    expect(shown.items.find(i => i.id === 'turbo')).toEqual({
      id: 'turbo',
      charges: 2,
      armed: true,
    })
    expect(shown.revert).toBeNull()
    // Al caer la bola, todo.
    expect(reveal({ ...step.state, pending: resolved() }).shownInventory).toEqual(bought)
  })

  it('inventoryWhileLanding sin nada enseñado: el nuevo', () => {
    expect(inventoryWhileLanding(null, null, INVENTORY)).toBe(INVENTORY)
  })
})

describe('resultado y HUD', () => {
  const tr = translator('es')

  it('líneas de cada objeto y neto con lo que pagan', () => {
    const round = resolved({
      bets: [{ selection: { kind: 'red' }, amount: 100, won: false, payout: 0 }],
      result: 0,
      color: 'green',
      staked: 100,
      returned: 0,
      net: -100,
      itemNet: 50,
      items: [
        { itemId: 'rabbit_foot', kind: 'placebo', amount: 0 },
        { itemId: 'oracle', kind: 'prediction', amount: 0, prediction: 17, hit: false },
        { itemId: 'insurance', kind: 'refund', amount: 50 },
      ],
    })
    const view = describeOutcome({
      round,
      wallet: wallet({ currentStreak: 4 }),
      game: testWebConfig.game,
      tr,
      memory: new PhraseMemory(),
      random: () => 0,
    })
    expect(view.net).toBe(-50)
    expect(view.items).toEqual([
      'PATA DE CONEJO: +∞% SUERTE (+0)',
      'LA IA DIJO 17: FALLÓ (como siempre)',
      'SEGURO: +50',
    ])
    expect(
      itemLines(
        [
          { itemId: 'oracle', kind: 'prediction', amount: 0, prediction: 0, hit: true },
          { itemId: 'turbo', kind: 'boost', amount: 3500 },
          { itemId: 'turbo', kind: 'boost', amount: 0 },
          { itemId: 'streak_helmet', kind: 'shield', amount: 0 },
          { itemId: 'insurance', kind: 'refund', amount: 0 },
        ],
        testWebConfig.game,
        7,
        tr,
      ),
    ).toEqual([
      'LA IA DIJO 0: ¡ACIERTO! (2,7 %, como cualquiera)',
      'TURBO ×2: +3.500',
      'TURBO: el pleno no entró',
      'CASCO: racha salvada (7*)',
      'SEGURO: nada que indemnizar',
    ])
  })

  it('racha con asterisco, porcentajes y veredicto del Placebómetro', () => {
    expect(streakText(7, true)).toBe('▲7*')
    expect(streakText(7, false)).toBe('▲7')
    expect(streakText(-2, true)).toBe('▼2')
    expect(streakText(0, undefined)).toBe('–')
    expect(percent(1, 37, tr)).toBe('2,7 %')
    expect(percent(0, 0, tr)).toBe('–')
    const p = shopFixture().placebometer
    expect(placeboVerdict(p, tr)).toMatch(/La misma suerte/)
    expect(
      placeboVerdict(
        { ...p, rabbit: { with: { rounds: 2, won: 2 }, without: { rounds: 2, won: 0 } } },
        tr,
      ),
    ).toMatch(/Correlación/)
    expect(
      placeboVerdict({ ...p, spent: 0, rabbit: { ...p.rabbit, with: { rounds: 0, won: 0 } } }, tr),
    ).toMatch(/Sin datos/)
  })
})

describe('tienda de la demo', () => {
  it('topes, saldo, cooldown, cosméticos y git revert con la lógica de shared', () => {
    const shop = new DemoShop({ ...testGame.items, purchaseCooldownMs: 1000 })
    const t0 = new Date('2026-10-12T10:00:00.000Z')
    const at = (ms: number) => new Date(t0.getTime() + ms)
    expect(shop.buy('rabbit_foot', 10, t0)).toMatchObject({
      ok: false,
      error: 'insufficient_funds',
    })
    expect(shop.buy('rabbit_foot', 500, t0)).toEqual({ ok: true, price: 70, refund: 0 })
    expect(shop.buy('oracle', 500, at(10))).toMatchObject({ ok: false, error: 'rate_limited' })
    expect(shop.buy('revert', 500, at(2000))).toMatchObject({ ok: false, error: 'conflict' })
    expect(shop.buy('felt_vaporwave', 500, at(4000))).toMatchObject({ ok: true })
    expect(shop.buy('felt_vaporwave', 500, at(6000))).toMatchObject({
      ok: false,
      error: 'conflict',
    })
    expect(shop.owns('felt', 'vaporwave')).toBe(true)
    expect(shop.owns('chips', 'floppy')).toBe(false)
    expect(shop.arm('turbo', true)).toMatchObject({ error: 'conflict' })
    expect(shop.arm('rabbit_foot', true)).toBeNull()
    const view = shop.view('2026-10', at(6000))
    expect(view.items).toEqual([{ id: 'rabbit_foot', charges: 30, armed: true }])
    expect(view.cosmetics.felts).toEqual(['classic', 'vaporwave'])
    // Una ronda perdida: git revert la puede deshacer una vez, dentro de la ventana.
    shop.resolved('0b9a8d3c-6a39-4c4e-9f7b-1f9a6c2d3e41', -1000, at(7000))
    expect(shop.view('2026-10', at(6999)).revert).toBeNull()
    expect(shop.view('2026-10', at(7000)).revert?.refund).toBe(testGame.items.revert.maxRefund)
    expect(shop.buy('revert', 1000, at(8000))).toEqual({
      ok: true,
      price: testGame.items.revert.price,
      refund: testGame.items.revert.maxRefund,
    })
    expect(shop.view('2026-10', at(9000)).revert).toBeNull()
    const s = shop.shop({
      seasonId: '2026-10',
      seasonEndsAt: at(1e9),
      canBorrow: false,
      now: at(9000),
    })
    expect(s.placebometer.spent).toBe(
      70 + testGame.items.cosmetics.feltPrice + testGame.items.revert.price,
    )
    expect(s.placebometer.recovered).toBe(testGame.items.revert.maxRefund)
  })

  describe('demo completa', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('comprar la pata, armarla y girar: gasta una carga y la ronda la nombra', async () => {
      const link = new DemoLink(
        testWebConfig.game,
        {
          thinkMs: 100,
          pauseMs: 2000,
          login: 'demo',
          stats: { recentRounds: 4, seriesPoints: 6, loanMarks: 3, bankHistory: 3 },
          showcase: { seed: 3, spins: 40, pending: 7 },
          achievements: testGame.achievements,
        },
        false,
        testWebConfig.publicUrl,
      )
      const got: ServerMessage[] = []
      link.onMessage(m => got.push(serverMessageSchema.parse(m)))
      link.start()
      await vi.advanceTimersByTimeAsync(1)
      expect(got[0]).toMatchObject({ type: 'hello', inventory: { items: [] } })
      link.send(withVersion({ type: 'shop.buy', itemId: 'rabbit_foot', requestId: 'demo-req-1' }))
      await vi.advanceTimersByTimeAsync(50)
      expect(got.at(-1)).toMatchObject({ type: 'inventory', event: 'bought' })
      link.send(withVersion({ type: 'item.arm', itemId: 'rabbit_foot', armed: true }))
      await vi.advanceTimersByTimeAsync(50)
      link.send(withVersion({ type: 'bet.place', selection: { kind: 'red' }, amount: 5 }))
      await vi.advanceTimersByTimeAsync(50)
      const turn = link.controls.turn({ thinkMs: 0 })
      await vi.advanceTimersByTimeAsync(10)
      await turn
      const round = got.find(m => m.type === 'round.resolved')
      expect(round).toMatchObject({
        round: { items: [{ itemId: 'rabbit_foot', kind: 'placebo' }], itemNet: 0 },
      })
      // Orden: round.resolved, inventory (consumed) y después los logros.
      const after = got.slice(got.indexOf(round!))
      expect(after.map(m => m.type)).toEqual([
        'round.resolved',
        'inventory',
        'achievement.unlocked',
      ])
      expect(after[1]).toMatchObject({
        type: 'inventory',
        event: 'consumed',
        inventory: {
          items: [{ id: 'rabbit_foot', charges: testGame.items.rabbitFoot.charges - 1 }],
        },
      })
      // Un tapete que no es tuyo no se puede poner.
      link.send(withVersion({ type: 'settings.update', felt: 'dark_mode' }))
      await vi.advanceTimersByTimeAsync(50)
      expect(got.at(-1)).toMatchObject({ type: 'error', error: 'conflict', re: 'settings.update' })
      link.send(withVersion({ type: 'shop.request' }))
      await vi.advanceTimersByTimeAsync(50)
      expect(got.at(-1)).toMatchObject({ type: 'shop', shop: { placebometer: { spent: 70 } } })
      link.stop()
    })
  })
})
