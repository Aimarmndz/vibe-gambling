// SPDX-License-Identifier: AGPL-3.0-or-later
// TIENDA: la casa siempre gana (enumeración exacta de las 37 casillas sobre boletos aleatorios con
// semilla), la configuración "generosa" no arranca y cada pieza de la lógica pura de los objetos.
import { describe, expect, it } from 'vitest'

import {
  CONSUMABLE_IDS,
  COSMETIC_IDS,
  EMPTY_PLAN,
  ITEM_IDS,
  OUTSIDE_MAX_LOSING_POCKETS,
  POCKET_COUNT,
  addCharges,
  armBlock,
  betSchema,
  clientMessageSchema,
  cosmeticFor,
  cosmeticOf,
  finePrint,
  gameConfigSchema,
  inRevertWindow,
  insuranceMaxExpected,
  insuranceRefund,
  isArmed,
  itemCharges,
  itemKind,
  itemMaxPerSeason,
  itemPrice,
  planItems,
  placebometer,
  publicGameConfigSchema,
  purchaseBlock,
  resolveBets,
  serverMessageSchema,
  settingsRequestSchema,
  shopItemSchema,
  revertDeadline,
  revertRefund,
  setArmed,
  settleItems,
  spendCharges,
  streakWithHelmet,
  toPublicGameConfig,
  turboBoost,
  turboMaxExpected,
} from '../src/index.ts'
import type { Bet, InventoryEntry, ItemsConfig } from '../src/index.ts'
import { loadTestGameConfig, testGameConfig } from './fixtures.ts'

const game = testGameConfig()
const items = game.items

/** PRNG con semilla (mulberry32): los mismos boletos en cada ejecución. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Todas las selecciones del tapete, para sacar boletos al azar. */
function allSelections(): Bet['selection'][] {
  const out: unknown[] = []
  for (let n = 0; n <= 36; n++) out.push({ kind: 'straight', numbers: [n] })
  for (let a = 1; a <= 36; a++) {
    if (a % 3 !== 0) out.push({ kind: 'split', numbers: [a, a + 1] })
    if (a + 3 <= 36) out.push({ kind: 'split', numbers: [a, a + 3] })
  }
  for (const b of [1, 2, 3]) out.push({ kind: 'split', numbers: [0, b] })
  for (let r = 1; r <= 12; r++) out.push({ kind: 'street', numbers: [3 * r - 2, 3 * r - 1, 3 * r] })
  out.push({ kind: 'street', numbers: [0, 1, 2] }, { kind: 'street', numbers: [0, 2, 3] })
  for (let a = 1; a <= 32; a++) {
    if (a % 3 !== 0) out.push({ kind: 'corner', numbers: [a, a + 1, a + 3, a + 4] })
  }
  out.push({ kind: 'corner', numbers: [0, 1, 2, 3] })
  for (let r = 1; r <= 11; r++) {
    const a = 3 * r - 2
    out.push({ kind: 'line', numbers: [a, a + 1, a + 2, a + 3, a + 4, a + 5] })
  }
  for (const kind of ['dozen', 'column'] as const) {
    for (const index of [1, 2, 3] as const) out.push({ kind, index })
  }
  for (const kind of ['red', 'black', 'even', 'odd', 'low', 'high'] as const) out.push({ kind })
  return out.map(sel => betSchema.parse({ selection: sel, amount: 1 }).selection)
}

const SELECTIONS = allSelections()

/** Un boleto al azar: de 1 a 8 apuestas, cantidades de 1 a 1.000 (a veces enormes). */
function randomSlip(rand: () => number): Bet[] {
  const count = 1 + Math.floor(rand() * 8)
  return Array.from({ length: count }, () => ({
    selection: SELECTIONS[Math.floor(rand() * SELECTIONS.length)]!,
    amount: rand() < 0.1 ? 1 + Math.floor(rand() * 100_000) : 1 + Math.floor(rand() * 1000),
  }))
}

