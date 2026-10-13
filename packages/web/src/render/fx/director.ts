// SPDX-License-Identifier: AGPL-3.0-or-later
// Director del espectáculo: encadena las animaciones de una ronda (plan.ts) cuando la bola ya se
// ha asentado, lleva la cola de avisos de logro, el fuego de ON FIRE, la ficha que vuela al gastar
// una tirada pendiente y las capas FX (2D que tiembla, 3D de fichas y copas, sacudida y
// desaturado). game.ts solo le pasa los mensajes y le deja pintar.
import type { Achievement, PublicGameConfig, ResolvedRound } from '@vibe-gambling/shared'

import type { AppContext } from '../../app/context.ts'
import type { FxConfig } from '../../config.ts'
import { drawText, measure } from '../../font/bitmap.ts'
import type { MessageKey } from '../../i18n/index.ts'
import { pendingSpins } from '../../game/state.ts'
import { BankruptScreen } from '../../ui/screens/bankrupt.ts'
import { FallacyScreen } from '../../ui/screens/fallacy.ts'
import { GreenScreen } from '../../ui/screens/green.ts'
import { PrizeScreen } from '../../ui/screens/prize.ts'
import { PushScreen } from '../../ui/screens/pushToProd.ts'
import { drawWindow } from '../../ui/draw.ts'
import { PALETTE } from '../../ui/palette.ts'
import type { PsxPipeline } from '../pipeline.ts'
import { progress } from './easing.ts'
import { DoomFire } from './fire.ts'
import type { FxScreen } from './fxScreen.ts'
import type { FxKit } from './kit.ts'
import { NOTICE, NoticeQueue } from './notices.ts'
import { planRound } from './plan.ts'
import type { FxStep } from './plan.ts'
import { Rays } from './rays.ts'
import { RAYS_CENTER } from '../../ui/screens/prize.ts'
import { FxScene3d } from './scene3d.ts'
import { FLAME_ICON, FLAME_ICON_COLORS, drawSprite } from './sprites.ts'
import { GRADIENTS, drawFancyText } from './text.ts'

export interface DirectorDeps {
  ctx: AppContext
  pipeline: PsxPipeline
  cfg: FxConfig
  game: PublicGameConfig
  reduced: boolean
  /** Una vuelta de la copa (la misma que en LOGROS, `menu.trophySpinMs`). */
  trophySpinMs: number
  announce: (text: string) => void
  /** BANCARROTA ya ha hecho la oferta: que la mesa no la repita sola al volver. */
  loanOffered: () => void
  /** ¿Se ve la mesa (cámara quieta en su plano y sin pantallas encima)? */
  tableVisible: () => boolean
}

/** Lo que pide game.ts para enseñar la pantalla de resultado de siempre. */
export type ShowResult = (done: () => void) => void

/** Panel derecho del HUD (racha, tiradas, pendientes). */
const PANEL = { x: 222, y: 4, w: 94 } as const
/** Recuerdo de los últimos números vistos (para el historial de la falacia). */
const RECENT_MAX = 20

interface FireIntro {
  ms: number
  streak: number
  base: DoomFire
  strip: DoomFire
}

export class FxDirector {
  readonly kit: FxKit
  readonly coins: FxScene3d
  private readonly deps: DirectorDeps
  private readonly notices: NoticeQueue
  private readonly recent: number[] = []
  private screen: FxScreen | null = null
  private steps: FxStep[] = []
  /** Paso que espera a que la mesa esté a la vista (falacia y ON FIRE van sobre ella). */
  private waiting: FxStep | null = null
  private round: ResolvedRound | null = null
  private fire: FireIntro | null = null
  private readonly flames: DoomFire
  private spriteClock = 0
  private shakeFrame = { x: 0, y: 0 }
  private desatFrame = 0
  private overlayOn = false
  private lastPending: number | null = null
  private crackleClock = 0

