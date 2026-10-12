// SPDX-License-Identifier: AGPL-3.0-or-later
// Comprueba que cada archivo fuente del repo lleva la cabecera SPDX de la licencia.
// Uso: `node scripts/check-spdx.ts` (Node ≥ 23.6 ejecuta TypeScript con type stripping).
// Sale con código 1 y lista los archivos que fallan; con código 2 si no puede listar el repo.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED = 'SPDX-License-Identifier: AGPL-3.0-or-later'

// Extensiones que cuentan como código fuente.
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.glsl',
  '.vert',
  '.frag',
  '.css',
  '.html',
])

// Rutas que no son nuestras o que se generan solas. Se comparan contra la ruta relativa con `/`.
const IGNORED: readonly RegExp[] = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)playwright-report\//,
  /(^|\/)test-results\//,
  /^\.plan\//,
  // Tipos que escribe el engine de Claude Code al cargar el mod.
  /^packages\/mod\/\.claude-plugin\/types\//,
  // Migraciones y metadatos generados por drizzle-kit.
  /^packages\/server\/drizzle\//,
  // Convención para cualquier otro archivo generado.
  /\.generated\.[a-z]+$/,
]

// La cabecera tiene que estar al principio: se deja margen para un shebang o `<!doctype html>`.
const HEADER_LINES = 5

/** Lista los archivos del repo (versionados y nuevos no ignorados), respetando `.gitignore`. */
function listRepoFiles(root: string): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return output.split('\0').filter(path => path.length > 0)
}

export function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase()) && !IGNORED.some(re => re.test(path))
}

export function hasSpdxHeader(content: string): boolean {
  return content.split(/\r?\n/, HEADER_LINES).some(line => line.includes(EXPECTED))
}

function main(): number {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  let files: string[]
  try {
    files = listRepoFiles(root)
  } catch (error) {
    console.error(`check-spdx: could not list the repository files with git: ${String(error)}`)
    return 2
  }

  const missing: string[] = []
  let checked = 0
  for (const path of files.filter(isSourceFile)) {
    let content: string
    try {
      content = readFileSync(join(root, path), 'utf8')
    } catch (error) {
      // Un archivo listado por git que ya no existe (borrado sin confirmar) no es un fallo.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    checked++
    if (!hasSpdxHeader(content)) missing.push(path)
  }

  if (missing.length > 0) {
    console.error(`check-spdx: ${missing.length} file(s) without "${EXPECTED}":`)
    for (const path of missing.sort()) console.error(`  - ${path}`)
    console.error(
      'Add the header in the first lines (see CONTRIBUTING.md, "License of contributions").',
    )
    return 1
  }
  console.log(`check-spdx: ${checked} source files OK`)
  return 0
}

// Solo se ejecuta como script, no al importarlo (p. ej. desde un test).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}
