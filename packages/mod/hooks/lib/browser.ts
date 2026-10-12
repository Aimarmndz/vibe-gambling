// SPDX-License-Identifier: AGPL-3.0-or-later
// Dónde buscar un navegador Chromium en cada SO y con qué orden abrir la ventana en modo app.
// Módulo puro: el SO, las variables de entorno y la comprobación de archivos se inyectan,
// así la detección se prueba con un SO falso.
import type { Os } from '../generated/protocol.ts'
import type { WindowSize } from './config.ts'

/** Un navegador candidato: un ejecutable o, en macOS, el paquete `.app`. */
export interface BrowserCandidate {
  readonly name: string
  readonly path: string
  readonly kind: 'binary' | 'macApp'
}

/** Variables de entorno que hacen falta para construir las rutas. */
export interface BrowserEnv {
  readonly home?: string | undefined
  readonly programFiles?: string | undefined
  readonly programFilesX86?: string | undefined
  readonly localAppData?: string | undefined
}

/** Nombres de los ejecutables en Linux, por orden de preferencia (Chrome, Chromium, Brave, Edge, Vivaldi). */
const LINUX_BINARIES = [
  ['Chrome', 'google-chrome-stable'],
  ['Chrome', 'google-chrome'],
  ['Chromium', 'chromium'],
  ['Chromium', 'chromium-browser'],
  ['Brave', 'brave-browser'],
  ['Brave', 'brave'],
  ['Edge', 'microsoft-edge-stable'],
  ['Edge', 'microsoft-edge'],
  ['Vivaldi', 'vivaldi-stable'],
  ['Vivaldi', 'vivaldi'],
] as const

const LINUX_DIRS = ['/usr/bin', '/usr/local/bin', '/snap/bin'] as const

/** Instalaciones fuera del PATH (paquetes .deb/.rpm en /opt y Flatpak). */
const LINUX_EXTRA = [
  ['Chrome', '/opt/google/chrome/chrome'],
  ['Brave', '/opt/brave.com/brave/brave'],
  ['Edge', '/opt/microsoft/msedge/msedge'],
  ['Vivaldi', '/opt/vivaldi/vivaldi'],
  ['Chrome', '/var/lib/flatpak/exports/bin/com.google.Chrome'],
  ['Chromium', '/var/lib/flatpak/exports/bin/org.chromium.Chromium'],
  ['Brave', '/var/lib/flatpak/exports/bin/com.brave.Browser'],
  ['Edge', '/var/lib/flatpak/exports/bin/com.microsoft.Edge'],
  ['Vivaldi', '/var/lib/flatpak/exports/bin/com.vivaldi.Vivaldi'],
] as const

const MAC_APPS = [
  ['Chrome', 'Google Chrome.app'],
  ['Chromium', 'Chromium.app'],
  ['Brave', 'Brave Browser.app'],
  ['Edge', 'Microsoft Edge.app'],
  ['Vivaldi', 'Vivaldi.app'],
] as const

