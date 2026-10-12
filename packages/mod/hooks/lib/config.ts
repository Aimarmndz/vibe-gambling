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
 * ¿Es un host de esta misma máquina? (`localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`).
 * Recibe el `hostname` ya normalizado por `URL` (`127.1` → `127.0.0.1`).
 */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    hostname === '[::1]'
  )
}

/** ¿Es una URL `http:` a otra máquina? (el token viajaría en claro). */
export function isPlainHttpRemote(raw: string): boolean {
  const text = raw.trim()
  if (!URL.canParse(text)) return false
  const url = new URL(text)
  return url.protocol === 'http:' && !isLoopbackHost(url.hostname)
}

/**
 * Normaliza la URL del servidor: https (o http solo hacia esta máquina, porque el token de sesión
 * viajaría en claro y la cookie `Secure` de la web no funcionaría), un host con caracteres de
 * nombre de dominio o IP, sin credenciales, query ni fragmento, y sin la barra final. Devuelve
 * `null` si no vale.
 */
export function normalizeServerUrl(raw: string): string | null {
  const text = raw.trim()
  if (!URL.canParse(text)) return null
  const url = new URL(text)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) return null
  // El parser ya pasa los dominios Unicode a punycode: aquí solo quedan letras, cifras, `.` y `-`.
  if (!/^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])$/.test(url.hostname)) return null
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
  // Los rangos de cada opción (`min`/`max`) viven en el `userConfig` del manifiesto y el engine
  // los hace cumplir antes de cargar el mod; aquí solo se comprueba el tipo, por si acaso.
  const integer = (key: string, min: number): number => {
    const value = options[key]
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= min) return value
    errors.push(`${key}: debe ser un entero mayor o igual que ${min}`)
    return min
  }

  const rawUrl = text('serverUrl')
  const serverUrl = rawUrl === null ? null : normalizeServerUrl(rawUrl)
  if (rawUrl !== null && serverUrl === null) {
    errors.push(
      isPlainHttpRemote(rawUrl)
        ? 'serverUrl: usa https (http solo vale para localhost)'
        : 'serverUrl: no es una URL http(s) válida',
    )
  }

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
    turnTimeoutMs: integer('turnTimeoutMs', 1),
    commandTimeoutMs: integer('commandTimeoutMs', 1),
    windowReopenCooldownMs: integer('windowReopenCooldownMs', 0),
    windowSize: windowSize ?? { width: 0, height: 0 },
    launchTimeoutMs: integer('launchTimeoutMs', 1),
    revealMaxDelayMs: integer('revealMaxDelayMs', 0),
    language: language ?? 'auto',
  } satisfies ModConfig

  // Regla de oro del plan, no configuración: una llamada del turno nunca espera más de 1,5 s.
  if (config.turnTimeoutMs > MAX_TURN_TIMEOUT_MS) {
    errors.push(`turnTimeoutMs: nunca más de ${MAX_TURN_TIMEOUT_MS} ms`)
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, config }
}
