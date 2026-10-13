// SPDX-License-Identifier: AGPL-3.0-or-later
// ESTADÍSTICAS, BANCO y LOGROS del modo demo: el "servidor" del navegador apunta cada tirada y
// cada préstamo y contesta `stats.request` / `bank.request` con la misma forma que el de verdad
// (esquemas de shared). `showcaseSeason` juega una temporada de ejemplo con azar fijo para las
// capturas: siempre sale igual.
import {
  ACHIEVEMENTS,
  accrueInterest,
  achievementParams,
  achievementProgress,
  applyLoan,
  bestStreak,
  canRequestLoan,
  colorOf,
  colorStreak,
  netWorth,
  nextStreak,
  resolveBets,
  seasonBounds,
  zonedParts,
} from '@vibe-gambling/shared'
import type {
  Achievement,
  AchievementId,
  BankEntry,
  BankStatement,
  Bet,
  GameConfig,
  ResolvedRound,
  RoundSummary,
  SeasonStats,
  Wallet,
} from '@vibe-gambling/shared'

export interface DemoLimits {
  recentRounds: number
  seriesPoints: number
  loanMarks: number
  bankHistory: number
}

interface DemoRound {
  spin: number
  summary: RoundSummary
  netWorthAfter: number
  /** Intereses que sumó esta tirada a la deuda, y la deuda tras ella. */
  interest: number
  debtAfter: number
}

interface DemoLoan {
  at: string
  amount: number
  debtAfter: number
  /** Tiradas jugadas cuando se pidió (▼ en la gráfica). */
  afterSpin: number
}

/** Pseudoazar fijo (mulberry32): la temporada de ejemplo siempre es la misma. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Reduce una serie a `max` puntos como mucho, conservando siempre el primero y el último. */
export function sampleSeries<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points]
  const out: T[] = []
  for (let i = 0; i < max; i++) out.push(points[Math.round((i * (points.length - 1)) / (max - 1))]!)
  return out
}

