// SPDX-License-Identifier: AGPL-3.0-or-later
// Datos del menú v2: el libro de logros (bloqueado, oculto, con progreso y conseguido; lo visto
// se recuerda), las peticiones de ESTADÍSTICAS y BANCO por WebSocket y los de la demo.
import {
  ACHIEVEMENTS,
  accrueInterest,
  gameConfigSchema,
  spinAllStopReason,
  toPublicGameConfig,
} from '@vibe-gambling/shared'
import type { ServerMessage } from '@vibe-gambling/shared'
import { LOCALES as LOCALE_LIST } from '@vibe-gambling/shared/i18n'
import { serverMessageSchema } from '@vibe-gambling/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasGlyph } from '../src/font/bitmap.ts'
import {
  AchievementBook,
  SEEN_KEY,
  achievementRow,
  achievementState,
} from '../src/game/achievements.ts'
import { DemoLink } from '../src/net/demo.ts'
import {
  DemoProgress,
  sampleSeries,
  seededRandom,
  showcaseSeason,
  wallDay,
} from '../src/net/demoProgress.ts'
import { withVersion } from '../src/net/link.ts'
import { ProgressError, ProgressRequests } from '../src/net/progress.ts'
import { shortDate } from '../src/ui/menu/format.ts'
import { clientConfig } from '../src/config.ts'
import rawGame from '../../../config/game.json'
import { BANK, STATS, achievementsFixture } from './menuFixtures.ts'
import { msg, testGame, testWebConfig, user, wallet } from './fixtures.ts'
import { translator } from './translators.ts'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const hello = (achievements = achievementsFixture(['first_spin'])) =>
  msg({
    type: 'hello',
    user,
    wallet: wallet(),
    slip: { bets: [], total: 0 },
    round: null,
    lastRound: null,
    serverTime: '2026-10-12T10:00:00.000Z',
    achievements,
  })

