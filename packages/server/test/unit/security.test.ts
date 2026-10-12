// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import { ConfigError, parseEnv } from '../../src/config.ts'
import { helmetOptions } from '../../src/http/security.ts'
import { testConfig, testEnv } from '../helpers/env.ts'

describe('cabeceras de seguridad', () => {
  it('la duración de HSTS sale de la configuración, no del código', () => {
    const options = helmetOptions(testConfig({ HSTS_MAX_AGE_SECONDS: '123' }))
    expect(options.strictTransportSecurity).toEqual({ maxAge: 123, includeSubDomains: false })
  })

  it('sin HTTPS no hay HSTS aunque esté configurado', () => {
    const options = helmetOptions(
      testConfig({ PUBLIC_URL: 'http://localhost:8787', HSTS_MAX_AGE_SECONDS: '123' }),
    )
    expect(options.strictTransportSecurity).toBe(false)
  })

  it('HSTS_MAX_AGE_SECONDS es obligatoria', () => {
    const env = testEnv()
    delete env.HSTS_MAX_AGE_SECONDS
    expect(() => parseEnv(env)).toThrow(ConfigError)
  })
})
