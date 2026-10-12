// SPDX-License-Identifier: AGPL-3.0-or-later
// vibe-gambling: cada prompt es una tirada de ruleta. Este módulo solo conecta los eventos del
// engine con la lógica de `./lib`. Reglas de oro: ningún hook espera al casino (todo va en segundo
// plano y con timeout ≤ 1,5 s), ningún error escapa y todos llaman a `next(e)`.
import type { EngineInterface, Register } from 'claude-code'

import { debug, withTimeout } from './lib/api.ts'
import { createAuthState } from './lib/auth.ts'
import { MAX_TURN_TIMEOUT_MS } from './lib/config.ts'
import type { EnvName, Io } from './lib/io.ts'
import { isFailedTestRun, isSuccessfulGitPush, saysNothingPushed } from './lib/bash.ts'
import * as commands from './lib/commands.ts'
import type { CommandContext } from './lib/commands.ts'
import { MESSAGES } from './lib/messages.ts'
import type { CommandId } from './lib/messages.ts'
import {
  createRuntime,
  detectOs,
  loadSession,
  readPluginVersion,
  refreshMe,
  resolveLocale,
  setStatus,
} from './lib/runtime.ts'
import { beginTurn, finishTurn } from './lib/turns.ts'
import type { TurnState } from './lib/turns.ts'
import { createWindowState } from './lib/window.ts'

/**
 * Adapta `$` a la interfaz `Io` que usa `./lib`. El engine solo deja usar `$` en este archivo y
 * siempre como `$.noun.event(...)`; por eso cada variable de entorno va escrita de forma literal.
 */
function ioOf($: EngineInterface): Io {
  const env = (name: EnvName): Promise<string | undefined> => {
    switch (name) {
      case 'OS':
        return $.env.get('OS')
      case 'HOME':
        return $.env.get('HOME')
      case 'ProgramFiles':
        return $.env.get('ProgramFiles')
      case 'ProgramFiles(x86)':
        return $.env.get('ProgramFiles(x86)')
      case 'LOCALAPPDATA':
        return $.env.get('LOCALAPPDATA')
      case 'LC_ALL':
        return $.env.get('LC_ALL')
      case 'LC_MESSAGES':
        return $.env.get('LC_MESSAGES')
      case 'LANG':
        return $.env.get('LANG')
      case 'LANGUAGE':
        return $.env.get('LANGUAGE')
    }
  }
  return {
    pluginName: $.plugin.name,
    pluginRoot: $.plugin.root,
    fetch: (url, init) => $.http.fetch(url, { ...init, headers: { ...init.headers } }),
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    log: text => $.ui.log(text, { to: 'debug' }),
    status: text => $.ui.status(text),
    toast: text => $.ui.toast(text),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    storeDelete: key => $.store.delete(key),
    env,
    run: (argv, timeoutMs) => $.process.run(argv, { timeoutMs }),
    exists: path => $.fs.exists(path),
    readText: async path => String(await $.fs.read(path)),
    configSet: (key, value) => $.config.set({ key, value }),
  }
}

/**
 * Espera el registro de un comando sin que un rechazo (p. ej. un nombre que ya usa otro plugin)
 * deje sin registrar los demás ni sin status line a la sesión.
 */
async function registerSafely(io: Io, name: string, registering: Promise<unknown>): Promise<void> {
  try {
    await registering
  } catch (error) {
    debug(io, `no he podido registrar /${name}: ${String(error)}`)
  }
}

/** Argumentos del comando (el engine manda `""` sin argumentos; se toleran también ausentes). */
function argsOf(e: { readonly args?: string | undefined }): string {
  return typeof e.args === 'string' ? e.args : ''
}

