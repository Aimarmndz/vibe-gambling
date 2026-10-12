// SPDX-License-Identifier: AGPL-3.0-or-later
// Genera `packages/mod/hooks/generated/manifest.ts` con la versión y los valores por defecto del
// `userConfig` de `packages/mod/.claude-plugin/plugin.json`, que es la única fuente: el mod no lee
// su manifiesto en tiempo de ejecución (ver «Repo y CI» en docs/DECISIONES.md).
//
// Lo usan `pnpm sync:mod` (escribe y comprueba, junto con la copia de shared), `pnpm release`
// (lo regenera al subir la versión) y `pnpm lint:versions` (falla si no cuadra). No importa nada
// de `packages/shared`, así los scripts de versiones no dependen de sus dependencias.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { format, resolveConfig } from 'prettier'

import { ROOT } from './repo.ts'
import { parseSemVer } from './semver.ts'

const MOD_MANIFEST = join(ROOT, 'packages/mod/.claude-plugin/plugin.json')
export const MOD_MANIFEST_MODULE = join(ROOT, 'packages/mod/hooks/generated/manifest.ts')

const SPDX = '// SPDX-License-Identifier: AGPL-3.0-or-later'

/**
 * `manifest.ts`: versión del plugin y valor por defecto de cada opción del `userConfig`, sacados
 * del `plugin.json` del mod. Falla si la versión no es SemVer o a una opción le falta `default`.
 */
export function renderManifest(manifestText: string): string {
  const source = relative(ROOT, MOD_MANIFEST)
  const manifest: unknown = JSON.parse(manifestText)
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    throw new Error(`${source} no es un objeto JSON`)
  }
  const { version, userConfig } = manifest as { version?: unknown; userConfig?: unknown }
  if (typeof version !== 'string' || parseSemVer(version) === null) {
    throw new Error(`${source}: "version" no es SemVer válido (${JSON.stringify(version)})`)
  }
  if (typeof userConfig !== 'object' || userConfig === null || Array.isArray(userConfig)) {
    throw new Error(`${source}: falta el objeto "userConfig"`)
  }
  const defaults: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(userConfig)) {
    if (typeof field !== 'object' || field === null || !('default' in field)) {
      throw new Error(`${source}: la opción "${key}" del userConfig no tiene "default"`)
    }
    defaults[key] = (field as { default: unknown }).default
  }
  return [
    SPDX,
    `// GENERADO por scripts/sync-mod-shared.ts a partir de ${source}. No lo edites a mano.`,
    '// Versión del plugin (la que manda en cada turno) y valores por defecto de sus opciones.',
    '',
    `export const PLUGIN_VERSION = ${JSON.stringify(version)}`,
    `export const USER_CONFIG_DEFAULTS = ${JSON.stringify(defaults)} as const`,
    'export type UserConfigKey = keyof typeof USER_CONFIG_DEFAULTS',
    '',
  ].join('\n')
}

/** Contenido esperado de `manifest.ts` (ya con el formato de Prettier del repo). */
export async function renderModManifest(): Promise<string> {
  const text = renderManifest(await readFile(MOD_MANIFEST, 'utf8'))
  const options = await resolveConfig(MOD_MANIFEST_MODULE)
  return format(text, { ...options, filepath: MOD_MANIFEST_MODULE })
}

/** Regenera solo `manifest.ts` (lo usa `pnpm release` tras subir la versión). */
export async function writeModManifest(): Promise<string> {
  await mkdir(dirname(MOD_MANIFEST_MODULE), { recursive: true })
  await writeFile(MOD_MANIFEST_MODULE, await renderModManifest())
  return relative(ROOT, MOD_MANIFEST_MODULE)
}

/** `true` si `manifest.ts` coincide con el `plugin.json` actual. */
export async function isModManifestFresh(): Promise<boolean> {
  const current = await readFile(MOD_MANIFEST_MODULE, 'utf8').catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    },
  )
  return current === (await renderModManifest())
}
