// SPDX-License-Identifier: AGPL-3.0-or-later
// Arranque falso de la consola POLYGONE (inventada): gema dorada que gira, logotipo, "Licensed by
// Vibe Coding Entertainment" y pantalla de título con la marca del juego (la ficha con ">_" de
// docs/brand/) y la atribución "Created by Aimar (github.com/Aimarmndz)" de LICENSE. Se salta con
// cualquier tecla.
import {
  Color,
  Group,
  LatheGeometry,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
} from 'three'
import type { Camera } from 'three'

import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, measure } from '../../font/bitmap.ts'
import { createPsxMaterial, createPsxUniforms } from '../../render/psxMaterial.ts'
import { PSX_HEIGHT, PSX_WIDTH } from '../../render/pipeline.ts'
import type { World } from '../../render/world.ts'
import { WHEEL_CENTER } from '../../render/world.ts'
import { attribution } from '../../legal/attribution.ts'
import { brandMarks, drawMark } from '../brandMark.ts'
import { PALETTE } from '../palette.ts'

/** Marca en la pantalla de título: la rejilla de 32 a ×1, centrada encima de "VIBE". */
const TITLE_MARK = Object.freeze({ top: 8, scale: 1 })

/** Coreografía del arranque (segundos). */
const T = Object.freeze({
  gemIn: 0.3,
  word: 1.1,
  system: 2.1,
  logoOut: 2.9,
  licensedIn: 3.3,
  licensedOut: 4.9,
  title: 5.3,
})

function gemGeometry(): LatheGeometry {
  // Talla brillante de 8 facetas: mesa, corona, filetín y pabellón.
  const profile = [
    [0, -1.05],
    [1, 0],
    [1, 0.08],
    [0.55, 0.42],
    [0, 0.42],
  ].map(([x, y]) => new Vector2(x, y))
  const geo = new LatheGeometry(profile, 8).toNonIndexed() as LatheGeometry
  geo.computeVertexNormals()
  return geo
}

export class BootScreen implements Screen {
  readonly id = 'boot'
  readonly opaque = true
  private readonly ctx: AppContext
  private readonly world: World
  private readonly onDone: () => void
  private readonly gemScene = new Scene()
  private readonly gemCamera = new PerspectiveCamera(40, PSX_WIDTH / PSX_HEIGHT, 0.1, 50)
  private readonly titleCamera = new PerspectiveCamera(40, PSX_WIDTH / PSX_HEIGHT, 0.1, 60)
  private readonly gem: Group
  private time = 0
  private played = { boot: false, licensed: false }
  private done = false

  constructor(ctx: AppContext, world: World, onDone: () => void) {
    this.ctx = ctx
    this.world = world
    this.onDone = onDone
    const u = createPsxUniforms(PSX_WIDTH, PSX_HEIGHT)
    u.uFogNear.value = 20
    u.uFogFar.value = 40
    u.uAmbient.value = new Color(0.35, 0.3, 0.25)
    u.uLightColor.value = new Color(1, 0.9, 0.7)
    u.uPointPos.value = new Vector3(-3, 2, 4)
    u.uSnap.value = ctx.reducedMotion ? 0 : 1
    this.gemScene.background = new Color(PALETTE.ink)
    this.gem = new Group()
    const mesh = new Mesh(
      gemGeometry(),
      createPsxMaterial(u, { color: new Color(PALETTE.gold), specular: 0.9 }),
    )
    this.gem.add(mesh)
    this.gem.position.set(0, 0.9, 0)
    this.gemScene.add(this.gem)
    this.gemCamera.position.set(0, 0.6, 6)
    this.gemCamera.lookAt(0, 0.4, 0)
  }

  /** Escena y cámara que hay que pintar ahora. */
  view(): { scene: Scene; camera: Camera } {
    if (this.time < T.title) return { scene: this.gemScene, camera: this.gemCamera }
    return { scene: this.world.scene, camera: this.titleCamera }
  }

  private finish(): void {
    if (this.done) return
    this.done = true
    this.ctx.pop(this)
    this.onDone()
  }

  action(e: ActionEvent): void {
    if (e.action === 'mute') return
    this.finish()
  }

  pointer(kind: 'move' | 'down' | 'leave'): boolean {
    if (kind === 'down') this.finish()
    return true
  }

  update(dt: number): void {
    this.time += dt
    const t = this.time
    if (!this.played.boot && t >= T.gemIn) {
      this.played.boot = true
      this.ctx.sfx.play('boot')
    }
    if (!this.played.licensed && t >= T.licensedIn) {
      this.played.licensed = true
      this.ctx.sfx.play('licensed')
    }
    // La gema entra girando muy rápido y frena hasta quedarse de frente. Con movimiento reducido
    // aparece ya quieta y la cámara del título no da vueltas.
    const still = this.ctx.reducedMotion
    const k = still ? 1 : Math.min(1, Math.max(0, (t - T.gemIn) / 1.6))
    const ease = 1 - Math.pow(1 - k, 3)
    this.gem.rotation.y = (1 - ease) * Math.PI * 6 + (still ? 0.4 : t * 0.6)
    this.gem.rotation.x = 0.25 + (1 - ease) * 0.9
    this.gem.scale.setScalar(0.05 + ease * 0.95)
    // Título: la cámara da una vuelta lenta alrededor de la ruleta.
    const a = still ? 0 : (t - T.title) * 0.25
    this.titleCamera.position.set(
      WHEEL_CENTER.x + Math.sin(a) * 7.5,
      4.4,
      WHEEL_CENTER.z + Math.cos(a) * 7.5,
    )
    this.titleCamera.lookAt(WHEEL_CENTER.x, 0.3, WHEEL_CENTER.z)
    if (t >= T.title + this.ctx.client.ui.titleHoldMs / 1000 + 1.5) this.finish()
  }

