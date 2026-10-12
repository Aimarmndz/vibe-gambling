// SPDX-License-Identifier: AGPL-3.0-or-later
// GENERADO por scripts/sync-mod-shared.ts a partir de packages/mod/.claude-plugin/plugin.json. No lo edites a mano.
// Versión del plugin (la que manda en cada turno) y valores por defecto de sus opciones.

export const PLUGIN_VERSION = '0.1.0'
export const USER_CONFIG_DEFAULTS = {
  serverUrl: 'https://vibe.aimar.dev',
  autoOpen: true,
  language: 'auto',
  turnTimeoutMs: 1500,
  commandTimeoutMs: 5000,
  windowReopenCooldownMs: 60000,
  windowSize: '960,720',
  launchTimeoutMs: 5000,
  revealMaxDelayMs: 30000,
} as const
export type UserConfigKey = keyof typeof USER_CONFIG_DEFAULTS
