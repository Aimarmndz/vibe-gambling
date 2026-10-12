// SPDX-License-Identifier: AGPL-3.0-or-later
// Configuración de test: valores propios, nunca los de producción ni los de desarrollo.
import { fileURLToPath } from 'node:url'

import type { Config } from '../../src/config.ts'
import { loadConfig } from '../../src/config.ts'

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url))

export const TEST_PUBLIC_URL = 'https://vibe.test'
export const TEST_GITHUB_OAUTH = 'https://github.test'
export const TEST_GITHUB_API = 'https://api.github.test'
export const TEST_GITHUB_WEB = 'https://github.test'

export function testEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PUBLIC_URL: TEST_PUBLIC_URL,
    EXTRA_ALLOWED_ORIGINS: '',
    HOST: '127.0.0.1',
    PORT: '0',
    DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
    DB_POOL_MAX: '20',
    DB_CONNECT_TIMEOUT_SECONDS: '10',
    MIGRATE_ON_START: 'false',
    MIGRATIONS_DIR,
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_OAUTH_BASE_URL: TEST_GITHUB_OAUTH,
    GITHUB_API_BASE_URL: TEST_GITHUB_API,
    GITHUB_WEB_BASE_URL: TEST_GITHUB_WEB,
    GITHUB_TIMEOUT_MS: '2000',
    INSTANCE_NAME: 'Test Casino',
    IS_OFFICIAL: 'false',
    WEB_DIST_DIR: '/nonexistent/web-dist',
    STATIC_MAX_AGE_SECONDS: '120',
    ASSETS_MAX_AGE_SECONDS: '999',
    GAME_CONFIG_PATH: fixture('game.test.json'),
    SITE_CONFIG_PATH: fixture('site.test.json'),
    CSP_IMG_ORIGINS: 'https://avatars.test',
    SESSION_COOKIE_NAME: 'test_session',
    WEB_SESSION_TTL_SECONDS: '3600',
    MOD_SESSION_TTL_SECONDS: '31536000',
    SESSION_TOUCH_INTERVAL_SECONDS: '60',
    LINK_CODE_TTL_SECONDS: '60',
    DEVICE_POLL_LEEWAY_MS: '0',
    TRUST_PROXY_CIDRS: '',
    REAL_IP_HEADER: 'CF-Connecting-IP',
    RATE_LIMIT_IP_MAX: '100000',
    RATE_LIMIT_IP_WINDOW_MS: '60000',
    RATE_LIMIT_TOKEN_MAX: '100000',
    RATE_LIMIT_TOKEN_WINDOW_MS: '60000',
    WS_PING_INTERVAL_MS: '60000',
    WS_MAX_CONNECTIONS_PER_USER: '3',
    WS_MAX_MESSAGE_BYTES: '1024',
    WS_RATE_LIMIT_MAX: '1000',
    WS_RATE_LIMIT_WINDOW_MS: '10000',
    BODY_LIMIT_BYTES: '4096',
    SEASON_CHECK_INTERVAL_MS: '60000',
    SHUTDOWN_TIMEOUT_MS: '5000',
    LOG_LEVEL: 'silent',
    ...overrides,
  }
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig(testEnv(overrides))
}
