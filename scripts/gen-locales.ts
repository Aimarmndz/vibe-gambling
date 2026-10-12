// SPDX-License-Identifier: AGPL-3.0-or-later
// Registro de idiomas a partir de la carpeta `locales/` (una subcarpeta por idioma).
//
// La web descubre los idiomas sola con `import.meta.glob`. Lo que no puede descubrirlos en tiempo
// de ejecución lo genera este script:
//   - `packages/shared/src/i18n/locales.generated.ts`: la lista de idiomas válidos del protocolo
//     (`localeSchema`), que también llega al servidor y, vía `pnpm sync:mod`, al mod.
//   - `packages/mod/hooks/generated/{locales,phrases.<idioma>,texts.<idioma>}.ts`: la copia de
//     las frases y los textos del mod (el mod se instala solo y no puede leer fuera de su carpeta).
//   - Las opciones de `language` en el `userConfig` de `packages/mod/.claude-plugin/plugin.json`.
//
// Antes de escribir nada valida cada carpeta (esquemas zod de `shared/src/i18n/schemas.ts`) y su
// paridad con el inglés: mismas claves y mismos `{marcadores}`.
//
// Uso: `node scripts/gen-locales.ts` (escribe) o `node scripts/gen-locales.ts --check` (falla si
// algo generado no está al día; va en `pnpm lint` y en el CI).
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, resolveConfig } from 'prettier'

import { phraseParityProblems, textParityProblems } from '../packages/shared/src/i18n/parity.ts'
import type { PhraseCatalog } from '../packages/shared/src/i18n/phrases.ts'
import {
  LOCALE_FILES,
  REFERENCE_LOCALE,
  TEXT_FILES,
  localeCodeSchema,
  parseLocaleFile,
} from '../packages/shared/src/i18n/schemas.ts'
import type { LocaleMeta, TextCatalog } from '../packages/shared/src/i18n/schemas.ts'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const LOCALES_DIR = join(REPO_ROOT, 'locales')
const SHARED_REGISTRY = join(REPO_ROOT, 'packages/shared/src/i18n/locales.generated.ts')
const MOD_GENERATED = join(REPO_ROOT, 'packages/mod/hooks/generated')
const MOD_MANIFEST = join(REPO_ROOT, 'packages/mod/.claude-plugin/plugin.json')

const SPDX = '// SPDX-License-Identifier: AGPL-3.0-or-later'

/** Contenido validado de la carpeta de un idioma. */
export interface LocaleFolder {
  readonly meta: LocaleMeta
  readonly phrases: PhraseCatalog
  readonly texts: Readonly<Record<(typeof TEXT_FILES)[number], TextCatalog>>
}

function banner(source: string): string {
  return `// GENERADO por scripts/gen-locales.ts a partir de ${source}. No lo edites a mano.`
}

