// SPDX-License-Identifier: AGPL-3.0-or-later
// La versión del proyecto vive en varios manifiestos y tiene que ser la MISMA en todos:
//
//   - package.json (raíz) y packages/*/package.json: la del servidor es la que expone /api/meta
//     (`serverVersion`, empaquetada por esbuild al compilar);
//   - <plugin>/.claude-plugin/plugin.json: la que el mod manda en cada turno (`pluginVersion`);
//   - .claude-plugin/marketplace.json: `metadata.version` del marketplace y, si alguna entrada de
//     plugin la declarase, también su `version`.
//
// Las rutas se descubren (paquetes del workspace, `source` de cada plugin del marketplace): un
// paquete o un plugin nuevo entra solo en la comprobación.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { readJson, ROOT } from './repo.ts'
import { parseSemVer } from './semver.ts'

const MARKETPLACE = '.claude-plugin/marketplace.json'
const PACKAGES_DIR = 'packages'

export interface VersionField {
  /** Archivo relativo a la raíz del repo. */
  readonly file: string
  /** Ruta del campo dentro del JSON (`['metadata', 'version']`). */
  readonly path: readonly (string | number)[]
  /** Valor actual (`undefined` si falta). */
  readonly value: unknown
}

function getPath(data: unknown, path: readonly (string | number)[]): unknown {
  let current = data
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

function asObject(data: unknown, file: string): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`${file} is not a JSON object`)
  }
  return data as Record<string, unknown>
}

/** Manifiestos de los paquetes del workspace (`packages/<nombre>/package.json`), ordenados. */
function workspacePackageFiles(): string[] {
  return readdirSync(join(ROOT, PACKAGES_DIR), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => `${PACKAGES_DIR}/${entry.name}/package.json`)
    .filter(file => existsSync(join(ROOT, file)))
    .sort()
}

/** Directorios de los plugins que publica el marketplace del repo (`source` relativos). */
export function marketplacePluginDirs(): string[] {
  const marketplace = asObject(readJson(MARKETPLACE), MARKETPLACE)
  const plugins = marketplace['plugins']
  if (!Array.isArray(plugins)) throw new Error(`${MARKETPLACE} has no "plugins" array`)
  return plugins.map((plugin: unknown, index) => {
    const source = getPath(plugin, ['source'])
    if (typeof source !== 'string' || !source.startsWith('./')) {
      throw new Error(`${MARKETPLACE} plugins[${index}].source must be a relative path ("./…")`)
    }
    return source.slice(2).replace(/\/$/, '')
  })
}

/** Todos los campos de versión del repo con su valor actual. */
export function collectVersionFields(): VersionField[] {
  const fields: VersionField[] = []
  const add = (file: string, path: readonly (string | number)[], optional = false): void => {
    const value = getPath(readJson(file), path)
    if (optional && value === undefined) return
    fields.push({ file, path, value })
  }

  add('package.json', ['version'])
  for (const file of workspacePackageFiles()) add(file, ['version'])
  add(MARKETPLACE, ['metadata', 'version'])
  marketplacePluginDirs().forEach((dir, index) => {
    add(`${dir}/.claude-plugin/plugin.json`, ['version'])
    // La versión de la entrada es opcional (manda la de plugin.json), pero si está, debe cuadrar.
    add(MARKETPLACE, ['plugins', index, 'version'], true)
  })
  return fields
}

export interface VersionReport {
  /** Versión del package.json raíz: la referencia. */
  readonly version: string
  /** Problemas encontrados; vacío si todo cuadra. */
  readonly problems: string[]
}

const formatField = (field: VersionField): string => `${field.file} → ${field.path.join('.')}`

/** Comprueba que todos los campos existen, son SemVer válido y coinciden con el de la raíz. */
export function checkVersions(
  fields: readonly VersionField[] = collectVersionFields(),
): VersionReport {
  const reference = fields[0]
  const version = typeof reference?.value === 'string' ? reference.value : ''
  const problems: string[] = []
  if (parseSemVer(version) === null) {
    problems.push(`package.json → version "${String(reference?.value)}" is not valid SemVer`)
  }
  for (const field of fields.slice(1)) {
    if (typeof field.value !== 'string') {
      problems.push(`${formatField(field)} is missing (expected "${version}")`)
    } else if (field.value !== version) {
      problems.push(`${formatField(field)} is "${field.value}", expected "${version}"`)
    }
  }
  return { version, problems }
}

/**
 * Cambia la versión en el texto de un manifiesto sin reformatearlo: sustituye solo los valores
 * `"version": "<from>"` y comprueba al volver a leerlo que no ha cambiado nada más.
 */
export function replaceVersionInText(text: string, file: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`("version"\\s*:\\s*)"${escaped}"`, 'g')
  const updated = text.replace(re, `$1"${to}"`)
  const before = JSON.parse(text) as unknown
  const after = JSON.parse(updated) as unknown
  // Con las versiones normalizadas, el antes y el después tienen que ser idénticos.
  const normalize = (data: unknown, value: string): string =>
    JSON.stringify(data, (key, current: unknown) =>
      key === 'version' && current === value ? '<version>' : current,
    )
  if (normalize(before, from) !== normalize(after, to)) {
    throw new Error(`${file}: replacing the version changed something else`)
  }
  return updated
}

/** Escribe la versión nueva en todos los manifiestos. Devuelve los archivos tocados. */
export function writeVersion(from: string, to: string): string[] {
  const files = [...new Set(collectVersionFields().map(field => field.file))]
  for (const file of files) {
    const absolute = join(ROOT, file)
    const text = readFileSync(absolute, 'utf8')
    writeFileSync(absolute, replaceVersionInText(text, file, from, to))
  }
  return files
}
