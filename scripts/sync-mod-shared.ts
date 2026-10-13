// SPDX-License-Identifier: AGPL-3.0-or-later
// Genera en `packages/mod/hooks/generated/` la copia de lo que el mod necesita de `shared`.
//
// El mod se instala copiando solo `packages/mod`, así que no puede importar `packages/shared`.
// Este script copia la lógica de las frases (tal cual; las frases de cada idioma las genera
// `scripts/gen-locales.ts` desde `locales/`) y las constantes del protocolo (versión, SO, idiomas,
// códigos de error, longitudes de los textos y rutas). `packages/shared/test/mod-contract.test.ts`
// falla si la copia está desactualizada.
//
// También escribe `manifest.ts` (versión y valores por defecto del `plugin.json` del mod), que se
// genera en scripts/lib/mod-manifest.ts.
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
  TEXT_LIMITS,
} from '../packages/shared/src/protocol/common.ts'
import { API_ROUTES, PAGE_PATHS } from '../packages/shared/src/protocol/routes.ts'
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_REJECTIONS,
} from '../packages/shared/src/game/referral.ts'
import {
  CHIP_SKIN_IDS,
  CONSUMABLE_IDS,
  COSMETIC_IDS,
  FELT_IDS,
  ITEM_IDS,
} from '../packages/shared/src/game/items.ts'
import { MOD_MANIFEST_MODULE, renderModManifest } from './lib/mod-manifest.ts'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHARED_I18N = join(REPO_ROOT, 'packages/shared/src/i18n')
export const GENERATED_DIR = join(REPO_ROOT, 'packages/mod/hooks/generated')

/** Archivos de `shared/src/i18n` que se copian tal cual (no importan nada fuera de la carpeta). */
const VERBATIM_I18N = ['phrases.ts'] as const

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
    banner('packages/shared/src/{protocol/common,protocol/routes,game/referral,game/items}.ts'),
    '// Constantes del protocolo que usa el mod: versión, SO, idiomas, errores, textos, rutas, el',
    '// formato de los códigos de afiliado y los ids del catálogo de la TIENDA.',
    '',
    constant('PROTOCOL_VERSION', PROTOCOL_VERSION),
    constant('OS_VALUES', OS_VALUES),
    'export type Os = (typeof OS_VALUES)[number]',
    constant('LOCALES', LOCALES),
    'export type Locale = (typeof LOCALES)[number]',
    constant('ERROR_CODES', ERROR_CODES),
    'export type ErrorCode = (typeof ERROR_CODES)[number]',
    constant('TEXT_LIMITS', TEXT_LIMITS),
    constant('API_ROUTES', API_ROUTES),
    'export type ApiRouteName = keyof typeof API_ROUTES',
    constant('PAGE_PATHS', PAGE_PATHS),
    constant('REFERRAL_CODE_ALPHABET', REFERRAL_CODE_ALPHABET),
    constant('REFERRAL_CODE_LENGTH', REFERRAL_CODE_LENGTH),
    constant('REFERRAL_REJECTIONS', REFERRAL_REJECTIONS),
    'export type ReferralRejection = (typeof REFERRAL_REJECTIONS)[number]',
    constant('ITEM_IDS', ITEM_IDS),
    'export type ItemId = (typeof ITEM_IDS)[number]',
    constant('CONSUMABLE_IDS', CONSUMABLE_IDS),
    'export type ConsumableId = (typeof CONSUMABLE_IDS)[number]',
    constant('COSMETIC_IDS', COSMETIC_IDS),
    constant('FELT_IDS', FELT_IDS),
    constant('CHIP_SKIN_IDS', CHIP_SKIN_IDS),
    '',
  ].join('\n')
}

/** Mismo formato que el resto del repo, para que `prettier --check` no proteste. */
async function prettify(path: string, text: string): Promise<string> {
  const options = await resolveConfig(path)
  return format(text, { ...options, filepath: path })
}

async function readTextOrNull(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
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

  const formatted = new Map<string, string>()
  for (const [path, text] of files) formatted.set(path, await prettify(path, text))
  formatted.set(MOD_MANIFEST_MODULE, await renderModManifest())
  return formatted
}

/** Lista los archivos generados que faltan o no coinciden con `shared`. */
export async function staleModSharedFiles(): Promise<string[]> {
  const stale: string[] = []
  for (const [path, expected] of await renderModSharedFiles()) {
    const current = await readTextOrNull(path)
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