describe('libro de logros', () => {
  it('estados: conseguido, secreto, contable con progreso y bloqueado', () => {
    const list = achievementsFixture(['first_spin'])
    const byId = (id: string) => list.find(a => a.id === id)!
    expect(achievementState(byId('first_spin'))).toBe('unlocked')
    expect(achievementState(byId('night_owl'))).toBe('secret')
    expect(achievementState(byId('pro_debtor'))).toBe('progress')
    expect(achievementState(byId('all_on_zero'))).toBe('locked')
    // Un secreto conseguido ya enseña su nombre.
    expect(achievementState({ ...byId('night_owl'), unlockedAt: '2026-10-01T00:00:00.000Z' })).toBe(
      'unlocked',
    )
  })

  it('los secretos sin conseguir salen como ??? y los marcadores se rellenan', () => {
    const tr = translator('es')
    const list = achievementsFixture([])
    const secret = achievementRow(
      list.find(a => a.id === 'too_big_to_fail')!,
      tr,
    )
    expect(secret.title).toBe('???')
    expect(secret.desc).toBe(tr.t('ach.secretDesc'))
    const debtor = achievementRow(
      list.find(a => a.id === 'pro_debtor')!,
      tr,
    )
    expect(debtor.desc).toContain(String(testGame.achievements.proDebtorLoans))
    expect(debtor.progress).toEqual({ current: 1, goal: 2 })
    for (const locale of LOCALE_LIST) {
      for (const a of achievementsFixture(ACHIEVEMENTS.map(d => d.id))) {
        const row = achievementRow(a, translator(locale))
        expect(row.title).not.toMatch(/[{}]/)
        expect(row.desc).not.toMatch(/[{}]/)
      }
    }
  })

  it('cuenta, recibe los nuevos y apaga el punto oro al verlos', () => {
    const storage = memoryStorage({ [SEEN_KEY]: JSON.stringify(['first_spin']) })
    const book = new AchievementBook(storage)
    expect(book.all()).toBeNull()
    expect(book.receive(msg({ type: 'pong', t: 1 }))).toBe(false)
    // Sin catálogo aún, un logro suelto no se apunta.
    const unlocked = {
      ...achievementsFixture([]).find(a => a.id === 'big_win')!,
      unlockedAt: '2026-10-12T10:00:00.000Z',
      seasonId: '2026-10',
    }
    expect(book.receive(msg({ type: 'achievement.unlocked', achievement: unlocked }))).toBe(false)
    expect(book.receive(hello())).toBe(true)
    expect(book.count()).toEqual({ unlocked: 1, total: ACHIEVEMENTS.length })
    expect(book.hasUnseen()).toBe(false)
    expect(book.receive(msg({ type: 'achievement.unlocked', achievement: unlocked }))).toBe(true)
    expect(book.count().unlocked).toBe(2)
    expect(book.hasUnseen()).toBe(true)
    book.markAllSeen()
    expect(book.hasUnseen()).toBe(false)
    expect(JSON.parse(storage.data.get(SEEN_KEY)!)).toEqual(['first_spin', 'big_win'])
  })

  it('con la bola cayendo aparta los logros (sueltos o en un hello de reconexión) hasta soltarlos', () => {
    const book = new AchievementBook(memoryStorage({ [SEEN_KEY]: JSON.stringify(['first_spin']) }))
    book.receive(hello())
    const before = book.count()
    const zero = {
      ...achievementsFixture([]).find(a => a.id === 'big_win')!,
      unlockedAt: '2026-10-12T10:00:00.000Z',
      seasonId: '2026-10',
    }
    // "Todo al 0" o "Primera ruina" dirían el resultado: ni el contador, ni el punto oro, ni la fila.
    expect(book.receive(msg({ type: 'achievement.unlocked', achievement: zero }), true)).toBe(false)
    const reconnect = hello(achievementsFixture(['first_spin', 'big_win', 'first_ruin']))
    expect(book.receive(reconnect, true)).toBe(false)
    expect(book.count()).toEqual(before)
    expect(book.hasUnseen()).toBe(false)
    expect(book.all()!.find(a => a.id === 'big_win')!.unlockedAt).toBeNull()
    // Otros mensajes no se apartan ni cambian nada.
    expect(book.receive(msg({ type: 'pong', t: 1 }), true)).toBe(false)
    // Cae la bola: se aplica todo en orden.
    expect(book.release()).toBe(true)
    expect(book.count().unlocked).toBe(3)
    expect(book.hasUnseen()).toBe(true)
    expect(book.release()).toBe(false)
  })

  it('lo apartado se aplica antes que un mensaje nuevo sin apartar', () => {
    const book = new AchievementBook(null)
    book.receive(hello(achievementsFixture(['first_spin', 'first_ruin'])), true)
    expect(book.all()).toBeNull()
    // Un hello más nuevo (sin el de antes) manda.
    expect(book.receive(hello(achievementsFixture(['first_spin'])))).toBe(true)
    expect(book.count().unlocked).toBe(1)
  })

  it('la primera vez en este navegador lo ya conseguido no cuenta como nuevo', () => {
    const storage = memoryStorage()
    const book = new AchievementBook(storage)
    book.receive(hello(achievementsFixture(['first_spin', 'first_ruin'])))
    expect(book.hasUnseen()).toBe(false)
    // Sin almacenamiento también funciona (y sin catálogo, nada que contar).
    const bare = new AchievementBook(null)
    expect(bare.count()).toEqual({ unlocked: 0, total: 0 })
    bare.markAllSeen()
  })

  it('un almacenamiento roto no rompe nada', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken = {
      getItem: () => '{no es json',
      setItem: () => {
        throw new Error('lleno')
      },
    }
    const book = new AchievementBook(broken)
    book.receive(hello())
    book.markAllSeen()
    expect(
      new AchievementBook({ getItem: () => '"x"', setItem: () => undefined }).hasUnseen(),
    ).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('peticiones de estadísticas y banco', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('cada respuesta va a la petición de su tipo y temporada', async () => {
    const sent: unknown[] = []
    const req = new ProgressRequests(m => sent.push(m) > 0, 1000)
    const now = req.request('stats')
    const past = req.request('stats', '2026-09')
    const bank = req.request('bank')
    expect(req.busy).toBe(true)
    expect(sent).toEqual([
      { type: 'stats.request' },
      { type: 'stats.request', seasonId: '2026-09' },
      { type: 'bank.request' },
    ])
    expect(req.receive(msg({ type: 'stats', stats: { ...STATS, seasonId: '2026-09' } }))).toBe(true)
    expect(req.receive(msg({ type: 'stats', stats: STATS }))).toBe(true)
    expect(req.receive(msg({ type: 'bank', bank: BANK }))).toBe(true)
    await expect(past).resolves.toMatchObject({ seasonId: '2026-09' })
    await expect(now).resolves.toMatchObject({ seasonId: '2026-10' })
    await expect(bank).resolves.toMatchObject({ debt: 330 })
    // Una respuesta que nadie esperaba se ignora.
    expect(req.receive(msg({ type: 'bank', bank: BANK }))).toBe(false)
    expect(req.busy).toBe(false)
  })

  it('temporada en la que no jugó, sin respuesta a tiempo y sin conexión', async () => {
    const req = new ProgressRequests(() => true, 1000)
    const missing = req.request('bank', '2025-01')
    const notFound = msg({ type: 'error', error: 'not_found', message: 'x' })
    expect(req.receive(notFound)).toBe(true)
    await expect(missing).rejects.toMatchObject({ reason: 'not_found' })
    // Un not_found sin petición con temporada no es para nosotros.
    const current = req.request('stats')
    expect(req.receive(notFound)).toBe(false)
    vi.advanceTimersByTime(1001)
    await expect(current).rejects.toBeInstanceOf(ProgressError)
    const lost = req.request('stats')
    req.failAll()
    await expect(lost).rejects.toMatchObject({ reason: 'offline' })
    const offline = new ProgressRequests(() => false, 1000)
    await expect(offline.request('bank')).rejects.toMatchObject({ reason: 'offline' })
  })

  it('un not_found de GIRAR TODAS no se toma por la respuesta de una temporada pedida', async () => {
    const req = new ProgressRequests(() => true, 1000)
    const past = req.request('stats', '2025-01')
    const spinError = msg({ type: 'error', error: 'not_found', message: 'x', re: 'spin.pending' })
    expect(req.receive(spinError)).toBe(false)
    expect(req.busy).toBe(true)
    const bankError = msg({ type: 'error', error: 'not_found', message: 'x', re: 'bank.request' })
    expect(req.receive(bankError)).toBe(false)
    const statsError = msg({ type: 'error', error: 'not_found', message: 'x', re: 'stats.request' })
    expect(req.receive(statsError)).toBe(true)
    await expect(past).rejects.toMatchObject({ reason: 'not_found' })
  })
})

describe('demo: estadísticas, banco y logros', () => {
  const limits = { recentRounds: 3, seriesPoints: 5, loanMarks: 2, bankHistory: 2 }

  it('azar fijo, muestreo de la serie y día de pared', () => {
    const a = seededRandom(5)
    const b = seededRandom(5)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
    expect(sampleSeries([1, 2, 3], 5)).toEqual([1, 2, 3])
    const sampled = sampleSeries([...Array(100).keys()], 5)
    expect(sampled).toHaveLength(5)
    expect(sampled[0]).toBe(0)
    expect(sampled.at(-1)).toBe(99)
    expect(wallDay('2026-10-12T23:30:00.000Z', 'Europe/Madrid')).toBe('2026-10-13')
  })

  it('la temporada de ejemplo sale siempre igual y cumple el contrato', () => {
    const run = () => {
      const progress = new DemoProgress(testGame, limits)
      const played = showcaseSeason(
        progress,
        testGame,
        wallet(),
        { seed: 9, spins: 60, pending: 7 },
        Date.parse('2026-10-20T12:00:00Z'),
      )
      return { progress, played }
    }
    const one = run()
    const two = run()
    expect(one.played.wallet).toEqual(two.played.wallet)
    expect(one.played.history).toEqual(two.played.history)
    const w = one.played.wallet
    expect(w.spins).toBe(60)
    expect(w.pendingSpins).toBe(7)
    expect(one.played.lastRound?.result).toBe(one.played.history.at(-1))
    const stats = serverMessageSchema.parse(msg({ type: 'stats', stats: one.progress.stats(w) }))
    expect(stats.type === 'stats' && stats.stats.series.length).toBeLessThanOrEqual(
      limits.seriesPoints,
    )
    expect(stats.type === 'stats' && stats.stats.recent).toHaveLength(limits.recentRounds)
    const bank = serverMessageSchema.parse(msg({ type: 'bank', bank: one.progress.bank(w) }))
    expect(bank.type === 'bank' && bank.bank.history.length).toBeLessThanOrEqual(limits.bankHistory)
    const unlocked = one.progress.achievements(w).filter(a => a.unlockedAt)
    expect(unlocked.length).toBeGreaterThan(0)
    // Un logro ya conseguido no se vuelve a dar.
    expect(one.progress.unlock('first_spin', '2026-10-02T00:00:00.000Z', w.seasonId)).toBe(false)
  })

  it('agrupa los intereses por día y entre préstamos', () => {
    const progress = new DemoProgress(testGame, { ...limits, bankHistory: 10 })
    const w = wallet({ debt: 300, loans: 1, balance: 0 })
    progress.recordLoan('2026-10-11T09:00:00.000Z', 300, w)
    const round = (at: string, interest: number, debtAfter: number) =>
      progress.recordRound(
        {
          roundId: '0b9a8d3c-6a39-4c4e-9f7b-1f9a6c2d3e41',
          resolvedAt: at,
          result: 3,
          color: 'red',
          staked: 5,
          net: -5,
          interestCharged: interest,
        },
        wallet({ debt: debtAfter, loans: 1, spins: 1 }),
      )
    round('2026-10-11T10:00:00.000Z', 30, 330)
    round('2026-10-11T11:00:00.000Z', 33, 363)
    round('2026-10-12T10:00:00.000Z', 37, 400)
    round('2026-10-12T11:00:00.000Z', 0, 400)
    const bank = progress.bank(wallet({ debt: 400, loans: 1 }))
    expect(bank.history.map(e => e.kind)).toEqual(['interest', 'interest', 'loan'])
    expect(bank.history[1]).toMatchObject({ spins: 2, amount: 63, debtAfter: 363 })
    expect(bank.nextInterest).toBe(accrueInterest(400, testGame) - 400)
    expect(bank.truncated).toBe(false)
    const stats = progress.stats(wallet({ spins: 4 }))
    expect(stats.mostFrequent).toEqual({ result: 3, color: 'red', count: 4 })
    expect(stats.biggestWin).toBeNull()
  })

  it('la ventana de la demo pide y recibe estadísticas, banco y logros, y gasta pendientes', async () => {
    vi.useFakeTimers()
    const demoCfg = {
      thinkMs: 1000,
      pauseMs: 2000,
      login: 'demo-tester',
      stats: limits,
      showcase: { seed: 3, spins: 20, pending: 2 },
      achievements: testGame.achievements,
    }
    const link = new DemoLink(testWebConfig.game, demoCfg, false, testWebConfig.publicUrl)
    const got: ServerMessage[] = []
    link.onMessage(m => got.push(serverMessageSchema.parse(m)))
    link.onStatus(() => undefined)
    link.start()
    vi.advanceTimersByTime(1)
    const first = got[0]
    expect(first?.type === 'hello' && first.achievements?.length).toBe(ACHIEVEMENTS.length)
    link.controls.showcase()
    const shown = got.at(-1)
    expect(shown?.type === 'hello' && shown.wallet.pendingSpins).toBe(2)
    link.send(withVersion({ type: 'stats.request' }))
    link.send(withVersion({ type: 'bank.request' }))
    await vi.advanceTimersByTimeAsync(50)
    expect(got.slice(-2).map(m => m.type)).toEqual(['stats', 'bank'])
    link.send(withVersion({ type: 'spin.pending', quick: true, requestId: crypto.randomUUID() }))
    link.send(withVersion({ type: 'spin.pending', quick: false, requestId: crypto.randomUUID() }))
    await vi.advanceTimersByTimeAsync(40)
    // La segunda llega con la ruleta ocupada.
    expect(got.some(m => m.type === 'error' && m.error === 'conflict')).toBe(true)
    await vi.advanceTimersByTimeAsync(testWebConfig.game.pendingSpins.quickSpinMs + 50)
    const resolved = got.filter(m => m.type === 'round.resolved')
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.type === 'round.resolved' && resolved[0].wallet.pendingSpins).toBe(1)
    link.send(withVersion({ type: 'spin.pending', quick: false, requestId: crypto.randomUUID() }))
    await vi.advanceTimersByTimeAsync(testWebConfig.game.minSpinMs + 50)
    link.send(withVersion({ type: 'spin.pending', quick: false, requestId: crypto.randomUUID() }))
    await vi.advanceTimersByTimeAsync(50)
    expect(got.at(-1)?.type === 'error' && (got.at(-1) as { error: string }).error).toBe(
      'not_found',
    )
    link.stop()
    vi.useRealTimers()
  })
})

describe('capturas de GIRAR TODAS (demo, temporada de ejemplo)', () => {
  it('tras la temporada de ejemplo las pendientes salen siempre igual y las dos primeras no paran', async () => {
    // Con la configuración de verdad: es la que usan las capturas de docs/screenshots (E2E).
    const pub = toPublicGameConfig(gameConfigSchema.parse(rawGame))
    const play = async () => {
      vi.useFakeTimers()
      const link = new DemoLink(pub, clientConfig.demo, false, testWebConfig.publicUrl)
      const got: ServerMessage[] = []
      link.onMessage(m => got.push(serverMessageSchema.parse(m)))
      link.onStatus(() => undefined)
      link.start()
      vi.advanceTimersByTime(1)
      link.controls.showcase()
      for (let i = 0; i < 3; i++) {
        link.send(
          withVersion({ type: 'spin.pending', quick: true, requestId: crypto.randomUUID() }),
        )
        await vi.advanceTimersByTimeAsync(pub.pendingSpins.quickSpinMs + 50)
      }
      link.stop()
      vi.useRealTimers()
      return got.flatMap(m => (m.type === 'round.resolved' ? [m] : []))
    }
    const a = await play()
    const b = await play()
    expect(a.map(m => m.round.result)).toEqual(b.map(m => m.round.result))
    expect(a).toHaveLength(3)
    // La captura espera a la tercera cayendo: ni premio gordo, ni verde, ni bancarrota antes.
    for (const m of a.slice(0, 2)) expect(spinAllStopReason(m.round, m.wallet, pub)).toBeNull()
  })
})

describe('glifos', () => {
  it('las fechas cortas de todos los idiomas se pueden pintar con la fuente', () => {
    for (const locale of LOCALE_LIST) {
      for (let m = 0; m < 12; m++) {
        const text = shortDate(new Date(Date.UTC(2026, m, 15)).toISOString(), locale, 'UTC')
        for (const ch of text) expect(hasGlyph(ch), `${locale}: ${text}`).toBe(true)
      }
    }
  })
})
