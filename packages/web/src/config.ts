// SPDX-License-Identifier: AGPL-3.0-or-later
// Único módulo de configuración de la web. Dos fuentes, las dos validadas con zod al arrancar:
// - `config/web.json` (versionado, se empaqueta en la build): ajustes del propio cliente.
// - `/config.json` (lo sirve el servidor en tiempo de ejecución): instancia, juego y textos de marca.
// Ningún valor configurable vive en el código.
import { webConfigSchema } from '@vibe-gambling/shared'
import type { WebConfig } from '@vibe-gambling/shared'
import { z } from 'zod'

import rawClientConfig from '../../../config/web.json'

const ms = z
  .number()
  .int()
  .min(0)
  .max(10 * 60 * 1000)

export const webClientConfigSchema = z
  .object({
    ws: z
      .object({
        /** Cada cuánto manda la ventana un `ping` de aplicación (mantiene viva la conexión). */
        pingIntervalMs: ms.min(1000),
        /** Si no llega el `pong` en este tiempo, se da la conexión por muerta y se reconecta. */
        pongTimeoutMs: ms.min(500),
        reconnect: z
          .object({
            /** Primer reintento; luego se dobla en cada fallo. */
            baseMs: ms.min(50),
            /** Tope del backoff. */
            maxMs: ms.min(100),
            /** Fracción aleatoria (0–1) para que no reconecten todas las ventanas a la vez. */
            jitter: z.number().min(0).max(1),
          })
          .strict(),
      })
      .strict(),
    ui: z
      .object({
        /** Cuánto se queda la pantalla de resultado antes de volver a la mesa. */
        resultHoldMs: ms,
        /** Duración del aviso "Guardando en MEMORY CARD…". */
        memoryCardToastMs: ms,
        /** Duración de los avisos breves. */
        toastMs: ms,
        /** Cuánto espera la pantalla de título del arranque antes de pasar sola a la mesa. */
        titleHoldMs: ms,
      })
      .strict(),
    spin: z
      .object({
        /** Duración mínima de la caída de la bola (frenado + rebotes) en ms. */
        landingMs: ms.min(500),
        /** Igual, con `prefers-reduced-motion`. */
        reducedLandingMs: ms.min(100),
      })
      .strict(),
    leaderboard: z
      .object({
        /** Filas del ranking en la landing. */
        pageLimit: z.number().int().min(1).max(100),
        /** Filas del ranking dentro de la ventana. */
        inGameLimit: z.number().int().min(1).max(20),
      })
      .strict(),
    demo: z
      .object({
        /** Cuánto "piensa Claude" en cada turno simulado del modo demo. */
        thinkMs: ms.min(500),
        /** Pausa entre turnos simulados. */
        pauseMs: ms.min(500),
        /** Usuario ficticio del modo demo. */
        login: z.string().min(1).max(39),
      })
      .strict(),
  })
  .strict()
  .refine(cfg => cfg.ws.reconnect.maxMs >= cfg.ws.reconnect.baseMs, {
    message: 'ws.reconnect.maxMs no puede ser menor que baseMs',
  })

export type WebClientConfig = z.output<typeof webClientConfigSchema>

/** Valida la configuración del cliente. Lanza con un mensaje claro si algo no cuadra. */
export function parseClientConfig(raw: unknown): WebClientConfig {
  const parsed = webClientConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`config/web.json no es válido: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export const clientConfig: WebClientConfig = parseClientConfig(rawClientConfig)

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/** Descarga y valida `/config.json`. La ruta es relativa al propio dominio. */
export async function loadWebConfig(fetchImpl: typeof fetch = fetch): Promise<WebConfig> {
  let response: Response
  try {
    response = await fetchImpl('/config.json', {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
  } catch (error) {
    throw new ConfigError(`no se pudo descargar /config.json: ${String(error)}`)
  }
  if (!response.ok) throw new ConfigError(`/config.json respondió ${response.status}`)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ConfigError('/config.json no es JSON')
  }
  const parsed = webConfigSchema.safeParse(body)
  if (!parsed.success) {
    throw new ConfigError(`/config.json no cumple el contrato: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}
