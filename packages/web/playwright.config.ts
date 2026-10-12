// SPDX-License-Identifier: AGPL-3.0-or-later
// Playwright contra la pila de verdad: el servidor compilado (sirviendo la build de la web) y el
// GitHub falso, contra la base de datos de DATABASE_URL (el CI la pone). En local, sin DATABASE_URL,
// usa E2E_DATABASE_URL: una base aparte (`vibe_e2e`) en el Postgres de la pila de desarrollo, que
// se crea sola si no existe (e2e/ensure-db.ts), para no llenar el ranking de desarrollo de
// usuarios `e2e-*`. Cada ejecución usa un usuario de GitHub falso nuevo: empieza con saldo limpio.
// Requisitos: `pnpm build` (servidor y web) y Postgres accesible.
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, devices } from '@playwright/test'
import { z } from 'zod'

const here = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(here, '../..')
const serverDir = resolve(repoRoot, 'packages/server')

const e2eSchema = z.object({
  E2E_SERVER_PORT: z.coerce.number().int().min(1).max(65535),
  E2E_FAKE_GITHUB_PORT: z.coerce.number().int().min(1).max(65535),
  E2E_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Base de mantenimiento a la que conectarse para crear la del E2E si no existe. */
  E2E_ADMIN_DATABASE: z.string().regex(/^[A-Za-z0-9_]{1,63}$/),
  /**
   * Opcional: servidor de navegadores de Playwright (`playwright run-server`) para WebKit/Firefox
   * cuando el sistema no puede ejecutarlos (p. ej. WebKit en Arch: le faltan bibliotecas de
   * Ubuntu). Ver docs/DECISIONES.md, sección Web. En el CI (Ubuntu) van en local.
   */
  E2E_WEBKIT_WS_ENDPOINT: z.url().optional(),
  E2E_FIREFOX_WS_ENDPOINT: z.url().optional(),
})

function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m) out[m[1]!] = m[2]!
  }
  return out
}

const e2e = e2eSchema.parse({ ...readEnvFile(resolve(here, 'e2e/e2e.env')), ...process.env })
const baseURL = `http://localhost:${e2e.E2E_SERVER_PORT}`
const fakeGitHub = `http://localhost:${e2e.E2E_FAKE_GITHUB_PORT}`
// Los tests lo necesitan para distinguir avatares de esta ejecución (ver smoke.spec.ts).
process.env.E2E_FAKE_GITHUB_URL = fakeGitHub
// Usuario de GitHub falso único por ejecución (id y login), para empezar siempre con saldo limpio.
const runId = process.env.E2E_RUN_ID ?? Date.now().toString(36)
process.env.E2E_RUN_ID = runId
const fakeUserId = String(1_000_000 + (parseInt(runId, 36) % 1_000_000_000))

/** Entorno común: el de desarrollo (deploy/dev.env vía --env-file) con lo que cambia en el E2E. */
const env: Record<string, string> = {
  PORT: String(e2e.E2E_SERVER_PORT),
  PUBLIC_URL: baseURL,
  EXTRA_ALLOWED_ORIGINS: baseURL,
  DATABASE_URL: process.env.DATABASE_URL ?? e2e.E2E_DATABASE_URL,
  GITHUB_OAUTH_BASE_URL: fakeGitHub,
  GITHUB_API_BASE_URL: fakeGitHub,
  GITHUB_WEB_BASE_URL: fakeGitHub,
  CSP_IMG_ORIGINS: fakeGitHub,
  WEB_DIST_DIR: resolve(here, 'dist'),
  MIGRATIONS_DIR: resolve(serverDir, 'drizzle'),
  GAME_CONFIG_PATH: resolve(repoRoot, 'config/game.json'),
  SITE_CONFIG_PATH: resolve(repoRoot, 'config/site.json'),
  FAKE_GITHUB_PORT: String(e2e.E2E_FAKE_GITHUB_PORT),
  FAKE_GITHUB_PUBLIC_URL: fakeGitHub,
  FAKE_GITHUB_USER_ID: fakeUserId,
  FAKE_GITHUB_USER_LOGIN: `e2e-${runId}`,
  LOG_LEVEL: 'warn',
  E2E_ADMIN_DATABASE: e2e.E2E_ADMIN_DATABASE,
}

/** Conectar a un servidor de navegadores remoto si se ha configurado uno. */
function remote(wsEndpoint: string | undefined) {
  return wsEndpoint ? { connectOptions: { wsEndpoint } } : {}
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 180_000,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    viewport: { width: 960, height: 720 },
    locale: 'es-ES',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    {
      // Chromium hace el recorrido completo (y las capturas de docs/screenshots) y el humo.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 960, height: 720 } },
    },
    {
      name: 'firefox',
      testMatch: 'smoke.spec.ts',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 960, height: 720 },
        launchOptions: {},
        ...remote(e2e.E2E_FIREFOX_WS_ENDPOINT),
      },
    },
    {
      name: 'webkit',
      testMatch: 'smoke.spec.ts',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 960, height: 720 },
        launchOptions: {},
        ...remote(e2e.E2E_WEBKIT_WS_ENDPOINT),
      },
    },
  ],
  webServer: [
    {
      command: 'node --env-file=../../deploy/dev.env dist/fake-github.js',
      cwd: serverDir,
      url: `${fakeGitHub}/healthz`,
      env,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Primero, la base de datos del E2E (si no existe); el servidor aplica las migraciones.
      // Ruta relativa al cwd: una absoluta sin comillas se rompería con espacios en la ruta del repo.
      command: `node ${relative(serverDir, resolve(here, 'e2e/ensure-db.ts'))} && node --env-file=../../deploy/dev.env dist/main.js`,
      cwd: serverDir,
      url: `${baseURL}/healthz`,
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
