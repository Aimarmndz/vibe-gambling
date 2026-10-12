// SPDX-License-Identifier: AGPL-3.0-or-later
// Presencia de la ventana: le dice al servidor si se ve (`document.visibilityState`). Con todas
// las ventanas ocultas, los prompts se guardan como tiradas pendientes en vez de girar a ciegas.

/** Lo que hace falta del documento (inyectable en los tests). */
export interface VisibilitySource {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

/** ¿Se ve la ventana? */
export function isVisible(doc: Pick<VisibilitySource, 'visibilityState'>): boolean {
  return doc.visibilityState === 'visible'
}

/**
 * Manda la visibilidad en cada cambio (`send` decide si hay conexión). Devuelve la función que
 * deja de escuchar. Al (re)conectar hay que mandarla aparte con `isVisible`.
 */
export function watchPresence(doc: VisibilitySource, send: (visible: boolean) => void): () => void {
  let last: boolean | null = null
  const listener = () => {
    const visible = isVisible(doc)
    // Algunos navegadores repiten el evento sin cambio: no se manda dos veces lo mismo.
    if (visible === last) return
    last = visible
    send(visible)
  }
  doc.addEventListener('visibilitychange', listener)
  return () => doc.removeEventListener('visibilitychange', listener)
}
