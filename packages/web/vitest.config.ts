// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: [
        'src/game/**/*.ts',
        'src/i18n/**/*.ts',
        'src/net/**/*.ts',
        'src/font/**/*.ts',
        'src/config.ts',
        'src/app/prefs.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: {
        'src/game/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
      },
    },
  },
})
