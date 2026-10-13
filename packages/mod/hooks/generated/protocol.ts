// SPDX-License-Identifier: AGPL-3.0-or-later
// GENERADO por scripts/sync-mod-shared.ts a partir de packages/shared/src/protocol/{common,routes}.ts. No lo edites a mano.
// Constantes del protocolo que usa el mod: versión, SO, idiomas, errores, textos y rutas.

export const PROTOCOL_VERSION = 1 as const
export const OS_VALUES = ['linux', 'darwin', 'win32', 'other'] as const
export type Os = (typeof OS_VALUES)[number]
export const LOCALES = ['en', 'es', 'fr', 'de'] as const
export type Locale = (typeof LOCALES)[number]
export const ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'insufficient_funds',
  'too_many_bets',
  'invalid_bet',
  'loan_not_allowed',
  'daily_limit',
  'protocol_mismatch',
  'github_unavailable',
  'internal',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
export const TEXT_LIMITS = { login: 39, serverName: 80, userCode: 20, errorMessage: 500 } as const
export const API_ROUTES = {
  meta: { method: 'GET', path: '/api/meta', auth: 'public' },
  deviceStart: { method: 'POST', path: '/api/auth/device/start', auth: 'public' },
  devicePoll: { method: 'POST', path: '/api/auth/device/poll', auth: 'public' },
  link: { method: 'POST', path: '/api/auth/link', auth: 'mod' },
  redeem: { method: 'POST', path: '/api/auth/redeem', auth: 'public' },
  logout: { method: 'POST', path: '/api/auth/logout', auth: 'any' },
  turnStart: { method: 'POST', path: '/api/turn/start', auth: 'mod' },
  turnEnd: { method: 'POST', path: '/api/turn/end', auth: 'mod' },
  bet: { method: 'POST', path: '/api/bet', auth: 'mod' },
  me: { method: 'GET', path: '/api/me', auth: 'any' },
  settings: { method: 'POST', path: '/api/me/settings', auth: 'any' },
  deleteAccount: { method: 'POST', path: '/api/me/delete', auth: 'any' },
  leaderboard: { method: 'GET', path: '/api/leaderboard', auth: 'public' },
  hallOfRuin: { method: 'GET', path: '/api/hall-of-ruin', auth: 'public' },
} as const
export type ApiRouteName = keyof typeof API_ROUTES
export const PAGE_PATHS = {
  play: '/play',
  privacy: '/privacy',
  webConfig: '/config.json',
  ws: '/ws',
  healthz: '/healthz',
} as const
