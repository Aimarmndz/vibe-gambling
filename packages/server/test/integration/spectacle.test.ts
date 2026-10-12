// SPDX-License-Identifier: AGPL-3.0-or-later
// Fase 8 (espectáculo, servidor): nivel de premio en cada ronda, bancarrota una vez por temporada,
// logros de broma (una sola vez, también con concurrencia, y en cascada al borrar la cuenta) y los
// datos de las pantallas ESTADÍSTICAS y BANCO.
import { ACHIEVEMENT_IDS, meResponseSchema } from '@vibe-gambling/shared'
import type { BetSelection, ServerMessage } from '@vibe-gambling/shared'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { achievements, wallets } from '../../src/db/schema.ts'
import { AppError } from '../../src/lib/errors.ts'
import { createUser, createWatchingUser, MOD_META, startTestApp, turnId } from '../helpers/app.ts'
import type { TestApp } from '../helpers/app.ts'

let t: TestApp

beforeAll(async () => {
  t = await startTestApp()
})
afterAll(async () => {
  await t.close()
})

const STRAIGHT = (n: number): BetSelection => ({ kind: 'straight', numbers: [n] })

/**
 * Juega un turno en directo: pone las fichas, fija el número y termina el turno. Avanza el reloj
 * un segundo después para que cada tirada tenga su instante.
 */
async function play(
  app: TestApp,
  userId: string,
  opts: {
    bets?: Array<[BetSelection, number | 'all-in']>
    result: number
    gitPushOk?: boolean
    testFailed?: boolean
    id?: string
  },
) {
  for (const [selection, amount] of opts.bets ?? []) {
    await app.services.game.placeBet(userId, selection, amount)
  }
  app.rng.fix(opts.result)
  const res = await app.services.game.turnEnd(userId, {
    v: 1,
    turnId: opts.id ?? turnId(),
    durationMs: 5,
    gitPushOk: opts.gitPushOk ?? false,
    testFailed: opts.testFailed ?? false,
    ...MOD_META,
  })
  if (res.status !== 'resolved') throw new Error(`se esperaba una ronda resuelta: ${res.status}`)
  app.clock.advance(1000)
  return res
}

const types = (list: ServerMessage[]) => list.map(m => m.type)
const unlockedIds = (list: ServerMessage[]) =>
  list.flatMap(m => (m.type === 'achievement.unlocked' ? [m.achievement.id] : []))

async function achievementRows(app: TestApp, userId: string) {
  return app.db.db.select().from(achievements).where(eq(achievements.userId, userId))
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    if (error instanceof AppError) return error.code
    throw error
  }
  return 'ok'
}

