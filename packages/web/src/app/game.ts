// SPDX-License-Identifier: AGPL-3.0-or-later
// La ventana del juego: une red, estado, animación de la ruleta, pantallas, sonido y render PSX.
// El servidor manda: aquí solo se pinta lo que llega y se envían las intenciones del jugador.
import type {
  LeaderboardBoard,
  LeaderboardResponse,
  Locale,
  ServerMessage,
  WebConfig,
} from '@vibe-gambling/shared'

import { Sfx } from '../audio/sfx.ts'
import type { WebClientConfig } from '../config.ts'
import { drawText, measure, printable, wrap } from '../font/bitmap.ts'
import { betReadyHint } from '../game/hints.ts'
import { PhraseMemory, describeOutcome } from '../game/outcome.ts'
import type { OutcomeView } from '../game/outcome.ts'
import { pocketAtLocalAngle } from '../game/spin.ts'
import { SpinAllLoop } from '../game/spinAll.ts'
import type { SpinAllEnd, SpinAllStatus } from '../game/spinAll.ts'
import {
  INITIAL_STATE,
  canSpinPending,
  dismissResult,
  localRevealAt,
  pendingSpins,
  reduce,
  reveal,
} from '../game/state.ts'
import type { Effect, GameState } from '../game/state.ts'
import { WheelMotion } from '../game/wheelMotion.ts'
import { applyDocumentLanguage, loadTranslator } from '../i18n/index.ts'
import type { Translator } from '../i18n/index.ts'
import { fetchLeaderboard, fetchMe } from '../net/api.ts'
import { withVersion } from '../net/link.ts'
import { webUrl } from '../net/urls.ts'
import type { Link, LinkStatus, Outgoing } from '../net/link.ts'
import { PSX_HEIGHT, PSX_WIDTH, PsxPipeline } from '../render/pipeline.ts'
import { SHOTS, World, layoutToWorld } from '../render/world.ts'
import type { Shot } from '../render/world.ts'
import { Hits, drawMemoryCardIcon, drawWindow } from '../ui/draw.ts'
import { PALETTE } from '../ui/palette.ts'
import { STATUS_BOX, STATUS_LOOKS, statusColor } from '../ui/status.ts'
import { BootScreen } from '../ui/screens/boot.ts'
import { LoanScreen } from '../ui/screens/loan.ts'
import { MessageScreen } from '../ui/screens/message.ts'
import { PendingNoticeScreen, PendingScreen } from '../ui/screens/pending.ts'
import { ResultScreen } from '../ui/screens/result.ts'
import { TableScreen } from '../ui/screens/table.ts'
import { TipScreen } from '../ui/screens/tip.ts'
import type { AppContext, ButtonLabels, Screen, ToastKind } from './context.ts'
import { Input } from './input.ts'
import type { ActionEvent } from './input.ts'
import { bootSeen, markBootSeen, markTipSeen, tipSeen } from './onboarding.ts'
import { isVisible, watchPresence } from './presence.ts'
import { loadPrefs, safeStorage, savePrefs } from './prefs.ts'
import type { Prefs } from './prefs.ts'
import { demoLeaderboard } from './demoBoard.ts'

interface Toast {
  text: string
  kind: ToastKind
  /** Duración en segundos desde que se enseña de verdad. */
  seconds: number
  /** Cuándo desaparece (null = aún no ha cabido en pantalla). */
  until: number | null
}

interface CameraMove {
  from: Shot
  to: Shot
  start: number
  duration: number
}

export interface GameOptions {
  canvas: HTMLCanvasElement
  live: HTMLElement
  web: WebConfig
  client: WebClientConfig
  link: Link
  demo: boolean
  reducedMotion: boolean
  /** Se salta el arranque (segunda apertura en la sesión). */
  skipBoot?: boolean
  /** El código de un solo uso de la URL no se pudo canjear (caducado o ya usado). */
  linkExpired?: boolean
  /** Traducción del idioma inicial, ya cargada (preferencia guardada → navegador → inglés). */
  translator: Translator
}

/** Curva barril del CRT (la misma que el shader), para que el ratón apunte bien con el filtro. */
function crtCurve(u: number, v: number): [number, number] {
  const x = u * 2 - 1
  const y = v * 2 - 1
  return [x * (1 + y * y * 0.045) * 0.5 + 0.5, y * (1 + x * x * 0.045) * 0.5 + 0.5]
}

