// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests unitarios: sin Docker ni base de datos.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
})
