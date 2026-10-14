// SPDX-License-Identifier: AGPL-3.0-or-later
// Traduce filas de la base de datos a los objetos del protocolo de `shared`.
import {
  DEFAULT_CHIP_SKIN,
  DEFAULT_FELT,
  chipSkinIdSchema,
  colorOf,
  feltIdSchema,
  localeSchema,
  netWorth,
  spectacleOf,
  totalStake,
} from '@vibe-gambling/shared'
import type {
  Bet,
  ItemEffect,
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
import type { Clock } from '../lib/clock.ts'
import { pendingRankedFrom } from './accountAge.ts'

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
  readonly #clock: Clock

  constructor(githubWebBaseUrl: string, game: GameConfig, clock: Clock) {
    this.#githubWebBaseUrl = githubWebBaseUrl
    this.#game = game
    this.#clock = clock
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
      newAccount: this.#newAccount(user),
      // Un cosmético que ya no está en el catálogo se trata como el clásico.
      felt: feltIdSchema.safeParse(user.felt).data ?? DEFAULT_FELT,
      chipSkin: chipSkinIdSchema.safeParse(user.chipSkin).data ?? DEFAULT_CHIP_SKIN,
    }
  }

  /** Si la cuenta de GitHub aún es demasiado nueva para el ranking, desde cuándo saldrá. */
  #newAccount(user: UserRow): SelfUser['newAccount'] {
    const minAgeDays = this.#game.leaderboard.minAccountAgeDays
    const from = pendingRankedFrom(user.githubCreatedAt, minAgeDays, this.#clock.now())
    return from === null ? null : { minAgeDays, rankedFrom: from.toISOString() }
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
        streakAsterisk: false,
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
      streakAsterisk: row.streakAsterisk,
    }
  }

  slip(bets: readonly Bet[] | undefined): Slip {
    const list = bets ? [...bets] : []
    return { bets: list, total: totalStake(list) }
  }

  openRound(round: Pick<RoundRow, 'id' | 'openedAt'>): OpenRound {
    return { roundId: round.id, openedAt: round.openedAt.toISOString() }
  }

  /**
   * Ronda resuelta, con lo que hicieron los objetos de la TIENDA. Lanza si la fila no está completa
   * (sería un bug, no un caso esperado).
   */
  resolvedRound(
    round: RoundRow,
    bets: readonly BetResultRow[],
    items: readonly ItemEffect[] = [],
  ): ResolvedRound {
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
    // Lo que siente el jugador (saldo, espectáculo): la ruleta más lo que pagan los objetos.
    const itemNet = round.itemNet ?? 0
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
        { result, net: net + itemNet, staked, jackpot, colorStreak, bets: betViews },
        { streak: round.streakAfter ?? 0, bankrupt: round.wentBroke ?? false },
        this.#spectacle,
      ),
      itemNet,
      items: items.map(e => ({ ...e })),
    }
  }
}