export class Game implements AppContext {
  readonly web: WebConfig
  readonly client: WebClientConfig
  readonly demo: boolean
  readonly reducedMotion: boolean
  readonly hits = new Hits()
  readonly sfx = new Sfx()
  tr: Translator
  prefs: Prefs

  private readonly canvas: HTMLCanvasElement
  private readonly live: HTMLElement
  private readonly link: Link
  private readonly pipeline: PsxPipeline
  private readonly world: World
  private readonly table: TableScreen
  private readonly motion: WheelMotion
  private readonly input: Input
  private readonly phrases = new PhraseMemory()
  private screens: Screen[] = []
  private boot: BootScreen | null = null
  private loanScreen: LoanScreen | null = null
  private game: GameState = INITIAL_STATE
  private conn: LinkStatus = 'connecting'
  private toasts: Toast[] = []
  private hover: string | null = null
  private camera: CameraMove | null = null
  private shot: Shot = SHOTS.table
  private time = 0
  private last = 0
  private loanOfferedFor = ''
  private ended = false
  private readonly linkExpired: boolean
  /** Para quedarse solo con el último cambio de idioma pedido. */
  private localeRequest = 0
  /** Se cumple cuando el último cambio de idioma pedido ya está aplicado (o ha fallado). */
  private localeReady: Promise<void> = Promise.resolve()
  /** GIRAR TODAS. */
  private readonly spinLoop: SpinAllLoop
  /**
   * Aviso de tiradas pendientes al abrir la ventana: `due` en cuanto el primer `hello` trae
   * alguna; sale cuando la mesa queda libre (tras el arranque y "cómo se juega").
   */
  private pendingNotice: { due: boolean; readyAt: number | null } = { due: false, readyAt: null }

  constructor(opts: GameOptions) {
    this.web = opts.web
    this.client = opts.client
    this.demo = opts.demo
    this.reducedMotion = opts.reducedMotion
    this.canvas = opts.canvas
    this.live = opts.live
    this.link = opts.link
    this.linkExpired = opts.linkExpired ?? false
    // Si el servidor dice que la bola anterior aún rueda, se reintenta pasado un giro rápido.
    this.spinLoop = new SpinAllLoop(opts.web.game, opts.web.game.pendingSpins.quickSpinMs)
    this.prefs = loadPrefs(safeStorage('local'))
    this.tr = opts.translator
    applyDocumentLanguage(this.tr)
    this.sfx.setMuted(!this.prefs.sound)

    this.pipeline = new PsxPipeline(this.canvas)
    this.world = new World(PSX_WIDTH, PSX_HEIGHT)
    this.motion = new WheelMotion({
      launch: () => this.sfx.play('launch'),
      bounce: i => this.sfx.play('bounce', 1 - i * 0.18),
      settled: () => this.onSettled(),
    })
    this.table = new TableScreen(this, {
      pick: (x, y) => this.world.pick(x, y, PSX_WIDTH, PSX_HEIGHT),
    })
    this.screens = [this.table]
    if (!opts.skipBoot) {
      this.boot = new BootScreen(this, this.world, () => {
        this.boot = null
        markBootSeen(safeStorage('session'))
        this.showTipOnce()
      })
      this.screens.push(this.boot)
    } else {
      this.showTipOnce()
    }
    this.applyPrefs()

    this.input = new Input(
      this.canvas,
      {
        action: e => this.onAction(e),
        pointer: (kind, x, y) => this.onPointer(kind, x, y),
        wheel: d => this.top().wheel?.(d),
        gesture: () => this.sfx.unlock(),
      },
      (cx, cy) => this.toVirtual(cx, cy),
    )
    this.link.onMessage(msg => this.onMessage(msg))
    this.link.onStatus(status => this.onStatus(status))
    // Con todas las ventanas ocultas, los prompts se guardan como tiradas pendientes.
    watchPresence(document, visible => this.sendPresence(visible))
    new ResizeObserver(() => this.resize()).observe(this.canvas)
    this.resize()
    this.canvas.setAttribute('aria-label', this.tr.t('a11y.canvas'))
    // Ganchos de inspección para los tests E2E (solo lectura del estado propio).
    Object.assign(window, {
      __vg: {
        state: () => this.game,
        screens: () => this.screens.map(s => s.id),
        spinAll: () => this.spinLoop.status(),
        layoutToClient: (x: number, y: number) => this.layoutToClient(x, y),
        render: () => ({
          crt: this.pipeline.options.crt,
          snap: this.world.uniforms.uSnap.value === 1,
          muted: !this.prefs.sound,
          audio: this.sfx.started,
        }),
      },
    })
  }