/** Media exacta (sobre las 37 casillas) de lo que paga un consumible en una carga. */
function expectedBenefit(
  id: (typeof CONSUMABLE_IDS)[number],
  bets: readonly Bet[],
  jackpot: number,
  cfg: ItemsConfig,
): number {
  let total = 0
  for (let result = 0; result < POCKET_COUNT; result++) {
    const outcome = resolveBets(bets, result, jackpot)
    if (id === 'insurance') total += insuranceRefund(outcome, cfg.insurance)
    if (id === 'turbo') total += turboBoost(outcome, jackpot, cfg.turbo)
  }
  return total / POCKET_COUNT
}

const SLIPS = 10_000

describe('la casa siempre gana (EV ≤ precio por carga)', () => {
  const configs: Array<[string, ItemsConfig]> = [
    ['config/game.json', loadTestGameConfig().items],
    ['configuración de test', items],
  ]

  it.each(configs)(
    '%s: enumeración exacta sobre 10⁴ boletos con semilla',
    (_name, cfg) => {
      const rand = seeded(0x5eed)
      const worst: Record<string, number> = {}
      for (let i = 0; i < SLIPS; i++) {
        const bets = randomSlip(rand)
        for (const jackpot of [1, game.jackpot.gitPushMultiplier]) {
          for (const id of CONSUMABLE_IDS) {
            // Solo cuenta si el objeto actuaría con ese boleto (si no, ni gasta ni paga).
            const plan = planItems([{ itemId: id, charges: 1, armed: true }], bets, jackpot, cfg)
            if (!plan.acting.includes(id)) continue
            const ev = expectedBenefit(id, bets, jackpot, cfg)
            const { perCharge, maxExpected } = finePrint(id, cfg)
            expect(ev).toBeLessThanOrEqual(maxExpected + 1e-9)
            expect(ev).toBeLessThanOrEqual(perCharge)
            worst[id] = Math.max(worst[id] ?? 0, ev)
          }
        }
      }
      // Los placebos no pagan nunca; el seguro y el turbo, menos que su carga.
      expect(worst.rabbit_foot).toBe(0)
      expect(worst.oracle).toBe(0)
      expect(worst.insurance).toBeGreaterThan(0)
      expect(worst.turbo).toBeGreaterThan(0)
      // Enumera 37 casillas × 10⁴ boletos × objetos: en los runners del CI tarda más de los 5 s por defecto.
    },
    60_000,
  )

  it('las cotas son ajustadas: el peor boleto para la casa las alcanza y aun así pierde', () => {
    // Todo a una docena con el tope de cobertura: 0,5·200·25/37 = 67,57 ≤ 70.
    const dozen: Bet[] = [
      { selection: { kind: 'dozen', index: 1 }, amount: items.insurance.coverCap },
    ]
    const insurance = expectedBenefit('insurance', dozen, 1, items)
    expect(insurance).toBeCloseTo(insuranceMaxExpected(items.insurance), 1)
    expect(insurance).toBeCloseTo(67.57, 2)
    expect(insurance).toBeLessThan(items.insurance.price / items.insurance.charges)
    // 200 al rojo: 0,5·200·19/37 = 51,35, así que el objeto deja −18,65 de EV.
    const red: Bet[] = [{ selection: { kind: 'red' }, amount: 200 }]
    expect(70 - expectedBenefit('insurance', red, 1, items)).toBeCloseTo(18.65, 2)
    // Pleno de 100 con turbo: 35·100/37 = 94,59 ≤ 100.
    const straight: Bet[] = [{ selection: { kind: 'straight', numbers: [17] }, amount: 100 }]
    expect(expectedBenefit('turbo', straight, 1, items)).toBeCloseTo(
      turboMaxExpected(items.turbo),
      9,
    )
    expect(turboMaxExpected(items.turbo)).toBeCloseTo(94.59, 2)
    expect(OUTSIDE_MAX_LOSING_POCKETS).toBe(25)
  })

  it('git revert devuelve siempre menos de lo que cuesta (cota determinista)', () => {
    for (const net of [-1_000_000, -501, -500, -1, 0, 1, 99]) {
      expect(revertRefund(net, items.revert)).toBeLessThan(items.revert.price)
    }
    expect(revertRefund(-1_000_000, items.revert)).toBe(items.revert.maxRefund)
    expect(revertRefund(-120, items.revert)).toBe(120)
    expect(revertRefund(30, items.revert)).toBe(0)
  })

  it('la letra pequeña: lo que la casa gana como mínimo por carga', () => {
    const fp = (id: (typeof ITEM_IDS)[number]) => finePrint(id, items)
    expect(fp('insurance').minEdge).toBeCloseTo(70 - 67.567, 2)
    expect(fp('turbo').minEdge).toBeCloseTo(100 - 94.594, 2)
    expect(fp('rabbit_foot')).toEqual({ perCharge: 77 / 37, maxExpected: 0, minEdge: 77 / 37 })
    expect(fp('revert')).toEqual({ perCharge: 550, maxExpected: 500, minEdge: 50 })
    expect(fp('felt_vaporwave').minEdge).toBe(items.cosmetics.feltPrice)
    for (const id of ITEM_IDS) expect(fp(id).minEdge).toBeGreaterThan(0)
  })
})

