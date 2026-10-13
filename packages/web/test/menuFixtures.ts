// SPDX-License-Identifier: AGPL-3.0-or-later
// Contexto y canvas de mentira para probar el menú v2 sin navegador: lo que pintan las páginas se
// apunta (texto y color) y lo que mandan al servidor también.
import { ACHIEVEMENTS, achievementParams } from '@vibe-gambling/shared'
import type {
  Achievement,
  AchievementId,
  BankStatement,
  Locale,
  SeasonStats,
} from '@vibe-gambling/shared'
import { vi } from 'vitest'

import type { AppContext } from '../src/app/context.ts'
import { DEFAULT_PREFS } from '../src/app/prefs.ts'
import type { Prefs } from '../src/app/prefs.ts'
import { clientConfig } from '../src/config.ts'
import { AchievementBook } from '../src/game/achievements.ts'
import { INITIAL_STATE } from '../src/game/state.ts'
import type { GameState } from '../src/game/state.ts'
import type { ProgressData, ProgressKind } from '../src/net/progress.ts'
import { Hits } from '../src/ui/draw.ts'
import { msg, testGame, testWebConfig, user, wallet } from './fixtures.ts'
import { translator } from './translators.ts'

/** Canvas 2D que no pinta nada (los textos se apuntan con el mock de `drawText`). */
export function fakeCanvas2d(): CanvasRenderingContext2D {
  const noop = () => undefined
  const gradient = { addColorStop: noop }
  return new Proxy({ canvas: { width: 320, height: 240 } } as Record<string | symbol, unknown>, {
    get: (target, key) =>
      key in target ? target[key] : key === 'createLinearGradient' ? () => gradient : noop,
    set: () => true,
  }) as unknown as CanvasRenderingContext2D
}

export function achievementsFixture(unlocked: readonly AchievementId[] = []): Achievement[] {
  return ACHIEVEMENTS.map(def => ({
    id: def.id,
    hidden: def.hidden,
    unlockedAt: unlocked.includes(def.id) ? '2026-10-03T18:00:00.000Z' : null,
    seasonId: unlocked.includes(def.id) ? '2026-10' : null,
    params: achievementParams(def.id, testGame),
    progress:
      def.id === 'pro_debtor' && !unlocked.includes(def.id) ? { current: 1, goal: 2 } : null,
  }))
}

export const STATS: SeasonStats = {
  seasonId: '2026-10',
  seasons: ['2026-10', '2026-09'],
  spins: 4,
  bestStreak: 2,
  series: [
    { spin: 0, netWorth: 500 },
    { spin: 1, netWorth: 700 },
    { spin: 2, netWorth: -100 },
    { spin: 4, netWorth: -300 },
  ],
  peakNetWorth: 700,
  lowestNetWorth: -300,
  loanMarks: [2],
  recent: [
    {
      roundId: '0b9a8d3c-6a39-4c4e-9f7b-1f9a6c2d3e41',
      resolvedAt: '2026-10-12T10:00:02.000Z',
      result: 0,
      color: 'green',
      staked: 25,
      net: -25,
    },
  ],
  mostFrequent: { result: 0, color: 'green', count: 2 },
  biggestWin: {
    roundId: '1c8b7e4d-5b28-4d3f-8e6a-2e8b5d1c4f52',
    resolvedAt: '2026-10-11T10:00:02.000Z',
    result: 17,
    color: 'black',
    staked: 25,
    net: 875,
  },
}

export const BANK: BankStatement = {
  seasonId: '2026-10',
  seasons: ['2026-10'],
  balance: 2,
  debt: 330,
  netWorth: -328,
  loans: 1,
  nextInterest: 33,
  canBorrow: true,
  history: [
    {
      kind: 'interest',
      day: '2026-10-12',
      from: '2026-10-12T10:00:00.000Z',
      to: '2026-10-12T11:00:00.000Z',
      spins: 1,
      amount: 30,
      debtAfter: 330,
    },
    { kind: 'loan', at: '2026-10-11T09:00:00.000Z', amount: 300, debtAfter: 300 },
  ],
  truncated: true,
}

export interface FakeContextOptions {
  locale?: Locale
  state?: Partial<GameState>
  demo?: boolean
  reducedMotion?: boolean
  achievements?: Achievement[] | null
  loanAvailable?: boolean
}

