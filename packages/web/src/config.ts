// SPDX-License-Identifier: AGPL-3.0-or-later
// Único módulo de configuración de la web. Dos fuentes, las dos validadas con zod al arrancar:
// - `config/web.json` (versionado, se empaqueta en la build): ajustes del propio cliente.
// - `/config.json` (lo sirve el servidor en tiempo de ejecución): instancia, juego y textos de marca.
// Ningún valor configurable vive en el código.
import { gameConfigSchema, webConfigSchema } from '@vibe-gambling/shared'
import type { WebConfig } from '@vibe-gambling/shared'
import { z } from 'zod'

import rawClientConfig from '../../../config/web.json'

const ms = z
  .number()
  .int()
  .min(0)
  .max(10 * 60 * 1000)

/** Un tiempo de animación (no puede ser 0: dividiría por cero). */
const span = ms.min(1)
/** Cantidad de fichas que llueven en un nivel de premio. */
const coinCount = z.number().int().min(0).max(200)

/** Tiempos, cantidades y presupuestos de las animaciones de espectáculo. */
const fxSchema = z
  .object({
    /** Con `prefers-reduced-motion`, ninguna animación dura más que esto. */
    reducedMaxMs: span,
    /** Duraciones de las versiones reducidas que no salen de otra clave (topadas por la de arriba). */
    reduced: z.object({ greenTintMs: span, pushBandMs: span, loanMs: span }).strict(),
    /** Presupuesto de fichas 3D a la vez en pantalla (rendimiento). */
    maxCoins: z.number().int().min(0).max(200),
    /** Sacudida de cámara del impacto (píxeles enteros) y lo que tarda en volver a 0. */
    shake: z
      .object({
        x: z.number().int().min(-8).max(8),
        y: z.number().int().min(-8).max(8),
        decayMs: span,
      })
      .strict(),
    bigWin: z
      .object({
        /** El flash crema del impacto (uno solo por resultado). */
        flashMs: span,
        /** Cada escalón del rótulo (×7 → ×6 → ×5). */
        impactStepMs: span,
        /** Lo que tarda el contador en rodar hasta el premio, por nivel. */
        countMs: z.object({ big: span, mega: span, pleno: span }).strict(),
        /** Cuánto se queda el valor final antes de cerrarse solo. */
        holdMs: span,
        /** Fichas que llueven por nivel (topadas por `maxCoins`). */
        coins: z.object({ big: coinCount, mega: coinCount, pleno: coinCount }).strict(),
        /** Gravedad de la lluvia de fichas, en píxeles de 320×240 por segundo². */
        gravityPxS2: z.number().min(1).max(10_000),
        /** Giro de los rayos durante el hold (grados por segundo). */
        raysDegPerS: z.number().min(0).max(360),
        /** Cada cuánto cruza el brillo diagonal el rótulo. */
        sheenEveryMs: span,
        /** Tic del contador mientras rueda. */
        tickMs: ms.min(10),
        /** Movimiento reducido: el contador llega en 3 saltos de este tiempo. */
        reducedStepMs: span,
      })
      .strict(),
    green: z
      .object({
        /** Medio ciclo del parpadeo verde (encendido o apagado). */
        blinkMs: span,
        /** Parpadeos (como mucho 3 por segundo: fotosensibilidad). */
        blinks: z.number().int().min(1).max(3),
        /** Espera hasta encadenar con el premio si se había apostado al 0. */
        chainMs: span,
        /** Sin premio que encadenar: cuánto se queda el rótulo antes de pasar al resultado. */
        holdMs: span,
      })
      .strict(),
    push: z
      .object({
        /** La terminal: sube, "git push" y la barra hasta DEPLOYED. */
        terminalMs: span,
        /** El cohete despegando. */
        rocketMs: span,
        /** El cohete sale y cae el sello ×N. */
        stampMs: span,
      })
      .strict(),
    loan: z
      .object({
        /** El contrato sube. */
        contractMs: span,
        /** La firma pixelada se dibuja. */
        signMs: span,
        /** Cae el sello APROBADO. */
        stampMs: span,
        /** Las monedas caen en el saldo (y el saldo cuenta). */
        coinsMs: span,
        /** La deuda sube con la caja registradora. */
        debtMs: span,
        /** Velocidad de la letra pequeña que cruza la barra inferior (demasiado rápida). */
        finePrintPxPerS: z.number().min(1).max(5000),
      })
      .strict(),
    bankrupt: z
      .object({
        /** La escena se desatura y el patrimonio parpadea. */
        desaturateMs: span,
        /** "BANCARROTA" con glitch. */
        glitchMs: span,
        /** Desde dónde cuenta el CONTINUE? */
        countFrom: z.number().int().min(1).max(99),
        /** Cada paso de la cuenta atrás. */
        tickMs: ms.min(100),
      })
      .strict(),
    onFire: z
      .object({
        /** Intro: franja de fuego y "ON FIRE". */
        introMs: span,
        /** Tras la intro, lo que tarda el fuego en consumirse sin fuente. */
        outroMs: span,
        /** Fotogramas por segundo del fuego y las llamitas (bucles de sprites). */
        spriteFps: z.number().int().min(1).max(60),
      })
      .strict(),
    fallacy: z.object({ holdMs: span }).strict(),
    achievement: z.object({ inMs: span, holdMs: span, outMs: span, gapMs: ms }).strict(),
    pending: z.object({ rollMs: span, floatMs: span, flyMs: span }).strict(),
  })
  .strict()

