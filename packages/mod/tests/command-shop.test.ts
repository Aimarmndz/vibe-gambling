// SPDX-License-Identifier: AGPL-3.0-or-later
// La TIENDA desde el terminal: `/vibe-shop` (`/vibe-tienda`), `/vibe-shop buy <objeto>` con alias
// en español e inglés, `/vibe-use <objeto> [off]` (`/vibe-usar`), la línea del bolsillo en
// `/balance`, los glifos de lo armado en la status line y los efectos en el toast del resultado.
import { describe, expect, test } from 'claude-code/testing'

import { aliasKey, resolveItem } from '../hooks/lib/items.ts'
import {
  LOGGED_IN,
  SERVER,
  TEST_OPTIONS,
  TOKEN,
  command,
  happyCasino,
  meReply,
  playTurn,
  resolvedReply,
  startSession,
  wallet,
  world,
} from './support/harness.ts'
import type { SentRequest } from './support/harness.ts'

type Pocket = { id: string; charges: number; armed: boolean }

function inventory(items: Pocket[] = [], revert: unknown = null, enabled = true) {
  return {
    seasonId: '2026-10',
    enabled,
    maxArmed: 4,
    items,
    cosmetics: { felts: ['classic'], chips: ['classic'], felt: 'classic', chipSkin: 'classic' },
    revert,
  }
}

function shopItem(
  id: string,
  kind: string,
  price: number,
  charges: number,
  maxPerSeason: number | null,
  finePrint: { perCharge: number; maxExpected: number; minEdge: number },
  extra: Record<string, unknown> = {},
) {
  return { id, kind, price, charges, maxPerSeason, bought: 0, owned: false, finePrint, ...extra }
}

/** Respuesta de `/api/shop` con los números de `config/game.json` de ejemplo. */
function shopReply(pocket: Pocket[] = [], extra: Record<string, unknown> = {}) {
  return {
    json: {
      v: 1,
      shop: {
        seasonId: '2026-10',
        seasonEndsAt: '2026-10-31T23:00:00.000Z',
        items: [
          shopItem('rabbit_foot', 'consumable', 77, 37, 3, {
            perCharge: 77 / 37,
            maxExpected: 0,
            minEdge: 77 / 37,
          }),
          shopItem('oracle', 'consumable', 37, 10, 5, {
            perCharge: 3.7,
            maxExpected: 0,
            minEdge: 3.7,
          }),
          shopItem(
            'insurance',
            'consumable',
            350,
            5,
            5,
            { perCharge: 70, maxExpected: 2500 / 37, minEdge: 70 - 2500 / 37 },
            { bought: 2 },
          ),
          shopItem(
            'turbo',
            'consumable',
            100,
            1,
            10,
            { perCharge: 100, maxExpected: 3500 / 37, minEdge: 100 - 3500 / 37 },
            { bought: 10 },
          ),
          shopItem('streak_helmet', 'consumable', 150, 3, 3, {
            perCharge: 50,
            maxExpected: 0,
            minEdge: 50,
          }),
          shopItem('revert', 'service', 550, 0, 1, {
            perCharge: 550,
            maxExpected: 500,
            minEdge: 50,
          }),
          shopItem(
            'felt_vaporwave',
            'cosmetic',
            500,
            0,
            null,
            { perCharge: 500, maxExpected: 0, minEdge: 500 },
            { owned: true },
          ),
          shopItem('chips_floppy', 'cosmetic', 300, 0, null, {
            perCharge: 300,
            maxExpected: 0,
            minEdge: 300,
          }),
        ],
        inventory: inventory(pocket, {
          roundId: '7d9f0c1e-1d2b-4c3a-9e8f-0a1b2c3d4e5f',
          refund: 120,
          until: '2026-10-12T20:02:00.000Z',
        }),
        placebometer: {
          spent: 0,
          recovered: 0,
          net: 0,
          rabbit: { with: { rounds: 0, won: 0 }, without: { rounds: 0, won: 0 } },
          oracle: { predictions: 0, hits: 0 },
        },
        canBorrow: false,
        ...extra,
      },
    },
  }
}