describe('configuración generosa: no arranca', () => {
  const base = loadTestGameConfig()
  const withItems = (patch: (cfg: ItemsConfig) => void) => {
    const raw = structuredClone(base) as { items: ItemsConfig }
    patch(raw.items)
    return gameConfigSchema.safeParse(raw)
  }

  it('acepta la de producción', () => {
    expect(withItems(() => {}).success).toBe(true)
  })

  it('rechaza un seguro que sale a cuenta', () => {
    const r = withItems(i => {
      i.insurance.price = 330 // 66 por carga < 67,57
    })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toContain('seguro')
    expect(
      withItems(i => {
        i.insurance.refundRate = 0.6
      }).success,
    ).toBe(false)
  })

  it('rechaza un turbo que sale a cuenta', () => {
    expect(
      withItems(i => {
        i.turbo.price = 94
      }).success,
    ).toBe(false)
    expect(
      withItems(i => {
        i.turbo.multiplier = 3
      }).success,
    ).toBe(false)
    expect(
      withItems(i => {
        i.turbo.charges = 2
      }).success,
    ).toBe(false)
  })

  it('rechaza un revert que devuelve tanto como cuesta', () => {
    expect(
      withItems(i => {
        i.revert.maxRefund = i.revert.price
      }).success,
    ).toBe(false)
  })

  it('rechaza un bloque sin todos sus campos o con campos de más', () => {
    expect(
      withItems(i => {
        delete (i as Partial<ItemsConfig>).oracle
      }).success,
    ).toBe(false)
    expect(
      withItems(i => {
        ;(i.rabbitFoot as Record<string, unknown>).luck = 9000
      }).success,
    ).toBe(false)
  })

  it('la configuración pública lleva el bloque entero (la demo lo usa)', () => {
    const pub = publicGameConfigSchema.parse(toPublicGameConfig(base))
    expect(pub.items).toEqual(base.items)
  })
})

