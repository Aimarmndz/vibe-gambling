// SPDX-License-Identifier: AGPL-3.0-or-later
// Detección de `git push` con éxito y de tests fallidos a partir de un comando de Bash.
// El comando se mira aquí, en local, y se olvida: de cada turno solo quedan dos booleanos.
// Módulo puro (sin `$`).

/** Lo que el mod sabe del resultado de una llamada a Bash (sin guardar su salida). */
export interface BashOutcome {
  /** El comando terminó con código 0 (ni error, ni denegado, ni interrumpido). */
  readonly succeeded: boolean
  /** Terminó con error (código distinto de 0). */
  readonly failed: boolean
  /** La salida dice que no había nada que subir. */
  readonly nothingPushed: boolean
}

interface Segment {
  readonly text: string
  /** Operador que separa este trozo del siguiente (`null` en el último). */
  readonly next: string | null
}

/**
 * Parte una línea de shell en comandos simples por `&&`, `||`, `;`, `|`, `&` y saltos de línea,
 * respetando las comillas. No es un parser de shell completo: basta para reconocer comandos.
 */
export function splitCommands(command: string): Segment[] {
  const segments: Segment[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let i = 0
  const push = (next: string | null): void => {
    if (current.trim() !== '' || next !== null) segments.push({ text: current.trim(), next })
    current = ''
  }
  while (i < command.length) {
    const char = command[i]!
    if (quote !== null) {
      if (char === '\\' && quote === '"' && i + 1 < command.length) {
        current += char + command[i + 1]!
        i += 2
        continue
      }
      if (char === quote) quote = null
      current += char
      i += 1
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      i += 1
      continue
    }
    if (char === '\\' && i + 1 < command.length) {
      current += char + command[i + 1]!
      i += 2
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') {
      push(two)
      i += 2
      continue
    }
    // `2>&1`, `&>` y `>&` son redirecciones, no separadores.
    const isRedirect = char === '&' && (command[i - 1] === '>' || command[i + 1] === '>')
    if (!isRedirect && (char === ';' || char === '|' || char === '&' || char === '\n')) {
      push(char === '\n' ? ';' : char)
      i += 1
      continue
    }
    current += char
    i += 1
  }
  push(null)
  return segments.filter(segment => segment.text !== '')
}

/** Parte un comando simple en palabras respetando comillas y escapes (sin expandir nada). */
function tokenize(segment: string): string[] {
  const tokens: string[] = []
  let current: string | null = null
  let quote: '"' | "'" | null = null
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]!
    if (quote !== null) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && i + 1 < segment.length) current += segment[++i]!
      else current += char
      continue
    }
    if (/\s/.test(char)) {
      if (current !== null) tokens.push(current)
      current = null
      continue
    }
    current ??= ''
    if (char === '"' || char === "'") quote = char
    else if (char === '\\' && i + 1 < segment.length) current += segment[++i]!
    else current += char
  }
  if (current !== null) tokens.push(current)
  return tokens
}

/** Envoltorios que lanzan otro comando: sus opciones con valor aparte y sus argumentos fijos. */
interface Wrapper {
  readonly optionsWithValue: ReadonlySet<string>
  /** Argumentos posicionales antes del comando (la duración de `timeout`). */
  readonly positional: number
}

const WRAPPERS: ReadonlyMap<string, Wrapper> = new Map([
  [
    'sudo',
    {
      optionsWithValue: new Set(['-u', '-g', '-C', '-h', '-p', '-U', '-r', '-t', '-D']),
      positional: 0,
    },
  ],
  ['env', { optionsWithValue: new Set(['-u', '-C', '-S']), positional: 0 }],
  ['command', { optionsWithValue: new Set<string>(), positional: 0 }],
  ['time', { optionsWithValue: new Set(['-f', '-o']), positional: 0 }],
  ['nice', { optionsWithValue: new Set(['-n']), positional: 0 }],
  ['nohup', { optionsWithValue: new Set<string>(), positional: 0 }],
  ['exec', { optionsWithValue: new Set(['-a']), positional: 0 }],
  ['timeout', { optionsWithValue: new Set(['-s', '-k']), positional: 1 }],
])

