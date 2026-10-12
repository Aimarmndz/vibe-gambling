// SPDX-License-Identifier: AGPL-3.0-or-later
// Genera los artefactos de una release en `dist-release/` (los mismos que adjunta el workflow
// release.yml a la GitHub Release), de forma reproducible: mismo commit → mismos bytes.
//
//   <name>-mod-vX.Y.Z.zip          el plugin de Claude Code, listo para `claude --plugin-dir`
//   <name>-server-vX.Y.Z.tar.gz    servidor compilado + web + config/ + migraciones + .env.example
//   <name>-vX.Y.Z.spdx.json        SBOM (SPDX 2.3) de las dependencias de producción empaquetadas
//   SHA256SUMS                     sumas de los tres anteriores
//   RELEASE_NOTES.md               notas de la release (CHANGELOG + instalación); no se adjunta
//
// Uso: node scripts/package.ts [--skip-build] [--out dist-release]
// La fecha de todos los archivos es SOURCE_DATE_EPOCH o, si no está, la del commit de HEAD.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

import { createTarGz, createZip } from './lib/archive.ts'
import type { ArchiveEntry } from './lib/archive.ts'
import { findSection, parseChangelog } from './lib/changelog.ts'
import { git, projectInfo, readJson, ROOT } from './lib/repo.ts'
import { isPrerelease, mustParseSemVer } from './lib/semver.ts'
import { checkVersions, marketplacePluginDirs } from './lib/versions.ts'

// Qué lleva el zip del plugin, relativo a su carpeta: solo lo que carga Claude Code.
const MOD_INCLUDE: readonly RegExp[] = [
  /^\.claude-plugin\/plugin\.json$/,
  /^hooks\//,
  /^README\.md$/,
]
// Programas del servidor que van en el tar.gz (el GitHub falso es solo para desarrollo y E2E).
const SERVER_PROGRAMS: readonly string[] = ['main', 'migrate']
// Origen de cada parte del servidor dentro del repo.
const SERVER_DIST = 'packages/server/dist'
const SERVER_MIGRATIONS = 'packages/server/drizzle'
const WEB_DIST = 'packages/web/dist'
const CONFIG_DIR = 'config'
const ENV_EXAMPLE = 'deploy/.env.example'
const SERVER_README_TEMPLATE = 'scripts/templates/server-README.md'
const PROTOCOL_SOURCE = 'packages/shared/src/protocol/common.ts'
const SERVER_PACKAGE = '@vibe-gambling/server'
const WEB_PACKAGE = '@vibe-gambling/web'

const read = (path: string): Buffer => readFileSync(join(ROOT, path))

/** Archivos del repo bajo `dir` (versionados y nuevos no ignorados), con rutas relativas a `dir`. */
function repoFiles(dir: string): string[] {
  return git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', dir])
    .split('\0')
    .filter(path => path !== '' && existsSync(join(ROOT, path)))
    .map(path => path.slice(dir.length + 1))
}

/** Todos los archivos bajo un directorio de build (no versionado), con rutas relativas a él. */
function buildFiles(dir: string): string[] {
  const absolute = join(ROOT, dir)
  if (!existsSync(absolute)) throw new Error(`${dir} does not exist: build the project first`)
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(absolute, join(entry.parentPath, entry.name)).split(sep).join('/'))
}

function sourceDateEpoch(): number {
  const fromEnv = process.env['SOURCE_DATE_EPOCH']
  const value =
    fromEnv !== undefined && fromEnv !== '' ? fromEnv : git(['log', '-1', '--format=%ct'])
  const epoch = Number(value)
  if (!Number.isSafeInteger(epoch) || epoch < 0)
    throw new Error(`invalid SOURCE_DATE_EPOCH "${value}"`)
  return epoch
}

function modEntries(): ArchiveEntry[] {
  const dirs = marketplacePluginDirs()
  if (dirs.length !== 1 || dirs[0] === undefined) {
    throw new Error(`expected exactly one plugin in the marketplace, found ${dirs.length}`)
  }
  const dir = dirs[0]
  const files = repoFiles(dir).filter(path => MOD_INCLUDE.some(re => re.test(path)))
  for (const required of ['.claude-plugin/plugin.json', 'hooks/hooks.json']) {
    if (!files.includes(required)) throw new Error(`${dir}/${required} is missing`)
  }
  return [
    ...files.map(path => ({ path, data: read(`${dir}/${path}`) })),
    { path: 'LICENSE', data: read('LICENSE') },
  ]
}

