// SPDX-License-Identifier: AGPL-3.0-or-later
// Rutas de la API HTTP: una única fuente de verdad para el servidor, la web y el mod.
// El mod no puede importar `shared` (se instala solo `packages/mod`), así que recibe una copia
// generada por `scripts/sync-mod-shared.ts` y un test comprueba que no se desincroniza.

export const HTTP_METHODS = ['GET', 'POST'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/** Quién puede llamar a una ruta: cualquiera, el mod (Bearer) o la web (cookie). */
export const ROUTE_AUTH = ['public', 'mod', 'web', 'any'] as const
export type RouteAuth = (typeof ROUTE_AUTH)[number]

export interface ApiRoute {
  readonly method: HttpMethod
  readonly path: string
  readonly auth: RouteAuth
}

/** Rutas de la API. Los cuerpos de cada una están en `http.ts`. */
export const API_ROUTES = Object.freeze({
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
  /** Tu código de afiliado (se crea la primera vez), tu enlace y tus estadísticas de la pirámide. */
  referral: { method: 'GET', path: '/api/referral', auth: 'any' },
  /** Canjea el código de quien te invitó (una vez en la vida de la cuenta). */
  referralRedeem: { method: 'POST', path: '/api/referral/redeem', auth: 'mod' },
  /** Quién invita con un código (para la página `/r/<código>`). */
  referralLookup: { method: 'GET', path: '/api/referral/lookup', auth: 'public' },
  /** TIENDA: catálogo con precios, tu bolsillo, tu armario y el Placebómetro. */
  shop: { method: 'GET', path: '/api/shop', auth: 'any' },
  /** Compra un objeto (o `git revert HEAD~1`). Idempotente por `requestId`. */
  shopBuy: { method: 'POST', path: '/api/shop/buy', auth: 'any' },
  /** Arma o desarma un consumible del bolsillo. */
  itemArm: { method: 'POST', path: '/api/items/arm', auth: 'any' },
} as const satisfies Record<string, ApiRoute>)
export type ApiRouteName = keyof typeof API_ROUTES

/** Rutas que no son de la API pero que el mod o la web necesitan conocer. */
export const PAGE_PATHS = Object.freeze({
  play: '/play',
  privacy: '/privacy',
  /** Página de invitación: `/r/<código>`. */
  invite: '/r',
  webConfig: '/config.json',
  ws: '/ws',
  healthz: '/healthz',
} as const)
