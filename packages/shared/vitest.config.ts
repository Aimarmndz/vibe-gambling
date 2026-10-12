// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        'src/roulette/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/game/**': { lines: 95, branches: 95, functions: 95, statements: 95 },
      },
    },
  },
})
