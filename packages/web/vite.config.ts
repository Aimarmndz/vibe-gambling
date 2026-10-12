// SPDX-License-Identifier: AGPL-3.0-or-later
// Build multipágina de la web (landing, ventana del juego y privacidad) y servidor de desarrollo.
// Todo lo configurable del entorno de desarrollo sale de variables de entorno validadas con zod
// (ver packages/web/.env.example). La build de producción no necesita ninguna.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { gameConfigSchema, toPublicGameConfig, webConfigSchema } from '@vibe-gambling/shared'
import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import { z } from 'zod'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../..')

const devEnvSchema = z.object({
  /** Puerto de Vite en desarrollo. */
  WEB_DEV_PORT: z.coerce.number().int().min(1).max(65535),
  /** Servidor al que Vite reenvía /api, /ws y /config.json. */
  WEB_DEV_PROXY_TARGET: z.url(),
  /**
   * Si es "1", Vite sirve él mismo /config.json a partir de config/*.json (para trabajar en la
   * ventana con `?demo` sin levantar el servidor). Con "0", /config.json va al servidor.
   */
  WEB_DEV_LOCAL_CONFIG: z.enum(['0', '1']),
  /** Nombre de la instancia en ese /config.json local. */
  WEB_DEV_INSTANCE_NAME: z.string().min(1).max(80),
})

/** /config.json de desarrollo a partir de los archivos de configuración versionados. */
function localConfigPlugin(env: z.output<typeof devEnvSchema>): Plugin {
  return {
    name: 'vibe-gambling-local-config',
    configureServer(server) {
      server.middlewares.use('/config.json', (_req, res) => {
        const game = gameConfigSchema.parse(
          JSON.parse(readFileSync(resolve(repoRoot, 'config/game.json'), 'utf8')),
        )
        const site = JSON.parse(readFileSync(resolve(repoRoot, 'config/site.json'), 'utf8'))
        const body = webConfigSchema.parse({
          v: 1,
          publicUrl: `http://localhost:${env.WEB_DEV_PORT}`,
          instanceName: env.WEB_DEV_INSTANCE_NAME,
          isOfficial: false,
          serverVersion: 'dev',
          game: toPublicGameConfig(game),
          site,
        })
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(body))
      })
    },
  }
}

/** En desarrollo, /play y /privacy sirven sus HTML (en producción lo hace el servidor). */
function cleanUrlsPlugin(): Plugin {
  const pages: Record<string, string> = { '/play': '/play.html', '/privacy': '/privacy.html' }
  return {
    name: 'vibe-gambling-clean-urls',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path = '', query] = (req.url ?? '').split('?')
        const page = pages[path]
        if (page) req.url = query === undefined ? page : `${page}?${query}`
        next()
      })
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const plugins: Plugin[] = [cleanUrlsPlugin()]
  let server = {}
  if (command === 'serve' && mode !== 'test') {
    const parsed = devEnvSchema.safeParse({ ...loadEnv(mode, here, 'WEB_DEV_'), ...process.env })
    if (!parsed.success) {
      throw new Error(
        `Faltan variables de entorno de desarrollo de la web (copia packages/web/.env.example a .env):\n${z.prettifyError(parsed.error)}`,
      )
    }
    const env = parsed.data
    const target = env.WEB_DEV_PROXY_TARGET
    if (env.WEB_DEV_LOCAL_CONFIG === '1') plugins.push(localConfigPlugin(env))
    server = {
      port: env.WEB_DEV_PORT,
      strictPort: true,
      fs: { allow: [repoRoot] },
      proxy: {
        '/api': { target, changeOrigin: false },
        '/ws': { target, ws: true, changeOrigin: false },
        ...(env.WEB_DEV_LOCAL_CONFIG === '1' ? {} : { '/config.json': { target } }),
      },
    }
  }
  return {
    plugins,
    server,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: 0,
      // Sin mapas de fuentes en producción: el código ya es libre y está en el repo.
      sourcemap: false,
      rolldownOptions: {
        input: {
          index: resolve(here, 'index.html'),
          play: resolve(here, 'play.html'),
          privacy: resolve(here, 'privacy.html'),
        },
        output: {
          codeSplitting: {
            groups: [{ name: 'three', test: /node_modules[\\/].*three[\\/]/ }],
          },
        },
      },
    },
  }
})