describe('catálogo', () => {
  it('ids únicos, en snake_case y en su categoría', () => {
    expect(new Set(ITEM_IDS).size).toBe(ITEM_IDS.length)
    for (const id of ITEM_IDS) expect(id).toMatch(/^[a-z][a-z0-9_]{2,39}$/)
    expect(itemKind('oracle')).toBe('consumable')
    expect(itemKind('revert')).toBe('service')
    expect(itemKind('chips_floppy')).toBe('cosmetic')
  })

  it('precio, cargas y tope salen de la configuración', () => {
    expect(itemPrice('rabbit_foot', items)).toBe(items.rabbitFoot.price)
    expect(itemCharges('rabbit_foot', items)).toBe(items.rabbitFoot.charges)
    expect(itemMaxPerSeason('streak_helmet', items)).toBe(items.streakHelmet.maxPerSeason)
    expect(itemPrice('revert', items)).toBe(items.revert.price)
    expect(itemCharges('revert', items)).toBe(0)
    expect(itemMaxPerSeason('revert', items)).toBe(items.revert.maxPerSeason)
    expect(itemPrice('felt_dark_mode', items)).toBe(items.cosmetics.feltPrice)
    expect(itemPrice('chips_bottle_cap', items)).toBe(items.cosmetics.chipsPrice)
    expect(itemMaxPerSeason('chips_bottle_cap', items)).toBeNull()
  })

  it('cosméticos: ranura y aspecto, y los clásicos no se compran', () => {
    for (const id of COSMETIC_IDS) {
      const c = cosmeticOf(id)
      expect(c.slot === 'felt' ? cosmeticFor('felt', c.skin) : cosmeticFor('chips', c.skin)).toBe(
        id,
      )
    }
    expect(cosmeticFor('felt', 'classic')).toBeNull()
    expect(cosmeticFor('chips', 'classic')).toBeNull()
  })
})

describe('bolsillo', () => {
  it('una compra suma cargas; gastarlas desarma al llegar a 0', () => {
    let inv: InventoryEntry[] = []
    inv = addCharges(inv, 'turbo', items)
    inv = addCharges(inv, 'turbo', items)
    expect(inv).toEqual([{ itemId: 'turbo', charges: 2, armed: false }])
    inv = setArmed(inv, 'turbo', true)
    inv = spendCharges(inv, ['turbo'])
    expect(inv[0]).toEqual({ itemId: 'turbo', charges: 1, armed: true })
    inv = spendCharges(inv, ['turbo'])
    expect(inv[0]).toEqual({ itemId: 'turbo', charges: 0, armed: false })
    expect(isArmed(inv[0]!)).toBe(false)
  })

  it('armar: sin cargas no, y como mucho maxArmed a la vez', () => {
    const cfg = { ...items, maxArmed: 2 }
    let inv: InventoryEntry[] = []
    for (const id of ['rabbit_foot', 'oracle', 'insurance'] as const) inv = addCharges(inv, id, cfg)
    expect(armBlock(inv, 'turbo', true, cfg)).toBe('no_charges')
    inv = setArmed(inv, 'rabbit_foot', true)
    inv = setArmed(inv, 'oracle', true)
    expect(armBlock(inv, 'insurance', true, cfg)).toBe('max_armed')
    expect(armBlock(inv, 'oracle', true, cfg)).toBeNull()
    expect(armBlock(inv, 'oracle', false, cfg)).toBeNull()
    expect(armBlock(inv, 'insurance', true, { ...cfg, enabled: false })).toBe('closed')
  })

  it('comprar: cada motivo de rechazo', () => {
    const ok = {
      itemId: 'rabbit_foot' as const,
      balance: 1000,
      boughtThisSeason: 0,
      owned: new Set<string>(),
      sinceLastPurchaseMs: null,
      revertRefund: null,
    }
    expect(purchaseBlock(ok, items)).toBeNull()
    expect(purchaseBlock({ ...ok, balance: 76 }, items)).toBe('insufficient_funds')
    expect(purchaseBlock({ ...ok, balance: 77 }, items)).toBeNull()
    expect(purchaseBlock({ ...ok, boughtThisSeason: 3 }, items)).toBe('sold_out')
    expect(purchaseBlock({ ...ok, sinceLastPurchaseMs: 999 }, items)).toBe('cooldown')
    expect(purchaseBlock({ ...ok, sinceLastPurchaseMs: 1000 }, items)).toBeNull()
    expect(purchaseBlock(ok, { ...items, enabled: false })).toBe('closed')
    const felt = { ...ok, itemId: 'felt_vaporwave' as const }
    expect(purchaseBlock(felt, { ...items, enabled: false })).toBeNull()
    expect(purchaseBlock({ ...felt, owned: new Set(['felt_vaporwave']) }, items)).toBe('owned')
    expect(purchaseBlock({ ...felt, boughtThisSeason: 99 }, items)).toBeNull()
    const revert = { ...ok, itemId: 'revert' as const }
    expect(purchaseBlock(revert, items)).toBe('nothing_to_revert')
    expect(purchaseBlock({ ...revert, revertRefund: 0 }, items)).toBe('nothing_to_revert')
    expect(purchaseBlock({ ...revert, revertRefund: 120, balance: 549 }, items)).toBe(
      'insufficient_funds',
    )
    expect(purchaseBlock({ ...revert, revertRefund: 120, balance: 550 }, items)).toBeNull()
  })
})