describe('nivel de espectáculo en round.resolved', () => {
  it('¡PLENO!, racha ON FIRE y falacia, con los logros detrás del resultado y en orden', async () => {
    const { user, window } = await createWatchingUser(t, 'pleno')
    if (!window) throw new Error('sin ventana')
    window.received.length = 0
    const first = await play(t, user.id, { bets: [[STRAIGHT(7), 10]], result: 7 })
    expect(first.round.spectacle).toMatchObject({
      tier: 'straight',
      netMultiple: 35,
      bigWin: true,
      green: false,
      greenWin: false,
      jackpot: false,
      streak: 1,
      fire: 'none',
      bankrupt: false,
    })
    // El mensaje de la ventana lleva el mismo espectáculo que la respuesta del mod.
    const msgs = window.received.filter(m => m.type !== 'slip')
    expect(types(msgs)).toEqual([
      'round.started',
      'round.resolved',
      'achievement.unlocked',
      'achievement.unlocked',
      'achievement.unlocked',
    ])
    expect(msgs[1]).toMatchObject({ round: { spectacle: first.round.spectacle } })
    expect(unlockedIds(msgs)).toEqual(['first_spin', 'big_win', 'mega_win'])
    // Con la fecha del momento de la tirada (el reloj avanzó 1 s después) y su temporada.
    const at = new Date(t.clock.now().getTime() - 1000).toISOString()
    for (const m of msgs.slice(2)) {
      expect(m).toMatchObject({
        achievement: { unlockedAt: at, seasonId: '2026-10', progress: null },
      })
    }

    window.received.length = 0
    const second = await play(t, user.id, { result: 7 })
    expect(second.round.spectacle).toMatchObject({ streak: 2, fire: 'none' })
    expect(unlockedIds(window.received)).toEqual([])

    window.received.length = 0
    const third = await play(t, user.id, { result: 7 })
    // Tres rojos seguidos llegan al aviso de la falacia (colorWarningAt = 3 en los tests).
    expect(third.round.spectacle).toMatchObject({ streak: 3, fire: 'ignite', fallacy: true })
    expect(unlockedIds(window.received)).toEqual(['on_fire'])
    expect(types(window.received).indexOf('round.resolved')).toBeLessThan(
      types(window.received).indexOf('achievement.unlocked'),
    )

    const fourth = await play(t, user.id, { result: 7 })
    expect(fourth.round.spectacle).toMatchObject({ streak: 4, fire: 'burning' })
    // Pierde: se apaga.
    const fifth = await play(t, user.id, { result: 8 })
    expect(fifth.round.spectacle).toMatchObject({ tier: 'none', streak: -1, fire: 'none' })
  })

  it('el verde: ¡VERDE! a secas, y con pleno al 0 "Todo al 0"; dos ceros, coleccionista', async () => {
    const { user } = await createWatchingUser(t, 'verde')
    const lost = await play(t, user.id, { result: 0 })
    expect(lost.round.spectacle).toMatchObject({ green: true, greenWin: false, tier: 'none' })
    const won = await play(t, user.id, { bets: [[STRAIGHT(0), 10]], result: 0 })
    expect(won.round.spectacle).toMatchObject({ green: true, greenWin: true, tier: 'straight' })
    const ids = (await achievementRows(t, user.id)).map(r => r.achievementId)
    expect(ids).toEqual(
      expect.arrayContaining(['first_spin', 'all_on_zero', 'zero_collector', 'mega_win']),
    )
  })

  it('falacia confirmada: con el aviso, al color contrario y pierde', async () => {
    const { user } = await createWatchingUser(t, 'falacia')
    for (let i = 0; i < 3; i++) await play(t, user.id, { result: 1 })
    await play(t, user.id, { bets: [[{ kind: 'black' }, 10]], result: 3 })
    const ids = (await achievementRows(t, user.id)).map(r => r.achievementId)
    expect(ids).toContain('fallacy_confirmed')
  })

  it('el jackpot un viernes (zona horaria de la temporada) y los tests que también apuestan', async () => {
    const own = await startTestApp()
    try {
      // Viernes 16 a las 12:00 en Madrid.
      own.clock.set('2026-10-16T10:00:00Z')
      const { user } = await createWatchingUser(own, 'viernes')
      const res = await play(own, user.id, { result: 1, gitPushOk: true, testFailed: true })
      expect(res.round.net).toBe(30)
      expect(res.round.spectacle).toMatchObject({ jackpot: true, bigWin: true, tier: 'win' })
      const ids = (await achievementRows(own, user.id)).map(r => r.achievementId)
      expect(ids).toEqual(expect.arrayContaining(['friday_push', 'tests_also_bet']))
      expect(ids).not.toContain('night_owl')

      // Jueves 22 a las 22:30 UTC, que en Madrid ya es viernes 23 a las 00:30: cuenta.
      const other = await createWatchingUser(own, 'viernes-utc')
      own.clock.set('2026-10-22T22:30:00Z')
      await play(own, other.user.id, { result: 1, gitPushOk: true })
      const ids2 = (await achievementRows(own, other.user.id)).map(r => r.achievementId)
      expect(ids2).toContain('friday_push')

      // Madrugada en Madrid (04:30): el logro secreto.
      own.clock.set('2026-10-20T02:30:00Z')
      const owl = await createWatchingUser(own, 'buho')
      await play(own, owl.user.id, { result: 2 })
      const ids3 = (await achievementRows(own, owl.user.id)).map(r => r.achievementId)
      expect(ids3).toContain('night_owl')
      expect(ids3).not.toContain('friday_push')
    } finally {
      await own.close()
    }
  })

  it('un jackpot en jueves no es "Push el viernes"', async () => {
    const { user } = await createWatchingUser(t, 'jueves')
    const res = await play(t, user.id, { result: 1, gitPushOk: true })
    expect(res.round.spectacle?.jackpot).toBe(true)
    const ids = (await achievementRows(t, user.id)).map(r => r.achievementId)
    expect(ids).not.toContain('friday_push')
  })
})