  constructor(deps: DirectorDeps) {
    this.deps = deps
    const cfg = deps.cfg
    this.coins = new FxScene3d({
      gravityPxS2: cfg.bigWin.gravityPxS2,
      maxCoins: cfg.maxCoins,
      snap: !deps.reduced,
    })
    this.notices = new NoticeQueue(cfg.achievement, deps.reduced)
    this.flames = new DoomFire(30, 10)
    const rays = new Rays(RAYS_CENTER.x, RAYS_CENTER.y)
    this.kit = {
      ctx: deps.ctx,
      cfg,
      reduced: deps.reduced,
      coins: this.coins,
      rays,
      shake: (x, y) => {
        if (deps.reduced) return
        this.shakeFrame = { x, y }
      },
      desaturate: k => {
        if (deps.reduced) return
        this.desatFrame = k
      },
      announce: deps.announce,
    }
  }

  /** ¿Hay una animación de espectáculo en pantalla (no se apilan otros avisos encima)? */
  get blocking(): boolean {
    return this.screen !== null && !this.screen.isClosed
  }

  /** Pasos que quedan de la secuencia en curso (para los tests E2E). */
  get queued(): string[] {
    return this.steps.map(s => s.kind)
  }

  /** Logro cuyo aviso está en pantalla (para los tests E2E). */
  get notice(): string | null {
    return this.notices.shown?.achievement.id ?? null
  }

  /** Logros esperando su turno (para los tests). */
  get noticesPending(): number {
    return this.notices.pending
  }

  /** Id de la animación en pantalla (para los tests E2E). */
  get current(): string | null {
    if (this.blocking) return this.screen!.id
    if (this.fire) return 'fx:fire'
    return this.waiting ? `wait:${this.waiting.kind}` : null
  }

  /**
   * La bola se ha asentado (después de `revealAt`): planifica y arranca la secuencia. Devuelve los
   * pasos, para que game.ts sepa si le toca poner el sonido de siempre.
   */
  reveal(round: ResolvedRound, quick: boolean, showResult: ShowResult): FxStep[] {
    this.abort()
    this.round = round
    this.recent.push(round.result)
    if (this.recent.length > RECENT_MAX) this.recent.shift()
    const steps = planRound(round, this.deps.game, { quick })
    this.steps = [...steps]
    this.showResult = showResult
    this.next()
    return steps
  }

  private showResult: ShowResult = done => done()

  /** Llega otra ronda: se quita lo que haya (sin seguir la secuencia) y se para la lluvia. */
  abort(): void {
    this.steps = []
    this.waiting = null
    this.screen?.dispose()
    this.screen = null
    this.coins.clear()
  }

  private next(): void {
    this.screen = null
    const step = this.steps.shift()
    if (!step) return
    // Lo que va sobre la mesa espera a que la cámara vuelva a ella (si no, ni se vería el HUD).
    if ((step.kind === 'fallacy' || step.kind === 'fire') && !this.deps.tableVisible()) {
      this.waiting = step
      return
    }
    this.run(step)
  }

  private run(step: FxStep): void {
    const round = this.round
    if (!round) return
    const { ctx } = this.deps
    const go = () => this.next()
    switch (step.kind) {
      case 'push':
        this.open(new PushScreen(this.kit, step.multiplier, go))
        return
      case 'green':
        this.open(new GreenScreen(this.kit, step.chain, go))
        return
      case 'prize':
        this.open(
          new PrizeScreen(
            this.kit,
            { tier: step.tier, net: step.net, netMultiple: step.netMultiple, number: round.result },
            go,
          ),
        )
        return
      case 'result':
        this.showResult(go)
        return
      case 'fallacy': {
        const streak = round.colorStreak
        if (!streak) {
          go()
          return
        }
        this.open(
          new FallacyScreen(
            this.kit,
            { color: streak.color, count: streak.count, recent: this.recent },
            go,
          ),
        )
        return
      }
      case 'fire':
        this.startFire(step.streak)
        go()
        return
      case 'bankrupt':
        this.deps.loanOffered()
        this.open(new BankruptScreen(this.kit, () => ctx.offerLoan(), go))
        return
    }
  }

  private open(screen: FxScreen): void {
    this.screen = screen
    this.deps.ctx.push(screen)
  }

  /** Logro conseguido (llega detrás del mensaje que lo desbloquea). */
  achievement(a: Achievement): void {
    this.notices.push(a)
  }