function boughtReply(request: SentRequest, pocket: Pocket[], extra: Record<string, unknown> = {}) {
  const body = request.body as { itemId: string }
  return {
    json: {
      v: 1,
      itemId: body.itemId,
      price: 77,
      refund: 0,
      fresh: true,
      wallet: wallet({ balance: 923, netWorth: 923 }),
      inventory: inventory(pocket),
      ...extra,
    },
  }
}

const httpError = (status: number, error: string) => ({
  status,
  json: { v: 1, error, message: 'nope' },
})

describe('alias', () => {
  test('Spanish, English, accents, spaces and the catalogue id all resolve', () => {
    expect(resolveItem('pata')).toBe('rabbit_foot')
    expect(resolveItem('Rabbit Foot')).toBe('rabbit_foot')
    expect(resolveItem('rabbit_foot')).toBe('rabbit_foot')
    expect(resolveItem('Oráculo')).toBe('oracle')
    expect(resolveItem('IA')).toBe('oracle')
    expect(resolveItem('tipster')).toBe('oracle')
    expect(resolveItem('seguro')).toBe('insurance')
    expect(resolveItem('INSURANCE')).toBe('insurance')
    expect(resolveItem('casco')).toBe('streak_helmet')
    expect(resolveItem('helmet')).toBe('streak_helmet')
    expect(resolveItem('ctrl+z')).toBe('revert')
    expect(resolveItem('git revert')).toBe('revert')
    expect(resolveItem('deshacer')).toBe('revert')
    expect(resolveItem('vaporwave')).toBe('felt_vaporwave')
    expect(resolveItem('felt_vaporwave')).toBe('felt_vaporwave')
    expect(resolveItem('disquete')).toBe('chips_floppy')
    expect(resolveItem('chapas')).toBe('chips_bottle_cap')
    expect(resolveItem('cinco duros')).toBe('chips_cinco_duros')
    expect(resolveItem('lambo')).toBeNull()
    expect(resolveItem('   ')).toBeNull()
    expect(aliasKey('Pata de Conejo™')).toBe('patadeconejo')
  })
})

test(
  '/vibe-shop lists prices, caps, fine print, cosmetics, the pocket and the revert',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const pocket = [
      { id: 'rabbit_foot', charges: 36, armed: true },
      { id: 'insurance', charges: 5, armed: false },
    ]
    const w = world(on, { routes: { '/api/shop': shopReply(pocket) }, store: LOGGED_IN })
    await startSession($, w)
    const lines = ((await command($, 'vibe-shop')).text ?? '').split('\n')
    expect(lines[0]).toStartWith('🛒 SHOP · season 2026-10 · consumables expire on ')
    expect(lines[1]).toBe(
      "🐇 Lucky Rabbit's Foot™ — 77 🪙 · 37 charges · 0/3 this season · does nothing, with great conviction · pays back 0: the house wins 2.08 per charge (that is, all of it)",
    )
    expect(lines[3]).toBe(
      '🛡 Full Coverage Insurance — 350 🪙 · 5 charges · 2/5 this season · refunds part of your outside-bet losses (deductible applies) · pays back ≤ 67.57 per charge on average: the house wins ≥ 2.43',
    )
    expect(lines[4]).toContain('⚡ Straight-Up Turbo ×2 — 100 🪙 · 1 charge · SOLD OUT this season')
    expect(lines[4]).toContain('pays back ≤ 94.59 per charge on average: the house wins ≥ 5.41')
    expect(lines[6]).toContain('↩ git revert HEAD~1 — 550 🪙 · 0/1 this season')
    expect(lines[6]).toContain('pays back ≤ 500: the house wins ≥ 50, always')
    expect(lines[7]).toBe('🎨 Cosmetics (forever):')
    expect(lines[8]).toContain('Vaporwave felt — 500 🪙 · yours · A E S T H E T I C · EV −500')
    expect(lines[10]).toBe(
      "🎒 Pocket: 🐇 Lucky Rabbit's Foot™ ×36 (armed) · 🛡 Full Coverage Insurance ×5",
    )
    expect(lines[11]).toMatch(
      /^↩ git revert available: it would refund 120 🪙 \(costs 550\) until /,
    )
    expect(lines.at(-1)).toContain('/vibe-shop buy <item>')
    const [request] = w.to('/api/shop')
    expect(request?.method).toBe('GET')
    expect(request?.rawBody).toBeUndefined()
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    // Lo armado sale ya en la status line la próxima vez que se pinta.
    expect((await command($, 'balance')).text).toBeDefined()
  },
)

