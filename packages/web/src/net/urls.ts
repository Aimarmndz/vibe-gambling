// SPDX-License-Identifier: AGPL-3.0-or-later
// Defensa en profundidad para las URLs que llegan del servidor (avatares, perfiles, enlaces de
// ayuda). El contrato de shared ya solo acepta http y https (`httpUrlSchema`), pero lo que se pinta
// no depende de que todo lo que llega haya pasado por él (otra versión del servidor, datos de la
// demo): aquí se vuelve a comprobar. La CSP bloquea `javascript:`, pero un enlace que no lleva a
// ninguna parte tampoco debería pintarse.

/** La URL si es http(s) y está bien formada; si no, null. */
export function webUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}
