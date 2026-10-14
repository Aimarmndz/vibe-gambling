// SPDX-License-Identifier: AGPL-3.0-or-later
// Construcción de todos los servicios a partir de la configuración y sus dependencias.
import { seasonAt } from '@vibe-gambling/shared'

import type { Config } from '../config.ts'
import type { Database } from '../db/client.ts'
import type { Clock } from '../lib/clock.ts'
import type { Rng } from '../lib/rng.ts'
import { generateReferralCode } from '../lib/tokens.ts'
import { AchievementService } from './achievements.ts'
import { AuthService } from './auth.ts'
import { GameService } from './game.ts'
import type { GameLogger } from './game.ts'
import { GitHubClient } from './github.ts'
import { ItemService } from './items.ts'
import { LeaderboardService } from './leaderboard.ts'
import { ReferralService } from './referrals.ts'
import type { Notifier } from './notifier.ts'
import { SeasonService } from './seasons.ts'
import type { SeasonJobLogger } from './seasons.ts'
import { StatsService } from './stats.ts'
import { Views } from './views.ts'

export interface Services {
  views: Views
  game: GameService
  auth: AuthService
  leaderboard: LeaderboardService
  seasons: SeasonService
  stats: StatsService
  referrals: ReferralService
  items: ItemService
}

export interface ServiceDeps {
  config: Config
  db: Database
  clock: Clock
  rng: Rng
  notifier: Notifier
  logger: SeasonJobLogger & GameLogger
  userAgent: string
  /** Generador de códigos de afiliado (por defecto, aleatorio con `crypto`). */
  generateReferralCode?: () => string
}

export function createServices(deps: ServiceDeps): Services {
  const { config, db, clock, rng, notifier } = deps
  const { env, game } = config
  const views = new Views(env.GITHUB_WEB_BASE_URL, game, clock)
  const github = new GitHubClient({
    clientId: env.GITHUB_CLIENT_ID,
    oauthBaseUrl: env.GITHUB_OAUTH_BASE_URL,
    apiBaseUrl: env.GITHUB_API_BASE_URL,
    timeoutMs: env.GITHUB_TIMEOUT_MS,
    userAgent: deps.userAgent,
  })
  const achievements = new AchievementService(game)
  // Se crea después (necesita la cartera de GameService); los ganchos lo llaman ya creado.
  let referrals: ReferralService | null = null
  const settleReferral = async (userId: string): Promise<void> => {
    await referrals?.settle(userId)
  }
  const items = new ItemService({
    db,
    game,
    clock,
    views,
    notifier,
    achievements,
    currentSeason: now => seasonAt(now, game.season.timeZone, game.season.startDay),
  })
  const gameService = new GameService({
    db,
    game,
    clock,
    rng,
    views,
    notifier,
    achievements,
    items,
    logger: deps.logger,
    afterSpin: settleReferral,
  })
  const stats = new StatsService({ db, game, currentSeason: () => gameService.currentSeason().id })
  const auth = new AuthService({
    db,
    clock,
    github,
    views,
    notifier,
    options: {
      publicUrl: env.PUBLIC_URL,
      modSessionTtlSeconds: env.MOD_SESSION_TTL_SECONDS,
      webSessionTtlSeconds: env.WEB_SESSION_TTL_SECONDS,
      sessionTouchIntervalSeconds: env.SESSION_TOUCH_INTERVAL_SECONDS,
      linkCodeTtlSeconds: env.LINK_CODE_TTL_SECONDS,
      devicePollLeewayMs: env.DEVICE_POLL_LEEWAY_MS,
    },
    afterLogin: settleReferral,
  })
  const leaderboard = new LeaderboardService({
    db,
    views,
    clock,
    minAccountAgeDays: game.leaderboard.minAccountAgeDays,
  })
  const seasons = new SeasonService({
    db,
    game,
    clock,
    notifier,
    gameService,
    items,
    auth,
    logger: deps.logger,
    intervalMs: env.SEASON_CHECK_INTERVAL_MS,
  })
  referrals = new ReferralService({
    db,
    game,
    clock,
    views,
    notifier,
    achievements,
    publicUrl: env.PUBLIC_URL,
    generateCode: deps.generateReferralCode ?? generateReferralCode,
  })
  return { views, game: gameService, auth, leaderboard, seasons, stats, referrals, items }
}
