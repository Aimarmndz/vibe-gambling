// SPDX-License-Identifier: AGPL-3.0-or-later
// Genera en `packages/mod/hooks/generated/` la copia de lo que el mod necesita de `shared`.
//
// El mod se instala copiando solo `packages/mod`, así que no puede importar `packages/shared`.
// Este script copia las frases (tal cual) y las constantes del protocolo (versión, SO, idiomas,
// códigos de error y rutas). `packages/shared/test/mod-sync.test.ts` falla si la copia está
// desactualizada.
//
// Uso: `node scripts/sync-mod-shared.ts` (escribe) o `node scripts/sync-mod-shared.ts --check`.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, resolveConfig } from 'prettier'

import {
  ERROR_CODES,
  LOCALES,
  OS_VALUES,
  PROTOCOL_VERSION,
} from '../packages/shared/src/protocol/common.ts'
import { API_ROUTES, PAGE_PATHS } from '../packages/shared/src/protocol/routes.ts'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED_I18N = join(REPO_ROOT, 'packages/shared/src/i18n')
export const GENERATED_DIR = join(REPO_ROOT, 'packages/mod/hooks/generated')

/** Archivos de `shared/src/i18n` que se copian tal cual (no importan nada fuera de la carpeta). */
const VERBATIM_I18N = ['phrases.ts', 'phrases.en.ts', 'phrases.es.ts'] as const

const SPDX = '// SPDX-License-Identifier: AGPL-3.0-or-later'

function banner(source: string): string {
  return `// GENERADO por scripts/sync-mod-shared.ts a partir de ${source}. No lo edites a mano.`
}

/** Inserta el aviso de "generado" justo después de la línea SPDX. */
function withBanner(text: string, source: string): string {
  if (!text.startsWith(SPDX)) throw new Error(`${source} no empieza por la cabecera SPDX`)
  return `${SPDX}\n${banner(source)}\n${text.slice(SPDX.length + 1)}`
}

function renderProtocol(): string {
  const constant = (name: string, value: unknown): string =>
    `export const ${name} = ${JSON.stringify(value)} as const`
  return [
    SPDX,
    banner('packages/shared/src/protocol/{common,routes}.ts'),
    '// Constantes del protocolo que usa el mod: versión, SO, idiomas, errores y rutas.',
    '',
    constant('PROTOCOL_VERSION', PROTOCOL_VERSION),
    constant('OS_VALUES', OS_VALUES),
    'export type Os = (typeof OS_VALUES)[number]',
    constant('LOCALES', LOCALES),
    'export type Locale = (typeof LOCALES)[number]',
    constant('ERROR_CODES', ERROR_CODES),
    'export type ErrorCode = (typeof ERROR_CODES)[number]',
    constant('API_ROUTES', API_ROUTES),
    'export type ApiRouteName = keyof typeof API_ROUTES',
    constant('PAGE_PATHS', PAGE_PATHS),
    '',
  ].join('\n')
}

/** Devuelve el contenido esperado de cada archivo generado (ruta absoluta → texto). */
export async function renderModSharedFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  for (const name of VERBATIM_I18N) {
    const source = join(SHARED_I18N, name)
    const text = await readFile(source, 'utf8')
    files.set(join(GENERATED_DIR, name), withBanner(text, relative(REPO_ROOT, source)))
  }
  files.set(join(GENERATED_DIR, 'protocol.ts'), renderProtocol())

  // Mismo formato que el resto del repo, para que `prettier --check` no proteste.
  const formatted = new Map<string, string>()
  for (const [path, text] of files) {
    const options = await resolveConfig(path)
    formatted.set(path, await format(text, { ...options, filepath: path }))
  }
  return formatted
}

/** Lista los archivos generados que faltan o no coinciden con `shared`. */
export async function staleModSharedFiles(): Promise<string[]> {
  const stale: string[] = []
  for (const [path, expected] of await renderModSharedFiles()) {
    const current = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (current !== expected) stale.push(relative(REPO_ROOT, path))
  }
  return stale
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    const stale = await staleModSharedFiles()
    if (stale.length > 0) {
      console.error(
        `La copia de shared en el mod está desactualizada: ${stale.join(', ')}.\n` +
          'Ejecuta `pnpm sync:mod` y añade los cambios.',
      )
      process.exitCode = 1
      return
    }
    console.log('La copia de shared en el mod está al día.')
    return
  }
  await mkdir(GENERATED_DIR, { recursive: true })
  for (const [path, text] of await renderModSharedFiles()) {
    await writeFile(path, text)
    console.log(`escrito ${relative(REPO_ROOT, path)}`)
  }
}

if (import.meta.main) await main()
