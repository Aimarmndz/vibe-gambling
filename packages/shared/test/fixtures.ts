// SPDX-License-Identifier: AGPL-3.0-or-later
// Configuración del juego para los tests: se lee del mismo archivo versionado que usa el servidor.
import { readFileSync } from 'node:fs'

import { gameConfigSchema } from '../src/index.ts'
import type { GameConfig } from '../src/index.ts'

export function loadTestGameConfig(): GameConfig {
  const raw = readFileSync(new URL('../../../config/game.json', import.meta.url), 'utf8')
  return gameConfigSchema.parse(JSON.parse(raw))
}

/** Variante con valores propios para no depender de los números de producción. */
export function testGameConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return gameConfigSchema.parse({
    startingBalance: 1000,
    chips: [10, 50, 100],
    allIn: true,
    maxBetsPerRound: 5,
    defaultBet: { selection: { kind: 'red' }, amount: 10 },
    loan: { amount: 1000, displayApr: 4200, interestPerSpin: 0.1, maxDebt: 1_000_000 },
    jackpot: { gitPushMultiplier: 2 },
    season: { timeZone: 'Europe/Madrid', startDay: 1 },
    hallOfRuinSize: 10,
    spin: { minSpinMs: 4000 },
    round: { staleAfterMs: 1_800_000 },
    streak: { colorWarningAt: 5, historySize: 50, onFireAt: 5 },
    pendingSpins: { max: 100, quickSpinMs: 1200 },
    bigWin: { minNetMultiple: 5, megaNetMultiple: 15 },
    achievements: {
      proDebtorLoans: 5,
      compoundInterestDebt: 100_000,
      zeroCollectorZeros: 5,
      addictSpins: 500,
      nightOwl: { fromHour: 3, toHour: 6 },
    },
    stats: { recentRounds: 18, seriesPoints: 280, loanMarks: 100, bankHistory: 50 },
    ...overrides,
  })
}