  draw(g: CanvasRenderingContext2D, now: number): void {
    const { tr } = this.ctx
    const t = this.time
    const fade = (start: number, end: number) => {
      // 0 = negro total, 1 = visible: entra en 0,3 s y sale en 0,4 s.
      const a = Math.min(1, Math.max(0, (t - start) / 0.3))
      const b = Math.min(1, Math.max(0, (end - t) / 0.4))
      return Math.min(a, b)
    }
    g.clearRect(0, 0, PSX_WIDTH, PSX_HEIGHT)

    if (t < T.licensedIn - 0.1) {
      // Logotipo.
      const word = tr.t('boot.console')
      const shown = Math.max(0, Math.min(word.length, Math.floor((t - T.word) / 0.07)))
      const scale = 4
      const x0 = 160 - measure(word, scale) / 2
      drawText(g, word.slice(0, shown), x0 + 2, 158, { color: PALETTE.goldDark, scale })
      drawText(g, word.slice(0, shown), x0, 156, { color: PALETTE.gold, scale })
      if (t >= T.system) {
        drawText(g, tr.t('boot.system'), 160, 192, { color: PALETTE.muted, align: 'center' })
      }
      this.cover(g, fade(0, T.logoOut))
    } else if (t < T.title) {
      g.fillStyle = PALETTE.ink
      g.fillRect(0, 0, PSX_WIDTH, PSX_HEIGHT)
      drawText(g, tr.t('boot.licensedBy'), 160, 92, { color: PALETTE.muted, align: 'center' })
      drawText(g, tr.t('boot.licensor1'), 160, 108, {
        color: PALETTE.cream,
        scale: 2,
        align: 'center',
      })
      drawText(g, tr.t('boot.licensor2'), 160, 128, {
        color: PALETTE.cream,
        scale: 2,
        align: 'center',
      })
      this.cover(g, fade(T.licensedIn, T.licensedOut))
    } else {
      // Título sobre la mesa en penumbra.
      g.fillStyle = 'rgba(8,7,13,0.5)'
      g.fillRect(0, 0, PSX_WIDTH, PSX_HEIGHT)
      g.fillStyle = 'rgba(8,7,13,0.85)'
      g.fillRect(0, 202, PSX_WIDTH, 38)
      // La ficha con el prompt encima del logotipo; su "_" parpadea al ritmo de "PULSA X".
      const blink = Math.floor(now * 2) % 2 === 0
      const mark = brandMarks().large
      const markX = (PSX_WIDTH - mark.size * TITLE_MARK.scale) / 2
      drawMark(g, mark, markX, TITLE_MARK.top, TITLE_MARK.scale, blink)
      const [first = '', ...rest] = tr.t('brand.title').split(' ')
      drawText(g, first, 160, 46, {
        color: PALETTE.gold,
        scale: 5,
        align: 'center',
        shadow: PALETTE.ink,
      })
      drawText(g, rest.join(' '), 160, 88, {
        color: PALETTE.red,
        scale: 4,
        align: 'center',
        shadow: PALETTE.ink,
      })
      drawText(g, tr.t('brand.tagline'), 160, 124, {
        color: PALETTE.cream,
        align: 'center',
        shadow: PALETTE.ink,
      })
      if (blink) {
        drawText(g, tr.t('boot.pressStart', { ...this.ctx.buttons() }), 160, 160, {
          color: PALETTE.cream,
          scale: 2,
          align: 'center',
          shadow: PALETTE.ink,
        })
      }
      // Atribución obligatoria (términos 7(b) de LICENSE) y aviso de monedas de mentira.
      drawText(g, attribution(this.ctx.web.site.author, tr).text, 160, 207, {
        color: PALETTE.cream,
        align: 'center',
        shadow: PALETTE.ink,
      })
      drawText(g, tr.t('brand.fakeCoins'), 160, 218, {
        color: PALETTE.muted,
        align: 'center',
        shadow: PALETTE.ink,
      })
      this.cover(g, fade(T.title, Number.POSITIVE_INFINITY))
    }
    if (!this.ctx.sfx.running) {
      drawText(g, tr.t('boot.soundHint'), 316, 230, { color: PALETTE.line, align: 'right' })
    } else if (t < T.title) {
      drawText(g, tr.t('boot.skip'), 316, 230, { color: PALETTE.line, align: 'right' })
    }
  }

  /** Fundido a negro: `visible` 1 = nada, 0 = negro. */
  private cover(g: CanvasRenderingContext2D, visible: number): void {
    if (visible >= 1) return
    g.fillStyle = `rgba(8,7,13,${1 - visible})`
    g.fillRect(0, 0, PSX_WIDTH, PSX_HEIGHT)
  }
}
