// SPDX-License-Identifier: AGPL-3.0-or-later
// Rutas `/api/*`. Método, ruta y quién puede llamarla salen de `API_ROUTES` (shared): una única
// fuente de verdad para el servidor, la web y el mod. Cada entrada se valida con los esquemas
// zod de `shared` y cada respuesta 200 se comprueba contra su esquema antes de salir.
import {
  API_ROUTES,
  betRequestSchema,
  betResponseSchema,
  deleteAccountRequestSchema,
  devicePollRequestSchema,
  devicePollResponseSchema,
  deviceStartRequestSchema,
  deviceStartResponseSchema,
  hallOfRuinResponseSchema,
  itemArmRequestSchema,
  itemArmResponseSchema,
  leaderboardQuerySchema,
  leaderboardResponseSchema,
  linkRequestSchema,
  linkResponseSchema,
  logoutRequestSchema,
  meResponseSchema,
  metaResponseSchema,
  okResponseSchema,
  parseBetTarget,
  redeemRequestSchema,
  redeemResponseSchema,
  referralLookupQuerySchema,
  referralLookupResponseSchema,
  referralRedeemRequestSchema,
  referralRedeemResponseSchema,
  referralResponseSchema,
  settingsRequestSchema,
  settingsResponseSchema,
  shopBuyRequestSchema,
  shopBuyResponseSchema,
  shopResponseSchema,
  turnEndRequestSchema,
  turnEndResponseSchema,
  turnStartRequestSchema,
  turnStartResponseSchema,
} from '@vibe-gambling/shared'
import type { ApiRoute } from '@vibe-gambling/shared'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Config } from '../config.ts'
import { AppError } from '../lib/errors.ts'
import { rateLimitKeyOf } from '../lib/real-ip.ts'
import type { Services } from '../services/index.ts'
import { authOf, makeRequireAuth, tokenKeyOf } from './auth.ts'

const V = 1 as const

export interface ApiOptions {
  config: Config
  services: Services
  serverVersion: string
}