/** Rutas relativas a Program Files / LocalAppData en Windows. */
const WINDOWS_BINARIES = [
  ['Chrome', 'Google\\Chrome\\Application\\chrome.exe'],
  ['Chromium', 'Chromium\\Application\\chrome.exe'],
  ['Brave', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
  ['Edge', 'Microsoft\\Edge\\Application\\msedge.exe'],
  ['Vivaldi', 'Vivaldi\\Application\\vivaldi.exe'],
] as const

/** Candidatos en orden de preferencia para el SO dado. */
export function browserCandidates(os: Os, env: BrowserEnv): BrowserCandidate[] {
  switch (os) {
    case 'linux': {
      const fromDirs = LINUX_BINARIES.flatMap(([name, binary]) =>
        LINUX_DIRS.map(dir => ({ name, path: `${dir}/${binary}`, kind: 'binary' as const })),
      )
      const extra = LINUX_EXTRA.map(([name, path]) => ({ name, path, kind: 'binary' as const }))
      const userFlatpak =
        env.home === undefined
          ? []
          : LINUX_EXTRA.filter(([, path]) => path.startsWith('/var/lib/flatpak/')).map(
              ([name, path]) => ({
                name,
                path: path.replace('/var/lib/flatpak/', `${env.home}/.local/share/flatpak/`),
                kind: 'binary' as const,
              }),
            )
      return [...fromDirs, ...extra, ...userFlatpak]
    }
    case 'darwin': {
      const roots = [
        '/Applications',
        ...(env.home === undefined ? [] : [`${env.home}/Applications`]),
      ]
      return MAC_APPS.flatMap(([name, app]) =>
        roots.map(root => ({ name, path: `${root}/${app}`, kind: 'macApp' as const })),
      )
    }
    case 'win32': {
      const roots = [env.programFiles, env.programFilesX86, env.localAppData].filter(
        (root): root is string => root !== undefined && root !== '',
      )
      return WINDOWS_BINARIES.flatMap(([name, relative]) =>
        roots.map(root => ({
          name,
          path: `${root.replace(/[\\/]+$/, '')}\\${relative}`,
          kind: 'binary' as const,
        })),
      )
    }
    case 'other':
      return []
  }
}

/** Busca el primer candidato que exista. `exists` es la comprobación inyectada (`$.fs.exists`). */
export async function findBrowser(
  os: Os,
  env: BrowserEnv,
  exists: (path: string) => Promise<boolean>,
): Promise<BrowserCandidate | null> {
  for (const candidate of browserCandidates(os, env)) {
    if (await exists(candidate.path)) return candidate
  }
  return null
}

/**
 * Comprueba que la URL que devuelve el servidor se puede abrir sin riesgo: http(s), del mismo
 * origen que el servidor configurado y solo con caracteres que ningún shell ni `cmd` interpreta
 * (el código de un solo uso es base64url). Evita que un servidor abra otra cosa o inyecte opciones.
 */
export function isSafeWindowUrl(url: string, serverOrigin: string): boolean {
  if (!/^https?:\/\/[A-Za-z0-9.:/?=_~-]+$/.test(url)) return false
  if (!URL.canParse(url)) return false
  return new URL(url).origin === serverOrigin
}

/**
 * ¿Puede ir un argumento por `cmd /c` sin que `cmd` lo interprete? El argv se convierte en una
 * línea de órdenes que solo lleva comillas si hay espacios, y `cmd` expande `%VAR%` incluso entre
 * comillas: se rechaza cualquier metacarácter de `cmd` y cualquier carácter de control.
 */
export function isCmdSafe(arg: string): boolean {
  return !/[&|<>^%"!\p{Cc}]/u.test(arg)
}

/**
 * Orden (argv, sin shell salvo el lanzador de Linux) que abre la ventana sin bloquear: el
 * lanzador vuelve en seguida y el navegador sigue vivo aunque la sesión de Claude Code acabe.
 */
export function launchCommand(
  os: Os,
  browser: BrowserCandidate | null,
  url: string,
  size: WindowSize,
): string[] | null {
  const appFlags = [`--app=${url}`, `--window-size=${size.width},${size.height}`]
  switch (os) {
    case 'linux':
    case 'other': {
      // `sh -c '"$@" &' nombre args…`: los argumentos van por posición (sin interpretar) y el
      // navegador queda en segundo plano con la salida cerrada, así `$.process.run` vuelve ya.
      const detach = ['sh', '-c', '"$@" </dev/null >/dev/null 2>&1 &', 'vibe-gambling']
      if (browser !== null) return [...detach, browser.path, ...appFlags]
      return os === 'linux' ? [...detach, 'xdg-open', url] : null
    }
    case 'darwin':
      // `open -na App --args …` arranca la app aunque ya esté abierta y vuelve en seguida.
      if (browser !== null) return ['open', '-na', browser.path, '--args', ...appFlags]
      return ['open', url]
    case 'win32':
      // `start "título" programa args`: el título lleva un espacio para que vaya entre comillas.
      // La ruta sale de variables de entorno (p. ej. el nombre del usuario en LOCALAPPDATA): si
      // `cmd` pudiera interpretarla, se usa el navegador por defecto, que solo recibe la URL.
      if (browser !== null && isCmdSafe(browser.path))
        return ['cmd', '/d', '/c', 'start', 'vibe gambling', browser.path, ...appFlags]
      return ['cmd', '/d', '/c', 'start', 'vibe gambling', url]
  }
}
