// SPDX-License-Identifier: AGPL-3.0-or-later
// Rutas fuera de `/api`: configuración pública de la web, salud y estáticos. Las páginas HTML salen
// con sus metadatos de previsualización (og:image…) absolutos con PUBLIC_URL (ver html.ts).
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

import fastifyStatic from '@fastify/static'
import { errorResponseSchema, toPublicGameConfig, webConfigSchema } from '@vibe-gambling/shared'
import { sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import type { Config } from '../config.ts'
import type { Database } from '../db/client.ts'
import { errorBody } from './errors.ts'
import { absolutizeMeta } from './html.ts'

export interface PublicOptions {
  config: Config
  db: Database
  serverVersion: string
}

/** Páginas de la web: ruta pública → archivo HTML generado por Vite. */
const PAGES: Readonly<Record<string, string>> = Object.freeze({
  '/': 'index.html',
  '/play': 'play.html',
  '/privacy': 'privacy.html',
})

/** Página que se sirve cuando el servidor arranca sin la build de la web (solo API). */
const MISSING_WEB_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>vibe-gambling</title></head>
<body>
<h1>The table is not set up yet</h1>
<p>This server is running without the web build, so only the API is available.
Build <code>packages/web</code> (or the Docker image without <code>SKIP_WEB</code>) and restart.</p>
<p lang="es">Este servidor está arrancado sin la build de la web: solo responde la API.</p>
</body>
</html>
`

export async function publicRoutes(parent: FastifyInstance, options: PublicOptions): Promise<void> {
  const { config, db, serverVersion } = options
  const { env } = config
  const app = parent.withTypeProvider<ZodTypeProvider>()

  const webConfig = webConfigSchema.parse({
    v: 1,
    publicUrl: env.PUBLIC_URL,
    instanceName: env.INSTANCE_NAME,
    isOfficial: env.IS_OFFICIAL,
    serverVersion,
    game: toPublicGameConfig(config.game),
    privacy: {
      imageOrigins: env.CSP_IMG_ORIGINS,
      modSessionTtlSeconds: env.MOD_SESSION_TTL_SECONDS,
      webSessionTtlSeconds: env.WEB_SESSION_TTL_SECONDS,
      linkCodeTtlSeconds: env.LINK_CODE_TTL_SECONDS,
    },
    site: config.site,
  })
  app.get(
    '/config.json',
    { schema: { response: { 200: webConfigSchema } } },
    async (_req, reply) => {
      reply.header('cache-control', `public, max-age=${env.STATIC_MAX_AGE_SECONDS}`)
      return webConfig
    },
  )

  app.get(
    '/healthz',
    {
      schema: {
        response: { 200: z.object({ ok: z.literal(true) }).strict(), 503: errorResponseSchema },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store')
      try {
        await db.execute(sql`select 1`)
      } catch (error) {
        request.log.error({ err: error }, 'healthz: la base de datos no responde')
        return reply.code(503).send(errorBody('internal', 'Database unavailable.'))
      }
      return { ok: true as const }
    },
  )

  const root = resolve(env.WEB_DIST_DIR)
  if (!existsSync(resolve(root, 'index.html')) || !statSync(root).isDirectory()) {
    app.log.warn({ webDistDir: env.WEB_DIST_DIR }, 'no hay build de la web: solo se sirve la API')
    // Las páginas responden con un HTML mínimo: quien abre la ventana desde el mod ve qué pasa
    // en vez del JSON de error de la API.
    for (const route of Object.keys(PAGES)) {
      app.get(route, async (_request, reply) =>
        reply
          .code(503)
          .header('cache-control', 'no-store')
          .type('text/html; charset=utf-8')
          .send(MISSING_WEB_PAGE),
      )
    }
    return
  }
  const assetsDir = `${resolve(root, 'assets')}${sep}`
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    index: false,
    wildcard: true,
    cacheControl: false,
    // Sin listados de directorios ni archivos ocultos.
    list: false,
    dotfiles: 'deny',
    setHeaders: (reply, path) => {
      if (path.startsWith(assetsDir)) {
        // Vite pone un hash en el nombre: se pueden cachear para siempre.
        reply.header('cache-control', `public, max-age=${env.ASSETS_MAX_AGE_SECONDS}, immutable`)
      } else if (path.endsWith('.html')) {
        reply.header('cache-control', 'no-cache')
      } else {
        reply.header('cache-control', `public, max-age=${env.STATIC_MAX_AGE_SECONDS}`)
      }
    },
  })
  for (const [route, file] of Object.entries(PAGES)) {
    const handler = async (request: FastifyRequest, reply: FastifyReply) => {
      // Se lee en cada petición (es pequeño): una build nueva se ve sin reiniciar el servidor.
      const html = absolutizeMeta(await readFile(resolve(root, file), 'utf8'), env.PUBLIC_URL)
      const etag = `"${createHash('sha256').update(html).digest('base64url').slice(0, 27)}"`
      reply.header('cache-control', 'no-cache').header('etag', etag)
      if (request.headers['if-none-match'] === etag) return reply.code(304).send()
      return reply.type('text/html; charset=utf-8').send(html)
    }
    app.get(route, handler)
    // El archivo pedido por su nombre sale igual (con los metadatos absolutos).
    app.get(`/${file}`, handler)
  }
}
