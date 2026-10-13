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
        'src/app/onboarding.ts',
        'src/app/presence.ts',
        'src/ui/counter.ts',
        // Lógica pura de las animaciones de espectáculo (lo que pinta se ve en las capturas E2E).
        'src/render/fx/clock.ts',
        'src/render/fx/easing.ts',
        'src/render/fx/plan.ts',
        'src/render/fx/notices.ts',
        'src/render/fx/odometer.ts',
        'src/render/fx/fire.ts',
        'src/legal/**/*.ts',
        'src/ui/status.ts',
        'src/pages/privacy.ts',
        'src/ui/menu/**/*.ts',
        'src/ui/brandMark.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: {
        'src/game/**': { lines: 95, branches: 90, functions: 95, statements: 95 },
      },
    },
  },
})