/** Identificador válido para un idioma (`pt-BR` → `PtBR`). */
function suffixOf(code: string): string {
  return code
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${relative(REPO_ROOT, path)} no es JSON válido: ${String(error)}`, {
      cause: error,
    })
  }
}

/** Lee y valida todas las carpetas de `locales/`, ordenadas por `meta.order`. */
export async function readLocales(dir = LOCALES_DIR): Promise<LocaleFolder[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const problems: string[] = []
  const folders: LocaleFolder[] = []
  for (const entry of entries
    .filter(e => e.isDirectory())
    .sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const code = entry.name
    if (!localeCodeSchema.safeParse(code).success) {
      problems.push(
        `locales/${code}: el nombre de la carpeta no es un código de idioma (es, pt-BR…)`,
      )
      continue
    }
    const data: Partial<Record<(typeof LOCALE_FILES)[number], unknown>> = {}
    for (const file of LOCALE_FILES) {
      const path = join(dir, code, `${file}.json`)
      let raw: unknown
      try {
        raw = await readJson(path)
      } catch (error) {
        problems.push(`locales/${code}/${file}.json: ${(error as Error).message}`)
        continue
      }
      const parsed = parseLocaleFile(file, raw)
      if (!parsed.ok) {
        problems.push(`locales/${code}/${file}.json:\n${parsed.error}`)
        continue
      }
      data[file] = parsed.data
    }
    const meta = data.meta as LocaleMeta | undefined
    if (meta && meta.code !== code) {
      problems.push(`locales/${code}/meta.json: "code" es "${meta.code}" y debe ser "${code}"`)
    }
    if (Object.keys(data).length === LOCALE_FILES.length) {
      folders.push({
        meta: meta!,
        phrases: data.phrases as PhraseCatalog,
        texts: Object.fromEntries(TEXT_FILES.map(f => [f, data[f] as TextCatalog])) as Record<
          (typeof TEXT_FILES)[number],
          TextCatalog
        >,
      })
    }
  }

  const reference = folders.find(f => f.meta.code === REFERENCE_LOCALE)
  if (!reference && problems.length === 0) {
    problems.push(`falta la carpeta del idioma de referencia: locales/${REFERENCE_LOCALE}`)
  }
  const orders = new Map<number, string>()
  for (const folder of folders) {
    const other = orders.get(folder.meta.order)
    if (other !== undefined) {
      problems.push(
        `locales/${folder.meta.code}: "order" ${folder.meta.order} repetido con ${other}`,
      )
    }
    orders.set(folder.meta.order, folder.meta.code)
    if (!reference || folder === reference) continue
    for (const file of TEXT_FILES) {
      for (const p of textParityProblems(reference.texts[file], folder.texts[file])) {
        problems.push(`locales/${folder.meta.code}/${file}.json: ${p}`)
      }
    }
    for (const p of phraseParityProblems(reference.phrases, folder.phrases)) {
      problems.push(`locales/${folder.meta.code}/phrases.json: ${p}`)
    }
  }
  if (problems.length > 0) {
    throw new Error(`Hay problemas en locales/:\n- ${problems.join('\n- ')}`)
  }
  return folders.sort((a, b) => a.meta.order - b.meta.order)
}

function renderSharedRegistry(folders: readonly LocaleFolder[]): string {
  return [
    SPDX,
    banner('locales/*/meta.json'),
    '// Idiomas registrados, en el orden de los selectores. Añadir uno: ver locales/README.md.',
    '',
    `export const LOCALES = ${JSON.stringify(folders.map(f => f.meta.code))} as const`,
    '',
  ].join('\n')
}

function renderModPhrases(folder: LocaleFolder): string {
  const { code } = folder.meta
  return [
    SPDX,
    banner(`locales/${code}/phrases.json`),
    "import type { PhraseCatalog } from './phrases.ts'",
    '',
    `export const phrases${suffixOf(code)}: PhraseCatalog = ${JSON.stringify(folder.phrases)}`,
    '',
  ].join('\n')
}

function renderModTexts(folder: LocaleFolder): string {
  const { code } = folder.meta
  return [
    SPDX,
    banner(`locales/${code}/mod.json`),
    "import type { ModTexts } from './locales.ts'",
    '',
    `export const modTexts${suffixOf(code)}: ModTexts = ${JSON.stringify(folder.texts.mod)}`,
    '',
  ].join('\n')
}

function renderModIndex(folders: readonly LocaleFolder[], reference: LocaleFolder): string {
  const imports = folders.flatMap(f => [
    `import { phrases${suffixOf(f.meta.code)} } from './phrases.${f.meta.code}.ts'`,
    `import { modTexts${suffixOf(f.meta.code)} } from './texts.${f.meta.code}.ts'`,
  ])
  const record = (prefix: string) =>
    `{ ${folders.map(f => `${JSON.stringify(f.meta.code)}: ${prefix}${suffixOf(f.meta.code)}`).join(', ')} }`
  const info = Object.fromEntries(
    folders.map(f => [
      f.meta.code,
      {
        bcp47: f.meta.bcp47,
        nativeName: f.meta.nativeName,
        groupSeparator: f.meta.groupSeparator,
      },
    ]),
  )
  return [
    SPDX,
    banner('locales/*/{meta,phrases,mod}.json'),
    '// Idiomas del mod: metadatos, frases de ludópata y textos de cada uno.',
    "import type { PhraseCatalog } from './phrases.ts'",
    "import type { Locale } from './protocol.ts'",
    ...imports,
    '',
    `export const REFERENCE_LOCALE = ${JSON.stringify(reference.meta.code)} as const`,
    '',
    '/** Claves de los textos del mod (las del idioma de referencia). */',
    `export type ModTextKey = ${Object.keys(reference.texts.mod)
      .map(k => JSON.stringify(k))
      .join(' | ')}`,
    'export type ModTexts = Readonly<Record<ModTextKey, string>>',
    '',
    'export interface LocaleInfo {',
    '  readonly bcp47: string',
    '  readonly nativeName: string',
    '  /** Separador de miles de las cifras. */',
    '  readonly groupSeparator: string',
    '}',
    '',
    `export const LOCALE_INFO: Readonly<Record<Locale, LocaleInfo>> = ${JSON.stringify(info)}`,
    `export const PHRASES: Readonly<Record<Locale, PhraseCatalog>> = ${record('phrases')}`,
    `export const MOD_TEXTS: Readonly<Record<Locale, ModTexts>> = ${record('modTexts')}`,
    '',
  ].join('\n')
}

/**
 * `plugin.json` con las opciones de `language` al día (`auto` + los idiomas). Se cambia solo ese
 * bloque, como texto, para no tocar el formato del resto del manifiesto.
 */
export function renderManifest(text: string, folders: readonly LocaleFolder[]): string {
  const codes = folders.map(f => f.meta.code)
  const options = JSON.stringify(['auto', ...codes]).replaceAll(',', ', ')
  const list =
    codes.length > 1 ? `${codes.slice(0, -1).join(', ')} or ${codes.at(-1)}` : (codes[0] ?? '')
  const description = `Language of the mod's messages: auto (system language), ${list}.`
  const block = /("language"\s*:\s*\{)([^{}]*)(\})/
  const match = block.exec(text)
  if (!match) throw new Error('plugin.json: no encuentro la opción "language" del userConfig')
  let body = match[2]!
  const options_ = /("options"\s*:\s*)\[[^\]]*\]/
  const description_ = /("description"\s*:\s*)"(?:[^"\\]|\\.)*"/
  if (!options_.test(body) || !description_.test(body)) {
    throw new Error('plugin.json: la opción "language" no tiene "options" y "description"')
  }
  body = body
    .replace(options_, (_m, head: string) => `${head}${options}`)
    .replace(description_, (_m, head: string) => `${head}${JSON.stringify(description)}`)
  return (
    text.slice(0, match.index) +
    match[1] +
    body +
    match[3] +
    text.slice(match.index + match[0].length)
  )
}

