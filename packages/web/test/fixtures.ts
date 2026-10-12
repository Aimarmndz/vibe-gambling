// SPDX-License-Identifier: AGPL-3.0-or-later
// Datos de prueba que cumplen el contrato de shared (se validan al construirlos).
import {
  PROTOCOL_VERSION,
  gameConfigSchema,
  resolvedRoundSchema,
  serverMessageSchema,
  toPublicGameConfig,
  walletSchema,
  webConfigSchema,
} from '@vibe-gambling/shared'
import type { ResolvedRound, ServerMessage, Wallet, WebConfig } from '@vibe-gambling/shared'

/** Configuración del juego de los tests (propia, no la de config/game.json). */
export const testGame = gameConfigSchema.parse({
  startingBalance: 500,
  chips: [5, 25, 100],
  allIn: true,
  maxBetsPerRound: 3,
  defaultBet: { selection: { kind: 'black' }, amount: 5 },
  loan: { amount: 300, displayApr: 999, interestPerSpin: 0.1, maxDebt: 1_000_000 },
  jackpot: { gitPushMultiplier: 3 },
  season: { timeZone: 'UTC', startDay: 1 },
  hallOfRuinSize: 5,
  spin: { minSpinMs: 1000 },
  round: { staleAfterMs: 60_000 },
  streak: { colorWarningAt: 3, historySize: 20 },
})

export const testWebConfig: WebConfig = webConfigSchema.parse({
  v: PROTOCOL_VERSION,
  publicUrl: 'http://test.invalid',
  instanceName: 'test',
  isOfficial: false,
  serverVersion: '0.0.0-test',
  game: toPublicGameConfig(testGame),
  site: {
    author: { name: 'Tester', url: 'https://example.invalid/tester' },
    repoUrl: 'https://example.invalid/repo',
    installCommand: '/plugin install test',
    helpLinks: { en: [{ label: 'Help', url: 'https://example.invalid/help' }], es: [] },
    moreProjects: [],
  },
})

export function wallet(patch: Partial<Wallet> = {}): Wallet {
  const base = {
    seasonId: '2026-10',
    balance: 500,
    debt: 0,
    spins: 0,
    loans: 0,
    currentStreak: 0,
    bestStreak: 0,
  }
  const w = { ...base, ...patch }
  return walletSchema.parse({ ...w, netWorth: w.balance - w.debt })
}

export const user = {
  login: 'tester',
  avatarUrl: 'https://example.invalid/a.png',
  profileUrl: 'https://example.invalid/tester',
  hidden: false,
  locale: null,
  createdAt: '2026-10-01T00:00:00.000Z',
}

export const ROUND_ID = '0b9a8d3c-6a39-4c4e-9f7b-1f9a6c2d3e41'
export const ROUND_ID_2 = '1c8b7e4d-5b28-4d3f-8e6a-2e8b5d1c4f52'

export function resolved(patch: Partial<ResolvedRound> = {}): ResolvedRound {
  return resolvedRoundSchema.parse({
    roundId: ROUND_ID,
    openedAt: '2026-10-12T10:00:00.000Z',
    resolvedAt: '2026-10-12T10:00:02.000Z',
    result: 17,
    color: 'black',
    bets: [{ selection: { kind: 'straight', numbers: [17] }, amount: 25, won: true, payout: 900 }],
    source: 'slip',
    staked: 25,
    returned: 900,
    net: 875,
    jackpot: false,
    gitPushOk: false,
    testFailed: false,
    interestCharged: 0,
    colorStreak: { color: 'black', count: 1 },
    revealAt: '2026-10-12T10:00:04.000Z',
    ...patch,
  })
}

export function msg(m: unknown): ServerMessage {
  return serverMessageSchema.parse({ v: PROTOCOL_VERSION, ...(m as object) })
}