export type FxConfig = z.output<typeof fxSchema>

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
        /** Periodo de la ayuda de la barra inferior (controles ↔ cómo se gira). */
        helpCycleMs: ms.min(1000),
        /** Cuánto se queda el resultado de cada tirada de GIRAR TODAS (modo rápido). */
        quickResultHoldMs: ms.min(300),
        /** Espera desde que la mesa queda libre hasta el aviso de tiradas pendientes al abrir. */
        pendingNoticeDelayMs: ms,
        /** Duración del salto del contador de tiradas pendientes cuando cambia. */
        counterBumpMs: ms.min(50),
      })
      .strict(),
    spin: z
      .object({
        /**
         * Caída con `prefers-reduced-motion` (ms). La normal y la rápida de GIRAR TODAS son
         * `game.landingMs` y `game.pendingSpins.quickLandingMs` de `/config.json`: las comparte con
         * el servidor, que nunca pone `revealAt` antes de que la bola termine de caer.
         */
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
    /** Menús v2 (docs/DISENO-V2.md, "Menús"). */
    menu: z
      .object({
        /** Barrido de bloques entre pantallas: la mitad tapa y la otra mitad destapa. */
        wipeMs: ms.min(2),
        /** Las esquinas oro del cursor se abren y cierran 1 px cada este tiempo (a saltos). */
        cursorBreatheMs: ms.min(50),
        /** Una vuelta del icono 3D seleccionado. */
        iconSpinMs: ms.min(100),
        /** Periodo del bob (sube y baja) del icono seleccionado. */
        iconBobMs: ms.min(100),
        /** Una vuelta de la copa de la fila elegida en LOGROS. */
        trophySpinMs: ms.min(100),
        /** Velocidad de la trama de palos del fondo (píxeles por segundo, en diagonal). */
        patternPxPerS: z.number().min(0).max(120),
        /** La línea del patrimonio se dibuja de izquierda a derecha al entrar en ESTADÍSTICAS. */
        chartDrawMs: ms,
        /** Barrido de columnas al pasar página en CÓMO SE JUEGA. */
        pageTurnMs: ms,
        /** Velocidad a la que suben los créditos solos (píxeles por segundo). */
        creditsPxPerS: z.number().min(0).max(240),
        /** Tiempo que los créditos se quedan quietos al entrar antes de empezar a subir. */
        creditsHoldMs: ms,
        /** Parpadeo del "_" del icono de guardado de la MEMORY CARD. */
        saveBlinkMs: ms.min(50),
        /** Espera máxima a la respuesta de `stats.request` / `bank.request`. */
        requestTimeoutMs: ms.min(500),
      })
      .strict(),
    /** Animaciones de espectáculo (docs/DISENO-V2.md, "Animaciones"). */
    fx: fxSchema,
    demo: z
      .object({
        /** Cuánto "piensa Claude" en cada turno simulado del modo demo. */
        thinkMs: ms.min(500),
        /** Pausa entre turnos simulados. */
        pauseMs: ms.min(500),
        /** Usuario ficticio del modo demo. */
        login: z.string().min(1).max(39),
        /**
         * Topes de ESTADÍSTICAS y BANCO en la demo (los del servidor, `stats.*` de
         * config/game.json, no son públicos).
         */
        stats: z
          .object({
            recentRounds: z.number().int().min(1).max(100),
            seriesPoints: z.number().int().min(2).max(2000),
            loanMarks: z.number().int().min(0).max(1000),
            bankHistory: z.number().int().min(1).max(500),
          })
          .strict(),
        /**
         * Temporada de ejemplo (`__vgDemo.showcase()`) para las capturas: semilla del azar fijo,
         * tiradas jugadas y tiradas pendientes.
         */
        showcase: z
          .object({
            seed: z.number().int().min(0),
            spins: z.number().int().min(1).max(2000),
            pending: z.number().int().min(0).max(1000),
          })
          .strict(),
        /** Umbrales de los logros en la demo (los del servidor no son públicos). */
        achievements: gameConfigSchema.shape.achievements,
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
