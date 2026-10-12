// SPDX-License-Identifier: AGPL-3.0-or-later
// Lo que la lógica del mod necesita del mundo exterior. `register.ts` lo construye sobre `$`
// (el engine solo deja usar `$` en el archivo del hook), y así todo `./lib` es TypeScript puro.

/** Variables de entorno que el mod lee (el engine exige nombrarlas de forma literal). */
export const ENV_NAMES = [
  'OS',
  'HOME',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'LOCALAPPDATA',
  'LC_ALL',
  'LC_MESSAGES',
  'LANG',
  'LANGUAGE',
] as const
export type EnvName = (typeof ENV_NAMES)[number]

export interface HttpRequestInit {
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string
}

export interface HttpReply {
  readonly status: number
  readonly ok: boolean
  readonly text: string
}

export interface ProcessReply {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface Timer {
  cancel(): void
}

export interface Io {
  readonly pluginName: string
  fetch(url: string, init: HttpRequestInit): Promise<HttpReply>
  now(): Promise<number>
  after(ms: number, fn: () => void): Timer
  /** Línea en el log de depuración del engine (`claude --debug`); nunca en pantalla. */
  log(text: string): void
  status(text: string | undefined): void
  toast(text: string): void
  storeGet(key: string): Promise<unknown>
  storeSet(key: string, value: unknown): Promise<void>
  storeDelete(key: string): Promise<void>
  env(name: EnvName): Promise<string | undefined>
  run(argv: readonly string[], timeoutMs: number): Promise<ProcessReply>
  exists(path: string): Promise<boolean>
  configSet(key: string, value: string): Promise<{ readonly deny?: string | undefined }>
}