function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`template: unknown placeholder ${match}`)
    return value
  })
}

function serverEntries(archive: string, values: Record<string, string>): ArchiveEntry[] {
  const entries: ArchiveEntry[] = []
  const add = (path: string, data: Buffer): void => {
    entries.push({ path: `${archive}/${path}`, data })
  }

  const programs = buildFiles(SERVER_DIST).filter(path =>
    SERVER_PROGRAMS.some(name => path === `${name}.js` || path.startsWith(`${name}.js.`)),
  )
  for (const name of SERVER_PROGRAMS) {
    if (!programs.includes(`${name}.js`)) throw new Error(`${SERVER_DIST}/${name}.js is missing`)
  }
  for (const path of programs) add(`dist/${path}`, read(`${SERVER_DIST}/${path}`))

  const web = buildFiles(WEB_DIST)
  if (!web.includes('index.html'))
    throw new Error(`${WEB_DIST}/index.html is missing: build the web`)
  for (const path of web) add(`web/${path}`, read(`${WEB_DIST}/${path}`))

  const migrations = repoFiles(SERVER_MIGRATIONS)
  if (!migrations.includes('meta/_journal.json'))
    throw new Error('drizzle/meta/_journal.json is missing')
  for (const path of migrations) add(`drizzle/${path}`, read(`${SERVER_MIGRATIONS}/${path}`))

  for (const path of repoFiles(CONFIG_DIR)) add(`config/${path}`, read(`${CONFIG_DIR}/${path}`))
  add('.env.example', read(ENV_EXAMPLE))
  add('LICENSE', read('LICENSE'))
  add('README.md', Buffer.from(render(read(SERVER_README_TEMPLATE).toString('utf8'), values)))

  // package.json mínimo: marca el código como ESM y deja `npm start` / `npm run migrate`.
  const manifest = {
    name: `${values['name']}-server`,
    version: values['version'],
    private: true,
    description: `${values['name']} server, bundled (no dependencies to install).`,
    license: 'AGPL-3.0-or-later',
    homepage: values['repoUrl'],
    type: 'module',
    engines: { node: values['engines'] },
    scripts: {
      start: 'node --env-file=.env --enable-source-maps dist/main.js',
      migrate: 'node --env-file=.env --enable-source-maps dist/migrate.js',
    },
  }
  add('package.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))
  return entries
}

/** SBOM SPDX de las dependencias de producción del servidor y de la web (lo que va empaquetado). */
function sbom(version: string, fileName: string, repoUrl: string, epoch: number): Buffer {
  const output = execFileSync(
    'pnpm',
    [
      'sbom',
      '--sbom-format',
      'spdx',
      '--prod',
      '--lockfile-only',
      '--filter',
      SERVER_PACKAGE,
      '--filter',
      WEB_PACKAGE,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  const document = JSON.parse(output) as {
    creationInfo?: { created?: string }
    documentNamespace?: string
  }
  // pnpm pone la hora actual y un UUID aleatorio: se fijan para que el SBOM sea reproducible.
  document.creationInfo = {
    ...document.creationInfo,
    created: new Date(epoch * 1000).toISOString(),
  }
  document.documentNamespace = `${repoUrl}/releases/download/v${version}/${fileName}`
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`)
}

/** Versión del protocolo (`PROTOCOL_VERSION` de shared), para las notas. */
function protocolVersion(): string {
  const match = /export const PROTOCOL_VERSION = (\d+)/.exec(read(PROTOCOL_SOURCE).toString('utf8'))
  if (match?.[1] === undefined) throw new Error(`PROTOCOL_VERSION not found in ${PROTOCOL_SOURCE}`)
  return match[1]
}

function releaseNotes(values: Record<string, string>, files: Record<string, string>): string {
  const version = values['version'] ?? ''
  const changelog = parseChangelog(read('CHANGELOG.md').toString('utf8'))
  const section = findSection(changelog, version)
  if (section === undefined || section.body === '') {
    throw new Error(`CHANGELOG.md has no entries for [${version}]`)
  }
  const site = readJson(`${CONFIG_DIR}/site.json`) as { installCommand?: unknown }
  if (typeof site.installCommand !== 'string')
    throw new Error('config/site.json has no installCommand')
  const tag = `v${version}`
  return [
    section.body,
    '',
    // Línea en blanco antes de `---`: pegado a un párrafo, Markdown lo leería como título.
    '---',
    '',
    '### Install',
    '',
    `- **Plugin**: \`${site.installCommand}\` in Claude Code, or unzip \`${files['mod']}\` and run \`claude --plugin-dir <folder>\`.`,
    `- **Server (Docker)**: \`docker pull ${values['image']}:${version}\` (linux/amd64 and linux/arm64).`,
    `- **Server (Node.js ${values['node']}, no Docker)**: \`${files['server']}\`; instructions in its \`README.md\`.`,
    '',
    `Protocol version: \`v${protocolVersion()}\`. Full changelog: [CHANGELOG.md](${values['repoUrl']}/blob/${tag}/CHANGELOG.md).`,
    '',
    '### Verify',
    '',
    '```sh',
    'sha256sum --check --ignore-missing SHA256SUMS',
    `gh attestation verify ${files['server']} --repo ${values['repoSlug']}`,
    `gh attestation verify oci://${values['image']}:${version} --repo ${values['repoSlug']}`,
    '```',
    '',
    `How releases are made and verified: [docs/RELEASING.md](${values['repoUrl']}/blob/${tag}/docs/RELEASING.md).`,
    '',
  ].join('\n')
}

function main(): number {
  let values: { 'skip-build': boolean; out: string }
  try {
    values = parseArgs({
      options: {
        'skip-build': { type: 'boolean', default: false },
        out: { type: 'string', default: 'dist-release' },
      },
    }).values
  } catch (error) {
    console.error(`package: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  const { version, problems } = checkVersions()
  if (problems.length > 0) {
    console.error(
      `package: versions do not agree (run \`pnpm lint:versions\`):\n  - ${problems.join('\n  - ')}`,
    )
    return 1
  }
  const info = projectInfo()
  const epoch = sourceDateEpoch()
  const outDir = resolve(ROOT, values.out)

  if (!values['skip-build']) {
    console.log('package: building the server and the web…')
    execFileSync('pnpm', ['--filter', SERVER_PACKAGE, '--filter', WEB_PACKAGE, 'run', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
    })
  }

  const tag = `v${version}`
  const serverArchive = `${info.name}-server-${tag}`
  const files = {
    mod: `${info.name}-mod-${tag}.zip`,
    server: `${serverArchive}.tar.gz`,
    sbom: `${info.name}-${tag}.spdx.json`,
  }
  const templateValues: Record<string, string> = {
    name: info.name,
    version,
    image: info.image,
    repoUrl: info.repoUrl,
    repoSlug: info.repoSlug,
    engines: info.nodeEngines,
    node: read('.nvmrc').toString('utf8').trim(),
    archive: serverArchive,
  }

  const artifacts = new Map<string, Buffer>([
    [files.mod, createZip(modEntries(), epoch)],
    [files.server, createTarGz(serverEntries(serverArchive, templateValues), epoch)],
    [files.sbom, sbom(version, files.sbom, info.repoUrl, epoch)],
  ])
  const sums = [...artifacts]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, data]) => `${createHash('sha256').update(data).digest('hex')}  ${name}`)
    .join('\n')

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  for (const [name, data] of artifacts) writeFileSync(join(outDir, name), data)
  writeFileSync(join(outDir, 'SHA256SUMS'), `${sums}\n`)
  writeFileSync(join(outDir, 'RELEASE_NOTES.md'), releaseNotes(templateValues, files))

  const kind = isPrerelease(mustParseSemVer(version)) ? 'pre-release' : 'release'
  console.log(`package: ${kind} ${tag} → ${relative(ROOT, outDir)}/ (SOURCE_DATE_EPOCH=${epoch})`)
  console.log(sums)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`package: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
