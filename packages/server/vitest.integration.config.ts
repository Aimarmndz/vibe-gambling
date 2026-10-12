// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests de integración contra un Postgres real: el de TEST_DATABASE_URL si existe (CI) o uno
// efímero levantado con testcontainers. Cada archivo de test trabaja en su propia base de datos,
// clonada de una plantilla ya migrada.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
