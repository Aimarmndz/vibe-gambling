// SPDX-License-Identifier: AGPL-3.0-or-later
// Configuración del mod: valida las opciones que el engine lee del `userConfig` del manifiesto.
// Los valores por defecto viven en `.claude-plugin/plugin.json`, nunca aquí. Módulo puro (sin `$`).

/** Tope de las llamadas de red durante un turno: regla de oro del plan (≤ 1,5 s), no configuración. */
export const MAX_TURN_TIMEOUT_MS = 1500

export const LANGUAGE_OPTIONS = ['auto', 'en', 'es'] as const
export type LanguageOption = (typeof LANGUAGE_OPTIONS)[number]

export interface WindowSize {
  readonly width: number
  readonly height: number
}

export interface ModConfig {
  /** URL base del servidor, sin barra final. */
  readonly serverUrl: string
  /** Abrir la ventana en cada prompt si está cerrada. */
  readonly autoOpen: boolean
  /** Timeout de las llamadas del turno (turn/start, turn/end, enlace). */
  readonly turnTimeoutMs: number
  /** Timeout de las llamadas de los comandos (login, apuestas, ajustes…). */
  readonly commandTimeoutMs: number
  /** Tras abrir la ventana, cuánto esperar a que conecte antes de volver a abrirla. */
  readonly windowReopenCooldownMs: number
  /** Tamaño de la ventana en modo app. */
  readonly windowSize: WindowSize
  /** Cuánto puede tardar el lanzador del navegador en volver. */
  readonly launchTimeoutMs: number
  /** Espera máxima para enseñar el resultado (el giro mínimo lo marca el servidor con `revealAt`). */
  readonly revealMaxDelayMs: number
  /** Idioma de los mensajes: el del sistema (`auto`), inglés o español. */
  readonly language: LanguageOption
}

export type ConfigResult =
  | { readonly ok: true; readonly config: ModConfig }
  | { readonly ok: false; readonly errors: readonly string[] }

/**
 * Normaliza la URL del servidor: solo http(s), sin credenciales, query ni fragmento,
 * y sin la barra final. Devuelve `null` si no vale.
 */
export function normalizeServerUrl(raw: string): string | null {
  const text = raw.trim()
  if (!URL.canParse(text)) return null
  const url = new URL(text)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return null
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/** Origen (`protocolo://host:puerto`) de una URL ya normalizada. */
export function originOf(serverUrl: string): string {
  return new URL(serverUrl).origin
}

function parseWindowSize(raw: string): WindowSize | null {
  const match = /^\s*(\d{3,4})\s*[,x]\s*(\d{3,4})\s*$/.exec(raw)
  if (!match) return null
  return { width: Number(match[1]), height: Number(match[2]) }
}

type Options = Readonly<Record<string, unknown>>

/** Lee y valida las opciones. Si falta algo o no cuadra, devuelve los errores (nunca inventa). */
export function parseConfig(options: Options): ConfigResult {
  const errors: string[] = []

  const text = (key: string): string | null => {
    const value = options[key]
    if (typeof value === 'string') return value
    errors.push(`${key}: falta o no es texto`)
    return null
  }
  const flag = (key: string): boolean => {
    const value = options[key]
    if (typeof value === 'boolean') return value
    errors.push(`${key}: falta o no es booleano`)
    return false
  }
  const integer = (key: string, min: number, max: number): number => {
    const value = options[key]
    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
      return value
    }
    errors.push(`${key}: debe ser un entero entre ${min} y ${max}`)
    return min
  }

  const rawUrl = text('serverUrl')
  const serverUrl = rawUrl === null ? null : normalizeServerUrl(rawUrl)
  if (rawUrl !== null && serverUrl === null) errors.push('serverUrl: no es una URL http(s) válida')

  const rawSize = text('windowSize')
  const windowSize = rawSize === null ? null : parseWindowSize(rawSize)
  if (rawSize !== null && windowSize === null)
    errors.push('windowSize: usa ANCHOxALTO, p. ej. 960,720')

  const rawLanguage = text('language')
  const language = LANGUAGE_OPTIONS.find(option => option === rawLanguage)
  if (rawLanguage !== null && language === undefined) {
    errors.push(`language: debe ser ${LANGUAGE_OPTIONS.join(', ')}`)
  }

  const config = {
    serverUrl: serverUrl ?? '',
    autoOpen: flag('autoOpen'),
    turnTimeoutMs: integer('turnTimeoutMs', 100, MAX_TURN_TIMEOUT_MS),
    commandTimeoutMs: integer('commandTimeoutMs', 500, 30_000),
    windowReopenCooldownMs: integer('windowReopenCooldownMs', 0, 3_600_000),
    windowSize: windowSize ?? { width: 0, height: 0 },
    launchTimeoutMs: integer('launchTimeoutMs', 500, 30_000),
    revealMaxDelayMs: integer('revealMaxDelayMs', 0, 120_000),
    language: language ?? 'auto',
  } satisfies ModConfig

  return errors.length > 0 ? { ok: false, errors } : { ok: true, config }
}
