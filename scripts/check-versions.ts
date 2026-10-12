// SPDX-License-Identifier: AGPL-3.0-or-later
// Comprueba que la versión del proyecto es la misma en todos los manifiestos (ver
// scripts/lib/versions.ts), que la copia generada del manifiesto del mod
// (`packages/mod/hooks/generated/manifest.ts`) está al día y que CHANGELOG.md tiene su sección.
//
// Uso:
//   node scripts/check-versions.ts                 # en `pnpm lint` y en el CI
//   node scripts/check-versions.ts --tag v1.2.3    # en el workflow de release: la etiqueta
//                                                  # empujada tiene que ser `v` + esa versión
// Sale con código 1 si algo no cuadra y con 2 si los argumentos no son válidos.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseArgs } from 'node:util'

import { findSection, parseChangelog } from './lib/changelog.ts'
import { ROOT } from './lib/repo.ts'
import { checkVersions } from './lib/versions.ts'
import { isModManifestFresh, MOD_MANIFEST_MODULE } from './lib/mod-manifest.ts'

async function main(): Promise<number> {
  let tag: string | undefined
  try {
    tag = parseArgs({ options: { tag: { type: 'string' } } }).values.tag
  } catch (error) {
    console.error(`check-versions: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  const { version, problems } = checkVersions()
  if (tag !== undefined && tag !== `v${version}`) {
    problems.push(`tag "${tag}" does not match the project version (expected "v${version}")`)
  }
  if (!(await isModManifestFresh())) {
    problems.push(
      `${relative(ROOT, MOD_MANIFEST_MODULE)} does not match the mod's plugin.json (run \`pnpm sync:mod\`)`,
    )
  }
  const changelog = parseChangelog(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'))
  const section = findSection(changelog, version)
  if (section === undefined) {
    problems.push(`CHANGELOG.md has no section for [${version}]`)
  } else if (section.body === '') {
    problems.push(`CHANGELOG.md section [${version}] is empty`)
  }

  if (problems.length > 0) {
    console.error(`check-versions: ${problems.length} problem(s):`)
    for (const problem of problems) console.error(`  - ${problem}`)
    console.error('Use `pnpm release <bump|version>` to change the version everywhere at once.')
    return 1
  }
  console.log(`check-versions: every manifest and CHANGELOG.md agree on ${version}`)
  return 0
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`check-versions: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