describe('una ronda con objetos', () => {
  const all: InventoryEntry[] = CONSUMABLE_IDS.map(itemId => ({ itemId, charges: 3, armed: true }))
  const red: Bet = { selection: { kind: 'red' }, amount: 100 }
  const pleno: Bet = { selection: { kind: 'straight', numbers: [17] }, amount: 300 }

  it('sin fichas no actúa nada; desarmado o sin cargas, tampoco', () => {
    expect(planItems(all, [], 1, items)).toBe(EMPTY_PLAN)
    expect(planItems(all, [red], 1, { ...items, enabled: false })).toBe(EMPTY_PLAN)
    const off = all.map(e => ({ ...e, armed: e.itemId !== 'oracle' ? false : true, charges: 0 }))
    expect(planItems(off, [red], 1, items).acting).toEqual([])
  })

  it('el seguro solo con exteriores; el turbo solo con un único pleno', () => {
    expect(planItems(all, [red], 1, items).acting).toEqual(['rabbit_foot', 'oracle', 'insurance'])
    expect(planItems(all, [pleno], 1, items).acting).toEqual(['rabbit_foot', 'oracle', 'turbo'])
    const twoPlenos = [pleno, { ...pleno, selection: { kind: 'straight' as const, numbers: [3] } }]
    expect(planItems(all, twoPlenos, 1, items).acting).not.toContain('turbo')
    expect(planItems(all, [pleno, red], 1, items).acting).toEqual([
      'rabbit_foot',
      'oracle',
      'insurance',
      'turbo',
    ])
    expect(planItems(all, [red], 1, items).helmet).toBe(true)
  })

  it('el plan es el mismo salga lo que salga: se gasta lo mismo en las 37 casillas', () => {
    const plan = planItems(all, [red, pleno], 1, items)
    const spent = new Set<string>()
    for (let result = 0; result < POCKET_COUNT; result++) {
      const s = settleItems(
        {
          plan,
          outcome: resolveBets([red, pleno], result),
          jackpotMultiplier: 1,
          prediction: 5,
          current: 0,
          asterisk: false,
        },
        items,
      )
      spent.add(JSON.stringify(s.spent))
    }
    expect([...spent]).toEqual([JSON.stringify(plan.acting)])
  })

  it('turbo y jackpot no se multiplican: con J ≥ m ni actúa ni gasta', () => {
    const won = resolveBets([pleno], 17)
    expect(turboBoost(won, 1, items.turbo)).toBe(100 * 35)
    // El extra solo es la parte que el jackpot no paga ya: max(m, J) − J.
    expect(turboBoost(resolveBets([pleno], 17, 1.5), 1.5, items.turbo)).toBe(100 * 35 * 0.5)
    expect(turboBoost(resolveBets([pleno], 17, 2), 2, items.turbo)).toBe(0)
    expect(planItems(all, [pleno], 2, items).acting).not.toContain('turbo')
    expect(planItems(all, [pleno], 1.5, items).acting).toContain('turbo')
    expect(turboBoost(resolveBets([pleno], 3), 1, items.turbo)).toBe(0)
  })

  it('el seguro devuelve r × lo perdido en exteriores, a prorrata con el tope', () => {
    const bets: Bet[] = [
      { selection: { kind: 'red' }, amount: 300 },
      { selection: { kind: 'dozen', index: 3 }, amount: 100 },
    ]
    // Sale el 0: pierden las dos (400), asegurado 200/400 → 0,5·400·0,5 = 100.
    expect(insuranceRefund(resolveBets(bets, 0), items.insurance)).toBe(100)
    // Sale el 1 (rojo, docena 1): pierde la docena (100) → 0,5·100·0,5 = 25.
    expect(insuranceRefund(resolveBets(bets, 1), items.insurance)).toBe(25)
    // Sale el 36 (rojo, docena 3): no pierde nada.
    expect(insuranceRefund(resolveBets(bets, 36), items.insurance)).toBe(0)
    // Los plenos no cuentan.
    expect(insuranceRefund(resolveBets([pleno], 0), items.insurance)).toBe(0)
  })

  it('liquidación: líneas en el orden del catálogo, neto de los objetos y oráculo', () => {
    const plan = planItems(all, [red], 1, items)
    const s = settleItems(
      {
        plan,
        outcome: resolveBets([red], 0),
        jackpotMultiplier: 1,
        prediction: 0,
        current: 0,
        asterisk: false,
      },
      items,
    )
    expect(s.effects).toEqual([
      { itemId: 'rabbit_foot', kind: 'placebo', amount: 0 },
      { itemId: 'oracle', kind: 'prediction', amount: 0, prediction: 0, hit: true },
      { itemId: 'insurance', kind: 'refund', amount: 50 },
    ])
    expect(s.itemNet).toBe(50)
    expect(s.streak).toBe(-1)
  })

  it('el casco salva una racha ganadora, la marca con asterisco y solo se gasta al perder', () => {
    const plan = planItems(all, [red], 1, items)
    const run = (result: number, current: number, asterisk = false) =>
      settleItems(
        {
          plan,
          outcome: resolveBets([red], result),
          jackpotMultiplier: 1,
          prediction: null,
          current,
          asterisk,
        },
        items,
      )
    const lost = run(2, 4)
    expect(lost.streak).toBe(4)
    expect(lost.streakAsterisk).toBe(true)
    expect(lost.spent).toContain('streak_helmet')
    expect(lost.effects.at(-1)).toEqual({ itemId: 'streak_helmet', kind: 'shield', amount: 0 })
    // Ganando no se gasta y el asterisco sigue con la racha.
    const won = run(1, 4, true)
    expect(won.streak).toBe(5)
    expect(won.streakAsterisk).toBe(true)
    expect(won.spent).not.toContain('streak_helmet')
    // Sin racha que proteger, no se gasta.
    expect(run(2, 0).spent).not.toContain('streak_helmet')
    expect(run(2, -3).streak).toBe(-4)
  })

  it('el asterisco se va cuando la racha se rompe de verdad', () => {
    expect(streakWithHelmet({ current: 5, asterisk: true, net: -10, helmet: false })).toEqual({
      streak: -1,
      asterisk: false,
      helmetUsed: false,
    })
    expect(streakWithHelmet({ current: 5, asterisk: true, net: null, helmet: false })).toEqual({
      streak: 5,
      asterisk: true,
      helmetUsed: false,
    })
    expect(streakWithHelmet({ current: 5, asterisk: false, net: 0, helmet: true }).helmetUsed).toBe(
      false,
    )
  })

  it('sin doble reembolso: git revert mira el neto con lo que ya devolvió el seguro', () => {
    const plan = planItems(all, [red], 1, items)
    const outcome = resolveBets([red], 0)
    const s = settleItems(
      { plan, outcome, jackpotMultiplier: 1, prediction: 3, current: 0, asterisk: false },
      items,
    )
    expect(outcome.net).toBe(-100)
    expect(revertRefund(outcome.net + s.itemNet, items.revert)).toBe(50)
  })

  it('ventana del revert: desde que se enseña y durante windowMs', () => {
    const reveal = new Date('2026-10-14T10:00:00.000Z')
    const at = (ms: number) => new Date(reveal.getTime() + ms)
    expect(inRevertWindow(reveal, at(-1), items.revert)).toBe(false)
    expect(inRevertWindow(reveal, at(0), items.revert)).toBe(true)
    expect(inRevertWindow(reveal, at(items.revert.windowMs - 1), items.revert)).toBe(true)
    expect(inRevertWindow(reveal, at(items.revert.windowMs), items.revert)).toBe(false)
    expect(revertDeadline(reveal, items.revert)).toEqual(at(items.revert.windowMs))
  })
})

