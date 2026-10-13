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
/** Textos y frases de `locales/<idioma>/` (lo que se carga bajo demanda). */
const LOCALE_TEXT = /[\\/]locales[\\/]([^\\/]+)[\\/](?:web|landing|privacy|phrases)\.json$/
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

/**
 * Lo que en /config.json pone el servidor desde su entorno (bloque `privacy`), sacado del entorno
 * de desarrollo versionado del servidor (`deploy/dev.env`), el mismo que usa `pnpm dev` allí.
 */
const serverDevEnvSchema = z.object({
  CSP_IMG_ORIGINS: z.string(),
  MOD_SESSION_TTL_SECONDS: z.coerce.number().int().positive(),
  WEB_SESSION_TTL_SECONDS: z.coerce.number().int().positive(),
  LINK_CODE_TTL_SECONDS: z.coerce.number().int().positive(),
  RATE_LIMIT_IP_WINDOW_MS: z.coerce.number().int().positive(),
})

function serverDevPrivacy() {
  const vars: Record<string, string> = {}
  for (const line of readFileSync(resolve(repoRoot, 'deploy/dev.env'), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) vars[m[1]!] = m[2]!
  }
  const env = serverDevEnvSchema.parse(vars)
  return {
    imageOrigins: env.CSP_IMG_ORIGINS.split(',')
      .map(o => o.trim())
      .filter(o => o !== ''),
    modSessionTtlSeconds: env.MOD_SESSION_TTL_SECONDS,
    webSessionTtlSeconds: env.WEB_SESSION_TTL_SECONDS,
    linkCodeTtlSeconds: env.LINK_CODE_TTL_SECONDS,
    ipMemorySeconds: Math.ceil(env.RATE_LIMIT_IP_WINDOW_MS / 1000),
  }
}

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
          privacy: serverDevPrivacy(),
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
      // El chunk `three` (solo lo carga /play) ocupa ~530 kB minificado y ~132 kB con gzip: es
      // Three.js ya podado por el bundler. El aviso de 500 kB solo era ruido; si otro chunk pasa
      // de este tope, sí avisa.
      chunkSizeWarningLimit: 560,
      rolldownOptions: {
        input: {
          index: resolve(here, 'index.html'),
          play: resolve(here, 'play.html'),
          privacy: resolve(here, 'privacy.html'),
        },
        output: {
          codeSplitting: {
            groups: [
              { name: 'three', test: /node_modules[\\/].*three[\\/]/ },
              // Un chunk por idioma con sus textos y sus frases (se carga al elegirlo). Los
              // metadatos y las banderas van en el bundle principal: los usan los selectores.
              {
                name: (id: string) => `locale-${LOCALE_TEXT.exec(id)?.[1] ?? 'x'}`,
                test: LOCALE_TEXT,
              },
            ],
          },
        },
      },
    },
  }
})
