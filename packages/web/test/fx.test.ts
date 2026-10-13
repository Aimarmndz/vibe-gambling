// SPDX-License-Identifier: AGPL-3.0-or-later
// Animaciones de espectáculo (render/fx y sus pantallas): qué se dispara para cada `spectacle`,
// que nada sale antes de que caiga la bola, la versión reducida, saltar con ✕/○/clic, el aviso
// de logro diferido y los guiones de la demo que fuerzan cada animación.
import { colorStreak, resolveBets, spectacleOf } from '@vibe-gambling/shared'
import type { Achievement, SpectacleView } from '@vibe-gambling/shared'
import { describe, expect, it, vi } from 'vitest'

import type { AppContext, Screen } from '../src/app/context.ts'
import { clientConfig } from '../src/config.ts'
import type { FxConfig } from '../src/config.ts'
import { netWithoutJackpot } from '../src/game/outcome.ts'
import { INITIAL_STATE } from '../src/game/state.ts'
import type { GameState, Phase } from '../src/game/state.ts'
import { DEMO_FX, demoScenario, isDemoFx } from '../src/net/demoFx.ts'
import { demoGameConfig } from '../src/net/demo.ts'
import { FxClock } from '../src/render/fx/clock.ts'
import { cubicBezier, outBack, progress, rollValue, stepScale } from '../src/render/fx/easing.ts'
import { DoomFire } from '../src/render/fx/fire.ts'
import type { FxKit } from '../src/render/fx/kit.ts'
import { shakeAt } from '../src/render/fx/kit.ts'
import { NoticeQueue } from '../src/render/fx/notices.ts'
import { Odometer, rollSteps } from '../src/render/fx/odometer.ts'
import { isBlocking, planRound, spectacleFor } from '../src/render/fx/plan.ts'
import type { FxScene3d } from '../src/render/fx/scene3d.ts'
import { BankruptScreen, bankruptTimes, countdownAt } from '../src/ui/screens/bankrupt.ts'
import { streakBoxes } from '../src/ui/screens/fallacy.ts'
import { GreenScreen, greenTimes, greenTintOn } from '../src/ui/screens/green.ts'
import { loanTimes, signaturePath } from '../src/ui/screens/loan.ts'
import { PrizeScreen, prizeTimes } from '../src/ui/screens/prize.ts'
import { PushScreen, deployPercent, pushTimes } from '../src/ui/screens/pushToProd.ts'
import { resolved, testGame, testWebConfig } from './fixtures.ts'
import { translator } from './translators.ts'

const game = testWebConfig.game
const fx: FxConfig = clientConfig.fx

function spectacle(patch: Partial<SpectacleView> = {}): SpectacleView {
  return {
    tier: 'none',
    netMultiple: 0,
    bigWin: false,
    green: false,
    greenWin: false,
    jackpot: false,
    streak: 0,
    fire: 'none',
    fallacy: false,
    bankrupt: false,
    ...patch,
  }
}

const kinds = (s: SpectacleView, quick = false) =>
  planRound(resolved({ spectacle: s }), game, { quick }).map(step => step.kind)

