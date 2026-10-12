// SPDX-License-Identifier: AGPL-3.0-or-later
// Empaqueta el servidor con esbuild en `dist/`: un archivo por programa, con todas las
// dependencias dentro. La imagen Docker no necesita node_modules, TypeScript ni `shared`.
import { rm } from 'node:fs/promises'

import { build } from 'esbuild'

await rm('dist', { recursive: true, force: true })
await build({
  entryPoints: {
    main: 'src/main.ts',
    migrate: 'src/migrate.ts',
    'fake-github': 'src/fake-github/main.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  legalComments: 'linked',
  // Dependencias CommonJS dentro de un bundle ESM: necesitan `require`, `__filename` y `__dirname`.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module'",
      "import { fileURLToPath as __fileURLToPath } from 'node:url'",
      "import { dirname as __pathDirname } from 'node:path'",
      'const require = __createRequire(import.meta.url)',
      'const __filename = __fileURLToPath(import.meta.url)',
      'const __dirname = __pathDirname(__filename)',
    ].join('\n'),
  },
  // Aceleradores nativos opcionales de `ws`: si no están, usa JS puro.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'info',
})