  private startFire(streak: number): void {
    const { ctx } = this.deps
    ctx.sfx.playFx('fireWhoosh')
    this.deps.announce(ctx.tr.t('a11y.fx.fire', { n: streak }))
    if (this.deps.reduced) return
    // La base es más baja que los 30 px de la tabla del diseño: como en su guion gráfico, una
    // franja que lame el borde inferior del panel sin tapar sus cifras.
    const strip = new DoomFire(240, 40)
    // La franja ya sale encendida del todo a los 300 ms: se precalienta lo que tarda en subir.
    for (let i = 0; i < strip.h; i++) strip.step()
    this.fire = { ms: 0, streak, base: new DoomFire(102, 14), strip }
  }

  /** ¿Está la racha encendida? (hasta la primera derrota). */
  burning(): boolean {
    const w = this.deps.ctx.state().shown
    return w !== null && w.currentStreak >= this.deps.game.onFireAt
  }

  update(dt: number): void {
    const { ctx, cfg } = this.deps
    const ms = dt * 1000
    this.coins.update(dt)
    // Los sprites (fuego) van a `spriteFps`, no a los fotogramas del juego.
    this.spriteClock += dt
    const frame = 1 / cfg.onFire.spriteFps
    let steps = 0
    while (this.spriteClock >= frame && steps < 4) {
      this.spriteClock -= frame
      steps++
      if (this.fire) {
        this.fire.base.step()
        this.fire.strip.step()
      }
      if (this.burning()) this.flames.step()
    }
    if (this.fire) {
      this.fire.ms += ms
      // Al acabar la intro se apaga la fuente y se deja consumir.
      if (this.fire.ms >= cfg.onFire.introMs) {
        this.fire.base.extinguish()
        this.fire.strip.extinguish()
      }
      if (this.fire.ms >= cfg.onFire.introMs + 600) this.fire = null
    }
    // Crepitar suave mientras arde (2 por segundo).
    if (this.burning() && !this.deps.reduced) {
      this.crackleClock += dt
      if (this.crackleClock >= 0.5) {
        this.crackleClock = 0
        ctx.sfx.playFx('crackle')
      }
    }
    if (this.waiting && this.deps.tableVisible()) {
      const step = this.waiting
      this.waiting = null
      this.run(step)
    }
    this.watchPending()
    const state = ctx.state()
    // Ni durante la caída (destriparía el resultado) ni encima del resultado (taparía el número):
    // el trofeo sale sobre la mesa, como en el diseño.
    // Y solo con la mesa a la vista, sin otro paso de la secuencia esperando (va antes).
    const ready =
      !this.blocking &&
      this.waiting === null &&
      this.fire === null &&
      state.phase !== 'landing' &&
      state.phase !== 'result' &&
      this.deps.tableVisible()
    const started = this.notices.tick(ms, ready)
    if (started) {
      ctx.sfx.playFx('trophy')
      const vars = started.params
      this.deps.announce(
        ctx.tr.t('a11y.fx.achievement', {
          title: ctx.tr.t(`achievements.${started.id}.title` as MessageKey, vars),
          desc: ctx.tr.t(`achievements.${started.id}.desc` as MessageKey, vars),
        }),
      )
    }
  }

  /** El contador de pendientes: sonido al sumar, ficha que vuela hacia la ruleta al gastar. */
  private watchPending(): void {
    const { ctx, cfg } = this.deps
    const count = pendingSpins(ctx.state())
    const last = this.lastPending
    this.lastPending = count
    if (last === null || count === last) return
    if (count > last) {
      ctx.sfx.playFx('pendingUp')
      return
    }
    ctx.sfx.play('chip')
    ctx.sfx.playFx('pendingDown')
    if (!this.deps.reduced) {
      this.coins.fly({ x: 300, y: 36 }, { x: 160, y: 60 }, cfg.pending.flyMs / 1000)
    }
  }

  /** Llamitas de 30×10 detrás de la racha del HUD (las pinta la mesa, bajo el texto). */
  drawHudFlames(g: CanvasRenderingContext2D): void {
    if (!this.burning()) return
    if (this.deps.reduced) {
      // Movimiento reducido: icono de llama fijo de 8×8 junto a la racha.
      drawSprite(g, FLAME_ICON, FLAME_ICON_COLORS, 266, 6)
      return
    }
    this.flames.draw(g, 282, 1)
  }