/**
 * Palabras de un comando simple, sin asignaciones de entorno, envoltorios (`sudo`, `timeout 60`…)
 * ni los paréntesis o llaves de un subshell o un grupo.
 */
function words(segment: string): string[] {
  const tokens = tokenize(segment.replace(/^[({\s]+/, '').replace(/[)}\s]+$/, ''))
  for (;;) {
    const first = tokens[0]
    if (first === undefined) break
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      tokens.shift()
      continue
    }
    const wrapper = WRAPPERS.get(first)
    if (wrapper === undefined) break
    tokens.shift()
    while (tokens[0]?.startsWith('-') === true) {
      const option = tokens.shift()!
      if (wrapper.optionsWithValue.has(option)) tokens.shift()
    }
    tokens.splice(0, wrapper.positional)
  }
  return tokens
}

/** Opciones globales de git que llevan valor aparte (`git -C dir push`). */
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/** Subcomando de git de un comando simple, o `null` si no es git. */
function gitSubcommand(tokens: readonly string[]): { name: string; args: string[] } | null {
  const [program, ...rest] = tokens
  if (program === undefined || !/(^|[/\\])git(\.exe)?$/.test(program)) return null
  let i = 0
  while (i < rest.length && rest[i]!.startsWith('-')) {
    i += GIT_OPTIONS_WITH_VALUE.has(rest[i]!) ? 2 : 1
  }
  const name = rest[i]
  return name === undefined ? null : { name, args: rest.slice(i + 1) }
}

/** ¿Este argumento de `git push` lo convierte en algo que no sube nada (prueba o ayuda)? */
function isNoopPushArg(arg: string): boolean {
  // `-n` también dentro de un grupo de opciones cortas (`-fn`, `-un`).
  return (
    arg === '--dry-run' ||
    arg === '--help' ||
    arg === '-h' ||
    /^-[A-Za-z0-9]*n[A-Za-z0-9]*$/.test(arg)
  )
}

/** Índice del `git push` real del comando (no `--dry-run` ni `--help`), o -1. */
function gitPushIndex(segments: readonly Segment[]): number {
  return segments.findIndex(segment => {
    const git = gitSubcommand(words(segment.text))
    return git !== null && git.name === 'push' && !git.args.some(isNoopPushArg)
  })
}

/** ¿El comando incluye un `git push` (que no sea de prueba)? */
export function isGitPush(command: string): boolean {
  return gitPushIndex(splitCommands(command)) !== -1
}

/**
 * ¿El comando hizo un `git push` que subió algo y terminó bien?
 *
 * El código de salida es el de la línea entera, así que solo cuenta si después del push todo va
 * encadenado con `&&` (con `;`, `||` o una tubería el código final no habla del push).
 */
export function isSuccessfulGitPush(command: string, outcome: BashOutcome): boolean {
  if (!outcome.succeeded || outcome.nothingPushed) return false
  const segments = splitCommands(command)
  const index = gitPushIndex(segments)
  if (index === -1) return false
  return segments
    .slice(index)
    .every((segment, k, rest) =>
      k === rest.length - 1 ? segment.next === null : segment.next === '&&',
    )
}

/** Ejecutables que son, por sí mismos, un lanzador de tests. */
const TEST_RUNNERS = new Set([
  'vitest',
  'jest',
  'mocha',
  'ava',
  'tap',
  'pytest',
  'py.test',
  'tox',
  'nox',
  'rspec',
  'phpunit',
  'pest',
  'ctest',
])

/** Gestores en los que `<gestor> test` o `<gestor> run test…` lanzan los tests. */
const TEST_SUBCOMMAND_TOOLS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'go',
  'cargo',
  'dotnet',
  'mvn',
  'gradle',
  'gradlew',
  'mix',
  'make',
  'swift',
  'zig',
  'flutter',
  'dart',
  'lein',
  'sbt',
  'stack',
  'cabal',
])