describe('Placebómetro', () => {
  it('cuenta rondas con y sin pata, y aciertos de la IA', () => {
    const p = placebometer({
      spent: 500,
      recovered: 120,
      rounds: [
        { won: true, items: [{ itemId: 'rabbit_foot' }, { itemId: 'oracle', hit: true }] },
        { won: false, items: [{ itemId: 'rabbit_foot' }, { itemId: 'oracle', hit: false }] },
        { won: true, items: [] },
        { won: false, items: [] },
        { won: false, items: [] },
      ],
    })
    expect(p).toEqual({
      spent: 500,
      recovered: 120,
      net: -380,
      rabbit: { with: { rounds: 2, won: 1 }, without: { rounds: 3, won: 1 } },
      oracle: { predictions: 2, hits: 1 },
    })
  })
})
describe('protocolo de la tienda (aditivo, v: 1)', () => {
  const inventory = {
    seasonId: '2026-10',
    enabled: true,
    maxArmed: 4,
    items: [{ id: 'rabbit_foot', charges: 36, armed: true }],
    cosmetics: {
      felts: ['classic', 'vaporwave'],
      chips: ['classic'],
      felt: 'vaporwave',
      chipSkin: 'classic',
    },
    revert: null,
  }

  it('mensajes nuevos del cliente y del servidor', () => {
    const buy = {
      v: 1,
      type: 'shop.buy',
      itemId: 'oracle',
      requestId: 'abcdefgh',
    }
    expect(clientMessageSchema.parse(buy)).toBeTruthy()
    expect(clientMessageSchema.safeParse({ ...buy, itemId: 'luck' }).success).toBe(false)
    const arm = { v: 1, type: 'item.arm', itemId: 'turbo', armed: true }
    expect(clientMessageSchema.parse(arm)).toBeTruthy()
    expect(clientMessageSchema.safeParse({ ...arm, itemId: 'revert' }).success).toBe(false)
    expect(
      clientMessageSchema.parse({
        v: 1,
        type: 'settings.update',
        felt: 'vaporwave',
      }),
    ).toBeTruthy()
    expect(
      serverMessageSchema.parse({
        v: 1,
        type: 'inventory',
        event: 'consumed',
        inventory,
        wallet: {
          seasonId: '2026-10',
          balance: 900,
          debt: 0,
          netWorth: 900,
          spins: 3,
          loans: 0,
          currentStreak: 2,
          bestStreak: 2,
          pendingSpins: 0,
          streakAsterisk: true,
        },
      }),
    ).toBeTruthy()
  })

  it('ajustes: felt y chipSkin cuentan como algo que cambiar', () => {
    expect(settingsRequestSchema.safeParse({ v: 1 }).success).toBe(false)
    expect(settingsRequestSchema.safeParse({ v: 1, felt: 'dark_mode' }).success).toBe(true)
    expect(settingsRequestSchema.safeParse({ v: 1, chipSkin: 'floppy' }).success).toBe(true)
    expect(settingsRequestSchema.safeParse({ v: 1, felt: 'neon' }).success).toBe(false)
  })

  it('la letra pequeña nunca promete que la casa pierde', () => {
    const item = {
      id: 'insurance',
      kind: 'consumable',
      price: 350,
      charges: 5,
      maxPerSeason: 5,
      bought: 0,
      owned: false,
      finePrint: finePrint('insurance', items),
    }
    expect(shopItemSchema.parse(item)).toBeTruthy()
    const lying = { ...item, finePrint: { ...item.finePrint, minEdge: -1 } }
    expect(shopItemSchema.safeParse(lying).success).toBe(false)
  })
})
