// SPDX-License-Identifier: AGPL-3.0-or-later
// Deja en `packages/mod/.claude-plugin/types/` las declaraciones de la API de plugins que escribe
// el propio engine de Claude Code, para que `tsc -p packages/mod` funcione también en el CI.
//
// Esas declaraciones son de Anthropic y dependen de la versión de Claude Code, así que no se
// versionan (están en .gitignore): se generan con el `claude` instalado. El engine las escribe
// al cargar un mod desde una carpeta que vigila; con `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` también lo
// hace una ejecución `claude -p`. Se lanza un comando del propio mod (`/balance`), que contesta
// sin llamar al modelo ni a la red, con una configuración de Claude Code vacía y temporal: no
// hace falta API key ni toca la sesión ni los datos del usuario.
//
// Uso: `node scripts/mod-engine-types.ts` (no hace nada si ya están las de la versión instalada).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MOD_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/mod')
const TYPES_DIR = join(MOD_DIR, '.claude-plugin/types')
const API_TYPES = join(TYPES_DIR, 'claude-code/index.d.ts')

function claude(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync('claude', args, {
    cwd: MOD_DIR,
    env,
    encoding: 'utf8',
    timeout: 120_000,
    // En Windows `claude` puede ser un .cmd de npm.
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** Versión de Claude Code instalada (`2.1.296`). */
function installedVersion(): string {
  const match = /^(\S+)/.exec(claude(['--version']).trim())
  if (!match) throw new Error('no he podido leer `claude --version`')
  return match[1]!
}

/** Versión que escribió los tipos actuales (primera línea: `// Written by Claude Code X.`). */
function typesVersion(): string | null {
  if (!existsSync(API_TYPES)) return null
  const first = readFileSync(API_TYPES, 'utf8').split('\n', 1)[0] ?? ''
  return /Claude Code (\S+?)\.?$/.exec(first)?.[1] ?? null
}

function main(): void {
  const version = installedVersion()
  if (typesVersion() === version) {
    console.log(`Tipos del engine al día (Claude Code ${version}).`)
    return
  }
  rmSync(TYPES_DIR, { recursive: true, force: true })
  const home = mkdtempSync(join(tmpdir(), 'vibe-mod-types-'))
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CLAUDE_CODE_PLUGIN_DIR_WATCH: '1',
      ANTHROPIC_API_KEY: '',
    }
    claude(['-p', '/balance', '--plugin-dir', MOD_DIR], env)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
  if (typesVersion() === null) {
    console.error(
      `Claude Code ${version} no ha dejado los tipos en ${TYPES_DIR}.\n` +
        'Abre una sesión con `claude --plugin-dir packages/mod` (los escribe al cargar el mod) ' +
        'y vuelve a intentarlo.',
    )
    process.exitCode = 1
    return
  }
  console.log(`Tipos del engine generados con Claude Code ${version}.`)
}

main()
