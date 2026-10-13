// SPDX-License-Identifier: AGPL-3.0-or-later
// Modo demo (`/play?demo`): un servidor de mentira dentro del navegador para probar la ventana sin
// cuenta. No toca el servidor real ni el ranking: es una partida local que se pierde al cerrar.
// Usa la misma lógica de shared que el servidor; el azar es local porque aquí no hay nada en juego.
import {
  PROTOCOL_VERSION,
  accrueInterest,
  addToSlip,
  applyLoan,
  bestStreak,
  canRequestLoan,
  chooseRoundBets,
  clientMessageSchema,
  colorOf,
  colorStreak,
  netWorth,
  nextStreak,
  resolveBets,
  seasonAt,
  spectacleOf,
  totalStake,
} from '@vibe-gambling/shared'
import type {
  Bet,
  ClientMessageInput,
  GameConfig,
  OpenRound,
  PublicGameConfig,
  ResolvedRound,
  SelfUser,
  ServerMessage,
  Wallet,
} from '@vibe-gambling/shared'

import type { WebClientConfig } from '../config.ts'
import { demoScenario } from './demoFx.ts'
import type { DemoFx } from './demoFx.ts'
import { DemoProgress, seededRandom, showcaseSeason } from './demoProgress.ts'
import type { Link, LinkStatus } from './link.ts'

export interface DemoTurnOptions {
  result?: number
  gitPushOk?: boolean
  testFailed?: boolean
  /** Milisegundos que "piensa Claude" antes de resolver. */
  thinkMs?: number
  /** Giro mínimo de esta ronda (las pendientes de GIRAR TODAS van más rápido). */
  minSpinMs?: number
  /** Caída de la bola de esta ronda (las pendientes de GIRAR TODAS caen más rápido). */
  landingMs?: number
}

/** Mandos del modo demo para los tests y las capturas (`window.__vgDemo`). */
export interface DemoControls {
  turn(options?: DemoTurnOptions): Promise<void>
  setWallet(balance: number, debt?: number): void
  /** Fuerza una animación de espectáculo (guiones de demoFx.ts). */
  fx(kind: DemoFx): Promise<void>
  /** Temporada de ejemplo con azar fijo: estadísticas, banco, logros y tiradas pendientes. */
  showcase(): void
}

/** La configuración completa que necesitan las funciones de shared, a partir de la pública. */
export function demoGameConfig(pub: PublicGameConfig): GameConfig {
  const minChip = Math.min(...pub.chips)
  return {
    startingBalance: pub.startingBalance,
    chips: [...pub.chips],
    allIn: pub.allIn,
    maxBetsPerRound: pub.maxBetsPerRound,
    // La apuesta por defecto real no es pública: en la demo es la ficha mínima al rojo.
    defaultBet: { selection: { kind: 'red' }, amount: minChip },
    loan: { ...pub.loan, maxDebt: Number.MAX_SAFE_INTEGER },
    jackpot: { ...pub.jackpot },
    season: { timeZone: pub.seasonTimeZone, startDay: pub.seasonStartDay },
    hallOfRuinSize: 10,
    spin: { minSpinMs: pub.minSpinMs, landingMs: pub.landingMs },
    round: { staleAfterMs: 30 * 60 * 1000 },
    streak: { colorWarningAt: pub.colorWarningAt, historySize: 50, onFireAt: pub.onFireAt },
    pendingSpins: { ...pub.pendingSpins },
    bigWin: { ...pub.bigWin },
    // Logros y estadísticas son del servidor: la demo no los usa (valores solo para el tipo).
    achievements: {
      proDebtorLoans: 1,
      compoundInterestDebt: Number.MAX_SAFE_INTEGER,
      zeroCollectorZeros: 1,
      addictSpins: 1,
      nightOwl: { fromHour: 0, toHour: 1 },
    },
    stats: { recentRounds: 1, seriesPoints: 2, loanMarks: 0, bankHistory: 1 },
  }
}

