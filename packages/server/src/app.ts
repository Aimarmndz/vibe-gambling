// SPDX-License-Identifier: AGPL-3.0-or-later
// Construye la aplicación Fastify completa. No escucha en ningún puerto: eso lo hace `main.ts`
// (y los tests, con su propia configuración).
import fastifyCookie from '@fastify/cookie'
import fastifyHelmet from '@fastify/helmet'
import fastifyRateLimit from '@fastify/rate-limit'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { LogController } from 'fastify'
import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import { validatorCompiler } from 'fastify-type-provider-zod'

import pkg from '../package.json' with { type: 'json' }
import type { Config } from './config.ts'
import type { Database } from './db/client.ts'
import { apiRoutes } from './http/api.ts'
import { zodSerializerCompiler } from './http/compilers.ts'
import { errorBody, registerErrorHandlers } from './http/errors.ts'
import { publicRoutes } from './http/public.ts'
import { helmetOptions } from './http/security.ts'
import './http/types.ts'
import type { Clock } from './lib/clock.ts'
import { systemClock } from './lib/clock.ts'
import { createRealIpResolver } from './lib/real-ip.ts'
import type { Rng } from './lib/rng.ts'
import { cryptoRng } from './lib/rng.ts'
import { loggerOptions, registerRequestLogging } from './logger.ts'
import { createServices } from './services/index.ts'
import type { Services } from './services/index.ts'
import { Hub } from './ws/hub.ts'
import { wsRoutes } from './ws/route.ts'

export const SERVER_VERSION: string = pkg.version
const USER_AGENT = `${pkg.name}/${pkg.version}`

export interface AppDeps {
  config: Config
  db: Database
  clock?: Clock
  rng?: Rng
  /** `false` para silenciar los logs (tests). Por defecto, pino con `LOG_LEVEL`. */
  logger?: FastifyServerOptions['logger']
}

export interface App {
  app: FastifyInstance
  hub: Hub
  services: Services
}

export async function buildApp(deps: AppDeps): Promise<App> {
  const { config, db } = deps
  const { env } = config
  const app = Fastify({
    logger: deps.logger ?? loggerOptions(env.LOG_LEVEL),
    bodyLimit: env.BODY_LIMIT_BYTES,
    // La IP real se calcula aparte (ver lib/real-ip.ts); Fastify no confía en ningún proxy.
    trustProxy: false,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    routerOptions: { ignoreTrailingSlash: true },
  })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(zodSerializerCompiler)

  const hub = new Hub(app.log)
  const services = createServices({
    config,
    db,
    clock: deps.clock ?? systemClock,
    rng: deps.rng ?? cryptoRng,
    notifier: hub,
    logger: app.log,
    userAgent: USER_AGENT,
  })

  const realIp = createRealIpResolver(env.TRUST_PROXY_CIDRS, env.REAL_IP_HEADER)
  app.decorateRequest('auth', null)
  app.decorateRequest('authVia', null)
  app.decorateRequest('realIp', '')
  app.decorateRequest('wsContext', null)
  app.addHook('onRequest', async request => {
    request.realIp = realIp(request.raw.socket.remoteAddress, request.headers)
  })

  registerErrorHandlers(app)
  registerRequestLogging(app)
  await app.register(fastifyHelmet, helmetOptions(config))
  await app.register(fastifyCookie)
  await app.register(fastifyRateLimit, {
    global: false,
    errorResponseBuilder: () => errorBody('rate_limited', 'Too many requests.'),
  })
  await app.register(fastifyWebsocket, {
    options: { maxPayload: env.WS_MAX_MESSAGE_BYTES },
    // El cierre ordenado lo hace el hub (manda `bye` antes de cerrar).
    preClose: done => {
      hub.shutdown()
      done()
    },
  })

  await app.register(wsRoutes, { config, services, hub })
  await app.register(apiRoutes, { config, services, serverVersion: SERVER_VERSION })
  await app.register(publicRoutes, { config, db, serverVersion: SERVER_VERSION })

  hub.startPing(env.WS_PING_INTERVAL_MS)
  return { app, hub, services }
}