test(
  '/vibe-tienda in Spanish, closed shop, empty pocket and the loan offer',
  { options: { ...TEST_OPTIONS, language: 'es' } },
  async ($, on) => {
    const reply = shopReply([], { canBorrow: true })
    reply.json.shop.inventory = inventory([], null, false)
    const w = world(on, { routes: { '/api/shop': reply }, store: LOGGED_IN })
    await startSession($, w)
    const text = (await command($, 'vibe-tienda')).text ?? ''
    expect(text).toContain('🛒 TIENDA · temporada 2026-10 · los consumibles caducan el')
    expect(text).toContain('La tienda está cerrada')
    expect(text).toContain('🐇 Pata de Conejo™ — 77 🪙 · 37 cargas · 0/3 esta temporada')
    expect(text).toContain('la casa gana 2,08 por carga (o sea, todo)')
    expect(text).toContain('🎒 Bolsillo vacío.')
    expect(text).toContain('¿Financiamos tu pata de conejo?')
    expect(text).not.toContain('git revert disponible')
  },
)

test(
  '/vibe-shop buy with Spanish and English aliases sends only the item and a request id',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        '/api/shop/buy': request =>
          boughtReply(request, [{ id: 'rabbit_foot', charges: 37, armed: false }]),
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect((await command($, 'vibe-shop', 'buy pata')).text).toBe(
      "🛒 Lucky Rabbit's Foot™ ×37 for 77 🪙. Balance: 923. Arm it with /vibe-use pata.",
    )
    await command($, 'vibe-shop', 'comprar Rabbit Foot')
    await command($, 'vibe-tienda', 'buy oráculo')
    const bodies = w.to('/api/shop/buy').map(r => r.body as Record<string, unknown>)
    expect(bodies.map(b => b.itemId)).toEqual(['rabbit_foot', 'rabbit_foot', 'oracle'])
    for (const body of bodies) {
      expect(Object.keys(body).sort()).toEqual(['itemId', 'requestId', 'v'])
      expect(body.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    }
    // Cada compra es una compra nueva: ids distintos.
    expect(new Set(bodies.map(b => b.requestId)).size).toBe(3)
    expect(w.lastStatus()).toBe('🎰 923 🪙')
  },
)

