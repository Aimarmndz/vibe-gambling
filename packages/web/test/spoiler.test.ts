// SPDX-License-Identifier: AGPL-3.0-or-later
// Nada destripa el resultado antes de que caiga la bola: el ranking dentro de la ventana no se
// pide al servidor mientras la ronda está cayendo (el servidor ya la ha resuelto).
import { describe, expect, it, vi } from 'vitest'

import type { AppContext } from '../src/app/context.ts'
import { clientConfig } from '../src/config.ts'
import { INITIAL_STATE } from '../src/game/state.ts'
import type { GameState, Phase } from '../src/game/state.ts'
import { translator } from './translators.ts'
import { LeaderboardScreen } from '../src/ui/screens/leaderboard.ts'
import { testWebConfig } from './fixtures.ts'

function context(phase: { value: Phase }) {
  const leaderboard = vi.fn(() => new Promise<never>(() => undefined))
  const brokeRank = vi.fn(() => new Promise<never>(() => undefined))
  const ctx = {
    web: testWebConfig,
    client: clientConfig,
    demo: false,
    tr: translator('es'),
    state: (): GameState => ({ ...INITIAL_STATE, phase: phase.value }),
    leaderboard,
    brokeRank,
  } as unknown as AppContext
  return { ctx, leaderboard, brokeRank }
}

describe('sin destripes', () => {
  it('el ranking de la ventana espera a que caiga la bola', () => {
    const phase = { value: 'landing' as Phase }
    const { ctx, leaderboard, brokeRank } = context(phase)
    const screen = new LeaderboardScreen(ctx)
    screen.update()
    expect(leaderboard).not.toHaveBeenCalled()
    expect(brokeRank).not.toHaveBeenCalled()
    phase.value = 'result'
    screen.update()
    screen.update()
    expect(leaderboard).toHaveBeenCalledTimes(1)
    expect(brokeRank).toHaveBeenCalledTimes(1)
  })

  it('fuera de la caída se carga al abrir', () => {
    const { ctx, leaderboard } = context({ value: 'idle' })
    new LeaderboardScreen(ctx).update()
    expect(leaderboard).toHaveBeenCalledTimes(1)
  })
})