describe('plan de la secuencia de cada ronda', () => {
  it('una ronda normal: solo el resultado', () => {
    expect(kinds(spectacle())).toEqual(['result'])
    expect(kinds(spectacle({ tier: 'win' }))).toEqual(['result'])
  })

  it('premio por niveles antes del resultado', () => {
    for (const tier of ['big', 'mega', 'straight'] as const) {
      const steps = planRound(resolved({ spectacle: spectacle({ tier, netMultiple: 17 }) }), game, {
        quick: false,
      })
      expect(steps[0]).toMatchObject({ kind: 'prize', tier, netMultiple: 17 })
      expect(steps[1]).toEqual({ kind: 'result' })
    }
  })

  it('PUSH TO PROD va antes que todo, con el multiplicador de la configuración', () => {
    const steps = planRound(
      resolved({ spectacle: spectacle({ jackpot: true, tier: 'big' }) }),
      game,
      { quick: false },
    )
    expect(steps.map(s => s.kind)).toEqual(['push', 'prize', 'result'])
    expect(steps[0]).toEqual({ kind: 'push', multiplier: game.jackpot.gitPushMultiplier })
  })

  it('el verde encadena con el premio solo si se había apostado al 0 y hay premio gordo', () => {
    const green = planRound(resolved({ spectacle: spectacle({ green: true }) }), game, {
      quick: false,
    })
    expect(green).toEqual([{ kind: 'green', chain: false }, { kind: 'result' }])
    const chained = planRound(
      resolved({ spectacle: spectacle({ green: true, greenWin: true, tier: 'straight' }) }),
      game,
      { quick: false },
    )
    expect(chained.map(s => s.kind)).toEqual(['green', 'prize', 'result'])
    expect(chained[0]).toEqual({ kind: 'green', chain: true })
    // Verde ganado con una apuesta pequeña (sin premio gordo): no hay banda de "todo al 0".
    expect(
      planRound(
        resolved({ spectacle: spectacle({ green: true, greenWin: true, tier: 'win' }) }),
        game,
        {
          quick: false,
        },
      )[0],
    ).toEqual({ kind: 'green', chain: false })
  })

  it('falacia, ON FIRE y bancarrota van después del resultado', () => {
    expect(
      kinds(spectacle({ fallacy: true, fire: 'ignite', streak: 5, bankrupt: true, tier: 'win' })),
    ).toEqual(['result', 'fallacy', 'fire', 'bankrupt'])
    // La racha que ya ardía no repite la intro.
    expect(kinds(spectacle({ fire: 'burning', streak: 6 }))).toEqual(['result'])
  })

  it('GIRAR TODAS sin parar: solo el resultado rápido', () => {
    expect(kinds(spectacle({ fallacy: true, fire: 'ignite', tier: 'big' }), true)).toEqual([
      'result',
    ])
  })

  it('sin `spectacle` (rondas de antes de la v2) se recalcula con las reglas públicas', () => {
    const round = resolved()
    const { spectacle: _omit, ...plain } = round
    const s = spectacleFor(plain, game)
    // El fixture es un pleno ganado: ¡PLENO!.
    expect(s.tier).toBe('straight')
    expect(s.bankrupt).toBe(false)
    expect(planRound(plain, game, { quick: false })[0]).toMatchObject({ kind: 'prize' })
  })

  it('solo ON FIRE deja la mesa libre mientras suena', () => {
    expect(isBlocking({ kind: 'fire', streak: 5 })).toBe(false)
    expect(isBlocking({ kind: 'bankrupt' })).toBe(true)
  })
})

describe('reloj: cues y saltar', () => {
  it('dispara cada cue una vez y en orden', () => {
    const calls: number[] = []
    const clock = new FxClock(300, 100, [
      { at: 200, run: () => calls.push(200) },
      { at: 0, run: () => calls.push(0) },
      { at: 100, run: () => calls.push(100) },
    ])
    clock.tick(0)
    clock.tick(150)
    clock.tick(-5)
    expect(calls).toEqual([0, 100])
    expect(clock.finished).toBe(false)
    clock.tick(200)
    expect(calls).toEqual([0, 100, 200])
    expect(clock.finished).toBe(true)
    // Estado final + hold (100 ms) para cerrarse sola.
    expect(clock.expired).toBe(false)
    clock.tick(50)
    expect(clock.expired).toBe(true)
  })

  it('la primera pulsación lleva al final (sin sonidos pendientes) y la segunda cierra', () => {
    const late = vi.fn()
    const after = vi.fn()
    const clock = new FxClock(1000, 500, [
      { at: 800, run: late },
      { at: 1200, run: after },
    ])
    clock.tick(10)
    expect(clock.skip()).toBe('finished')
    expect(clock.ms).toBe(1000)
    expect(clock.wasSkipped).toBe(true)
    clock.tick(300)
    expect(late).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    expect(clock.skip()).toBe('close')
  })
})

