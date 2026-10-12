// SPDX-License-Identifier: AGPL-3.0-or-later
// Estado del cilindro y de la bola fotograma a fotograma:
//   rest    → el cilindro gira despacio y la bola descansa en la última casilla.
//   orbit   → ronda abierta: el cilindro acelera y la bola da vueltas por la pista.
//   landing → llega el resultado: se planifica la caída para acabar en ese número.
import { pocketAngle, planLanding, sampleLanding } from './spin.ts'
import type { LandingPlan } from './spin.ts'

export type MotionMode = 'rest' | 'orbit' | 'landing'

export interface MotionEvents {
  launch(): void
  bounce(index: number): void
  settled(result: number): void
}

/** Velocidades (rad/s) de la puesta en escena. Son coreografía, no reglas del juego. */
const IDLE_WHEEL = 0.35
const SPIN_WHEEL = 2.1
const ORBIT_BALL = -7.8
const LAND_END_WHEEL = 0.9
const LAUNCH_TIME = 0.45

export class WheelMotion {
  wheelAngle = 0
  wheelSpeed = IDLE_WHEEL
  ballAngle = 0
  ballSpeed = IDLE_WHEEL
  radius = 0
  lift = 0
  mode: MotionMode = 'rest'
  private rel = 0
  private launchT = 0
  private plan: LandingPlan | null = null
  private planT = 0
  private result = 0
  private nextBounce = 0
  private readonly events: MotionEvents

  constructor(events: MotionEvents) {
    this.events = events
  }

  /** Deja la bola en una casilla (al conectar, con la última ronda). */
  restOn(result: number): void {
    this.mode = 'rest'
    this.plan = null
    this.rel = pocketAngle(result)
    this.radius = 0
    this.lift = 0
  }

  /** Empieza a girar: la bola sale de la casilla a la pista. */
  orbit(): void {
    if (this.mode === 'orbit') return
    if (this.mode === 'landing') return
    this.mode = 'orbit'
    this.launchT = 0
    this.events.launch()
  }

  /** Planifica la caída de la bola para que acabe en `result` dentro de `duration` segundos. */
  land(result: number, duration: number): LandingPlan {
    const wasResting = this.mode === 'rest'
    this.plan = planLanding({
      result,
      duration,
      wheelAngle: this.wheelAngle,
      wheelSpeed: this.wheelSpeed,
      wheelEndSpeed: LAND_END_WHEEL,
      ballAngle: this.ballAngle,
      ballSpeed: wasResting ? ORBIT_BALL : this.ballSpeed,
    })
    if (wasResting) {
      this.launchT = 0
      this.events.launch()
    } else {
      this.launchT = LAUNCH_TIME
    }
    this.mode = 'landing'
    this.planT = 0
    this.result = result
    this.nextBounce = 0
    return this.plan
  }

  update(dt: number): void {
    switch (this.mode) {
      case 'rest': {
        this.wheelSpeed += (IDLE_WHEEL - this.wheelSpeed) * Math.min(1, dt * 0.8)
        this.wheelAngle += this.wheelSpeed * dt
        this.ballSpeed = this.wheelSpeed
        this.ballAngle = this.wheelAngle + this.rel
        this.radius = Math.max(0, this.radius - dt * 3)
        this.lift = 0
        return
      }
      case 'orbit': {
        this.launchT = Math.min(LAUNCH_TIME, this.launchT + dt)
        const k = this.launchT / LAUNCH_TIME
        this.wheelSpeed += (SPIN_WHEEL - this.wheelSpeed) * Math.min(1, dt * 1.5)
        this.wheelAngle += this.wheelSpeed * dt
        this.ballSpeed += (ORBIT_BALL - this.ballSpeed) * Math.min(1, dt * 4)
        this.ballAngle += this.ballSpeed * dt
        this.radius = k * k * (3 - 2 * k)
        this.lift = Math.sin(Math.PI * k) * 0.6
        return
      }
      case 'landing': {
        const plan = this.plan!
        this.planT += dt
        this.launchT = Math.min(LAUNCH_TIME, this.launchT + dt)
        const s = sampleLanding(plan, this.planT)
        const prev = this.ballAngle
        this.wheelAngle = s.wheelAngle
        this.ballAngle = s.ballAngle
        this.ballSpeed = dt > 0 ? (this.ballAngle - prev) / dt : this.ballSpeed
        const D = plan.input.duration
        this.wheelSpeed =
          plan.input.wheelSpeed +
          ((LAND_END_WHEEL - plan.input.wheelSpeed) * Math.min(this.planT, D)) / D
        const k = this.launchT / LAUNCH_TIME
        this.radius = Math.min(
          s.radius,
          k * k * (3 - 2 * k) + (this.launchT >= LAUNCH_TIME ? 1 : 0),
        )
        this.lift = s.lift
        while (
          this.nextBounce < plan.bounces.length &&
          this.planT >= plan.bounces[this.nextBounce]!
        ) {
          this.events.bounce(this.nextBounce++)
        }
        if (this.planT >= D) {
          this.mode = 'rest'
          this.rel = pocketAngle(this.result)
          this.ballAngle = this.wheelAngle + this.rel
          this.radius = 0
          this.lift = 0
          this.plan = null
          this.events.settled(this.result)
        }
        return
      }
    }
  }

  /** Intensidad del sonido de la bola rodando (0–1). */
  rolling(): number {
    if (this.radius < 0.5) return 0
    return Math.min(1, Math.abs(this.ballSpeed - this.wheelSpeed) / 10)
  }
}