  /** ¿Debe saltarse el arranque? (ya se vio en esta sesión del navegador). */
  static bootSeen(): boolean {
    return bootSeen(safeStorage('session'))
  }

  /** "Cómo se juega" en la primera apertura de este navegador (luego, desde el menú). */
  private showTipOnce(): void {
    if (tipSeen(safeStorage('local'))) return
    this.showTip(() => markTipSeen(safeStorage('local')))
  }

  showTip(onClose?: () => void): void {
    const tip = new TipScreen(this, onClose)
    this.push(tip)
    this.announce([this.tr.t('tip.title'), ...tip.lines()].join(' '))
  }

  start(): void {
    this.link.start()
    this.last = performance.now()
    const frame = (now: number) => {
      this.frame(now)
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }

  // ------------------------------------------------------------------ AppContext

  setPrefs(patch: Partial<Prefs>): void {
    this.prefs = { ...this.prefs, ...patch }
    savePrefs(safeStorage('local'), this.prefs)
    if (patch.locale && patch.locale !== this.tr.locale) this.switchLocale(patch.locale)
    this.applyPrefs()
  }

  /** Cambia de idioma en cuanto llega su chunk de textos (el último pedido gana). */
  private switchLocale(locale: Locale): void {
    const request = ++this.localeRequest
    this.localeReady = loadTranslator(locale).then(
      tr => {
        if (request !== this.localeRequest) return
        this.tr = tr
        applyDocumentLanguage(tr)
        this.canvas.setAttribute('aria-label', tr.t('a11y.canvas'))
      },
      (error: unknown) => {
        console.error('[i18n] no se pudo cargar el idioma', locale, error)
        this.toast(this.tr.t('error.generic', { message: String(error) }), 'error')
      },
    )
  }

  state(): GameState {
    return this.game
  }

  send(msg: Outgoing): boolean {
    const ok = this.link.send(withVersion(msg))
    if (!ok) this.toast(this.tr.t('status.offline'), 'error')
    return ok
  }

  push(screen: Screen): void {
    this.screens.push(screen)
    // Las zonas clicables son del último fotograma: al cambiar de pantalla ya no valen (si no, un
    // clic justo después de cerrar el menú abría la opción que había debajo del ratón).
    this.hits.clear()
  }

  pop(screen?: Screen): void {
    this.hits.clear()
    if (!screen) {
      if (this.screens.length > 1) this.screens.pop()
      return
    }
    const i = this.screens.lastIndexOf(screen)
    if (i > 0) this.screens.splice(i, 1)
    if (screen === this.loanScreen) this.loanScreen = null
  }

  toast(text: string, kind: ToastKind = 'info'): void {
    const ms = kind === 'save' ? this.client.ui.memoryCardToastMs : this.client.ui.toastMs
    this.toasts = [
      ...this.toasts.filter(t => t.text !== text),
      { text, kind, seconds: ms / 1000, until: null },
    ]
    this.announce(text)
  }

  buttons(): ButtonLabels {
    return this.input?.usingPad
      ? { x: '✕', o: '○', tri: '△', sq: '□', start: 'START', sel: 'SELECT' }
      : { x: 'X', o: 'O', tri: 'C', sq: 'Z', start: 'P', sel: 'G' }
  }

  hoverId(): string | null {
    return this.hover
  }

  openLink(url: string): void {
    const safe = webUrl(url)
    if (!safe) {
      console.warn('[game] enlace descartado: no es http(s)')
      return
    }
    window.open(safe, '_blank', 'noopener,noreferrer')
  }

  minChip(): number {
    return Math.min(...this.web.game.chips)
  }

  loanAvailable(): boolean {
    const w = this.game.wallet
    return w !== null && w.balance < this.minChip() && this.game.phase !== 'landing'
  }

  connection(): LinkStatus {
    return this.conn
  }

  offerLoan(): void {
    if (this.loanScreen || !this.loanAvailable()) return
    this.loanScreen = new LoanScreen(this)
    this.push(this.loanScreen)
    this.sfx.play('accept')
  }

  leaderboard(board: LeaderboardBoard, limit: number): Promise<LeaderboardResponse> {
    if (this.demo) return Promise.resolve(demoLeaderboard(board, this.game, this.client.demo.login))
    return fetchLeaderboard({ board, limit })
  }

  async brokeRank(): Promise<number | null> {
    if (this.demo) return null
    const me = await fetchMe()
    return me.brokeRank
  }

  // ------------------------------------------------------------------ tiradas pendientes

  spinPending(): boolean {
    return this.requestPendingSpin(false)
  }

  spinAllPending(): boolean {
    if (this.demo || !canSpinPending(this.game)) {
      this.refusePendingSpin()
      return false
    }
    if (!this.spinLoop.start(this.game)) return false
    this.sfx.play('accept')
    this.announce(this.tr.t('status.spinAll', { n: pendingSpins(this.game), ...this.buttons() }))
    // La primera sale ya; las siguientes, cuando la mesa vuelve a estar quieta.
    this.tickSpinAll()
    return true
  }

  spinAll(): SpinAllStatus {
    return this.spinLoop.status()
  }

  showPending(): void {
    if (this.demo) return
    if (this.screens.some(s => s instanceof PendingScreen)) return
    this.push(new PendingScreen(this))
    const count = pendingSpins(this.game)
    this.announce(
      count > 0
        ? this.tr.t('status.pending', { n: this.tr.n(count), ...this.buttons() })
        : this.tr.t('pending.none'),
    )
  }

  /** Pide gastar una tirada pendiente. El servidor la tira y llega como cualquier ronda. */
  private requestPendingSpin(quick: boolean): boolean {
    if (this.demo || !canSpinPending(this.game)) {
      this.refusePendingSpin()
      return false
    }
    const ok = this.send({ type: 'spin.pending', quick, requestId: crypto.randomUUID() })
    if (ok && !quick) this.sfx.play('accept')
    return ok
  }

  private refusePendingSpin(): void {
    this.sfx.play('error')
    if (pendingSpins(this.game) > 0) this.toast(this.tr.t('pending.busy'), 'error')
  }

  /** Un paso de GIRAR TODAS (cada fotograma): pide la siguiente cuando toca. */
  private tickSpinAll(): void {
    const step = this.spinLoop.next(this.game, Date.now())
    if (step.ended) this.onSpinAllEnd(step.ended)
    if (!step.spin) return
    if (!this.requestPendingSpin(true)) this.onSpinAllEnd(this.spinLoop.stop('error'))
  }

  private onSpinAllEnd(reason: SpinAllEnd | null): void {
    if (!reason) return
    const kind = reason === 'error' ? 'error' : reason === 'user' ? 'info' : 'money'
    this.toast(
      this.tr.t(`toast.spinAll.${reason}`, { n: this.tr.n(pendingSpins(this.game)) }),
      kind,
    )
  }

  private sendPresence(visible: boolean): void {
    // Sin conexión no se manda: al reconectar se manda el estado de ese momento.
    if (this.conn !== 'open') return
    this.link.send(withVersion({ type: 'presence', visible }))
  }

  /** El aviso "tienes N tiradas pendientes" al abrir, cuando la mesa queda libre. */
  private checkPendingNotice(): void {
    const notice = this.pendingNotice
    if (!notice.due) return
    const free =
      !this.boot && this.top() === this.table && this.game.phase === 'idle' && !this.spinLoop.active
    if (!free) {
      notice.readyAt = null
      return
    }
    const now = performance.now()
    notice.readyAt ??= now + this.client.ui.pendingNoticeDelayMs
    if (now < notice.readyAt) return
    notice.due = false
    const count = pendingSpins(this.game)
    if (count > 0) {
      this.sfx.play('accept')
      this.push(new PendingNoticeScreen(this))
      this.announce(
        [
          this.tr.t('pending.noticeLine1'),
          this.tr.t('pending.noticeLine2', { n: this.tr.n(count) }),
          this.tr.t('pending.noticeLine3'),
        ].join(' '),
      )
    }
  }

  // ------------------------------------------------------------------ red

  private onStatus(status: LinkStatus): void {
    const was = this.conn
    this.conn = status
    // Nada más conectar (y al reconectar): ¿se ve esta ventana?
    if (status === 'open') this.sendPresence(isVisible(document))
    else this.onSpinAllEnd(this.spinLoop.stop('error'))
    if (status === 'unauthorized') {
      this.showMessage({
        title: this.tr.t('login.title'),
        lines: this.linkExpired
          ? [this.tr.t('login.expired'), this.tr.t('login.expiredHint')]
          : [this.tr.t('login.body'), this.tr.t('login.step1'), this.tr.t('login.step2')],
        footer: this.tr.t('login.landing'),
        onAccept: () => window.location.assign('/'),
        card: true,
      })
    } else if (status === 'refused' || (status === 'ended' && !this.ended)) {
      this.showMessage({ title: this.tr.t('bye.replaced'), lines: [] })
    } else if (status === 'open' && was === 'reconnecting') {
      this.toast(this.tr.t('toast.reconnected'))
    }
  }

  private onMessage(msg: ServerMessage): void {
    const before = this.game.slip.total
    const step = reduce(this.game, msg, Date.now())
    this.game = step.state
    if (msg.type === 'round.resolved') this.spinLoop.resolved()
    // Primera ficha sin ronda abierta: se explica que se jugará con el próximo prompt.
    if (msg.type === 'slip' && betReadyHint(before, this.game.slip.total, this.game.phase)) {
      this.toast(this.tr.t(this.demo ? 'toast.betReadyDemo' : 'toast.betReady'))
    }
    for (const effect of step.effects) this.onEffect(effect)
  }

  private onEffect(effect: Effect): void {
    const { tr } = this
    switch (effect.type) {
      case 'connected': {
        const user = this.game.user
        if (effect.first) {
          const last = this.game.lastRound
          if (last && this.game.phase !== 'spinning') {
            this.motion.restOn(last.result)
            this.world.setWinner(last.result)
          }
          if (user?.locale && !this.prefs.locale) this.setPrefs({ locale: user.locale })
          if (!this.demo && pendingSpins(this.game) > 0) this.pendingNotice.due = true
        }
        if (this.game.phase === 'spinning') this.motion.orbit()
        return
      }
      case 'spin':
        this.motion.orbit()
        this.world.setWinner(null)
        this.announce(tr.t('status.thinking'))
        return
      case 'land': {
        // En GIRAR TODAS la caída es corta: el ritmo lo marca el `revealAt` del servidor.
        const quick = this.spinLoop.active
        const normalMs = this.reducedMotion
          ? this.client.spin.reducedLandingMs
          : this.client.spin.landingMs
        const minMs = quick ? Math.min(normalMs, this.client.spin.quickLandingMs) : normalMs
        const untilReveal = localRevealAt(this.game, effect.round) - Date.now()
        this.motion.land(effect.round.result, Math.max(minMs, untilReveal) / 1000)
        this.world.setWinner(null)
        // Si había un resultado en pantalla, se cierra para ver caer la bola.
        this.screens.filter(s => s instanceof ResultScreen).forEach(s => this.pop(s))
        this.moveCamera(SHOTS.wheel, quick ? 0.4 : 0.9)
        this.announce(tr.t('status.landing'))
        return
      }
      case 'pending':
        this.toast(
          tr.t(effect.event === 'queued' ? 'toast.pendingQueued' : 'toast.pendingDropped', {
            n: tr.n(effect.count),
          }),
          effect.event === 'queued' ? 'money' : 'error',
        )
        return
      case 'expired': {
        const rel = this.motion.ballAngle - this.motion.wheelAngle
        this.motion.restOn(pocketAtLocalAngle(rel))
        this.toast(tr.t('toast.expired'))
        return
      }
      case 'slip':
        return
      case 'loan':
        if (this.loanScreen) this.pop(this.loanScreen)
        this.sfx.play('loan')
        this.toast(tr.t('loan.granted', { amount: tr.n(effect.amount) }), 'money')
        return
      case 'rejected':
      case 'error': {
        if (this.loanScreen) this.pop(this.loanScreen)
        if (effect.type === 'error' && this.spinLoop.active) {
          // Un `rate_limited` en GIRAR TODAS solo retrasa la siguiente: no merece un aviso.
          const end = this.spinLoop.failed(effect.error, Date.now())
          if (!end) return
          if (end === 'empty') {
            this.onSpinAllEnd(end)
            return
          }
        }
        const text = this.errorText(effect.error, effect.message)
        this.sfx.play('error')
        this.toast(text, 'error')
        return
      }
      case 'season':
        this.spinLoop.stop('error')
        this.toast(tr.t('toast.seasonChanged', { season: effect.seasonId }), 'money')
        return
      case 'settings':
        // Si se acaba de cambiar de idioma, el aviso sale ya en el nuevo (cuando llegue su chunk).
        void this.localeReady.then(() => this.toast(this.tr.t('settings.saved')))
        return
      case 'bye':
        this.ended = effect.reason !== 'shutdown'
        if (effect.reason === 'shutdown') {
          this.toast(tr.t('bye.shutdown'), 'error')
        } else {
          this.showMessage({ title: tr.t(`bye.${effect.reason}`), lines: [] })
        }
        return
    }
  }

  /** Texto del error en el idioma de la ventana (o el mensaje del servidor si no lo conocemos). */
  private errorText(code: string, message: string): string {
    const key = `error.${code}`
    if (this.tr.has(key)) return this.tr.t(key)
    return this.tr.t('error.generic', { message })
  }

  private showMessage(opts: ConstructorParameters<typeof MessageScreen>[1]): void {
    this.screens = [this.table, new MessageScreen(this, opts)]
    this.hits.clear()
    this.boot = null
    this.announce([opts.title, ...opts.lines].join('. '))
  }

  // ------------------------------------------------------------------ ronda

  private onSettled(): void {
    this.game = reveal(this.game)
    const round = this.game.lastRound
    const wallet = this.game.shown
    if (!round || !wallet) return
    this.world.setWinner(round.result)
    const view: OutcomeView = describeOutcome({
      round,
      wallet,
      game: this.web.game,
      tr: this.tr,
      memory: this.phrases,
    })
    // GIRAR TODAS se para sola en un premio gordo, en el verde o en bancarrota.
    const stopped = this.spinLoop.revealed(round, this.game.wallet ?? wallet)
    if (stopped) this.onSpinAllEnd(stopped)
    const quick = this.spinLoop.active
    this.sfx.play('settle')
    const straightWin = round.bets.some(b => b.won && b.selection.kind === 'straight')
    if (view.jackpot) this.sfx.play('jackpot')
    else if (view.net > 0) this.sfx.play(straightWin ? 'bigWin' : 'win')
    else if (view.net < 0) this.sfx.play('lose')
    this.push(
      new ResultScreen(
        this,
        view,
        () => {
          this.game = dismissResult(this.game)
          this.moveCamera(SHOTS.table, quick ? 0.3 : 0.7)
          if (this.game.phase === 'spinning') this.motion.orbit()
        },
        quick ? this.client.ui.quickResultHoldMs : this.client.ui.resultHoldMs,
      ),
    )
    // "Guardando en MEMORY CARD…" tras cada tirada (en GIRAR TODAS, solo al final: si no, el
    // aviso taparía la ruleta en cada vuelta).
    if (!quick) {
      this.toast(`${this.tr.t('mc.saving')}\n${this.tr.t('mc.noPowerOff')}`, 'save')
      this.sfx.play('save')
    }
    this.announce(
      this.tr.t('a11y.result', {
        number: round.result,
        color: this.tr.t(`color.${round.color}`),
        net: this.tr.signed(round.net),
      }),
    )
  }

  /** Ofrece el préstamo cuando el saldo no llega ni para la ficha mínima (una vez por situación). */
  private checkLoanOffer(): void {
    const w = this.game.shown
    if (!w || this.loanScreen || this.boot || this.spinLoop.active) return
    if (this.game.phase === 'landing' || this.game.phase === 'result') return
    if (this.top() !== this.table) return
    if (w.balance >= this.minChip() || this.game.slip.total > 0) return
    const key = `${w.seasonId}:${w.spins}:${w.loans}`
    if (key === this.loanOfferedFor) return
    this.loanOfferedFor = key
    this.offerLoan()
  }

  // ------------------------------------------------------------------ entrada

  private top(): Screen {
    return this.screens[this.screens.length - 1]!
  }

  private onAction(e: ActionEvent): void {
    if (e.action === 'mute') {
      this.setPrefs({ sound: !this.prefs.sound })
      this.toast(
        this.prefs.sound
          ? `♪ ${this.tr.t('settings.sound')} ${this.tr.t('settings.on')}`
          : this.tr.t('hud.muted'),
      )
      return
    }
    // ○ para GIRAR TODAS (esté la pantalla que esté).
    if (e.action === 'back' && this.spinLoop.active) {
      this.sfx.play('back')
      this.onSpinAllEnd(this.spinLoop.stop('user'))
      return
    }
    this.top().action(e)
  }

  private onPointer(kind: 'move' | 'down' | 'leave', x: number, y: number): void {
    const hit = kind === 'leave' ? null : this.hits.at(x, y)
    this.hover = hit?.id ?? null
    this.canvas.style.cursor = hit ? 'pointer' : 'default'
    if (kind === 'down' && hit) {
      hit.onClick()
      return
    }
    this.top().pointer?.(kind, x, y)
  }

  /** Punto del tapete en coordenadas de la ventana (sin la curva del CRT). Para los tests E2E. */
  private layoutToClient(x: number, y: number): { x: number; y: number } {
    const v = layoutToWorld({ x, y }).project(this.world.camera)
    const rect = this.canvas.getBoundingClientRect()
    const view = this.pipeline.cssViewport(window.devicePixelRatio || 1)
    return {
      x: rect.left + view.x + ((v.x + 1) / 2) * view.w,
      y: rect.top + view.y + ((1 - v.y) / 2) * view.h,
    }
  }

  private toVirtual(clientX: number, clientY: number): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const v = this.pipeline.cssViewport(dpr)
    let u = (clientX - rect.left - v.x) / v.w
    let w = (clientY - rect.top - v.y) / v.h
    if (this.pipeline.options.crt) {
      const [cu, cv] = crtCurve(u, 1 - w)
      u = cu
      w = 1 - cv
    }
    if (u < 0 || u >= 1 || w < 0 || w >= 1) return null
    return [u * PSX_WIDTH, w * PSX_HEIGHT]
  }