describe('curvas y escalones', () => {
  it('las curvas van de 0 a 1 y outBack se pasa un poco', () => {
    const ease = cubicBezier(0.33, 1, 0.68, 1)
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(-1)).toBe(0)
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(outBack))).toBeGreaterThan(1)
    // Una curva con x no monótona en Newton cae en la bisección y sigue siendo correcta.
    const steep = cubicBezier(0.9, 0, 0.1, 1)
    expect(steep(0.5)).toBeCloseTo(0.5, 2)
  })

  it('el texto solo existe a escalas enteras: ×7 → ×6 → ×5', () => {
    expect([0, 86, 87, 174, 500].map(ms => stepScale(ms, 7, 5, 87))).toEqual([7, 7, 6, 5, 5])
    expect(stepScale(200, 3, 6, 50)).toBe(6)
    expect(stepScale(-10, 7, 5, 87)).toBe(7)
  })

  it('los contadores ruedan en enteros hasta el valor exacto', () => {
    expect(rollValue(0, 850, 0)).toBe(0)
    expect(rollValue(0, 850, 1)).toBe(850)
    expect(rollValue(0, 850, 2)).toBe(850)
    expect(Number.isInteger(rollValue(0, 850, 0.37))).toBe(true)
    expect(progress(5, 10, 0)).toBe(0)
    expect(progress(15, 10, 0)).toBe(1)
  })

  it('la sacudida decae a 0 y es entera', () => {
    const amp = { x: 3, y: -2, decayMs: 260 }
    expect(shakeAt(0, 80, amp)).toEqual({ x: 0, y: 0 })
    expect(shakeAt(80, 80, amp)).toEqual({ x: 3, y: -2 })
    expect(shakeAt(400, 80, amp)).toEqual({ x: 0, y: 0 })
    const mid = shakeAt(200, 80, amp)
    expect(Number.isInteger(mid.x) && Math.abs(mid.x) <= 3).toBe(true)
  })
})

describe('tiempos de cada animación (y su versión reducida)', () => {
  const full = { cfg: fx, reduced: false }
  const reduced = { cfg: fx, reduced: true }

  it('premio: impacto, escalones, contador y hold de la configuración', () => {
    const t = prizeTimes(full, 'mega')
    expect(t.impact).toBe(fx.bigWin.flashMs)
    expect(t.settle).toBe(fx.bigWin.flashMs + 3 * fx.bigWin.impactStepMs)
    expect(t.final - t.settle).toBe(fx.bigWin.countMs.mega)
    expect(prizeTimes(full, 'big').count).toBe(fx.bigWin.countMs.big)
    expect(prizeTimes(full, 'straight').count).toBe(fx.bigWin.countMs.pleno)
  })

  it('con movimiento reducido ninguna dura más que fx.reducedMaxMs', () => {
    expect(prizeTimes(reduced, 'mega').final).toBeLessThanOrEqual(fx.reducedMaxMs)
    expect(greenTimes(reduced, true).final).toBeLessThanOrEqual(fx.reducedMaxMs)
    expect(pushTimes(reduced).final).toBeLessThanOrEqual(fx.reducedMaxMs)
    expect(loanTimes(reduced).final).toBeLessThanOrEqual(fx.reducedMaxMs)
    expect(bankruptTimes(reduced).countAt).toBe(0)
  })

  it('el verde parpadea 3 veces y nunca más de 3 destellos por segundo', () => {
    const t = greenTimes(full, false)
    expect(t.final).toBe(2 * fx.green.blinks * fx.green.blinkMs)
    let flashes = 0
    let was = false
    for (let ms = 0; ms < 1000; ms++) {
      const on = greenTintOn(ms, fx.green.blinkMs, fx.green.blinks)
      if (on && !was) flashes++
      was = on
    }
    expect(flashes).toBeLessThanOrEqual(3)
    expect(greenTintOn(-1, 160, 3)).toBe(false)
    expect(greenTintOn(2000, 160, 3)).toBe(false)
  })

  it('la barra de deploy va a saltos de 10 % hasta el 40 % y luego al 100 %', () => {
    const t = pushTimes(full)
    expect(deployPercent(0, t.deployed)).toBe(0)
    expect(deployPercent(t.deployed - 1, t.deployed)).toBe(40)
    expect(deployPercent(t.deployed, t.deployed)).toBe(100)
    expect(t.final).toBe(fx.push.terminalMs + fx.push.rocketMs + fx.push.stampMs)
  })

  it('el préstamo: contrato, firma, sello, monedas y deuda en orden', () => {
    const t = loanTimes(full)
    expect(t.sign).toBeLessThan(t.stamp)
    expect(t.stamp).toBeLessThan(t.coins)
    expect(t.coins).toBeLessThan(t.debt)
    expect(t.debt).toBeLessThan(t.final)
    const sig = signaturePath(110)
    expect(sig[0]!.x).toBe(0)
    expect(sig[sig.length - 1]!.x).toBe(110)
  })

  it('la cuenta atrás de BANCARROTA baja de countFrom a 0 sin pasar de 0', () => {
    const t = bankruptTimes(full)
    const b = fx.bankrupt
    expect(countdownAt(0, t.countAt, b.countFrom, b.tickMs)).toBe(b.countFrom)
    expect(countdownAt(t.countAt + b.tickMs, t.countAt, b.countFrom, b.tickMs)).toBe(
      b.countFrom - 1,
    )
    expect(countdownAt(t.zeroAt + 99_999, t.countAt, b.countFrom, b.tickMs)).toBe(0)
  })
})