export async function apiRoutes(parent: FastifyInstance, options: ApiOptions): Promise<void> {
  const { config, services, serverVersion } = options
  const { env } = config
  const app = parent.withTypeProvider<ZodTypeProvider>()
  const requireAuth = makeRequireAuth(config, services.auth)
  const cookieName = env.SESSION_COOKIE_NAME

  /** Método, ruta y autenticación de una ruta de `API_ROUTES`. */
  const at = (route: ApiRoute) => ({
    method: route.method,
    url: route.path,
    ...(route.auth === 'public' ? {} : { preHandler: requireAuth(route.auth) }),
  })

  // ---------------------------------------------------------------- rate limit y cabeceras

  // Dos límites independientes: por IP real y por token (si la petición trae uno).
  const ipLimit = app.createRateLimit({
    max: env.RATE_LIMIT_IP_MAX,
    timeWindow: env.RATE_LIMIT_IP_WINDOW_MS,
    keyGenerator: (request: FastifyRequest) =>
      `ip:${rateLimitKeyOf(request.realIp, env.RATE_LIMIT_IPV6_PREFIX)}`,
  })
  const tokenLimit = app.createRateLimit({
    max: env.RATE_LIMIT_TOKEN_MAX,
    timeWindow: env.RATE_LIMIT_TOKEN_WINDOW_MS,
    keyGenerator: (request: FastifyRequest) => `tok:${tokenKeyOf(request, cookieName) ?? ''}`,
    allowList: (request: FastifyRequest) => tokenKeyOf(request, cookieName) === null,
  })
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    for (const limit of [ipLimit, tokenLimit]) {
      const result = await limit(request)
      if (!result.isAllowed && result.isExceeded) {
        reply.header('retry-after', String(result.ttlInSeconds))
        throw new AppError('rate_limited', 'Easy there, high roller. Too many requests.')
      }
    }
  })
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store')
  })

  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: env.WEB_SESSION_TTL_SECONDS,
    })
  const clearSessionCookie = (reply: FastifyReply) =>
    reply.clearCookie(cookieName, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' })

  // ---------------------------------------------------------------- meta

  app.route({
    ...at(API_ROUTES.meta),
    schema: { response: { 200: metaResponseSchema } },
    handler: async () => ({
      v: V,
      protocol: V,
      name: env.INSTANCE_NAME,
      isOfficial: env.IS_OFFICIAL,
      serverVersion,
      publicUrl: env.PUBLIC_URL,
    }),
  })

  // ---------------------------------------------------------------- login

  app.route({
    ...at(API_ROUTES.deviceStart),
    schema: { body: deviceStartRequestSchema, response: { 200: deviceStartResponseSchema } },
    handler: async () => services.auth.deviceStart(),
  })

  app.route({
    ...at(API_ROUTES.devicePoll),
    schema: { body: devicePollRequestSchema, response: { 200: devicePollResponseSchema } },
    handler: async request => services.auth.devicePoll(request.body.pollId),
  })

  app.route({
    ...at(API_ROUTES.link),
    schema: { body: linkRequestSchema, response: { 200: linkResponseSchema } },
    handler: async request => {
      const link = await services.auth.createLink(authOf(request).user.id)
      return { v: V, ...link }
    },
  })

  app.route({
    ...at(API_ROUTES.redeem),
    schema: { body: redeemRequestSchema, response: { 200: redeemResponseSchema } },
    handler: async (request, reply) => {
      const origin = request.headers.origin
      if (typeof origin === 'string' && !config.allowedOrigins.has(origin)) {
        throw new AppError('forbidden', 'Cross-origin request refused.')
      }
      const { token, user } = await services.auth.redeemLink(request.body.code)
      setSessionCookie(reply, token)
      return { v: V, user }
    },
  })

  app.route({
    ...at(API_ROUTES.logout),
    schema: { body: logoutRequestSchema, response: { 200: okResponseSchema } },
    handler: async (request, reply) => {
      await services.auth.revokeSession(authOf(request).session.id)
      if (request.authVia === 'cookie') clearSessionCookie(reply)
      return { v: V, ok: true as const }
    },
  })

  // ---------------------------------------------------------------- turnos y apuestas

  app.route({
    ...at(API_ROUTES.turnStart),
    schema: { body: turnStartRequestSchema, response: { 200: turnStartResponseSchema } },
    handler: async request => services.game.turnStart(authOf(request).user.id, request.body.turnId),
  })

  app.route({
    ...at(API_ROUTES.turnEnd),
    schema: { body: turnEndRequestSchema, response: { 200: turnEndResponseSchema } },
    handler: async request => services.game.turnEnd(authOf(request).user.id, request.body),
  })

  app.route({
    ...at(API_ROUTES.bet),
    schema: { body: betRequestSchema, response: { 200: betResponseSchema } },
    handler: async request => {
      const selection = parseBetTarget(request.body.target)
      if (!selection) {
        throw new AppError('invalid_bet', `There is no "${request.body.target}" on this table.`)
      }
      const result = await services.game.placeBet(
        authOf(request).user.id,
        selection,
        request.body.amount,
      )
      return { v: V, ...result }
    },
  })

  // ---------------------------------------------------------------- cuenta

  app.route({
    ...at(API_ROUTES.me),
    schema: { response: { 200: meResponseSchema } },
    handler: async request => {
      const userId = authOf(request).user.id
      const state = await services.game.state(userId)
      const brokeRank = state.user.hidden
        ? null
        : await services.leaderboard.brokeRank(userId, state.wallet.seasonId)
      return {
        v: V,
        user: services.views.selfUser(state.user),
        wallet: state.wallet,
        slip: state.slip,
        round: state.round,
        brokeRank,
        achievements: state.achievements,
        inventory: state.inventory,
      }
    },
  })

  // Ajustes y borrado: la ruta canónica es la de `API_ROUTES` (la que usan el mod y la web);
  // además se aceptan los verbos REST equivalentes (PATCH /api/me/settings, DELETE /api/me).
  for (const route of [API_ROUTES.settings, { ...API_ROUTES.settings, method: 'PATCH' }]) {
    app.route({
      ...at(API_ROUTES.settings),
      method: route.method,
      url: route.path,
      schema: { body: settingsRequestSchema, response: { 200: settingsResponseSchema } },
      handler: async request => {
        const userId = authOf(request).user.id
        const { hidden, locale, felt, chipSkin } = request.body
        await services.items.assertCanEquip(userId, { felt, chipSkin })
        const user = await services.auth.updateSettings(userId, { hidden, locale, felt, chipSkin })
        return { v: V, user }
      },
    })
  }

  for (const route of [
    API_ROUTES.deleteAccount,
    { ...API_ROUTES.deleteAccount, method: 'DELETE', path: API_ROUTES.me.path },
  ]) {
    app.route({
      ...at(API_ROUTES.deleteAccount),
      method: route.method,
      url: route.path,
      schema: { body: deleteAccountRequestSchema, response: { 200: okResponseSchema } },
      handler: async (request, reply) => {
        await services.auth.deleteAccount(authOf(request).user, request.body.confirm)
        clearSessionCookie(reply)
        return { v: V, ok: true as const }
      },
    })
  }

  // ---------------------------------------------------------------- rankings

  app.route({
    ...at(API_ROUTES.leaderboard),
    schema: { querystring: leaderboardQuerySchema, response: { 200: leaderboardResponseSchema } },
    handler: async request => {
      const current = services.game.currentSeason().id
      return services.leaderboard.leaderboard({
        season: request.query.season ?? current,
        currentSeason: current,
        board: request.query.board,
        limit: request.query.limit,
      })
    },
  })

  app.route({
    ...at(API_ROUTES.hallOfRuin),
    schema: { response: { 200: hallOfRuinResponseSchema } },
    handler: async () => services.leaderboard.hallOfRuin(),
  })

  // ---------------------------------------------------------------- afiliados

  app.route({
    ...at(API_ROUTES.referral),
    schema: { response: { 200: referralResponseSchema } },
    handler: async request => ({
      v: V,
      referral: await services.referrals.status(authOf(request).user.id),
    }),
  })

  app.route({
    ...at(API_ROUTES.referralRedeem),
    schema: { body: referralRedeemRequestSchema, response: { 200: referralRedeemResponseSchema } },
    handler: async request => services.referrals.redeem(authOf(request).user.id, request.body.code),
  })

  // ---------------------------------------------------------------- TIENDA

  app.route({
    ...at(API_ROUTES.shop),
    schema: { response: { 200: shopResponseSchema } },
    handler: async request => ({ v: V, shop: await services.items.shop(authOf(request).user.id) }),
  })

  app.route({
    ...at(API_ROUTES.shopBuy),
    schema: { body: shopBuyRequestSchema, response: { 200: shopBuyResponseSchema } },
    handler: async request => {
      const bought = await services.items.buy(
        authOf(request).user.id,
        request.body.itemId,
        request.body.requestId,
      )
      return { v: V, ...bought }
    },
  })

  app.route({
    ...at(API_ROUTES.itemArm),
    schema: { body: itemArmRequestSchema, response: { 200: itemArmResponseSchema } },
    handler: async request => ({
      v: V,
      inventory: await services.items.arm(
        authOf(request).user.id,
        request.body.itemId,
        request.body.armed,
      ),
    }),
  })

  app.route({
    ...at(API_ROUTES.referralLookup),
    schema: {
      querystring: referralLookupQuerySchema,
      response: { 200: referralLookupResponseSchema },
    },
    handler: async request => services.referrals.lookup(request.query.code),
  })
}