test(
  'a buy that loses its connection is retried once with the same request id (no double charge)',
  { options: TEST_OPTIONS },
  async ($, on) => {
    let calls = 0
    const w = world(on, {
      routes: {
        '/api/shop/buy': request => {
          calls += 1
          return calls === 1
            ? { fail: true }
            : boughtReply(request, [{ id: 'streak_helmet', charges: 3, armed: false }], {
                price: 150,
              })
        },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    const { text } = await command($, 'vibe-shop', 'buy casco')
    expect(text).toContain('Streak Helmet ×3 for 150')
    const ids = w.to('/api/shop/buy').map(r => (r.body as { requestId: string }).requestId)
    expect(ids).toHaveLength(2)
    expect(ids[0]).toBe(ids[1])
  },
)

test(
  '/vibe-shop buy: cosmetics, revert, and every error with its own joke',
  { options: TEST_OPTIONS },
  async ($, on) => {
    let error: { status: number; error: string } | null = null
    const w = world(on, {
      routes: {
        '/api/shop/buy': request => {
          if (error !== null) return httpError(error.status, error.error)
          const id = (request.body as { itemId: string }).itemId
          return boughtReply(request, [], id === 'revert' ? { price: 550, refund: 120 } : {})
        },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect((await command($, 'vibe-shop', 'buy vaporwave')).text).toBe(
      '🎨 Vaporwave felt is yours forever for 77 🪙. Balance: 923. Put it on in the WARDROBE of /roulette.',
    )
    expect((await command($, 'vibe-shop', 'buy ctrl+z')).text).toBe(
      '↩ git revert HEAD~1: you pay 550, you get 120 back. Balance: 923. History and interest are not reverted.',
    )
    const cases: Array<[number, string, string, string]> = [
      [409, 'insufficient_funds', 'seguro', 'You cannot afford Full Coverage Insurance'],
      [409, 'conflict', 'turbo', 'You already bought every Straight-Up Turbo ×2 this season'],
      [409, 'conflict', 'disquete', '3½" Floppy chips is already yours'],
      [409, 'conflict', 'revert', 'Nothing to revert'],
      [404, 'not_found', 'pata', 'The shop is closed'],
      [429, 'rate_limited', 'pata', 'one purchase at a time'],
    ]
    for (const [status, code, alias, expected] of cases) {
      error = { status, error: code }
      expect((await command($, 'vibe-shop', `buy ${alias}`)).text).toContain(expected)
    }
    error = null
    expect((await command($, 'vibe-shop', 'buy lambo')).text).toContain(
      '"lambo" is not in the catalogue',
    )
    expect((await command($, 'vibe-shop', 'sell pata')).text).toMatch(/^Usage: \/vibe-shop/)
    expect((await command($, 'vibe-shop', 'buy')).text).toMatch(/^Usage: \/vibe-shop/)
  },
)

test(
  '/vibe-use arms and disarms, refuses cosmetics, and the status line shows the glyphs',
  { options: TEST_OPTIONS },
  async ($, on) => {
    let pocket: Pocket[] = []
    let conflict = false
    const w = world(on, {
      routes: {
        '/api/me': meReply({
          inventory: inventory([{ id: 'insurance', charges: 5, armed: true }]),
        }),
        '/api/items/arm': request => {
          if (conflict) return httpError(409, 'conflict')
          const body = request.body as { itemId: string; armed: boolean }
          pocket = [
            { id: 'rabbit_foot', charges: 37, armed: body.itemId === 'rabbit_foot' && body.armed },
            { id: 'insurance', charges: 5, armed: true },
          ]
          return { json: { v: 1, inventory: inventory(pocket) } }
        },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect(w.lastStatus()).toBe('🎰 1,000 🪙 · 🛡')
    expect((await command($, 'vibe-use', 'pata')).text).toBe(
      "🎒 Lucky Rabbit's Foot™ armed (37 charges). It acts on the next spin with chips.",
    )
    expect(w.lastStatus()).toBe('🎰 1,000 🪙 · 🐇🛡')
    expect((await command($, 'vibe-usar', 'rabbit off')).text).toContain('disarmed')
    expect(w.lastStatus()).toBe('🎰 1,000 🪙 · 🛡')
    expect(w.to('/api/items/arm').map(r => r.body)).toEqual([
      { v: 1, itemId: 'rabbit_foot', armed: true },
      { v: 1, itemId: 'rabbit_foot', armed: false },
    ])
    expect((await command($, 'vibe-use', 'vaporwave')).text).toContain('cannot be armed')
    expect((await command($, 'vibe-use', 'revert')).text).toContain('cannot be armed')
    expect((await command($, 'vibe-use')).text).toMatch(/^Usage: \/vibe-use/)
    expect((await command($, 'vibe-use', 'lambo')).text).toContain('not in the catalogue')
    expect(w.to('/api/items/arm')).toHaveLength(2)
    conflict = true
    expect((await command($, 'vibe-use', 'turbo')).text).toContain('Cannot arm Straight-Up Turbo')
  },
)

test(
  '/balance adds the armed items, or what is in the pocket unarmed; nothing without a shop',
  { options: TEST_OPTIONS },
  async ($, on) => {
    let inv: unknown = inventory([
      { id: 'rabbit_foot', charges: 36, armed: true },
      { id: 'oracle', charges: 10, armed: true },
      { id: 'turbo', charges: 0, armed: false },
    ])
    const w = world(on, {
      routes: { '/api/me': () => meReply(inv === undefined ? {} : { inventory: inv }) },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect(((await command($, 'balance')).text ?? '').split('\n').at(-1)).toBe(
      "🎒 Armed: 🐇 Lucky Rabbit's Foot™ ×36 · 🔮 AI Tipster (VibeOracle) ×10",
    )
    expect(w.lastStatus()).toBe('🎰 1,000 🪙 · 🐇🔮')
    inv = inventory([{ id: 'insurance', charges: 5, armed: false }])
    expect(((await command($, 'balance')).text ?? '').split('\n').at(-1)).toBe(
      '🎒 In your pocket, not armed: 🛡 Full Coverage Insurance ×5 (/vibe-use <item>)',
    )
    inv = undefined
    expect((await command($, 'balance')).text).not.toContain('🎒')
    expect(w.lastStatus()).toBe('🎰 1,000 🪙')
  },
)

test(
  'the result toast lists the item effects and the glyphs drop the spent charges at the reveal',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const items = [
      { itemId: 'rabbit_foot', kind: 'placebo', amount: 0 },
      { itemId: 'oracle', kind: 'prediction', amount: 0, prediction: 4, hit: false },
      { itemId: 'insurance', kind: 'refund', amount: 50 },
      { itemId: 'streak_helmet', kind: 'shield', amount: 0 },
      // Lo que no es del catálogo o no tiene la forma esperada se ignora.
      { itemId: 'lambo', kind: 'boost', amount: 1_000_000 },
      { itemId: 'turbo', kind: 'boost', amount: 'many' },
    ]
    const w = world(on, {
      routes: {
        ...happyCasino(true),
        '/api/me': meReply({
          inventory: inventory([
            { id: 'rabbit_foot', charges: 1, armed: true },
            { id: 'oracle', charges: 3, armed: true },
            { id: 'insurance', charges: 1, armed: true },
            { id: 'streak_helmet', charges: 1, armed: true },
          ]),
        }),
        '/api/turn/end': resolvedReply(
          { result: 17, net: -100, itemNet: 50, items },
          { balance: 950, netWorth: 950 },
        ),
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect(w.lastStatus()).toBe('🎰 1,000 🪙 · 🐇🔮🛡⛑')
    await playTurn($, w)
    // Nada antes de que la bola caiga: ni el toast ni el casco gastado (destriparía la derrota).
    expect(w.lastStatus()).toBe('🎰 1,000 🪙 · 🐇🔮🛡⛑')
    await w.clock.advance(4_000)
    expect(w.toasts[0]).toStartWith(
      '🎰 17 ⚫ black · −100 🪙 · 🐇 +∞% LUCK · 🔮 The AI predicted 4: missed (as always) · 🛡 INSURANCE +50 · ⛑ Helmet: streak saved (with an asterisk)',
    )
    expect(w.toasts[0]).not.toContain('1,000,000')
    expect(w.lastStatus()).toBe('🎰 950 🪙 · 🔮')
  },
)

test(
  'turbo and a lucky oracle in Spanish',
  { options: { ...TEST_OPTIONS, language: 'es' } },
  async ($, on) => {
    const w = world(on, {
      routes: {
        ...happyCasino(true),
        '/api/turn/end': resolvedReply({
          result: 17,
          net: 3500,
          itemNet: 3500,
          items: [
            { itemId: 'oracle', kind: 'prediction', amount: 0, prediction: 17, hit: true },
            { itemId: 'turbo', kind: 'boost', amount: 3500 },
          ],
        }),
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await playTurn($, w)
    await w.clock.advance(4_000)
    expect(w.toasts[0]).toContain('🔮 La IA predijo 17: ¡ACIERTO! (1/37, como cualquiera)')
    expect(w.toasts[0]).toContain('⚡ TURBO ×2 +3.500')
  },
)

test(
  'without a session the shop commands ask to log in',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on)
    await startSession($, w)
    expect((await command($, 'vibe-shop')).text).toContain('/vibe-login')
    expect((await command($, 'vibe-shop', 'buy pata')).text).toContain('/vibe-login')
    expect((await command($, 'vibe-use', 'pata')).text).toContain('/vibe-login')
    expect(w.requests).toHaveLength(0)
    expect(SERVER).toBe('https://casino.test')
  },
)