describe('aviso de logro diferido', () => {
  const ach = (id: Achievement['id']): Achievement => ({
    id,
    hidden: false,
    unlockedAt: '2026-10-12T10:00:00.000Z',
    seasonId: '2026-10',
    params: {},
    progress: null,
  })

  it('espera mientras cae la bola y luego sale uno detrás de otro', () => {
    const q = new NoticeQueue(fx.achievement, false)
    q.push(ach('first_spin'))
    q.push(ach('first_spin'))
    q.push(ach('first_ruin'))
    expect(q.pending).toBe(2)
    // Bola cayendo (o resultado en pantalla): nada.
    expect(q.tick(1000, false)).toBeNull()
    expect(q.shown).toBeNull()
    expect(q.tick(16, true)?.id).toBe('first_spin')
    q.tick(q.totalMs, true)
    expect(q.shown).toBeNull()
    // El hueco entre avisos.
    expect(q.tick(fx.achievement.gapMs / 2, true)).toBeNull()
    q.tick(fx.achievement.gapMs, true)
    expect(q.tick(16, true)?.id).toBe('first_ruin')
  })

  it('entra desde la derecha, se queda y sale', () => {
    const q = new NoticeQueue(fx.achievement, false)
    const w = 140
    expect(q.pose(0, w).x).toBe(320)
    expect(q.pose(fx.achievement.inMs + 10, w).x).toBe(316 - w)
    expect(q.pose(q.totalMs + 1, w).done).toBe(true)
    const sheen = q.pose(fx.achievement.inMs + fx.achievement.holdMs - 100, w).sheen
    expect(sheen).not.toBeNull()
    // Reducido: quieto en su sitio, sin brillo.
    const r = new NoticeQueue(fx.achievement, true)
    expect(r.pose(0, w)).toEqual({ x: 316 - w, sheen: null, done: false })
  })
})

describe('contador de pendientes (odómetro)', () => {
  const timing = { rollMs: 180, floatMs: 600, budgetMs: 450 }

  it('un paso por unidad hasta 5 y un solo giro si son más', () => {
    expect(rollSteps(0)).toBe(0)
    expect(rollSteps(3)).toBe(3)
    expect(rollSteps(-5)).toBe(5)
    expect(rollSteps(12)).toBe(1)
  })

  it('al sumar, el viejo sale por arriba y el nuevo entra; todo dentro del presupuesto', () => {
    const o = new Odometer(timing, false)
    o.see(19, 0)
    expect(o.look(10).from).toBeNull()
    o.see(20, 1000)
    const mid = o.look(1050)
    expect(mid).toMatchObject({ from: 19, to: 20, dir: 1 })
    expect(mid.float?.text).toBe('+1')
    expect(o.look(1000).flash).toBe(true)
    expect(o.look(1000 + timing.budgetMs).from).toBeNull()
    expect(o.look(1000 + timing.floatMs + 1).float).toBeNull()
    // Tres de golpe: tres pasos que caben en el presupuesto.
    o.see(23, 2000)
    expect(o.look(2000 + timing.budgetMs - 1).from).toBe(22)
    // Al gastar, rueda hacia abajo.
    o.see(10, 3000)
    expect(o.look(3010)).toMatchObject({ from: 23, to: 10, dir: -1 })
  })

  it('con movimiento reducido el número cambia sin rodar', () => {
    const o = new Odometer(timing, true)
    o.see(1, 0)
    o.see(2, 100)
    expect(o.look(100)).toMatchObject({ from: null, to: 2, float: null, flash: true })
  })
})