function basename(program: string): string {
  return (
    program
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.(exe|cmd|bat)$/i, '') ?? program
  )
}

function isTestScript(name: string | undefined): boolean {
  return name !== undefined && /^(test|tests|e2e|spec)([:-]\S*)?$/.test(name)
}

/** Lanzadores que ejecutan otro programa: `npx jest`, `uv run pytest`, `bundle exec rspec`… */
const RUNNER_PREFIXES: ReadonlyMap<string, string | null> = new Map([
  ['npx', null],
  ['bunx', null],
  ['pnpx', null],
  ['uv', 'run'],
  ['poetry', 'run'],
  ['pipenv', 'run'],
  ['pdm', 'run'],
  ['hatch', 'run'],
  ['rye', 'run'],
  ['bundle', 'exec'],
])

/** Subcomandos de un gestor de paquetes que ejecutan el programa que va detrás. */
const EXEC_SUBCOMMANDS = new Set(['run', 'exec', 'x', 'dlx'])

/** ¿Este comando simple lanza tests? */
function isTestSegment(segment: string): boolean {
  const tokens = words(segment)
  let program = basename(tokens[0] ?? '')
  let args = tokens.slice(1)
  // npx / uv run / bundle exec … delegan en el lanzador real.
  if (RUNNER_PREFIXES.has(program)) {
    const subcommand = RUNNER_PREFIXES.get(program)
    if (subcommand !== null) {
      if (args[0] !== subcommand) return false
      args = args.slice(1)
    }
    const index = args.findIndex(arg => !arg.startsWith('-'))
    if (index === -1) return false
    program = basename(args[index]!)
    args = args.slice(index + 1)
  }
  if (/^python(3(\.\d+)?)?$/.test(program) && args[0] === '-m') {
    program = args[1] ?? ''
    args = args.slice(2)
  }
  if (TEST_RUNNERS.has(program)) return true
  if (program === 'playwright' || program === 'cypress')
    return args.includes('test') || args.includes('run')
  if (program === 'claude') return args[0] === 'plugin' && args[1] === 'test'
  if (!TEST_SUBCOMMAND_TOOLS.has(program)) return false
  // Quita opciones como `-r`, `--filter pkg`, `-C dir` antes del subcomando.
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--filter' || arg === '-F' || arg === '-C' || arg === '--dir' || arg === '-p') {
      i += 1
      continue
    }
    if (!arg.startsWith('-')) positional.push(arg)
  }
  const [first, second, third] = positional
  // `npm t` y `npm tst` son alias de `npm test`.
  if (program === 'npm' && (first === 't' || first === 'tst')) return true
  if (isTestScript(first)) return true
  // `pnpm vitest`, `yarn jest`: el gestor ejecuta el binario del lanzador.
  if (first !== undefined && TEST_RUNNERS.has(first)) return true
  if (first !== undefined && EXEC_SUBCOMMANDS.has(first)) {
    if (isTestScript(second)) return true
    if (second !== undefined && TEST_RUNNERS.has(second)) return true
    // `pnpm exec playwright test`
    if (second === 'playwright' || second === 'cypress') return third === 'test' || third === 'run'
    return false
  }
  // `pnpm -r run test`, `yarn workspace web test`
  return first === 'workspace' && (isTestScript(third) || isTestScript(second))
}

/** ¿El comando lanza tests? */
export function isTestCommand(command: string): boolean {
  return splitCommands(command).some(segment => isTestSegment(segment.text))
}

/** ¿Un comando de tests terminó con fallo? */
export function isFailedTestRun(command: string, outcome: BashOutcome): boolean {
  return outcome.failed && isTestCommand(command)
}

/** Lo que git escribe cuando no hay nada que subir. */
export function saysNothingPushed(output: string): boolean {
  return /Everything up-to-date/i.test(output)
}