describe('bancarrota y banco', () => {
  it('BANCARROTA una sola vez por temporada; préstamos, recuperación y extracto del banco', async () => {
    const own = await startTestApp()
    try {
      const { user, window } = await createWatchingUser(own, 'ruina')
      if (!window) throw new Error('sin ventana')
      const broke = await play(own, user.id, { bets: [[{ kind: 'red' }, 'all-in']], result: 2 })
      expect(broke.wallet).toMatchObject({ balance: 0, netWorth: 0 })
      expect(broke.round.spectacle?.bankrupt).toBe(true)
      expect((await achievementRows(own, user.id)).map(r => r.achievementId)).toContain(
        'first_ruin',
      )

      // Primer préstamo (500 de deuda): no hay logro todavía; el aviso va detrás de loan.granted.
      window.received.length = 0
      await own.services.game.requestLoan(user.id)
      expect(types(window.received)).toEqual(['loan.granted'])

      // Dos tiradas sin fichas (la última apuesta no cabe): solo intereses, 550 y 605.
      const a = await play(own, user.id, { result: 2 })
      expect(a.round).toMatchObject({ source: 'none', interestCharged: 50 })
      expect(a.round.spectacle?.bankrupt).toBe(false)
      await play(own, user.id, { result: 2 })
      // Todo al rojo y pierde: patrimonio negativo, pero la bancarrota ya salió esta temporada.
      const c = await play(own, user.id, { bets: [[{ kind: 'red' }, 'all-in']], result: 2 })
      expect(c.wallet).toMatchObject({ balance: 0, debt: 666 })
      expect(c.round.spectacle?.bankrupt).toBe(false)

      // Segundo préstamo: "Deudor profesional" (2 en los tests) e "Interés compuesto" (≥ 700),
      // en el orden del catálogo y detrás de loan.granted.
      window.received.length = 0
      await own.services.game.requestLoan(user.id)
      expect(types(window.received)).toEqual([
        'loan.granted',
        'achievement.unlocked',
        'achievement.unlocked',
      ])
      expect(unlockedIds(window.received)).toEqual(['pro_debtor', 'compound_interest'])

      // Repite los 500 al rojo y pierde (1283); al día siguiente, otra sin fichas (1412).
      await play(own, user.id, { result: 2 })
      own.clock.advance(24 * 60 * 60 * 1000)
      const e = await play(own, user.id, { result: 2 })
      expect(e.wallet.debt).toBe(1412)

      const bank = await own.services.stats.bank(user.id)
      expect(bank).toMatchObject({
        seasonId: '2026-10',
        seasons: ['2026-10'],
        balance: 0,
        debt: 1412,
        netWorth: -1412,
        loans: 2,
        nextInterest: Math.ceil(1412 * 1.1) - 1412,
        canBorrow: true,
        truncated: true,
      })
      expect(bank.history).toEqual([
        expect.objectContaining({ kind: 'interest', day: '2026-10-16', spins: 1, amount: 129 }),
        expect.objectContaining({ kind: 'interest', day: '2026-10-15', spins: 1, amount: 117 }),
        expect.objectContaining({ kind: 'loan', amount: 500, debtAfter: 1166 }),
        expect.objectContaining({ kind: 'interest', day: '2026-10-15', spins: 3, amount: 166 }),
      ])
      expect(bank.history.map(h => h.debtAfter)).toEqual([1412, 1283, 1166, 666])

      // Recupera: un pleno con el préstamo que queda… primero hace falta saldo: un tercero.
      await own.services.game.requestLoan(user.id)
      const back = await play(own, user.id, { bets: [[STRAIGHT(7), 'all-in']], result: 7 })
      expect(back.wallet.netWorth).toBeGreaterThan(0)
      expect((await achievementRows(own, user.id)).map(r => r.achievementId)).toContain('comeback')

      // Temporada nueva: la bancarrota vuelve a salir (una vez por temporada).
      own.clock.set('2026-11-02T10:00:00Z')
      await own.services.seasons.tick()
      const nov = await play(own, user.id, { bets: [[{ kind: 'red' }, 'all-in']], result: 2 })
      expect(nov.wallet.seasonId).toBe('2026-11')
      expect(nov.round.spectacle?.bankrupt).toBe(true)
      const again = await play(own, user.id, { result: 2 })
      expect(again.round.spectacle?.bankrupt).toBe(false)
      const rows = await own.db.db
        .select({ season: wallets.seasonId, brokeAt: wallets.brokeAt })
        .from(wallets)
        .where(eq(wallets.userId, user.id))
      expect(rows.every(r => r.brokeAt !== null)).toBe(true)

      // El banco de la temporada pasada sigue ahí, sin intereses futuros ni préstamos.
      const oct = await own.services.stats.bank(user.id, '2026-10')
      expect(oct).toMatchObject({ seasonId: '2026-10', nextInterest: 0, canBorrow: false })
      expect(oct.seasons).toEqual(['2026-11', '2026-10'])
      // "Primera ruina" no se repite: una fila por logro.
      const ruins = (await achievementRows(own, user.id)).filter(
        r => r.achievementId === 'first_ruin',
      )
      expect(ruins).toHaveLength(1)
      expect(ruins[0]?.seasonId).toBe('2026-10')
    } finally {
      await own.close()
    }
  })
})