describe('fuego y falacia', () => {
  it('el fuego llega arriba, se apaga al quitarle la fuente y es determinista', () => {
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const fire = new DoomFire(30, 20, random)
    for (let i = 0; i < 60; i++) fire.step()
    let top = fire.h
    for (let y = 0; y < fire.h; y++) {
      for (let x = 0; x < fire.w; x++) if (fire.at(x, y) > 0) top = Math.min(top, y)
    }
    expect(top).toBeLessThan(fire.h / 2)
    fire.extinguish()
    for (let i = 0; i < 80; i++) fire.step()
    expect(fire.alive()).toBe(false)
  })

  it('el historial enseña los números vistos de la racha y huecos para los de antes', () => {
    expect(streakBoxes({ color: 'red', count: 5, recent: [2, 1, 3, 5] })).toEqual([
      null,
      null,
      1,
      3,
      5,
    ])
    expect(streakBoxes({ color: 'red', count: 30, recent: [] })).toHaveLength(14)
  })
})

describe('jackpot: la cuenta "+100 · ×2 · +200"', () => {
  it('el neto sin multiplicador sale de las apuestas de la ronda', () => {
    const bets = [
      { selection: { kind: 'red' as const }, amount: 50 },
      { selection: { kind: 'black' as const }, amount: 10 },
    ]
    const out = resolveBets(bets, 1, 2)
    const round = resolved({
      result: 1,
      color: 'red',
      bets: out.outcomes.map(o => ({
        selection: o.bet.selection,
        amount: o.bet.amount,
        won: o.won,
        payout: o.payout,
      })),
      staked: out.staked,
      returned: out.returned,
      net: out.net,
      jackpot: true,
    })
    expect(round.net).toBe(90)
    expect(netWithoutJackpot(round, 2)).toBe(40)
  })
})

describe('guiones de la demo: cada uno da justo su animación', () => {
  const cfg = demoGameConfig(testWebConfig.game)
  const rules = {
    bigWin: cfg.bigWin,
    onFireAt: cfg.streak.onFireAt,
    colorWarningAt: cfg.streak.colorWarningAt,
  }
  const play = (kind: (typeof DEMO_FX)[number]) => {
    const sc = demoScenario(kind, cfg)
    if (sc.result === null) return { sc, s: null }
    const out = resolveBets(sc.bets, sc.result, sc.gitPushOk ? cfg.jackpot.gitPushMultiplier : 1)
    const streakOfColor = colorStreak([...sc.history, sc.result])
    const streak = out.net > 0 ? (sc.wallet.currentStreak ?? 0) + 1 : -1
    const balance = (sc.wallet.balance ?? cfg.startingBalance) - out.staked + out.returned
    const s = spectacleOf(
      {
        result: sc.result,
        net: out.net,
        staked: out.staked,
        jackpot: out.jackpot,
        colorStreak: streakOfColor,
        bets: out.outcomes.map(o => ({ won: o.won, selection: o.bet.selection })),
      },
      { streak, bankrupt: balance - (sc.wallet.debt ?? 0) <= 0 },
      rules,
    )
    return { sc, s }
  }

  it('reconoce los nombres de la URL', () => {
    expect(isDemoFx('mega')).toBe(true)
    expect(isDemoFx('nope')).toBe(false)
    expect(isDemoFx(null)).toBe(false)
  })

  it('big, mega y pleno', () => {
    expect(play('big').s?.tier).toBe('big')
    expect(play('mega').s?.tier).toBe('mega')
    expect(play('pleno').s?.tier).toBe('straight')
  })

  it('verde, verde ganado y push', () => {
    expect(play('green').s).toMatchObject({ green: true, greenWin: false })
    expect(play('greenwin').s).toMatchObject({ green: true, greenWin: true, tier: 'straight' })
    expect(play('push').s?.jackpot).toBe(true)
  })

  it('bancarrota, ON FIRE, falacia, logro, préstamo y pendientes', () => {
    expect(play('bankrupt').s?.bankrupt).toBe(true)
    expect(play('fire').s?.fire).toBe('ignite')
    expect(play('fallacy').s?.fallacy).toBe(true)
    expect(play('achievement').sc.achievement).toBe('first_spin')
    expect(play('bank').sc).toMatchObject({ result: null, wallet: { balance: 0 } })
    expect(play('pending').sc.pendingSteps).toEqual([19, 20, 19])
    expect(play('commission').sc).toMatchObject({ result: null, commission: true })
  })

  it('todas las apuestas de los guiones caben en las reglas de la mesa', () => {
    for (const kind of DEMO_FX) {
      for (const bet of demoScenario(kind, cfg).bets) expect(cfg.chips).toContain(bet.amount)
    }
    // Los guiones se adaptan a otra configuración (fichas y umbrales de los tests).
    expect(demoScenario('fallacy', testGame).history).toHaveLength(
      testGame.streak.colorWarningAt - 1,
    )
  })
})

