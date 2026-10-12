// SPDX-License-Identifier: AGPL-3.0-or-later
// Física "de cine" de la bola: convincente, pero calculada para acabar EXACTAMENTE en el número
// que manda el servidor. La web nunca decide resultados: solo planifica cómo enseñarlo.
//
// Convención de ángulos: el ángulo crece en sentido antihorario visto desde arriba. La casilla i
// de WHEEL_ORDER está en el ángulo local -i·2π/37 (el cilindro está ordenado en sentido horario).
// Un punto del cilindro en el ángulo local α está en el ángulo de mundo α + θ (θ = giro del cilindro).
import { POCKET_COUNT, WHEEL_ORDER, wheelIndexOf } from '@vibe-gambling/shared'

const TAU = Math.PI * 2

/** Ángulo local (en el cilindro) del centro de la casilla de un número. */
export function pocketAngle(n: number): number {
  return -wheelIndexOf(n) * (TAU / POCKET_COUNT)
}

/** Reduce un ángulo a [0, 2π). */
export function wrapAngle(a: number): number {
  const r = a % TAU
  return r < 0 ? r + TAU : r
}

/** Casilla que hay bajo un ángulo local del cilindro. */
export function pocketAtLocalAngle(local: number): number {
  const slot = Math.round(wrapAngle(-local) / (TAU / POCKET_COUNT)) % POCKET_COUNT
  return WHEEL_ORDER[slot]!
}

export interface LandingInput {
  /** Resultado que manda el servidor (0–36). */
  result: number
  /** Duración de la caída, en segundos. */
  duration: number
  /** Ángulo y velocidad (rad/s) del cilindro al empezar. */
  wheelAngle: number
  wheelSpeed: number
  /** Velocidad del cilindro al acabar (sigue girando, más despacio). */
  wheelEndSpeed: number
  /** Ángulo de mundo y velocidad (rad/s) de la bola al empezar. */
  ballAngle: number
  ballSpeed: number
}

export interface LandingPlan {
  readonly input: LandingInput
  /** Ángulo relativo (bola − cilindro) inicial y final (sin reducir). */
  readonly relStart: number
  readonly relEnd: number
  /** Velocidad relativa inicial (rad/s). */
  readonly relSpeed: number
  /** Exponente del frenado: v(τ) = v0·(1 − τ/D)^p. */
  readonly exponent: number
  /** Instantes (s) de los botes de la bola, para el sonido. */
  readonly bounces: readonly number[]
}

export interface BallSample {
  wheelAngle: number
  ballAngle: number
  /** 1 = en la pista exterior, 0 = en el fondo de la casilla. */
  radius: number
  /** Altura extra del bote (0 = apoyada). */
  lift: number
}

/** Fracción del tiempo en la que la bola empieza a caer de la pista. */
const DROP_START = 0.5
/** Fracción en la que termina de caer hacia los separadores. */
const DROP_END = 0.64
/** Fracción en la que deja de rebotar y se asienta. */
const SETTLE = 0.9
/** Número de botes entre DROP_END y SETTLE. */
const BOUNCES = 4
/** Exponente que se busca: frena rápido al principio y se arrastra al final. */
const TARGET_EXPONENT = 2.2
const MIN_EXPONENT = 0.3
const MAX_EXPONENT = 8
/** Velocidad relativa mínima: si la bola estaba parada, se lanza con esta. */
const LAUNCH_SPEED = -9

/**
 * Planifica la caída de la bola para que acabe, con velocidad relativa nula, en la casilla
 * `result` del cilindro, sea cual sea el estado en que estaban la bola y el cilindro.
 */
export function planLanding(input: LandingInput): LandingPlan {
  if (!(input.duration > 0)) throw new RangeError('la duración debe ser positiva')
  const D = input.duration
  let v0 = input.ballSpeed - input.wheelSpeed
  if (Math.abs(v0) * D < TAU * 1.5) v0 = LAUNCH_SPEED
  const relStart = input.ballAngle - input.wheelAngle
  const target = pocketAngle(input.result)
  // Desplazamiento base (mismo signo que v0) y candidatos separados por vueltas completas.
  const sign = Math.sign(v0)
  const base = sign * wrapAngle(sign * (target - relStart))
  const reach = Math.abs(v0) * D
  let best: { delta: number; p: number } | null = null
  for (let k = 0; k < 64; k++) {
    const delta = base + sign * TAU * k
    if (delta === 0) continue
    const p = reach / Math.abs(delta) - 1
    if (p < MIN_EXPONENT) break
    if (p > MAX_EXPONENT) continue
    if (!best || Math.abs(p - TARGET_EXPONENT) < Math.abs(best.p - TARGET_EXPONENT)) {
      best = { delta, p }
    }
  }
  if (!best) {
    // Solo pasa con duraciones absurdas: se fuerza un exponente válido ajustando la velocidad.
    const delta = base === 0 ? sign * TAU : base
    best = { delta, p: TARGET_EXPONENT }
    v0 = (delta * (TARGET_EXPONENT + 1)) / D
  }
  const bounces: number[] = []
  for (let i = 1; i <= BOUNCES; i++) {
    bounces.push(D * (DROP_END + ((SETTLE - DROP_END) * i) / (BOUNCES + 1)))
  }
  return {
    input,
    relStart,
    relEnd: relStart + best.delta,
    relSpeed: v0,
    exponent: best.p,
    bounces,
  }
}

/** Ángulo del cilindro en el instante τ (s) de la caída (frenado lineal de la velocidad). */
export function wheelAngleAt(input: LandingInput, t: number): number {
  const D = input.duration
  const tau = Math.min(Math.max(t, 0), D)
  const base =
    input.wheelAngle +
    input.wheelSpeed * tau +
    ((input.wheelEndSpeed - input.wheelSpeed) * tau * tau) / (2 * D)
  return base + input.wheelEndSpeed * Math.max(0, t - D)
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Posición de la bola y del cilindro en el instante τ (s) desde que empezó la caída. */
export function sampleLanding(plan: LandingPlan, t: number): BallSample {
  const D = plan.input.duration
  const tau = Math.min(Math.max(t, 0), D)
  const u = tau / D
  const p = plan.exponent
  const delta = plan.relEnd - plan.relStart
  let rel = plan.relStart + delta * (1 - Math.pow(1 - u, p + 1))

  let radius = 1 - smoothstep(DROP_START, DROP_END, u)
  let lift = 0
  if (u > DROP_END && u < SETTLE) {
    // Botes: arcos que se van apagando. Se anulan antes de SETTLE, así que el final es exacto.
    const k = (u - DROP_END) / (SETTLE - DROP_END)
    const phase = k * (BOUNCES + 1)
    const decay = Math.pow(1 - k, 1.6)
    lift = Math.abs(Math.sin(Math.PI * phase)) * 0.55 * decay
    radius += Math.abs(Math.sin(Math.PI * phase)) * 0.35 * decay
    rel += Math.sin(Math.PI * phase) * 0.09 * decay * Math.sign(delta)
  }
  radius = Math.min(1, radius)
  const wheel = wheelAngleAt(plan.input, t)
  if (t >= D) rel = plan.relEnd
  return { wheelAngle: wheel, ballAngle: wheel + rel, radius, lift }
}
