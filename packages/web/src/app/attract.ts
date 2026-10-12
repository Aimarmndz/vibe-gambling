// SPDX-License-Identifier: AGPL-3.0-or-later
// "Attract mode" de la landing: la ruleta PSX girando sola, como las demos de las consolas en
// los escaparates. Es decorativa: no hay apuestas, ni servidor, ni nada en juego.
import { POCKET_COUNT } from '@vibe-gambling/shared'

import { WheelMotion } from '../game/wheelMotion.ts'
import type { Translator } from '../i18n/index.ts'
import { PSX_HEIGHT, PSX_WIDTH, PsxPipeline } from '../render/pipeline.ts'
import { World, WHEEL_CENTER } from '../render/world.ts'

/** Ciclo de la demo (segundos): gira, cae la bola y descansa. */
const ORBIT_S = 3
const LAND_S = 4.2
const REST_S = 2.5

/** Arranca la demo; `translator` es el idioma de la página (las etiquetas del tapete). */
export function startAttractMode(
  canvas: HTMLCanvasElement,
  translator: Translator,
): { setTranslator(tr: Translator): void } {
  const pipeline = new PsxPipeline(canvas)
  pipeline.options = { crt: true, dither: true }
  const world = new World(PSX_WIDTH, PSX_HEIGHT)
  world.felt.update({ hover: null, winner: null }, translator)
  let phaseEnd = ORBIT_S
  let phase: 'orbit' | 'land' | 'rest' = 'orbit'
  const motion = new WheelMotion({
    launch: () => {},
    bounce: () => {},
    settled: result => world.setWinner(result),
  })
  motion.orbit()

  const resize = () => {
    pipeline.resize(
      canvas.clientWidth || 1,
      canvas.clientHeight || 1,
      Math.min(window.devicePixelRatio || 1, 2),
    )
  }
  new ResizeObserver(resize).observe(canvas)
  resize()

  let time = 0
  let last = performance.now()
  let visible = true
  new IntersectionObserver(entries => {
    visible = entries.some(e => e.isIntersecting)
  }).observe(canvas)

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (visible && !document.hidden) {
      time += dt
      if (time >= phaseEnd) {
        if (phase === 'orbit') {
          phase = 'land'
          // Número al azar solo para la animación del escaparate.
          motion.land(Math.floor(Math.random() * POCKET_COUNT), LAND_S)
          phaseEnd = time + LAND_S + REST_S
        } else {
          phase = 'orbit'
          world.setWinner(null)
          motion.orbit()
          phaseEnd = time + ORBIT_S
        }
      }
      motion.update(dt)
      world.setWheel(motion.wheelAngle, motion.ballAngle, motion.radius, motion.lift)
      const a = time * 0.12
      world.camera.position.set(
        WHEEL_CENTER.x + Math.sin(a) * 5.2,
        4.2,
        WHEEL_CENTER.z + Math.cos(a) * 5.2,
      )
      world.camera.lookAt(WHEEL_CENTER.x, 0.2, WHEEL_CENTER.z)
      world.tick(time)
      pipeline.ui.clearRect(0, 0, PSX_WIDTH, PSX_HEIGHT)
      pipeline.render(world.scene, world.camera)
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  return {
    // Al cambiar de idioma en la landing, el tapete se vuelve a rotular.
    setTranslator: tr => world.felt.update({ hover: null, winner: null }, tr),
  }
}