// ------------------------------------------------------------------ pantallas

interface Fake {
  kit: FxKit
  pushed: Screen[]
  popped: Screen[]
  sounds: string[]
  fountains: number
  shakes: { x: number; y: number }[]
  phase: { value: Phase }
}

function fakeKit(reduced = false): Fake {
  const pushed: Screen[] = []
  const popped: Screen[] = []
  const sounds: string[] = []
  const shakes: { x: number; y: number }[] = []
  const phase = { value: 'result' as Phase }
  const fake = { pushed, popped, sounds, shakes, phase, fountains: 0 } as Fake
  const ctx = {
    web: testWebConfig,
    client: clientConfig,
    reducedMotion: reduced,
    tr: translator('es'),
    hits: { add: () => undefined },
    sfx: {
      play: (n: string) => sounds.push(n),
      playFx: (n: string) => sounds.push(n),
    },
    state: (): GameState => ({ ...INITIAL_STATE, phase: phase.value }),
    push: (s: Screen) => pushed.push(s),
    pop: (s: Screen) => popped.push(s),
    buttons: () => ({ x: 'X', o: 'O', tri: 'C', sq: 'Z', start: 'P', sel: 'G', auto: 'A' }),
  } as unknown as AppContext
  const coins = {
    fountain: () => {
      fake.fountains++
      return true
    },
    stopLoop: () => undefined,
    clear: () => undefined,
  } as unknown as FxScene3d
  fake.kit = {
    ctx,
    cfg: fx,
    reduced,
    coins,
    rays: { draw: () => undefined } as unknown as FxKit['rays'],
    shake: (x, y) => shakes.push({ x, y }),
    desaturate: () => undefined,
    announce: () => undefined,
  }
  return fake
}

