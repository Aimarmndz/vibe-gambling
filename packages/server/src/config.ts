// SPDX-License-Identifier: AGPL-3.0-or-later
// Único módulo que lee el entorno. Todo se valida con zod al arrancar: si falta algo
// obligatorio o tiene un valor raro, el proceso se niega a arrancar con un error claro.
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { resolve } from 'node:path'

import { gameConfigSchema, webConfigSchema } from '@vibe-gambling/shared'
import type { GameConfig } from '@vibe-gambling/shared'
import { z } from 'zod'

/** Esquema de `config/site.json`: es exactamente el bloque `site` de `/config.json`. */
export const siteConfigSchema = webConfigSchema.shape.site
export type SiteConfig = z.output<typeof siteConfigSchema>

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

const int = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+$/, 'debe ser un número entero')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))

const bool = z.enum(['true', 'false']).transform(v => v === 'true')

/** URL base sin barra final (las rutas se le concatenan). */
const baseUrl = z
  .url({ protocol: /^https?$/ })
  .transform(u => u.replace(/\/+$/, ''))
  .refine(u => new URL(u).pathname === '/' || new URL(u).pathname === '', {
    message: 'debe ser un origen o una URL base sin ruta',
  })

/** Origen (esquema + host + puerto) sin barra final. */
const origin = z
  .url({ protocol: /^https?$/ })
  .transform(u => u.replace(/\/+$/, ''))
  .refine(u => new URL(u).origin === u, { message: 'debe ser un origen (sin ruta ni query)' })

/** Lista separada por comas; vacía es válida. */
const list = (item: z.ZodType<string, string>) =>
  z
    .string()
    .transform(s =>
      s
        .split(',')
        .map(x => x.trim())
        .filter(x => x.length > 0),
    )
    .pipe(z.array(item))

/** Rango CIDR IPv4 o IPv6 (`1.2.3.0/24`, `2400:cb00::/32`) o una IP suelta. */
export const cidrSchema = z.string().refine(
  value => {
    const [address = '', prefix, ...rest] = value.split('/')
    const family = isIP(address)
    if (family === 0 || rest.length > 0) return false
    if (prefix === undefined) return true
    if (!/^\d{1,3}$/.test(prefix)) return false
    return Number(prefix) <= (family === 4 ? 32 : 128)
  },
  { message: 'rango CIDR no válido' },
)

/** Cabecera HTTP (en minúsculas, como las ve Node). */
const headerName = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,64}$/)
  .transform(h => h.toLowerCase())

export const envSchema = z.object({
  PUBLIC_URL: origin,
  EXTRA_ALLOWED_ORIGINS: list(origin),
  HOST: z.string().min(1),
  PORT: int(0, 65535),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DB_POOL_MAX: int(1, 200),
  DB_CONNECT_TIMEOUT_SECONDS: int(1, 600),
  MIGRATE_ON_START: bool,
  MIGRATIONS_DIR: z.string().min(1),
  GITHUB_CLIENT_ID: z.string().regex(/^[A-Za-z0-9._-]{4,100}$/, 'client_id de GitHub no válido'),
  GITHUB_OAUTH_BASE_URL: baseUrl,
  GITHUB_API_BASE_URL: baseUrl,
  GITHUB_WEB_BASE_URL: baseUrl,
  GITHUB_TIMEOUT_MS: int(100, 120_000),
  INSTANCE_NAME: z.string().trim().min(1).max(80),
  IS_OFFICIAL: bool,
  WEB_DIST_DIR: z.string().min(1),
  STATIC_MAX_AGE_SECONDS: int(0, 31_536_000),
  ASSETS_MAX_AGE_SECONDS: int(0, 31_536_000),
  GAME_CONFIG_PATH: z.string().min(1),
  SITE_CONFIG_PATH: z.string().min(1),
  CSP_IMG_ORIGINS: list(origin),
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'nombre de cookie no válido'),
  WEB_SESSION_TTL_SECONDS: int(60),
  MOD_SESSION_TTL_SECONDS: int(60),
  SESSION_TOUCH_INTERVAL_SECONDS: int(1),
  LINK_CODE_TTL_SECONDS: int(5, 3600),
  DEVICE_POLL_LEEWAY_MS: int(0, 10_000),
  TRUST_PROXY_CIDRS: list(cidrSchema),
  REAL_IP_HEADER: headerName,
  RATE_LIMIT_IP_MAX: int(1),
  RATE_LIMIT_IP_WINDOW_MS: int(100),
  RATE_LIMIT_TOKEN_MAX: int(1),
  RATE_LIMIT_TOKEN_WINDOW_MS: int(100),
  WS_PING_INTERVAL_MS: int(1000),
  WS_MAX_CONNECTIONS_PER_USER: int(1, 100),
  WS_MAX_MESSAGE_BYTES: int(64, 1_048_576),
  WS_RATE_LIMIT_MAX: int(1),
  WS_RATE_LIMIT_WINDOW_MS: int(100),
  BODY_LIMIT_BYTES: int(256, 10_485_760),
  SEASON_CHECK_INTERVAL_MS: int(1000),
  SHUTDOWN_TIMEOUT_MS: int(100, 120_000),
  LOG_LEVEL: z.enum(LOG_LEVELS),
})
export type Env = z.output<typeof envSchema>

