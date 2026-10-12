// SPDX-License-Identifier: AGPL-3.0-or-later
// Utilidades comunes de los scripts de release: raíz del repo, git y datos del package.json raíz.
// Todo lo que identifica al proyecto (nombre, URL del repo, imagen) sale del package.json raíz,
// nunca de constantes en el código.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Ejecuta git en la raíz del repo y devuelve la salida sin el salto de línea final. */
export function git(args: readonly string[], options: { cwd?: string } = {}): string {
  return execFileSync('git', args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).replace(/\n$/, '')
}

/** Como `git`, pero devuelve `null` si git sale con error (p. ej. una referencia que no existe). */
export function gitOrNull(args: readonly string[]): string | null {
  try {
    return git(args)
  } catch {
    return null
  }
}

export function readJson(path: string): unknown {
  const absolute = join(ROOT, path)
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'))
  } catch (error) {
    throw new Error(
      `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

export interface ProjectInfo {
  /** Nombre del proyecto (`name` del package.json raíz). */
  readonly name: string
  /** URL web del repo, sin `.git` (`https://github.com/<owner>/<repo>`). */
  readonly repoUrl: string
  /** `<owner>/<repo>` tal cual en GitHub. */
  readonly repoSlug: string
  /** Imagen del registro de GitHub, en minúsculas como exige el registro. */
  readonly image: string
  /** Rango de Node de `engines.node`. */
  readonly nodeEngines: string
}

/** Lee la identidad del proyecto del package.json raíz (`name`, `repository.url`, `engines`). */
export function projectInfo(): ProjectInfo {
  const pkg = readJson('package.json')
  if (typeof pkg !== 'object' || pkg === null) throw new Error('package.json is not an object')
  const { name, repository, engines } = pkg as {
    name?: unknown
    repository?: { url?: unknown }
    engines?: { node?: unknown }
  }
  if (typeof name !== 'string') throw new Error('package.json has no "name"')
  const rawUrl = repository?.url
  if (typeof rawUrl !== 'string') throw new Error('package.json has no "repository.url"')
  const match = /^(?:git\+)?(https:\/\/github\.com\/([^/]+\/[^/]+?))(?:\.git)?$/.exec(rawUrl)
  if (match === null || match[1] === undefined || match[2] === undefined) {
    throw new Error(`package.json "repository.url" is not a GitHub URL: ${rawUrl}`)
  }
  if (typeof engines?.node !== 'string') throw new Error('package.json has no "engines.node"')
  return {
    name,
    repoUrl: match[1],
    repoSlug: match[2],
    image: `ghcr.io/${match[2].toLowerCase()}`,
    nodeEngines: engines.node,
  }
}