  // ------------------------------------------------------------------ render

  private applyPrefs(): void {
    this.sfx.setMuted(!this.prefs.sound)
    const high = this.prefs.quality === 'high'
    this.pipeline.options = {
      crt: this.prefs.crt && !this.reducedMotion && high,
      dither: true,
    }
    this.world.setSnap(!this.reducedMotion)
    this.resize()
  }

  private resize(): void {
    const dpr = this.prefs.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1
    this.pipeline.resize(this.canvas.clientWidth || 1, this.canvas.clientHeight || 1, dpr)
  }

  private moveCamera(to: Shot, seconds: number): void {
    if (this.reducedMotion) {
      this.shot = to
      this.camera = null
      this.world.setShot(to)
      return
    }
    this.camera = { from: this.currentShot(), to, start: this.time, duration: seconds }
    this.shot = to
  }

  private currentShot(): Shot {
    const cam = this.world.camera
    const dir = cam.getWorldDirection(cam.position.clone())
    return {
      position: cam.position.clone(),
      target: cam.position.clone().add(dir.multiplyScalar(5)),
      fov: cam.fov,
    }
  }

  private announce(text: string): void {
    this.live.textContent = text
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.time += dt
    const t = this.time
    this.input.pollGamepads(now)

    // Animación de la ruleta.
    this.motion.update(dt)
    this.sfx.setRolling(this.motion.rolling(), Math.min(1, Math.abs(this.motion.wheelSpeed) / 2.5))
    this.world.setWheel(
      this.motion.wheelAngle,
      this.motion.ballAngle,
      this.motion.radius,
      this.motion.lift,
    )

    // Cámara.
    if (this.camera) {
      const k = Math.min(1, (t - this.camera.start) / this.camera.duration)
      const ease = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      this.world.blendShots(this.camera.from, this.camera.to, ease)
      if (k >= 1) this.camera = null
    }

    // Pantallas.
    for (const s of [...this.screens]) s.update?.(dt, t)
    this.tickSpinAll()
    this.checkLoanOffer()
    this.checkPendingNotice()
    const top = this.top()
    this.world.felt.update(
      {
        hover: top === this.table ? this.table.hover() : null,
        winner:
          this.game.phase === 'result' || this.game.phase === 'idle'
            ? (this.game.lastRound?.result ?? null)
            : null,
      },
      this.tr,
    )
    this.world.setChips(this.game.slip.bets, this.web.game.chips)
    this.world.setCursor(
      top === this.table && this.shot === SHOTS.table && !this.camera ? this.table.focus() : null,
      t,
    )
    if (this.prefs.quality === 'high') this.world.tick(t)

    const g = this.pipeline.ui
    g.clearRect(0, 0, PSX_WIDTH, PSX_HEIGHT)
    this.hits.clear()
    let from = 0
    this.screens.forEach((s, i) => {
      if (s.opaque) from = i
    })
    // Se pinta la base (la mesa o la última pantalla opaca) y la pantalla de arriba del todo.
    const visible = this.screens.slice(from)
    const layers = visible.length > 2 ? [visible[0]!, visible[visible.length - 1]!] : visible
    // Con un diálogo o menú encima, los avisos quedan debajo de él (no tapan sus textos).
    const upper = layers[layers.length - 1]
    const toastsUnderTop = upper !== this.table && upper?.id !== 'result'
    layers.forEach((s, i) => {
      if (toastsUnderTop && i === layers.length - 1) this.drawToasts(g, t)
      // Durante la caída de la bola (plano de la ruleta) el HUD de la mesa se esconde.
      if (s === this.table && (this.shot !== SHOTS.table || this.camera)) return
      s.draw(g, t)
    })
    if (!toastsUnderTop) this.drawToasts(g, t)
    // En la mesa ya lo dice su rótulo; en el plano de la ruleta, el HUD está escondido.
    const tableHidden = this.shot !== SHOTS.table || this.camera !== null
    if (this.spinLoop.active && tableHidden) this.drawSpinAllBanner(g, t)

    const view = this.boot
      ? this.boot.view()
      : { scene: this.world.scene, camera: this.world.camera }
    this.pipeline.render(view.scene, view.camera)
  }

