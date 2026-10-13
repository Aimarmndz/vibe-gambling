// SPDX-License-Identifier: AGPL-3.0-or-later
// Comprueba que los enlaces relativos, las imágenes y las anclas de los Markdown del repo existen
// (README.md, README.es.md, docs/, locales/, paquetes…). Las URL absolutas no se comprueban: no
// hace falta red y el CI no depende de que GitHub o un tercero respondan.
// Uso: `node scripts/check-links.ts` (en `pnpm lint`). Sale con 1 si hay enlaces rotos y con 2 si
// no puede listar el repo.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkLinks } from './lib/links.ts'

// Markdown que no se publica con el repo, que no es nuestro o que es una plantilla con `{{marcadores}}`.
const IGNORED: readonly RegExp[] = [
  /(^|\/)node_modules\//,
  /^\.plan\//,
  /(^|\/)dist\//,
  /^scripts\/templates\//,
]

/** Markdown del repo (versionados y nuevos no ignorados), respetando `.gitignore`. */
function listMarkdown(root: string): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return output
    .split('\0')
    .filter(path => path.length > 0 && !IGNORED.some(re => re.test(path)))
    .filter(path => existsSync(join(root, path)))
}

function main(): number {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  let files: string[]
  try {
    files = listMarkdown(root)
  } catch (error) {
    console.error(`check-links: could not list the repository files with git: ${String(error)}`)
    return 2
  }

  const broken = checkLinks(files, {
    exists: path => existsSync(join(root, path)),
    isDirectory: path => statSync(join(root, path)).isDirectory(),
    read: path => readFileSync(join(root, path), 'utf8'),
  })
  if (broken.length > 0) {
    for (const link of broken) {
      console.error(`${link.file}:${String(link.line)}: ${link.target} (${link.reason})`)
    }
    console.error(
      `check-links: ${String(broken.length)} broken link(s) in ${String(files.length)} files`,
    )
    return 1
  }
  console.log(
    `check-links: every relative link and anchor in ${String(files.length)} Markdown files exists`,
  )
  return 0
}

process.exitCode = main()