/** Mismo formato que el resto del repo, para que `prettier --check` no proteste. */
async function prettify(path: string, text: string): Promise<string> {
  const options = await resolveConfig(path)
  return format(text, { ...options, filepath: path })
}

/** Contenido esperado de cada archivo generado (ruta absoluta → texto). */
export async function renderLocaleFiles(dir = LOCALES_DIR): Promise<Map<string, string>> {
  const folders = await readLocales(dir)
  const reference = folders.find(f => f.meta.code === REFERENCE_LOCALE)!
  const files = new Map<string, string>()
  files.set(SHARED_REGISTRY, renderSharedRegistry(folders))
  files.set(join(MOD_GENERATED, 'locales.ts'), renderModIndex(folders, reference))
  for (const folder of folders) {
    files.set(join(MOD_GENERATED, `phrases.${folder.meta.code}.ts`), renderModPhrases(folder))
    files.set(join(MOD_GENERATED, `texts.${folder.meta.code}.ts`), renderModTexts(folder))
  }
  files.set(MOD_MANIFEST, renderManifest(await readFile(MOD_MANIFEST, 'utf8'), folders))
  const out = new Map<string, string>()
  for (const [path, text] of files) out.set(path, await prettify(path, text))
  return out
}

/** Archivos generados de un idioma que ya no existe (`phrases.xx.ts`, `texts.xx.ts`). */
async function orphanedFiles(expected: ReadonlyMap<string, string>): Promise<string[]> {
  const names = await readdir(MOD_GENERATED)
  return names
    .filter(name => /^(?:phrases|texts)\.[A-Za-z-]+\.ts$/.test(name))
    .map(name => join(MOD_GENERATED, name))
    .filter(path => !expected.has(path))
}

/** Archivos generados que faltan, sobran o no coinciden con `locales/`. */
export async function staleLocaleFiles(): Promise<string[]> {
  const expected = await renderLocaleFiles()
  const stale: string[] = []
  for (const [path, text] of expected) {
    const current = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (current !== text) stale.push(relative(REPO_ROOT, path))
  }
  for (const path of await orphanedFiles(expected)) stale.push(relative(REPO_ROOT, path))
  return stale
}

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    const stale = await staleLocaleFiles()
    if (stale.length > 0) {
      console.error(
        `El registro de idiomas no está al día: ${stale.join(', ')}.\n` +
          'Ejecuta `pnpm gen:locales` (y `pnpm sync:mod`) y añade los cambios.',
      )
      process.exitCode = 1
      return
    }
    console.log('El registro de idiomas está al día.')
    return
  }
  const expected = await renderLocaleFiles()
  for (const [path, text] of expected) {
    await writeFile(path, text)
    console.log(`escrito ${relative(REPO_ROOT, path)}`)
  }
  const { rm } = await import('node:fs/promises')
  for (const path of await orphanedFiles(expected)) {
    await rm(path)
    console.log(`borrado ${relative(REPO_ROOT, path)}`)
  }
}

if (import.meta.main) await main()
