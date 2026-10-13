// SPDX-License-Identifier: AGPL-3.0-or-later
// Entrada de /play: comprueba WebGL2, carga /config.json, canjea el código de un solo uso y arranca
// la ventana. Three.js y el juego se cargan aparte (import dinámico) para que esto pinte rápido.
// Si WebGL va por software (sin aceleración por hardware), avisa tras el arranque, sin bloquear.
// Primero de todo: zod sin `new Function` (CSP sin 'unsafe-eval'), ver zodJitless.ts.
import './zodJitless.ts'
import './styles/play.css'

import { clientConfig, loadWebConfig } from './config.ts'
import { applyDocumentLanguage, detectLocale, loadTranslator } from './i18n/index.ts'
import type { Translator } from './i18n/index.ts'
import { ApiError, redeemCode, takeCodeFromUrl } from './net/api.ts'
import { gpuWarned, markGpuWarned } from './app/onboarding.ts'
import { loadPrefs, safeStorage } from './app/prefs.ts'
import { detectSoftwareGpu } from './render/gpu.ts'
import { hasWebGL2 } from './render/pipeline.ts'
import { showGpuWarning } from './ui/gpuWarning.ts'

function fallback(tr: Translator, title: string, body: string): void {
  const root = document.getElementById('fallback')
  const canvas = document.getElementById('screen')
  if (canvas) canvas.hidden = true
  if (!root) return
  root.hidden = false
  document.getElementById('fallback-title')!.textContent = title
  document.getElementById('fallback-body')!.textContent = body
  document.getElementById('fallback-home')!.textContent = tr.t('login.landing')
}

async function main(): Promise<void> {
  // Idioma inicial: el guardado por el usuario → el del navegador → inglés.
  const prefs = loadPrefs(safeStorage('local'))
  const tr = await loadTranslator(prefs.locale ?? detectLocale(navigator.languages))
  applyDocumentLanguage(tr)

  if (!hasWebGL2()) {
    fallback(tr, tr.t('nowebgl.title'), tr.t('nowebgl.body'))
    return
  }

  let web
  try {
    web = await loadWebConfig()
  } catch (error) {
    console.error(error)
    fallback(tr, tr.t('error.config'), String(error instanceof Error ? error.message : error))
    return
  }

  const params = new URLSearchParams(window.location.search)
  const demo = params.has('demo')
  // Aviso de WebGL por software: una vez por sesión, salvo "No volver a mostrar" o `?nogpuwarn`
  // (los E2E, cuyos navegadores dibujan por software). `?gpu=software` fuerza la detección.
  let warnGpu = false
  if (prefs.gpuWarning && !params.has('nogpuwarn') && !gpuWarned(safeStorage('session'))) {
    const gpu = detectSoftwareGpu(
      clientConfig.gpu.softwareRenderers,
      params.get('gpu') === 'software',
    )
    if (gpu.software) console.info('[gpu] WebGL por software', gpu.reason, gpu.renderer ?? '')
    warnGpu = gpu.software
  }
  // El código de un solo uso se quita de la URL antes de nada (que no quede en el historial).
  const code = takeCodeFromUrl(window.location, window.history)
  let linkExpired = false
  if (code && !demo) {
    try {
      await redeemCode(code)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      console.warn('[auth] no se pudo canjear el enlace', error.code ?? error.status)
      linkExpired = true
    }
  }

  const [{ Game }, { WsLink, wsUrl }, { DemoLink }, { isDemoFx }] = await Promise.all([
    import('./app/game.ts'),
    import('./net/link.ts'),
    import('./net/demo.ts'),
    import('./net/demoFx.ts'),
  ])
  let link
  let demoControl
  if (demo) {
    // `?demo&fx=mega`: fuerza una animación de espectáculo (capturas, GIF y E2E).
    const fx = params.get('fx')
    // `?demo=manual` (tests) empieza sin turnos automáticos; si no, como lo dejó la persona.
    const demoLink = new DemoLink(
      web.game,
      clientConfig.demo,
      params.get('demo') !== 'manual' && prefs.demoAuto,
      window.location.origin,
      isDemoFx(fx) ? fx : null,
    )
    Object.assign(window, { __vgDemo: demoLink.controls })
    link = demoLink
    // Con una animación forzada (capturas, GIF) no hay mandos AUTO/PAUSA: la mesa sale como antes.
    if (!isDemoFx(fx)) demoControl = demoLink
  } else {
    link = new WsLink(wsUrl(window.location), clientConfig.ws)
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const canvas = document.getElementById('screen') as HTMLCanvasElement
  const game: InstanceType<typeof Game> = new Game({
    canvas,
    live: document.getElementById('live')!,
    web,
    client: clientConfig,
    link,
    demo,
    reducedMotion,
    skipBoot: Game.bootSeen() || params.has('noboot'),
    linkExpired,
    translator: tr,
    demoControl,
    onBooted: () => {
      if (!warnGpu) return
      markGpuWarned(safeStorage('session'))
      showGpuWarning({
        tr: game.tr,
        onNever: () => game.setPrefs({ gpuWarning: false }),
        returnFocus: canvas,
      })
    },
  })
  game.start()
  canvas.focus()
}

main().catch(async (error: unknown) => {
  console.error('[play] error al arrancar', error)
  try {
    const tr = await loadTranslator(detectLocale(navigator.languages))
    fallback(tr, tr.t('error.config'), String(error))
  } catch (inner) {
    // Ni siquiera hay textos (chunk de idioma inaccesible): queda el error en la consola.
    console.error('[play] tampoco se pudieron cargar los textos', inner)
  }
})