describe('logros', () => {
  it('cada logro se desbloquea una sola vez aunque lleguen turnos a la vez', async () => {
    const { user, window } = await createWatchingUser(t, 'concurrente')
    if (!window) throw new Error('sin ventana')
    t.rng.fix(1)
    await Promise.all(
      Array.from({ length: 8 }, () =>
        t.services.game.turnEnd(user.id, {
          v: 1,
          turnId: turnId(),
          durationMs: 5,
          gitPushOk: false,
          testFailed: false,
          ...MOD_META,
        }),
      ),
    )
    const rows = await achievementRows(t, user.id)
    expect(rows.filter(r => r.achievementId === 'first_spin')).toHaveLength(1)
    expect(unlockedIds(window.received).filter(id => id === 'first_spin')).toHaveLength(1)
    // 8 tiradas ≥ 6 (addictSpins de los tests): "Lo dejo cuando quiera", también una vez.
    expect(rows.filter(r => r.achievementId === 'addict')).toHaveLength(1)
    expect(new Set(rows.map(r => r.achievementId)).size).toBe(rows.length)
  })

  it('el reintento de un turn/end no vuelve a anunciar logros', async () => {
    const { user, window } = await createWatchingUser(t, 'reintento')
    if (!window) throw new Error('sin ventana')
    const id = turnId()
    await play(t, user.id, { result: 1, id })
    const before = window.received.length
    t.rng.fix(1)
    const again = await t.services.game.turnEnd(user.id, {
      v: 1,
      turnId: id,
      durationMs: 5,
      gitPushOk: false,
      testFailed: false,
      ...MOD_META,
    })
    expect(again.status).toBe('resolved')
    expect(window.received.length).toBe(before)
  })

  it('cola llena: el logro llega detrás de `pending`', async () => {
    const { user, bearer, window } = await createUser(t, 'acaparador', { window: 'hidden' })
    if (!window) throw new Error('sin ventana')
    const max = t.config.game.pendingSpins.max
    for (let i = 0; i < max; i++) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/turn/end',
        headers: bearer,
        payload: {
          v: 1,
          turnId: turnId(),
          durationMs: 5,
          gitPushOk: false,
          testFailed: false,
          ...MOD_META,
        },
      })
      expect(res.json()).toMatchObject({ status: 'queued', dropped: false })
    }
    expect(types(window.received).slice(-2)).toEqual(['pending', 'achievement.unlocked'])
    expect(unlockedIds(window.received)).toEqual(['queue_full'])
    // Con la cola llena, el siguiente prompt se descarta y el logro no se repite.
    await t.app.inject({
      method: 'POST',
      url: '/api/turn/end',
      headers: bearer,
      payload: {
        v: 1,
        turnId: turnId(),
        durationMs: 5,
        gitPushOk: false,
        testFailed: false,
        ...MOD_META,
      },
    })
    expect(types(window.received).at(-1)).toBe('pending')
    const rows = await achievementRows(t, user.id)
    expect(rows.map(r => r.achievementId)).toEqual(['queue_full'])
  })

  it('/api/me y el estado traen el catálogo entero con progreso y secretos', async () => {
    const { user, bearer } = await createUser(t, 'catalogo')
    const me = meResponseSchema.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: bearer })).json(),
    )
    expect(me.achievements?.map(a => a.id)).toEqual([...ACHIEVEMENT_IDS])
    expect(me.achievements?.every(a => a.unlockedAt === null && a.seasonId === null)).toBe(true)
    const byId = new Map(me.achievements?.map(a => [a.id, a]))
    expect(byId.get('pro_debtor')?.progress).toEqual({ current: 0, goal: 2 })
    expect(byId.get('queue_full')?.progress).toEqual({ current: 0, goal: 3 })
    expect(byId.get('zero_collector')?.progress).toEqual({ current: 0, goal: 2 })
    expect(byId.get('first_spin')?.progress).toBeNull()
    expect(byId.get('night_owl')?.hidden).toBe(true)

    await t.services.game.placeBet(user.id, STRAIGHT(0), 10)
    t.rng.fix(0)
    await t.app.inject({
      method: 'POST',
      url: '/api/turn/end',
      headers: bearer,
      payload: {
        v: 1,
        turnId: turnId(),
        durationMs: 5,
        gitPushOk: false,
        testFailed: false,
        ...MOD_META,
      },
    })
    // Sin ventana se guardó como pendiente: la gasta para que cuente.
    t.clock.advance(1)
    await t.services.game.spendPending(user.id, { quick: true, requestId: `req-${turnId()}` })
    const state = await t.services.game.state(user.id)
    const after = new Map(state.achievements.map(a => [a.id, a]))
    expect(after.get('all_on_zero')).toMatchObject({ seasonId: '2026-10', progress: null })
    expect(after.get('all_on_zero')?.unlockedAt).not.toBeNull()
    expect(after.get('zero_collector')?.progress).toEqual({ current: 1, goal: 2 })
    t.clock.advance(t.config.game.spin.minSpinMs)
  })

  it('se borran en cascada con la cuenta', async () => {
    const { user } = await createWatchingUser(t, 'borrame')
    await play(t, user.id, { result: 1 })
    expect((await achievementRows(t, user.id)).length).toBeGreaterThan(0)
    await t.services.auth.deleteAccount(user, 'borrame')
    expect(await achievementRows(t, user.id)).toHaveLength(0)
  })
})