/** Día de pared (`AAAA-MM-DD`) de un instante en la zona horaria de la temporada. */
export function wallDay(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export class DemoProgress {
  private readonly cfg: GameConfig
  private readonly limits: DemoLimits
  private rounds: DemoRound[] = []
  private loans: DemoLoan[] = []
  private readonly unlocked = new Map<AchievementId, { at: string; seasonId: string }>()

  constructor(cfg: GameConfig, limits: DemoLimits) {
    this.cfg = cfg
    this.limits = limits
  }

  /** Apunta una tirada resuelta con la cartera de después. */
  recordRound(
    round: Pick<
      ResolvedRound,
      'roundId' | 'resolvedAt' | 'result' | 'color' | 'staked' | 'net' | 'interestCharged'
    >,
    wallet: Wallet,
  ): void {
    this.rounds.push({
      spin: wallet.spins,
      summary: {
        roundId: round.roundId,
        resolvedAt: round.resolvedAt,
        result: round.result,
        color: round.color,
        staked: round.staked,
        net: round.net,
      },
      netWorthAfter: wallet.netWorth,
      interest: round.interestCharged,
      debtAfter: wallet.debt,
    })
  }

  recordLoan(at: string, amount: number, wallet: Wallet): void {
    this.loans.push({ at, amount, debtAfter: wallet.debt, afterSpin: wallet.spins })
  }

  /** Da un logro por conseguido. Devuelve false si ya lo estaba. */
  unlock(id: AchievementId, at: string, seasonId: string): boolean {
    if (this.unlocked.has(id)) return false
    this.unlocked.set(id, { at, seasonId })
    return true
  }

  /** Borra lo apuntado (temporada de ejemplo nueva). */
  reset(): void {
    this.rounds = []
    this.loans = []
    this.unlocked.clear()
  }

  stats(wallet: Wallet): SeasonStats {
    const start = { spin: 0, netWorth: this.cfg.startingBalance }
    const all = [start, ...this.rounds.map(r => ({ spin: r.spin, netWorth: r.netWorthAfter }))]
    const values = all.map(p => p.netWorth)
    const counts = new Map<number, number>()
    for (const r of this.rounds)
      counts.set(r.summary.result, (counts.get(r.summary.result) ?? 0) + 1)
    let most: SeasonStats['mostFrequent'] = null
    for (const [result, count] of [...counts].sort((a, b) => a[0] - b[0])) {
      if (!most || count > most.count) most = { result, color: colorOf(result), count }
    }
    const wins = this.rounds.filter(r => r.summary.net > 0)
    const biggest = wins.reduce<RoundSummary | null>(
      (best, r) => (!best || r.summary.net > best.net ? r.summary : best),
      null,
    )
    return {
      seasonId: wallet.seasonId,
      seasons: [wallet.seasonId],
      spins: wallet.spins,
      bestStreak: wallet.bestStreak,
      series: sampleSeries(all, this.limits.seriesPoints),
      peakNetWorth: Math.max(...values),
      lowestNetWorth: Math.min(...values),
      loanMarks: this.loans.map(l => l.afterSpin).slice(-this.limits.loanMarks),
      recent: this.rounds
        .slice(-this.limits.recentRounds)
        .reverse()
        .map(r => r.summary),
      mostFrequent: most,
      biggestWin: biggest,
    }
  }

  bank(wallet: Wallet): BankStatement {
    const tz = this.cfg.season.timeZone
    type Event =
      | { kind: 'loan'; at: string; loan: DemoLoan }
      | { kind: 'interest'; at: string; round: DemoRound }
    const events: Event[] = [
      ...this.loans.map(loan => ({ kind: 'loan' as const, at: loan.at, loan })),
      ...this.rounds
        .filter(r => r.interest > 0)
        .map(round => ({ kind: 'interest' as const, at: round.summary.resolvedAt, round })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    // Intereses agrupados por día de pared y por tramo entre préstamos (como el servidor).
    const history: BankEntry[] = []
    for (const e of events) {
      if (e.kind === 'loan') {
        history.push({ kind: 'loan', at: e.at, amount: e.loan.amount, debtAfter: e.loan.debtAfter })
        continue
      }
      const day = wallDay(e.at, tz)
      const last = history[history.length - 1]
      if (last?.kind === 'interest' && last.day === day) {
        last.to = e.at
        last.spins += 1
        last.amount += e.round.interest
        last.debtAfter = e.round.debtAfter
      } else {
        history.push({
          kind: 'interest',
          day,
          from: e.at,
          to: e.at,
          spins: 1,
          amount: e.round.interest,
          debtAfter: e.round.debtAfter,
        })
      }
    }
    const newest = history.reverse()
    return {
      seasonId: wallet.seasonId,
      seasons: [wallet.seasonId],
      balance: wallet.balance,
      debt: wallet.debt,
      netWorth: wallet.netWorth,
      loans: wallet.loans,
      nextInterest: accrueInterest(wallet.debt, this.cfg) - wallet.debt,
      canBorrow: canRequestLoan(wallet.balance, this.cfg, wallet.debt),
      history: newest.slice(0, this.limits.bankHistory),
      truncated: newest.length > this.limits.bankHistory,
    }
  }

  achievements(wallet: Wallet): Achievement[] {
    const rules = { ...this.cfg, streak: this.cfg.streak }
    const snap = {
      loans: wallet.loans,
      debt: wallet.debt,
      spins: wallet.spins,
      bestStreak: wallet.bestStreak,
      pendingSpins: wallet.pendingSpins,
      lifetimeZeros: this.rounds.filter(r => r.summary.result === 0).length,
    }
    return ACHIEVEMENTS.map(def => {
      const got = this.unlocked.get(def.id)
      return {
        id: def.id,
        hidden: def.hidden,
        unlockedAt: got?.at ?? null,
        seasonId: got?.seasonId ?? null,
        params: achievementParams(def.id, rules),
        progress: achievementProgress(def.id, snap, rules, got !== undefined),
      }
    })
  }
}

export interface ShowcaseOptions {
  seed: number
  spins: number
  pending: number
}

/** Logros conseguidos en la temporada de ejemplo y el día (de la temporada) en que se lograron. */
const SHOWCASE_UNLOCKED: readonly [AchievementId, number][] = [
  ['first_spin', 1],
  ['first_ruin', 3],
  ['big_win', 4],
  ['tests_also_bet', 6],
  ['friday_push', 10],
  ['all_on_zero', 11],
  ['night_owl', 12],
]

/** Apuestas de la temporada de ejemplo, en rotación (la casa siempre gana a la larga). */
const SHOWCASE_BETS: readonly Bet[][] = [
  [{ selection: { kind: 'red' }, amount: 50 }],
  [
    { selection: { kind: 'red' }, amount: 50 },
    { selection: { kind: 'straight', numbers: [17] }, amount: 100 },
  ],
  [{ selection: { kind: 'black' }, amount: 100 }],
  [{ selection: { kind: 'dozen', index: 2 }, amount: 50 }],
  [{ selection: { kind: 'straight', numbers: [0] }, amount: 10 }],
]

/**
 * Juega en `progress` una temporada de ejemplo con azar fijo (préstamos incluidos) hasta
 * `nowMs` y devuelve la cartera final, los números que salieron y la última apuesta.
 */
export function showcaseSeason(
  progress: DemoProgress,
  cfg: GameConfig,
  wallet: Wallet,
  opts: ShowcaseOptions,
  nowMs: number,
): { wallet: Wallet; history: number[]; lastBets: Bet[]; lastRound: ResolvedRound | null } {
  progress.reset()
  const rnd = seededRandom(opts.seed)
  const bounds = seasonBounds(wallet.seasonId, cfg.season.timeZone, cfg.season.startDay)
  const from = bounds.startsAt.getTime()
  const span = Math.max(1, nowMs - from - 3_600_000)
  let w: Wallet = {
    ...wallet,
    balance: cfg.startingBalance,
    debt: 0,
    netWorth: cfg.startingBalance,
    spins: 0,
    loans: 0,
    currentStreak: 0,
    bestStreak: 0,
    pendingSpins: 0,
  }
  const history: number[] = []
  let lastBets: Bet[] = []
  let lastRound: ResolvedRound | null = null
  for (let i = 0; i < opts.spins; i++) {
    const at = new Date(from + Math.round(((i + 1) / (opts.spins + 1)) * span))
    let bets = SHOWCASE_BETS[i % SHOWCASE_BETS.length]!
    let stake = bets.reduce((s, b) => s + b.amount, 0)
    if (stake > w.balance && canRequestLoan(w.balance, cfg, w.debt)) {
      const after = applyLoan(w.balance, w.debt, cfg)
      w = { ...w, ...after, netWorth: netWorth(after.balance, after.debt), loans: w.loans + 1 }
      progress.recordLoan(new Date(at.getTime() - 60_000).toISOString(), cfg.loan.amount, w)
    }
    if (stake > w.balance) {
      bets = [{ selection: { kind: 'red' }, amount: Math.min(...cfg.chips) }]
      stake = bets[0]!.amount
    }
    const result = Math.floor(rnd() * 37)
    const outcome = resolveBets(bets, result)
    const debt = accrueInterest(w.debt, cfg)
    const balance = w.balance - stake + outcome.returned
    const current = nextStreak(w.currentStreak, outcome.net)
    const interest = debt - w.debt
    w = {
      ...w,
      balance,
      debt,
      netWorth: netWorth(balance, debt),
      spins: w.spins + 1,
      currentStreak: current,
      bestStreak: bestStreak(w.bestStreak, current),
    }
    const round = {
      roundId: crypto.randomUUID(),
      resolvedAt: at.toISOString(),
      result,
      color: colorOf(result),
      staked: outcome.staked,
      net: outcome.net,
      interestCharged: interest,
    }
    progress.recordRound(round, w)
    history.push(result)
    lastBets = bets
    lastRound = {
      ...round,
      openedAt: new Date(at.getTime() - cfg.spin.minSpinMs).toISOString(),
      bets: outcome.outcomes.map(o => ({
        selection: o.bet.selection,
        amount: o.bet.amount,
        won: o.won,
        payout: o.payout,
      })),
      source: 'repeat',
      returned: outcome.returned,
      jackpot: false,
      gitPushOk: false,
      testFailed: false,
      colorStreak: colorStreak(history.slice(-cfg.streak.historySize)),
      revealAt: round.resolvedAt,
    }
  }
  w = { ...w, pendingSpins: opts.pending }
  for (const [id, day] of SHOWCASE_UNLOCKED) {
    const at = new Date(Math.min(nowMs, from + (day - 1) * 86_400_000 + 20 * 3_600_000))
    progress.unlock(id, at.toISOString(), w.seasonId)
  }
  return { wallet: w, history, lastBets, lastRound }
}
