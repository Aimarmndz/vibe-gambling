// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  cidrSchema,
  ConfigError,
  loadConfig,
  loadDbEnv,
  loadFakeGitHubEnv,
  parseEnv,
} from '../../src/config.ts'
import { testEnv } from '../helpers/env.ts'

describe('configuración', () => {
  it('carga el entorno de test y los JSON del juego y del sitio', () => {
    const config = loadConfig(testEnv())
    expect(config.env.PORT).toBe(0)
    expect(config.env.IS_OFFICIAL).toBe(false)
    expect(config.env.CSP_IMG_ORIGINS).toEqual(['https://avatars.test'])
    expect(config.env.TRUST_PROXY_CIDRS).toEqual([])
    expect(config.env.REAL_IP_HEADER).toBe('cf-connecting-ip')
    expect(config.game.chips).toEqual([10, 50, 100])
    expect(config.site.author.name).toBe('Test Author')
    expect([...config.allowedOrigins]).toEqual(['https://vibe.test'])
  })

  it('falla con un mensaje que nombra cada variable que falta o está mal', () => {
    const env = testEnv({ PORT: 'ochenta', IS_OFFICIAL: 'yes' })
    delete env.DATABASE_URL
    expect(() => parseEnv(env)).toThrow(ConfigError)
    try {
      parseEnv(env)
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('DATABASE_URL')
      expect(message).toContain('PORT')
      expect(message).toContain('IS_OFFICIAL')
      expect(message).toContain('.env.example')
    }
  })

  it('normaliza las URLs base y exige orígenes limpios', () => {
    const env = parseEnv(testEnv({ GITHUB_API_BASE_URL: 'https://api.github.com/' }))
    expect(env.GITHUB_API_BASE_URL).toBe('https://api.github.com')
    expect(() => parseEnv(testEnv({ PUBLIC_URL: 'https://vibe.test/path' }))).toThrow(ConfigError)
    expect(() => parseEnv(testEnv({ PUBLIC_URL: 'ftp://vibe.test' }))).toThrow(ConfigError)
    expect(() => parseEnv(testEnv({ EXTRA_ALLOWED_ORIGINS: 'not a url' }))).toThrow(ConfigError)
  })

  it('valida los rangos CIDR', () => {
    for (const ok of ['173.245.48.0/20', '2400:cb00::/32', '127.0.0.1', '::1/128']) {
      expect(cidrSchema.safeParse(ok).success, ok).toBe(true)
    }
    for (const bad of ['1.2.3.4/33', '2400::/129', 'banana/8', '1.2.3.4/x', '1.2.3.4/8/9']) {
      expect(cidrSchema.safeParse(bad).success, bad).toBe(false)
    }
    const env = parseEnv(testEnv({ TRUST_PROXY_CIDRS: ' 10.0.0.0/8 , ::1/128 ,' }))
    expect(env.TRUST_PROXY_CIDRS).toEqual(['10.0.0.0/8', '::1/128'])
  })

  it('rechaza archivos de configuración ausentes, rotos o inválidos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibe-config-'))
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{ nope')
    const invalid = join(dir, 'invalid.json')
    writeFileSync(invalid, JSON.stringify({ startingBalance: -1 }))
    expect(() => loadConfig(testEnv({ GAME_CONFIG_PATH: join(dir, 'missing.json') }))).toThrow(
      /No se puede leer/,
    )
    expect(() => loadConfig(testEnv({ GAME_CONFIG_PATH: broken }))).toThrow(/no es JSON/)
    expect(() => loadConfig(testEnv({ SITE_CONFIG_PATH: invalid }))).toThrow(/no es válido/)
  })

  it('site.json: exige los datos de la instancia y solo enlaces http(s)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibe-site-'))
    const base = JSON.parse(readFileSync(testEnv().SITE_CONFIG_PATH!, 'utf8')) as {
      instance: Record<string, unknown>
    }
    const write = (name: string, value: unknown) => {
      const path = join(dir, name)
      writeFileSync(path, JSON.stringify(value))
      return path
    }
    const { instance, ...withoutInstance } = base
    const noInstance = write('no-instance.json', withoutInstance)
    expect(() => loadConfig(testEnv({ SITE_CONFIG_PATH: noInstance }))).toThrow(/instance/)
    const evil = write('evil.json', {
      ...base,
      instance: { ...instance, operator: { name: 'x', url: 'javascript:alert(1)' } },
    })
    expect(() => loadConfig(testEnv({ SITE_CONFIG_PATH: evil }))).toThrow(/instance\.operator\.url/)
    const evilRepo = write('evil-repo.json', { ...base, repoUrl: 'data:text/html,hola' })
    expect(() => loadConfig(testEnv({ SITE_CONFIG_PATH: evilRepo }))).toThrow(/repoUrl/)
  })

  it('db:migrate solo necesita las variables de la base de datos', () => {
    const env = loadDbEnv({
      DATABASE_URL: 'postgres://a:b@localhost:5432/db',
      DB_CONNECT_TIMEOUT_SECONDS: '5',
      MIGRATIONS_DIR: './drizzle',
      LOG_LEVEL: 'info',
    })
    expect(env.DB_CONNECT_TIMEOUT_SECONDS).toBe(5)
    expect(() => loadDbEnv({})).toThrow(ConfigError)
  })

  it('el GitHub falso tiene su propia configuración', () => {
    expect(() => loadFakeGitHubEnv({})).toThrow(ConfigError)
    const env = loadFakeGitHubEnv({
      FAKE_GITHUB_HOST: '0.0.0.0',
      FAKE_GITHUB_PORT: '8788',
      FAKE_GITHUB_PUBLIC_URL: 'http://localhost:8788',
      FAKE_GITHUB_CLIENT_ID: 'x',
      FAKE_GITHUB_USER_ID: '1',
      FAKE_GITHUB_USER_LOGIN: 'octo',
      FAKE_GITHUB_INTERVAL_SECONDS: '1',
      FAKE_GITHUB_EXPIRES_IN_SECONDS: '60',
      LOG_LEVEL: 'silent',
    })
    expect(env.FAKE_GITHUB_PORT).toBe(8788)
  })
})