function randomPocket(): number {
  const buf = new Uint32Array(1)
  // Rechazo para que el reparto sea uniforme entre 0 y 36.
  for (;;) {
    crypto.getRandomValues(buf)
    const v = buf[0]!
    if (v < Math.floor(0x1_0000_0000 / 37) * 37) return v % 37
  }
}

function uuid(): string {
  return crypto.randomUUID()
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export class DemoLink implements Link {
  readonly controls: DemoControls
  private readonly cfg: GameConfig
  private readonly client: WebClientConfig['demo']
  /** Lo que piden ESTADÍSTICAS, BANCO y LOGROS. */
  private readonly progress: DemoProgress
  private readonly auto: boolean
  private readonly messageListeners: ((msg: ServerMessage) => void)[] = []
  private readonly statusListeners: ((status: LinkStatus) => void)[] = []
  private user: SelfUser
  private wallet: Wallet
  private slip: Bet[] = []
  private lastBets: Bet[] | null = null
  private round: OpenRound | null = null
  private lastRound: ResolvedRound | null = null
  private readonly history: number[] = []
  private running = false
  private busy = false
  /** BANCARROTA es una vez por temporada (como en el servidor). */
  private wentBroke = false
  /** Animación que se fuerza al arrancar (`?demo&fx=…`). */
  private readonly startFx: DemoFx | null
  /**
   * De dónde salen los números: azar criptográfico, salvo tras la temporada de ejemplo, que sigue
   * con su azar fijo (las tiradas pendientes de las capturas salen siempre igual).
   */
  private pocket: () => number = randomPocket

  /** `origin`: el de la página (de ahí salen el avatar y el "perfil" del jugador de la demo). */
  constructor(
    pub: PublicGameConfig,
    client: WebClientConfig['demo'],
    auto: boolean,
    origin: string,
    startFx: DemoFx | null = null,
  ) {
    // Los umbrales de los logros no son públicos: la demo usa los suyos (config/web.json).
    this.cfg = { ...demoGameConfig(pub), achievements: client.achievements }
    this.progress = new DemoProgress(this.cfg, client.stats)
    this.client = client
    this.startFx = startFx
    // Con una animación forzada no hay turnos automáticos: la captura sale siempre igual.
    this.auto = auto && startFx === null
    const now = new Date()
    this.user = {
      login: client.login,
      // Sin cuenta de GitHub: avatar y "perfil" del propio dominio (nada externo ni escrito a mano).
      avatarUrl: new URL('/favicon.svg', origin).toString(),
      profileUrl: new URL('/', origin).toString(),
      hidden: true,
      locale: null,
      createdAt: now.toISOString(),
    }
    const season = seasonAt(now, this.cfg.season.timeZone, this.cfg.season.startDay)
    this.wallet = {
      seasonId: season.id,
      balance: this.cfg.startingBalance,
      debt: 0,
      netWorth: this.cfg.startingBalance,
      spins: 0,
      loans: 0,
      currentStreak: 0,
      bestStreak: 0,
      // La demo gira sola con la ventana abierta: nunca acumula tiradas pendientes.
      pendingSpins: 0,
    }
    this.controls = {
      turn: options => this.turn(options),
      setWallet: (balance, debt = this.wallet.debt) => {
        this.wallet = { ...this.wallet, balance, debt, netWorth: netWorth(balance, debt) }
        this.emit({ v: PROTOCOL_VERSION, type: 'wallet', wallet: this.wallet })
      },
      fx: kind => this.forceFx(kind),
      showcase: () => this.showcase(),
    }
  }

  onMessage(listener: (msg: ServerMessage) => void): void {
    this.messageListeners.push(listener)
  }

  onStatus(listener: (status: LinkStatus) => void): void {
    this.statusListeners.push(listener)
  }

  start(): void {
    if (this.running) return
    this.running = true
    for (const l of this.statusListeners) l('open')
    setTimeout(() => this.emit(this.hello()), 0)
    if (this.auto) void this.loop()
    if (this.startFx) {
      const kind = this.startFx
      setTimeout(() => void this.forceFx(kind), 0)
    }
  }

  stop(): void {
    this.running = false
  }

  send(msg: ClientMessageInput): boolean {
    const parsed = clientMessageSchema.safeParse(msg)
    if (!parsed.success) {
      console.error('[demo] mensaje fuera de contrato', parsed.error.issues)
      return false
    }
    // Respuesta asíncrona, como la de un servidor de verdad.
    setTimeout(() => this.handle(parsed.data), 30)
    return true
  }

  private emit(msg: ServerMessage): void {
    for (const l of this.messageListeners) l(msg)
  }

  private hello(): ServerMessage {
    return {
      v: PROTOCOL_VERSION,
      type: 'hello',
      user: this.user,
      wallet: this.wallet,
      slip: this.slipView(),
      round: this.round,
      lastRound: this.lastRound,
      serverTime: new Date().toISOString(),
      achievements: this.progress.achievements(this.wallet),
    }
  }

  private slipView() {
    return { bets: [...this.slip], total: totalStake(this.slip) }
  }

  private setBalance(balance: number, debt = this.wallet.debt): void {
    this.wallet = { ...this.wallet, balance, debt, netWorth: netWorth(balance, debt) }
  }

  private reject(
    error: 'insufficient_funds' | 'too_many_bets' | 'loan_not_allowed',
    message: string,
  ) {
    this.emit({ v: PROTOCOL_VERSION, type: 'bet.rejected', error, message })
  }

  private handle(msg: ReturnType<typeof clientMessageSchema.parse>): void {
    switch (msg.type) {
      case 'bet.place': {
        const amount = msg.amount === 'all-in' ? this.wallet.balance : msg.amount
        if (amount <= 0 || amount > this.wallet.balance) {
          this.reject('insufficient_funds', 'not enough coins')
          return
        }
        const next = addToSlip(this.slip, { selection: msg.selection, amount }, this.cfg)
        if (!next) {
          this.reject('too_many_bets', 'too many bets')
          return
        }
        this.slip = next
        this.setBalance(this.wallet.balance - amount)
        this.emit({ v: PROTOCOL_VERSION, type: 'slip', slip: this.slipView(), wallet: this.wallet })
        return
      }
      case 'bet.clear':
        this.setBalance(this.wallet.balance + totalStake(this.slip))
        this.slip = []
        this.emit({ v: PROTOCOL_VERSION, type: 'slip', slip: this.slipView(), wallet: this.wallet })
        return
      case 'loan.request': {
        if (!canRequestLoan(this.wallet.balance, this.cfg)) {
          this.reject('loan_not_allowed', 'you still have coins')
          return
        }
        const after = applyLoan(this.wallet.balance, this.wallet.debt, this.cfg)
        this.setBalance(after.balance, after.debt)
        this.wallet = { ...this.wallet, loans: this.wallet.loans + 1 }
        this.progress.recordLoan(new Date().toISOString(), this.cfg.loan.amount, this.wallet)
        this.emit({
          v: PROTOCOL_VERSION,
          type: 'loan.granted',
          amount: this.cfg.loan.amount,
          wallet: this.wallet,
        })
        return
      }
      case 'settings.update':
        this.user = {
          ...this.user,
          ...(msg.hidden !== undefined ? { hidden: msg.hidden } : {}),
          ...(msg.locale !== undefined ? { locale: msg.locale } : {}),
        }
        this.emit({ v: PROTOCOL_VERSION, type: 'settings', user: this.user })
        return
      case 'sync':
        this.emit(this.hello())
        return
      case 'ping':
        this.emit({ v: PROTOCOL_VERSION, type: 'pong', t: msg.t })
        return
      case 'presence':
        return
      case 'spin.pending':
        this.spendPending(msg.quick)
        return
      case 'stats.request':
        this.emit({ v: PROTOCOL_VERSION, type: 'stats', stats: this.progress.stats(this.wallet) })
        return
      case 'bank.request':
        this.emit({ v: PROTOCOL_VERSION, type: 'bank', bank: this.progress.bank(this.wallet) })
        return
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      await sleep(this.client.pauseMs)
      if (!this.running) return
      await this.turn()
    }
  }

  /** Prepara la cartera, el boleto y el historial del guion y juega su tirada. */
  private async forceFx(kind: DemoFx): Promise<void> {
    const sc = demoScenario(kind, this.cfg)
    const w = sc.wallet
    this.setBalance(w.balance ?? this.wallet.balance, w.debt ?? this.wallet.debt)
    if (w.currentStreak !== undefined)
      this.wallet = { ...this.wallet, currentStreak: w.currentStreak }
    this.history.push(...sc.history)
    this.slip = []
    for (const bet of sc.bets) {
      const next = addToSlip(this.slip, bet, this.cfg)
      if (!next) throw new Error(`[demo] guion ${kind}: apuesta fuera de las reglas`)
      this.slip = next
      this.setBalance(this.wallet.balance - bet.amount)
    }
    this.emit({ v: PROTOCOL_VERSION, type: 'slip', slip: this.slipView(), wallet: this.wallet })
    // El contador de pendientes: cada paso a `pauseMs / 4` del anterior (la demo nunca acumula
    // tiradas de verdad; esto solo enseña la animación del HUD).
    for (const [i, count] of sc.pendingSteps.entries()) {
      if (i > 0) await sleep(this.client.pauseMs / 4)
      const up = count > this.wallet.pendingSpins
      this.wallet = { ...this.wallet, pendingSpins: count }
      this.emit(
        up && i > 0
          ? { v: PROTOCOL_VERSION, type: 'pending', event: 'queued', wallet: this.wallet }
          : { v: PROTOCOL_VERSION, type: 'wallet', wallet: this.wallet },
      )
    }
    if (sc.result === null) return
    await this.turn({
      result: sc.result,
      gitPushOk: sc.gitPushOk,
      // Lo justo: el giro mínimo de la ronda ya da tiempo a ver girar la ruleta.
      thinkMs: this.client.thinkMs,
    })
    if (sc.achievement) {
      this.emit({
        v: PROTOCOL_VERSION,
        type: 'achievement.unlocked',
        achievement: {
          id: sc.achievement,
          hidden: false,
          unlockedAt: new Date().toISOString(),
          seasonId: this.wallet.seasonId,
          params: {},
          progress: null,
        },
      })
    }
  }

  /** GIRAR: gasta una tirada pendiente al momento (la de GIRAR TODAS, con el giro rápido). */
  private spendPending(quick: boolean): void {
    if (this.wallet.pendingSpins <= 0) {
      this.emit({
        v: PROTOCOL_VERSION,
        type: 'error',
        error: 'not_found',
        message: 'no pending spins',
      })
      return
    }
    if (this.busy || this.round) {
      this.emit({ v: PROTOCOL_VERSION, type: 'error', error: 'conflict', message: 'wheel busy' })
      return
    }
    this.wallet = { ...this.wallet, pendingSpins: this.wallet.pendingSpins - 1 }
    void this.turn({
      thinkMs: 0,
      minSpinMs: quick ? this.cfg.pendingSpins.quickSpinMs : this.cfg.spin.minSpinMs,
      landingMs: quick ? this.cfg.pendingSpins.quickLandingMs : this.cfg.spin.landingMs,
    })
  }

  /** Temporada de ejemplo (siempre igual): para las capturas de los menús. */
  private showcase(): void {
    const played = showcaseSeason(
      this.progress,
      this.cfg,
      this.wallet,
      this.client.showcase,
      Date.now(),
    )
    this.wallet = played.wallet
    this.history.splice(0, this.history.length, ...played.history)
    this.lastBets = played.lastBets
    this.lastRound = played.lastRound
    // La semilla siguiente a la de la temporada: GIRAR TODAS de las capturas, determinista.
    const rnd = seededRandom(this.client.showcase.seed + 1)
    this.pocket = () => Math.floor(rnd() * 37) % 37
    this.emit(this.hello())
  }

  /** Un turno de Claude simulado: abre ronda, "piensa" y resuelve. */
  private async turn(options: DemoTurnOptions = {}): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const openedAt = new Date()
      this.round = { roundId: uuid(), openedAt: openedAt.toISOString() }
      this.emit({ v: PROTOCOL_VERSION, type: 'round.started', round: this.round })
      await sleep(options.thinkMs ?? this.client.thinkMs)
      this.resolve(openedAt, options)
    } finally {
      this.busy = false
    }
  }

  private resolve(openedAt: Date, options: DemoTurnOptions): void {
    const round = this.round
    if (!round) return
    const result = options.result ?? this.pocket()
    const choice = chooseRoundBets({
      slip: this.slip,
      lastBets: this.lastBets,
      balance: this.wallet.balance,
      cfg: this.cfg,
    })
    const jackpot = options.gitPushOk ? this.cfg.jackpot.gitPushMultiplier : 1
    const outcome = resolveBets(choice.bets, result, jackpot)
    const debtBefore = this.wallet.debt
    const debt = accrueInterest(debtBefore, this.cfg)
    const balance = this.wallet.balance - choice.charge + outcome.returned
    const net = choice.bets.length > 0 ? outcome.net : null
    const current = nextStreak(this.wallet.currentStreak, net)
    this.history.push(result)
    if (choice.bets.length > 0) this.lastBets = choice.bets
    this.slip = []
    this.round = null
    this.wallet = {
      ...this.wallet,
      balance,
      debt,
      netWorth: netWorth(balance, debt),
      spins: this.wallet.spins + 1,
      currentStreak: current,
      bestStreak: bestStreak(this.wallet.bestStreak, current),
    }
    const now = Date.now()
    // BANCARROTA: el patrimonio cae a 0 o menos por primera vez (en la demo, por sesión).
    const bankrupt = !this.wentBroke && this.wallet.netWorth <= 0 && choice.bets.length > 0
    if (bankrupt) this.wentBroke = true
    const resolved: ResolvedRound = {
      roundId: round.roundId,
      openedAt: round.openedAt,
      resolvedAt: new Date(now).toISOString(),
      result,
      color: colorOf(result),
      bets: outcome.outcomes.map(o => ({
        selection: o.bet.selection,
        amount: o.bet.amount,
        won: o.won,
        payout: o.payout,
      })),
      source: choice.source,
      staked: outcome.staked,
      returned: outcome.returned,
      net: outcome.net,
      jackpot: outcome.jackpot,
      gitPushOk: options.gitPushOk ?? false,
      testFailed: options.testFailed ?? false,
      interestCharged: debt - debtBefore,
      colorStreak: colorStreak(this.history.slice(-this.cfg.streak.historySize)),
      revealAt: new Date(
        // Las mismas reglas que el servidor: ni antes del giro mínimo ni antes de la caída.
        Math.max(
          now + (options.landingMs ?? this.cfg.spin.landingMs),
          openedAt.getTime() + (options.minSpinMs ?? this.cfg.spin.minSpinMs),
        ),
      ).toISOString(),
    }
    // El espectáculo con las mismas reglas que el servidor (shared).
    resolved.spectacle = spectacleOf(
      resolved,
      { streak: current, bankrupt },
      {
        bigWin: this.cfg.bigWin,
        onFireAt: this.cfg.streak.onFireAt,
        colorWarningAt: this.cfg.streak.colorWarningAt,
      },
    )
    this.lastRound = resolved
    this.emit({ v: PROTOCOL_VERSION, type: 'round.resolved', round: resolved, wallet: this.wallet })
    this.progress.recordRound(resolved, this.wallet)
    // El primer logro también en la demo (el resto solo los da el servidor de verdad).
    if (this.progress.unlock('first_spin', resolved.resolvedAt, this.wallet.seasonId)) {
      const achievement = this.progress.achievements(this.wallet).find(a => a.id === 'first_spin')
      if (achievement) this.emit({ v: PROTOCOL_VERSION, type: 'achievement.unlocked', achievement })
    }
  }
}