export const register: Register = (on, options) => {
  const runtime = createRuntime(options)
  const auth = createAuthState()
  const turns: TurnState = { turns: new Map(), active: null, window: createWindowState() }

  /** Descripción y pista de argumentos en el idioma del sistema. */
  const describe = (id: CommandId): string => runtime.messages.commands[id].description
  const hint = (id: CommandId): string | undefined => runtime.messages.commands[id].argumentHint

  /** Ejecuta un comando con la configuración válida, o explica por qué no la hay. */
  const run = async (
    io: Io,
    id: CommandId,
    action: (ctx: CommandContext) => Promise<string>,
  ): Promise<{ text: string }> => {
    const config = runtime.config
    if (config === null)
      return { text: runtime.messages.badConfig(runtime.configErrors.join('; ')) }
    try {
      return { text: await action({ io, runtime, config, auth, window: turns.window }) }
    } catch (error) {
      debug(io, `/${id}: ${String(error)}`)
      return { text: runtime.messages.offline }
    }
  }

  on('session.start', async ($, e, next) => {
    const io = ioOf($)
    try {
      runtime.isInteractive = e.isInteractive
      runtime.locale = await resolveLocale(io, runtime)
      runtime.messages = MESSAGES[runtime.locale]
      // `uname` va con el timeout del turno: `turn/start` espera al SO y no puede esperar más.
      runtime.os = detectOs(io, runtime.config?.turnTimeoutMs ?? MAX_TURN_TIMEOUT_MS)
      runtime.pluginVersion = readPluginVersion(io)

      // Nombres literales: así el engine sabe que cada comando lo responde este módulo. Cada
      // registro va por separado: si el engine rechaza uno, los demás siguen.
      await registerSafely(
        io,
        'roulette',
        $.command.register({
          name: 'roulette',
          description: describe('roulette'),
          argumentHint: hint('roulette'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'ruleta',
        $.command.register({
          name: 'ruleta',
          description: describe('roulette'),
          argumentHint: hint('roulette'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'bet',
        $.command.register({
          name: 'bet',
          description: describe('bet'),
          argumentHint: hint('bet'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'apostar',
        $.command.register({
          name: 'apostar',
          description: describe('bet'),
          argumentHint: hint('bet'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'all-in',
        $.command.register({
          name: 'all-in',
          description: describe('allIn'),
          argumentHint: hint('allIn'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'balance',
        $.command.register({
          name: 'balance',
          description: describe('balance'),
          argumentHint: hint('balance'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'saldo',
        $.command.register({
          name: 'saldo',
          description: describe('balance'),
          argumentHint: hint('balance'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'vibe-login',
        $.command.register({
          name: 'vibe-login',
          description: describe('login'),
          argumentHint: hint('login'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'vibe-logout',
        $.command.register({
          name: 'vibe-logout',
          description: describe('logout'),
          argumentHint: hint('logout'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'vibe-hide',
        $.command.register({
          name: 'vibe-hide',
          description: describe('hide'),
          argumentHint: hint('hide'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'vibe-show',
        $.command.register({
          name: 'vibe-show',
          description: describe('show'),
          argumentHint: hint('show'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'vibe-server',
        $.command.register({
          name: 'vibe-server',
          description: describe('server'),
          argumentHint: hint('server'),
          immediate: true,
        }),
      )
      await registerSafely(
        io,
        'vibe-delete-account',
        $.command.register({
          name: 'vibe-delete-account',
          description: describe('deleteAccount'),
          argumentHint: hint('deleteAccount'),
          immediate: true,
        }),
      )

      const config = runtime.config
      if (config === null) {
        debug(io, `configuración no válida: ${runtime.configErrors.join('; ')}`)
        setStatus(io, runtime.messages.statusBadConfig)
      } else {
        const session = await loadSession(io, config.serverUrl)
        if (session === null) {
          setStatus(io, runtime.messages.statusLogin)
        } else {
          // El saldo llega cuando llegue: la sesión no espera al servidor.
          void refreshMe(io, runtime, config, session, config.turnTimeoutMs)
        }
      }
    } catch (error) {
      debug(io, `session.start: ${String(error)}`)
    }
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    const io = ioOf($)
    // Un turno sin texto es una continuación del engine, no un prompt: no es una tirada.
    const config = runtime.config
    if (config !== null && e.text.trim() !== '') {
      try {
        beginTurn(io, runtime, config, turns, e.turnId)
      } catch (error) {
        debug(io, `turn.start: ${String(error)}`)
      }
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const io = ioOf($)
    const ran = await next(e)
    try {
      const record = turns.active
      if (record !== null && e.tool === 'Bash') {
        // Se mira el comando y su salida aquí mismo y se olvidan: solo quedan dos booleanos.
        const result = ran.isError === true || ran.deny !== undefined ? undefined : ran.result
        // Una orden que sigue en segundo plano (`run_in_background` o cortada por su timeout)
        // aún no tiene código de salida: no cuenta ni como push ni como test.
        const finished = result?.backgroundTaskId === undefined
        const outcome = {
          succeeded:
            finished &&
            ran.deny === undefined &&
            ran.isError !== true &&
            result?.interrupted !== true,
          failed: ran.isError === true,
          nothingPushed:
            result !== undefined && saysNothingPushed(`${result.stdout}\n${result.stderr}`),
        }
        if (isSuccessfulGitPush(e.command, outcome)) record.gitPushOk = true
        if (isFailedTestRun(e.command, outcome)) record.testFailed = true
      }
    } catch (error) {
      debug(io, `tool.call: ${String(error)}`)
    }
    return ran
  }).catch((_$, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const io = ioOf($)
    const config = runtime.config
    // Los turnos de los subagentes no son tiradas.
    if (config !== null && e.agentId === undefined) {
      try {
        const sending = finishTurn(io, runtime, config, turns, e.turnId, e.durationMs)
        // En `claude -p` el proceso acaba con el turno: se espera el envío, pero nunca más de un
        // timeout de turno en total (aunque `turn/start` siga en vuelo). En sesión interactiva, no.
        if (sending !== null && !runtime.isInteractive) {
          await withTimeout(io, sending, config.turnTimeoutMs)
        }
      } catch (error) {
        debug(io, `turn.complete: ${String(error)}`)
      }
    }
    return next(e)
  })

  on('command.run', { command: 'roulette' }, $ => run(ioOf($), 'roulette', commands.roulette))
  on('command.run', { command: 'ruleta' }, $ => run(ioOf($), 'roulette', commands.roulette))
  on('command.run', { command: 'bet' }, ($, e) =>
    run(ioOf($), 'bet', ctx => commands.bet(ctx, argsOf(e))),
  )
  on('command.run', { command: 'apostar' }, ($, e) =>
    run(ioOf($), 'bet', ctx => commands.bet(ctx, argsOf(e))),
  )
  on('command.run', { command: 'all-in' }, ($, e) =>
    run(ioOf($), 'allIn', ctx => commands.allIn(ctx, argsOf(e))),
  )
  on('command.run', { command: 'balance' }, $ => run(ioOf($), 'balance', commands.balance))
  on('command.run', { command: 'saldo' }, $ => run(ioOf($), 'balance', commands.balance))
  on('command.run', { command: 'vibe-login' }, $ => run(ioOf($), 'login', commands.login))
  on('command.run', { command: 'vibe-logout' }, $ => run(ioOf($), 'logout', commands.logout))
  on('command.run', { command: 'vibe-hide' }, $ =>
    run(ioOf($), 'hide', ctx => commands.setHidden(ctx, true)),
  )
  on('command.run', { command: 'vibe-show' }, $ =>
    run(ioOf($), 'show', ctx => commands.setHidden(ctx, false)),
  )
  on('command.run', { command: 'vibe-server' }, ($, e) =>
    run(ioOf($), 'server', ctx => commands.server(ctx, argsOf(e))),
  )
  on('command.run', { command: 'vibe-delete-account' }, ($, e) =>
    run(ioOf($), 'deleteAccount', ctx => commands.deleteAccount(ctx, argsOf(e))),
  )
}