export type FakeContext = AppContext & {
  sent: unknown[]
  announced: string[]
  sounds: string[]
  popped: number
  pushed: unknown[]
  links: string[]
  prefsSet: Partial<Prefs>[]
  logouts: number
  loans: number
  spinOne: ReturnType<typeof vi.fn<() => boolean>>
  spinEvery: ReturnType<typeof vi.fn<() => boolean>>
  hover: string | null
  progressCalls: [ProgressKind, string | undefined][]
  progressReply: { stats: Promise<SeasonStats>; bank: Promise<BankStatement> }
}

export function fakeContext(opts: FakeContextOptions = {}): FakeContext {
  const tr = translator(opts.locale ?? 'es')
  let state: GameState = {
    ...INITIAL_STATE,
    user,
    wallet: wallet({ pendingSpins: 3, spins: 4, debt: 330, balance: 2, loans: 1 }),
    shown: wallet({ pendingSpins: 3, spins: 4, debt: 330, balance: 2, loans: 1 }),
    ...opts.state,
  }
  const book = new AchievementBook(null)
  if (opts.achievements !== null) {
    book.receive(
      msg({
        type: 'hello',
        user,
        wallet: state.wallet,
        slip: { bets: [], total: 0 },
        round: null,
        lastRound: null,
        serverTime: '2026-10-12T10:00:00.000Z',
        achievements: opts.achievements ?? achievementsFixture(['first_spin', 'night_owl']),
      }),
    )
  }
  const ctx: FakeContext = {
    web: testWebConfig,
    client: clientConfig,
    demo: opts.demo ?? false,
    reducedMotion: opts.reducedMotion ?? true,
    hits: new Hits(),
    sfx: { play: (name: string) => ctx.sounds.push(name) } as unknown as AppContext['sfx'],
    tr,
    prefs: { ...DEFAULT_PREFS, locale: tr.locale },
    sent: [],
    announced: [],
    sounds: [],
    popped: 0,
    pushed: [],
    links: [],
    prefsSet: [],
    logouts: 0,
    loans: 0,
    hover: null,
    progressCalls: [],
    progressReply: { stats: Promise.resolve(STATS), bank: Promise.resolve(BANK) },
    spinOne: vi.fn<() => boolean>(() => true),
    spinEvery: vi.fn<() => boolean>(() => true),
    setPrefs: patch => {
      ctx.prefsSet.push(patch)
      ctx.prefs = { ...ctx.prefs, ...patch }
    },
    state: () => state,
    send: m => {
      ctx.sent.push(m)
      return true
    },
    push: s => void ctx.pushed.push(s),
    pop: () => void ctx.popped++,
    toast: text => void ctx.announced.push(text),
    buttons: () => ({ x: 'X', o: 'O', tri: 'C', sq: 'Z', start: 'P', sel: 'G' }),
    hoverId: () => ctx.hover,
    openLink: url => void ctx.links.push(url),
    minChip: () => 5,
    loanAvailable: () => opts.loanAvailable ?? false,
    connection: () => 'open',
    showTip: () => undefined,
    offerLoan: () => void ctx.loans++,
    leaderboard: () => new Promise(() => undefined),
    brokeRank: () => Promise.resolve(null),
    spinPending: () => ctx.spinOne(),
    spinAllPending: () => ctx.spinEvery(),
    spinAll: () => ({ running: false, spun: 0, ended: null }),
    showPending: () => undefined,
    announce: text => void ctx.announced.push(text),
    menuIcons: () => ({ icon: () => undefined }),
    progress: <K extends ProgressKind>(kind: K, seasonId?: string) => {
      ctx.progressCalls.push([kind, seasonId])
      return ctx.progressReply[kind] as Promise<ProgressData[K]>
    },
    achievements: () => book,
    hallOfRuin: () => Promise.resolve({ v: 1, seasons: [] }),
    logout: () => void ctx.logouts++,
  }
  Object.defineProperty(ctx, 'setState', {
    value: (patch: Partial<GameState>) => (state = { ...state, ...patch }),
  })
  return ctx
}

/** Cambia el estado del contexto de mentira. */
export function setState(ctx: FakeContext, patch: Partial<GameState>): void {
  ;(ctx as unknown as { setState: (p: Partial<GameState>) => void }).setState(patch)
}
