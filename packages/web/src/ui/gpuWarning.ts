// SPDX-License-Identifier: AGPL-3.0-or-later
// Aviso de aceleración por hardware desactivada: un `<dialog>` modal de HTML (play.html) con la
// paleta y la fuente pixel de la ventana, como el aviso de "sin WebGL". Va en HTML y no en el canvas
// porque es justo el caso en que el canvas va a tirones, porque las rutas de los ajustes se pueden
// leer con calma y copiar, y porque un diálogo de verdad da foco, Tab, Escape y lectores de pantalla
// sin reinventarlos. Nunca bloquea: se cierra y se sigue jugando.
import type { MessageKey, Translator } from '../i18n/index.ts'

export type BrowserFamily = 'chrome' | 'firefox' | 'safari'

/** Familia del navegador, solo para poner primero sus instrucciones. */
export function browserFamily(userAgent: string): BrowserFamily {
  if (/Firefox\//.test(userAgent)) return 'firefox'
  if (/Safari\//.test(userAgent) && !/Chrome|Chromium|CriOS|Edg/.test(userAgent)) return 'safari'
  return 'chrome'
}

/** "Firefox: Ajustes → …" → nombre del navegador, separador y ruta (para resaltar el nombre). */
export function splitStep(text: string): { name: string; sep: string; path: string } | null {
  const m = /^([^:]+?)([\s\u00a0\u202f]*:\s+)([\s\S]+)$/.exec(text)
  return m ? { name: m[1]!, sep: m[2]!, path: m[3]! } : null
}

export interface GpuWarningOptions {
  tr: Translator
  /** "No volver a mostrar". */
  onNever: () => void
  /** Adónde vuelve el foco al cerrar (el canvas del juego). */
  returnFocus: HTMLElement | null
  userAgent?: string
}

const STEPS: readonly BrowserFamily[] = ['chrome', 'firefox', 'safari']

/** Rellena y abre el aviso. Devuelve el diálogo, o null si la página no lo tiene. */
export function showGpuWarning(opts: GpuWarningOptions): HTMLDialogElement | null {
  const dialog = document.getElementById('gpu-warning') as HTMLDialogElement | null
  const list = document.getElementById('gpu-steps')
  const ok = document.getElementById('gpu-ok') as HTMLButtonElement | null
  const never = document.getElementById('gpu-never') as HTMLButtonElement | null
  if (!dialog || !list || !ok || !never) return null
  const { tr } = opts
  const text = (id: string, key: MessageKey) => {
    const el = document.getElementById(id)
    if (el) el.textContent = tr.t(key)
  }
  text('gpu-title', 'gpu.title')
  text('gpu-body', 'gpu.body')
  text('gpu-how', 'gpu.how')
  ok.textContent = tr.t('gpu.ok')
  never.textContent = tr.t('gpu.never')
  // Primero, las instrucciones del navegador que se está usando.
  const mine = browserFamily(opts.userAgent ?? navigator.userAgent)
  const order = [mine, ...STEPS.filter(s => s !== mine)]
  list.replaceChildren(
    ...order.map(family => {
      const li = document.createElement('li')
      li.dataset.browser = family
      if (family === mine) li.className = 'current'
      const step = tr.t(`gpu.${family}`)
      const parts = splitStep(step)
      if (parts) {
        const name = document.createElement('strong')
        name.textContent = parts.name
        li.append(name, `${parts.sep}${parts.path}`)
      } else {
        li.textContent = step
      }
      return li
    }),
  )

  // Las teclas del aviso no llegan al juego (Escape abriría el menú, Enter apostaría).
  const stopKeys = (e: KeyboardEvent) => e.stopPropagation()
  const close = (reason: 'ok' | 'never') => {
    if (reason === 'never') opts.onNever()
    dialog.close(reason)
  }
  const onOk = () => close('ok')
  const onNever = () => close('never')
  dialog.addEventListener('keydown', stopKeys)
  ok.addEventListener('click', onOk)
  never.addEventListener('click', onNever)
  dialog.addEventListener(
    'close',
    () => {
      dialog.removeEventListener('keydown', stopKeys)
      ok.removeEventListener('click', onOk)
      never.removeEventListener('click', onNever)
      opts.returnFocus?.focus()
    },
    { once: true },
  )
  dialog.hidden = false
  if (typeof dialog.showModal === 'function') dialog.showModal()
  else dialog.setAttribute('open', '')
  ok.focus()
  return dialog
}
