// SPDX-License-Identifier: AGPL-3.0-or-later
// Defensa en profundidad para las URLs que llegan del servidor (avatares, perfiles, enlaces de
// ayuda). El contrato de shared usa `z.url()`, que también acepta `javascript:`, `data:` o
// `vbscript:`: aquí solo se dejan pasar http y https. La CSP ya bloquea `javascript:`, pero un
// enlace que no lleva a ninguna parte tampoco debería pintarse.

/** La URL si es http(s) y está bien formada; si no, null. */
export function webUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}