export interface Config {
  env: Env
  game: GameConfig
  site: SiteConfig
  /** Orígenes aceptados en `Origin` (WebSocket y peticiones con cookie). */
  allowedOrigins: ReadonlySet<string>
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/** Convierte los fallos de zod en una lista legible: `VARIABLE: motivo`. */
export function formatIssues(error: z.ZodError, prefix = ''): string {
  return error.issues
    .map(issue => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(raíz)'
      return `  - ${prefix}${path}: ${issue.message}`
    })
    .join('\n')
}

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    throw new ConfigError(
      `Configuración del entorno incompleta o no válida (revisa deploy/.env.example):\n${formatIssues(result.error)}`,
    )
  }
  return result.data
}

/** Lee y valida un archivo JSON de configuración. */
export function loadJsonFile<T extends z.ZodType>(
  path: string,
  schema: T,
  label: string,
): z.output<T> {
  let raw: string
  try {
    raw = readFileSync(resolve(path), 'utf8')
  } catch (error) {
    throw new ConfigError(`No se puede leer ${label} en "${path}": ${(error as Error).message}`)
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (error) {
    throw new ConfigError(`${label} ("${path}") no es JSON válido: ${(error as Error).message}`)
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    throw new ConfigError(`${label} ("${path}") no es válido:\n${formatIssues(result.error)}`)
  }
  return result.data
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const env = parseEnv(source)
  const game = loadJsonFile(env.GAME_CONFIG_PATH, gameConfigSchema, 'la configuración del juego')
  const site = loadJsonFile(env.SITE_CONFIG_PATH, siteConfigSchema, 'la configuración del sitio')
  return {
    env,
    game,
    site,
    allowedOrigins: new Set([env.PUBLIC_URL, ...env.EXTRA_ALLOWED_ORIGINS]),
  }
}

/** Subconjunto para `db:migrate`: no hace falta el resto de la configuración. */
export const dbEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  DB_CONNECT_TIMEOUT_SECONDS: true,
  MIGRATIONS_DIR: true,
  LOG_LEVEL: true,
})
export type DbEnv = z.output<typeof dbEnvSchema>

export function loadDbEnv(source: NodeJS.ProcessEnv = process.env): DbEnv {
  const result = dbEnvSchema.safeParse(source)
  if (!result.success) {
    throw new ConfigError(
      `Configuración de la base de datos incompleta o no válida:\n${formatIssues(result.error)}`,
    )
  }
  return result.data
}

// ---------------------------------------------------------------- GitHub falso (solo desarrollo)

export const fakeGitHubEnvSchema = z.object({
  FAKE_GITHUB_HOST: z.string().min(1),
  FAKE_GITHUB_PORT: int(0, 65535),
  /** URL con la que el navegador y el servidor llegan al GitHub falso (para avatares y la página). */
  FAKE_GITHUB_PUBLIC_URL: origin,
  /** `client_id` que acepta (el mismo que GITHUB_CLIENT_ID del servidor). */
  FAKE_GITHUB_CLIENT_ID: z.string().min(1),
  FAKE_GITHUB_USER_ID: int(1),
  FAKE_GITHUB_USER_LOGIN: z.string().regex(/^[A-Za-z0-9-]{1,39}$/),
  FAKE_GITHUB_INTERVAL_SECONDS: int(1, 60),
  FAKE_GITHUB_EXPIRES_IN_SECONDS: int(10, 3600),
  LOG_LEVEL: z.enum(LOG_LEVELS),
})
export type FakeGitHubEnv = z.output<typeof fakeGitHubEnvSchema>

export function loadFakeGitHubEnv(source: NodeJS.ProcessEnv = process.env): FakeGitHubEnv {
  const result = fakeGitHubEnvSchema.safeParse(source)
  if (!result.success) {
    throw new ConfigError(
      `Configuración del GitHub falso no válida:\n${formatIssues(result.error)}`,
    )
  }
  return result.data
}