  /** Aviso de logro en la capa de interfaz (la copa va en la capa 3D). */
  drawUi(g: CanvasRenderingContext2D): void {
    const shown = this.notices.shown
    if (!shown) {
      this.coins.setTrophy(0, null)
      return
    }
    const { tr } = this.deps.ctx
    const a = shown.achievement
    const title = tr.t(`achievements.${a.id}.title` as MessageKey, a.params)
    const head = tr.t('fx.achievement.unlocked')
    const w = Math.min(316, Math.max(NOTICE.minW, measure(title) + 40, measure(head) + 40))
    const pose = this.notices.pose(shown.ms, w)
    if (pose.done) {
      this.coins.setTrophy(0, null)
      return
    }
    const x = pose.x
    drawWindow(g, x, NOTICE.y, w, NOTICE.h, { top: PALETTE.goldDark, bottom: PALETTE.carpet })
    drawText(g, head, x + 32, NOTICE.y + 6, { color: PALETTE.gold, shadow: PALETTE.ink })
    drawText(g, title, x + 32, NOTICE.y + 19, { color: PALETTE.cream, shadow: PALETTE.ink })
    if (pose.sheen !== null) {
      // Brillo diagonal de 6 px que cruza la ventana.
      g.save()
      g.beginPath()
      g.rect(x + 2, NOTICE.y + 2, w - 4, NOTICE.h - 4)
      g.clip()
      g.fillStyle = 'rgba(255,224,138,0.45)'
      const sx = x + Math.round(pose.sheen * (w + NOTICE.h)) - NOTICE.h
      for (let y = 0; y < NOTICE.h; y++) g.fillRect(sx + (NOTICE.h - y), NOTICE.y + y, 6, 1)
      g.restore()
    }
    const angle = this.deps.reduced ? 0.6 : ((shown.ms / this.deps.trophySpinMs) % 1) * Math.PI * 2
    this.coins.setTrophy(0, { x: x + 16, y: NOTICE.y + 16, size: 10, angle })
  }

  /** Capa FX 2D propia (intro de ON FIRE). Devuelve si ha pintado algo. */
  drawFx(fx: CanvasRenderingContext2D): boolean {
    const fire = this.fire
    if (!fire) return false
    const { tr } = this.deps.ctx
    const panelH = pendingSpins(this.deps.ctx.state()) > 0 ? 40 : 29
    // 0–80 ms: el panel derecho destella crema al 50 % (una vez).
    if (fire.ms < 80) {
      fx.fillStyle = 'rgba(243,234,214,0.5)'
      fx.fillRect(PANEL.x, PANEL.y, PANEL.w, panelH)
    }
    fire.base.draw(fx, PANEL.x - 4, PANEL.y + panelH - 10)
    const introMs = this.deps.cfg.onFire.introMs
    if (fire.ms >= 300) {
      fire.strip.draw(fx, 40, 70)
      if (fire.ms < introMs) {
        const k = progress(fire.ms, 300, 200)
        if (k > 0) {
          drawFancyText(fx, tr.t('fx.fire.title'), 160, 72, {
            scale: 5,
            bands: GRADIENTS.fire,
            outline: 2,
            align: 'center',
          })
          drawText(fx, tr.t('fx.fire.streak', { n: fire.streak }), 160, 114, {
            color: PALETTE.cream,
            align: 'center',
            shadow: PALETTE.ink,
          })
        }
      }
    }
    return true
  }

  /** Al final de cada fotograma: sacudida, desaturado y si se compone la capa 3D. */
  endFrame(): void {
    const p = this.deps.pipeline
    p.shake.x = this.shakeFrame.x
    p.shake.y = this.shakeFrame.y
    p.desaturate = this.desatFrame
    this.shakeFrame = { x: 0, y: 0 }
    this.desatFrame = 0
    const busy = this.coins.busy
    if (busy && !this.overlayOn) p.addOverlay(this.coins.scene, this.coins.camera, { shake: true })
    if (!busy && this.overlayOn) p.removeOverlay(this.coins.scene)
    this.overlayOn = busy
  }
}
