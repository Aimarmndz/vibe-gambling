// SPDX-License-Identifier: AGPL-3.0-or-later
// Construcción de todos los servicios a partir de la configuración y sus dependencias.
import type { Config } from '../config.ts'
import type { Database } from '../db/client.ts'
import type { Clock } from '../lib/clock.ts'
import type { Rng } from '../lib/rng.ts'
import { AchievementService } from './achievements.ts'
import { AuthService } from './auth.ts'
import { GameService } from './game.ts'
import { GitHubClient } from './github.ts'
import { LeaderboardService } from './leaderboard.ts'
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
}

export interface ServiceDeps {
  config: Config
  db: Database
  clock: Clock
  rng: Rng
  notifier: Notifier
  logger: SeasonJobLogger
  userAgent: string
}

export function createServices(deps: ServiceDeps): Services {
  const { config, db, clock, rng, notifier } = deps
  const { env, game } = config
  const views = new Views(env.GITHUB_WEB_BASE_URL, game)
  const github = new GitHubClient({
    clientId: env.GITHUB_CLIENT_ID,
    oauthBaseUrl: env.GITHUB_OAUTH_BASE_URL,
    apiBaseUrl: env.GITHUB_API_BASE_URL,
    timeoutMs: env.GITHUB_TIMEOUT_MS,
    userAgent: deps.userAgent,
  })
  const achievements = new AchievementService(game)
  const gameService = new GameService({ db, game, clock, rng, views, notifier, achievements })
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
  })
  const leaderboard = new LeaderboardService(db, views)
  const seasons = new SeasonService({
    db,
    game,
    clock,
    notifier,
    gameService,
    auth,
    logger: deps.logger,
    intervalMs: env.SEASON_CHECK_INTERVAL_MS,
  })
  return { views, game: gameService, auth, leaderboard, seasons, stats }
}