describe('pantallas de espectáculo', () => {
  it('el premio cuenta de 0 al neto del servidor, suena y se cierra solo', () => {
    const f = fakeKit()
    const done = vi.fn()
    const s = new PrizeScreen(f.kit, { tier: 'mega', net: 850, netMultiple: 17, number: 17 }, done)
    expect(s.counterValue()).toBe(0)
    s.update(0.001)
    expect(f.sounds).toContain('impact')
    const t = prizeTimes(f.kit, 'mega')
    s.update((t.settle + 100) / 1000)
    expect(s.counterValue()).toBeGreaterThan(0)
    expect(s.counterValue()).toBeLessThan(850)
    expect(f.fountains).toBeGreaterThan(0)
    s.update((t.final - t.settle) / 1000)
    expect(s.counterValue()).toBe(850)
    expect(f.sounds).toContain('winChord')
    expect(done).not.toHaveBeenCalled()
    s.update(t.hold / 1000)
    expect(done).toHaveBeenCalledTimes(1)
    expect(f.popped).toContain(s)
  })

  it('el anuncio de aria-live del premio y del verde dice el número (y el color del pleno)', () => {
    const f = fakeKit()
    const said: string[] = []
    const kit = { ...f.kit, announce: (text: string) => void said.push(text) }
    new PrizeScreen(kit, { tier: 'straight', net: 1750, netMultiple: 35, number: 17 }, vi.fn())
    expect(said.at(-1)).toBe('¡PLENO! 17 negro. +1.750.')
    new PrizeScreen(kit, { tier: 'big', net: 400, netMultiple: 8, number: 21 }, vi.fn())
    expect(said.at(-1)).toBe('BIG WIN 21 rojo. +400.')
    new GreenScreen(kit, false, vi.fn())
    expect(said.at(-1)).toMatch(/^¡VERDE! 0 /)
  })

  it('✕ lleva al final de golpe (con toda la lluvia) y otra ✕ cierra', () => {
    const f = fakeKit()
    const done = vi.fn()
    const s = new PrizeScreen(f.kit, { tier: 'big', net: 400, netMultiple: 8, number: 5 }, done)
    s.update(0.01)
    s.action({ action: 'accept', fine: false })
    expect(s.counterValue()).toBe(400)
    expect(f.fountains).toBe(Math.min(fx.bigWin.coins.big, fx.maxCoins))
    expect(done).not.toHaveBeenCalled()
    s.pointer('down')
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('movimiento reducido: sin sacudida ni lluvia, contador en tres saltos', () => {
    const f = fakeKit(true)
    const s = new PrizeScreen(
      f.kit,
      { tier: 'mega', net: 900, netMultiple: 18, number: 17 },
      vi.fn(),
    )
    expect(s.counterValue()).toBe(300)
    s.update(fx.bigWin.reducedStepMs / 1000)
    expect(s.counterValue()).toBe(600)
    s.update(1)
    expect(s.counterValue()).toBe(900)
    expect(f.fountains).toBe(0)
    expect(f.shakes).toEqual([])
  })

  it('el verde y PUSH TO PROD pasan al siguiente paso al terminar', () => {
    const f = fakeKit()
    const next = vi.fn()
    const green = new GreenScreen(f.kit, true, next)
    green.update(10)
    expect(next).toHaveBeenCalledTimes(1)
    expect(f.sounds).toEqual(expect.arrayContaining(['greenHi', 'boing']))
    const push = new PushScreen(f.kit, 2, next)
    push.update(0.05)
    expect(f.sounds).toContain('typeClick')
    push.update(10)
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('BANCARROTA: ✕ salta a la cuenta, otra ✕ pide el préstamo; ○ sale sin préstamo', () => {
    const f = fakeKit()
    const loan = vi.fn()
    const done = vi.fn()
    const s = new BankruptScreen(f.kit, loan, done)
    s.update(0.01)
    expect(f.sounds).toContain('powerDown')
    s.action({ action: 'accept', fine: false })
    expect(loan).not.toHaveBeenCalled()
    expect(s.opaque).toBe(true)
    s.action({ action: 'accept', fine: false })
    expect(loan).toHaveBeenCalledTimes(1)
    expect(done).toHaveBeenCalledTimes(1)

    const g = fakeKit()
    const loan2 = vi.fn()
    const back = new BankruptScreen(g.kit, loan2, vi.fn())
    back.action({ action: 'back', fine: false })
    expect(loan2).not.toHaveBeenCalled()
    expect(g.popped).toContain(back)
  })

  it('BANCARROTA: al llegar a 0 suena "lose" y desemboca en la oferta (sin game over)', () => {
    const f = fakeKit()
    const loan = vi.fn()
    const s = new BankruptScreen(f.kit, loan, vi.fn())
    const t = bankruptTimes(f.kit)
    for (let ms = 0; ms <= t.zeroAt + 50; ms += 50) s.update(0.05)
    expect(f.sounds.filter(n => n === 'countdown')).toHaveLength(fx.bankrupt.countFrom)
    expect(f.sounds).toContain('lose')
    expect(loan).toHaveBeenCalledTimes(1)
  })
})