  /** Rótulo de GIRAR TODAS, visible también en el plano de la ruleta (el HUD se esconde). */
  private drawSpinAllBanner(g: CanvasRenderingContext2D, t: number): void {
    const text = this.tr.t('status.spinAll', {
      n: this.tr.n(pendingSpins(this.game)),
      ...this.buttons(),
    })
    const look = STATUS_LOOKS.pending
    const w = measure(text) + 16
    drawWindow(g, 160 - w / 2, 4, w, STATUS_BOX.height, {
      top: look.top,
      bottom: look.bottom,
    })
    drawText(g, text, 160, 4 + STATUS_BOX.textTop, {
      color: statusColor(look, t),
      align: 'center',
      shadow: PALETTE.ink,
    })
  }

  private drawToasts(g: CanvasRenderingContext2D, t: number): void {
    this.toasts = this.toasts.filter(toast => toast.until === null || toast.until > t)
    // Franja libre de la pantalla de arriba: por defecto, encima de la barra inferior de la mesa.
    // El resultado reserva el número, el veredicto y la frase: lo que no cabe espera su turno.
    const band = this.top().toastBand?.() ?? { top: 0, bottom: 202 }
    let y = band.bottom
    for (const toast of [...this.toasts].reverse()) {
      const save = toast.kind === 'save'
      const x = save ? 96 : 112
      const w = save ? 220 : 204
      // El texto empieza tras el icono de la memory card y no puede pasarse del borde derecho.
      const textX = save ? 22 : 6
      const lines = printable(toast.text)
        .split('\n')
        .flatMap(line => wrap(line, w - textX - 5))
      const h = 8 + lines.length * 10
      if (y - h - 3 < band.top) continue
      y -= h + 3
      toast.until ??= t + toast.seconds
      if (toast.kind === 'save') {
        g.fillStyle = PALETTE.ink
        g.fillRect(x, y, w, h)
        g.fillStyle = PALETTE.frame
        g.fillRect(x, y, w, 1)
        g.fillRect(x, y + h - 1, w, 1)
        g.fillRect(x, y, 1, h)
        g.fillRect(x + w - 1, y, 1, h)
        drawMemoryCardIcon(g, x + 5, y + Math.floor((h - 14) / 2), Math.floor(t * 4) % 2 === 0)
      } else {
        drawWindow(g, x, y, w, h, {
          top:
            toast.kind === 'error'
              ? PALETTE.alertTop
              : toast.kind === 'money'
                ? PALETTE.moneyTop
                : PALETTE.menuTop,
          bottom: PALETTE.menuBottom,
        })
      }
      lines.forEach((line, i) => {
        drawText(g, line, x + textX, y + 5 + i * 10, {
          color: PALETTE.cream,
          shadow: PALETTE.ink,
        })
      })
    }
  }
}