describe('estadísticas', () => {
  it('serie muestreada, últimas tiradas, número más repetido y mayor premio', async () => {
    const own = await startTestApp()
    try {
      const { user } = await createWatchingUser(own, 'stats')
      const empty = await own.services.stats.stats(user.id)
      expect(empty).toMatchObject({
        seasonId: '2026-10',
        spins: 0,
        series: [{ spin: 0, netWorth: 1000 }],
        peakNetWorth: 1000,
        lowestNetWorth: 1000,
        recent: [],
        mostFrequent: null,
        biggestWin: null,
        loanMarks: [],
      })

      await play(own, user.id, { result: 1 }) // +10 → 1010
      await play(own, user.id, { result: 2 }) // −10 → 1000
      await play(own, user.id, { result: 2 }) // −10 → 990
      const big = await play(own, user.id, { bets: [[STRAIGHT(2), 10]], result: 2 }) // → 1340
      await play(own, user.id, { result: 5 }) // −10 → 1330
      await play(own, user.id, { result: 2 }) // +350 → 1680 (empata, pero es posterior)
      await play(own, user.id, { result: 2 }) // +350 → 2030

      const s = await own.services.stats.stats(user.id)
      // 7 tiradas y 5 puntos como mucho: cada 3, más la última y el saldo inicial.
      expect(s.series).toEqual([
        { spin: 0, netWorth: 1000 },
        { spin: 3, netWorth: 990 },
        { spin: 6, netWorth: 1680 },
        { spin: 7, netWorth: 2030 },
      ])
      expect(s.series.length).toBeLessThanOrEqual(own.config.game.stats.seriesPoints)
      expect(s).toMatchObject({ spins: 7, peakNetWorth: 2030, lowestNetWorth: 990, loanMarks: [] })
      expect(s.recent.map(r => [r.result, r.net])).toEqual([
        [2, 350],
        [2, 350],
        [5, -10],
        [2, 350],
      ])
      expect(s.mostFrequent).toEqual({ result: 2, color: 'black', count: 5 })
      expect(s.biggestWin).toMatchObject({ roundId: big.round.roundId, net: 350, staked: 10 })

      // Préstamo: su marca cae tras la tirada en la que se pidió.
      await play(own, user.id, { bets: [[{ kind: 'red' }, 'all-in']], result: 2 })
      await own.services.game.requestLoan(user.id)
      await play(own, user.id, { result: 2 })
      const s2 = await own.services.stats.stats(user.id)
      expect(s2.loanMarks).toEqual([8])
      expect(s2.lowestNetWorth).toBe(-50)
      expect(s2.series.at(-1)).toEqual({ spin: 9, netWorth: -50 })

      expect(await codeOf(own.services.stats.stats(user.id, '2026-09'))).toBe('not_found')
      expect(await codeOf(own.services.stats.bank(user.id, '1999-01'))).toBe('not_found')
    } finally {
      await own.close()
    }
  })

  it('los rankings no cambian con las columnas nuevas', async () => {
    const { user } = await createWatchingUser(t, 'ranking-v2')
    await play(t, user.id, { result: 1 })
    const res = await t.app.inject({ method: 'GET', url: '/api/leaderboard?board=rich' })
    expect(res.statusCode).toBe(200)
    const [row] = await t.db.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, user.id), eq(wallets.seasonId, '2026-10')))
    expect(row?.brokeAt).toBeNull()
  })
})
