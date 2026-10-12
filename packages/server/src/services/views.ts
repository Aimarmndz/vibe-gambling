// SPDX-License-Identifier: AGPL-3.0-or-later
// Traduce filas de la base de datos a los objetos del protocolo de `shared`.
import { colorOf, localeSchema, netWorth, spectacleOf, totalStake } from '@vibe-gambling/shared'
import type {
  Bet,
  GameConfig,
  OpenRound,
  PublicUser,
  ResolvedRound,
  SelfUser,
  Slip,
  SpectacleRules,
  Wallet,
} from '@vibe-gambling/shared'

import type { RoundRow, UserRow, WalletRow } from '../db/schema.ts'

export interface BetResultRow {
  selection: Bet['selection']
  amount: number
  won: boolean
  payout: number
}

export class Views {
  readonly #githubWebBaseUrl: string
  readonly #game: GameConfig
  readonly #spectacle: SpectacleRules

  constructor(githubWebBaseUrl: string, game: GameConfig) {
    this.#githubWebBaseUrl = githubWebBaseUrl
    this.#game = game
    this.#spectacle = {
      bigWin: game.bigWin,
      onFireAt: game.streak.onFireAt,
      colorWarningAt: game.streak.colorWarningAt,
    }
  }

  profileUrl(login: string): string {
    return `${this.#githubWebBaseUrl}/${encodeURIComponent(login)}`
  }

  publicUser(user: Pick<UserRow, 'login' | 'avatarUrl'>): PublicUser {
    return { login: user.login, avatarUrl: user.avatarUrl, profileUrl: this.profileUrl(user.login) }
  }

  selfUser(user: UserRow): SelfUser {
    return {
      ...this.publicUser(user),
      hidden: user.hidden,
      // Un idioma que ya no está registrado (se quitó su carpeta de locales/) se trata como sin elegir.
      locale: localeSchema.safeParse(user.locale).data ?? null,
      createdAt: user.createdAt.toISOString(),
    }
  }

  /**
   * Cartera; si aún no existe la fila (cartera perezosa), la de una temporada recién empezada.
   * `pendingSpins` es el número de rondas `deferred` del usuario en esa temporada.
   */
  wallet(row: WalletRow | undefined, seasonId: string, pendingSpins: number): Wallet {
    if (!row) {
      const balance = this.#game.startingBalance
      return {
        seasonId,
        balance,
        debt: 0,
        netWorth: netWorth(balance, 0),
        spins: 0,
        loans: 0,
        currentStreak: 0,
        bestStreak: 0,
        pendingSpins,
      }
    }
    return {
      seasonId: row.seasonId,
      balance: row.balance,
      debt: row.debt,
      netWorth: netWorth(row.balance, row.debt),
      spins: row.spins,
      loans: row.loans,
      currentStreak: row.currentStreak,
      bestStreak: row.bestStreak,
      pendingSpins,
    }
  }

  slip(bets: readonly Bet[] | undefined): Slip {
    const list = bets ? [...bets] : []
    return { bets: list, total: totalStake(list) }
  }

  openRound(round: Pick<RoundRow, 'id' | 'openedAt'>): OpenRound {
    return { roundId: round.id, openedAt: round.openedAt.toISOString() }
  }

  /** Ronda resuelta. Lanza si la fila no está completa (sería un bug, no un caso esperado). */
  resolvedRound(round: RoundRow, bets: readonly BetResultRow[]): ResolvedRound {
    const {
      resolvedAt,
      result,
      source,
      staked,
      returned,
      net,
      jackpot,
      gitPushOk,
      testFailed,
      interestCharged,
      revealAt,
    } = round
    if (
      round.status !== 'resolved' ||
      resolvedAt === null ||
      result === null ||
      source === null ||
      staked === null ||
      returned === null ||
      net === null ||
      jackpot === null ||
      gitPushOk === null ||
      testFailed === null ||
      interestCharged === null ||
      revealAt === null
    ) {
      throw new Error(`la ronda ${round.id} no está resuelta del todo`)
    }
    const betViews = bets.map(b => ({
      selection: b.selection,
      amount: b.amount,
      won: b.won,
      payout: b.payout,
    }))
    const colorStreak =
      round.colorStreakColor !== null && round.colorStreakCount !== null
        ? { color: round.colorStreakColor, count: round.colorStreakCount }
        : null
    return {
      roundId: round.id,
      openedAt: round.openedAt.toISOString(),
      resolvedAt: resolvedAt.toISOString(),
      result,
      color: colorOf(result),
      bets: betViews,
      source,
      staked,
      returned,
      net,
      jackpot,
      gitPushOk,
      testFailed,
      interestCharged,
      colorStreak,
      revealAt: revealAt.toISOString(),
      // Las rondas anteriores a la v2 no guardaron la racha ni la bancarrota: sin fuego ni aviso.
      spectacle: spectacleOf(
        { result, net, staked, jackpot, colorStreak, bets: betViews },
        { streak: round.streakAfter ?? 0, bankrupt: round.wentBroke ?? false },
        this.#spectacle,
      ),
    }
  }
}
