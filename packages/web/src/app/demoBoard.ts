// SPDX-License-Identifier: AGPL-3.0-or-later
// Ranking del modo demo: el jugador local y unos cuantos bots evidentes. No sale del navegador.
import { LEADERBOARD_BOARDS, PROTOCOL_VERSION } from '@vibe-gambling/shared'
import type { LeaderboardBoard, LeaderboardResponse, LeaderboardRow } from '@vibe-gambling/shared'

import type { GameState } from '../game/state.ts'

/** Bots de la demo: nombres que no pueden confundirse con cuentas reales. */
const BOTS: readonly [string, number, number, number][] = [
  ['demo-bot-the-house', 250_000, 0, 999],
  ['demo-bot-martingale', -48_210, 52_000, 310],
  ['demo-bot-yolo', -9_870, 11_000, 120],
  ['demo-bot-cautious', 1_150, 0, 15],
  ['demo-bot-zero-fan', -2_400, 3_000, 77],
]

export function demoLeaderboard(
  board: LeaderboardBoard,
  state: GameState,
  login: string,
): LeaderboardResponse {
  const avatarUrl = new URL('/favicon.svg', window.location.origin).toString()
  const rows: Omit<LeaderboardRow, 'rank'>[] = BOTS.map(([name, net, debt, spins], i) => ({
    login: name,
    avatarUrl,
    profileUrl: 'https://github.com/',
    netWorth: net,
    balance: net + debt,
    debt,
    spins,
    currentStreak: (i % 3) - 1,
    bestStreak: i,
  }))
  const w = state.shown
  if (w) {
    rows.push({
      login,
      avatarUrl,
      profileUrl: 'https://github.com/',
      netWorth: w.netWorth,
      balance: w.balance,
      debt: w.debt,
      spins: w.spins,
      currentStreak: w.currentStreak,
      bestStreak: w.bestStreak,
    })
  }
  const sorted = [...rows].sort((a, b) =>
    board === 'broke'
      ? a.netWorth - b.netWorth
      : board === 'rich'
        ? b.netWorth - a.netWorth
        : b.spins - a.spins,
  )
  return {
    v: PROTOCOL_VERSION,
    season: w?.seasonId ?? '2000-01',
    board: LEADERBOARD_BOARDS.includes(board) ? board : 'broke',
    seasons: w ? [w.seasonId] : [],
    rows: sorted.map((row, i) => ({ ...row, rank: i + 1 })),
    players: sorted.length,
  }
}
