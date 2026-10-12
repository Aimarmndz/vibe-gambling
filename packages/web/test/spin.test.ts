// SPDX-License-Identifier: AGPL-3.0-or-later
import { POCKET_COUNT, WHEEL_ORDER } from '@vibe-gambling/shared'
import { describe, expect, it } from 'vitest'

import {
  planLanding,
  pocketAngle,
  pocketAtLocalAngle,
  sampleLanding,
  wheelAngleAt,
  wrapAngle,
} from '../src/game/spin.ts'
import { WheelMotion } from '../src/game/wheelMotion.ts'

const TAU = Math.PI * 2
const angleDiff = (a: number, b: number) => {
  const d = wrapAngle(a - b)
  return Math.min(d, TAU - d)
}

/** Generador determinista para variar el estado inicial. */
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('ángulos del cilindro', () => {
  it('cada casilla del cilindro europeo está en su sitio', () => {
    for (let i = 0; i < POCKET_COUNT; i++) {
      const n = WHEEL_ORDER[i]!
      expect(angleDiff(pocketAngle(n), -i * (TAU / POCKET_COUNT))).toBeLessThan(1e-9)
      expect(pocketAtLocalAngle(pocketAngle(n))).toBe(n)
      expect(pocketAtLocalAngle(pocketAngle(n) + 0.05)).toBe(n)
    }
    expect(wrapAngle(-0.5)).toBeCloseTo(TAU - 0.5)
  })
})

describe('caída de la bola', () => {
  it('acaba exactamente en el número pedido, para los 37 números y estados variados', () => {
    const random = rng(42)
    for (let n = 0; n <= 36; n++) {
      for (let k = 0; k < 12; k++) {
        const input = {
          result: n,
          duration: [1.2, 3, 4.2, 6.5][k % 4]!,
          wheelAngle: random() * 100 - 50,
          wheelSpeed: 0.3 + random() * 2.5,
          wheelEndSpeed: 0.9,
          ballAngle: random() * 100 - 50,
          ballSpeed: k % 5 === 0 ? 0.35 : -4 - random() * 6,
        }
        const plan = planLanding(input)
        const end = sampleLanding(plan, input.duration)
        expect(angleDiff(end.ballAngle - end.wheelAngle, pocketAngle(n))).toBeLessThan(1e-9)
        expect(pocketAtLocalAngle(end.ballAngle - end.wheelAngle)).toBe(n)
        expect(end.radius).toBe(0)
        expect(end.lift).toBe(0)
        expect(plan.exponent).toBeGreaterThanOrEqual(0.3)
        expect(plan.exponent).toBeLessThanOrEqual(8)
        // Justo antes del final la bola ya casi no se mueve respecto al cilindro.
        const almost = sampleLanding(plan, input.duration - 0.02)
        expect(angleDiff(almost.ballAngle - almost.wheelAngle, pocketAngle(n))).toBeLessThan(0.08)
        // Después del final sigue en su casilla, girando con el cilindro.
        const later = sampleLanding(plan, input.duration + 2)
        expect(pocketAtLocalAngle(later.ballAngle - later.wheelAngle)).toBe(n)
      }
    }
  })

  it('la bola frena sin dar marcha atrás respecto al cilindro (antes de los botes)', () => {
    const plan = planLanding({
      result: 17,
      duration: 4.2,
      wheelAngle: 1,
      wheelSpeed: 2.1,
      wheelEndSpeed: 0.9,
      ballAngle: 3,
      ballSpeed: -7.8,
    })
    let prev = sampleLanding(plan, 0)
    for (let t = 0.05; t < 4.2 * 0.6; t += 0.05) {
      const s = sampleLanding(plan, t)
      const dRel = s.ballAngle - s.wheelAngle - (prev.ballAngle - prev.wheelAngle)
      expect(dRel).toBeLessThanOrEqual(1e-9)
      prev = s
    }
    expect(plan.bounces).toHaveLength(4)
    expect(sampleLanding(plan, 0).radius).toBe(1)
    expect(wheelAngleAt(plan.input, 0)).toBe(1)
  })

  it('rechaza duraciones imposibles', () => {
    expect(() =>
      planLanding({
        result: 0,
        duration: 0,
        wheelAngle: 0,
        wheelSpeed: 1,
        wheelEndSpeed: 1,
        ballAngle: 0,
        ballSpeed: -5,
      }),
    ).toThrow(RangeError)
  })

  it('con una velocidad absurda ajusta el lanzamiento y sigue acertando', () => {
    const plan = planLanding({
      result: 5,
      duration: 0.2,
      wheelAngle: 0,
      wheelSpeed: 0,
      wheelEndSpeed: 0,
      ballAngle: 0,
      ballSpeed: -500,
    })
    const end = sampleLanding(plan, 0.2)
    expect(pocketAtLocalAngle(end.ballAngle - end.wheelAngle)).toBe(5)
  })
})

describe('movimiento en tiempo real', () => {
  it('reposo → órbita → caída: termina en el número y avisa de los botes', () => {
    const events: string[] = []
    const motion = new WheelMotion({
      launch: () => events.push('launch'),
      bounce: i => events.push(`bounce${i}`),
      settled: r => events.push(`settled${r}`),
    })
    motion.restOn(3)
    for (let i = 0; i < 30; i++) motion.update(1 / 60)
    expect(pocketAtLocalAngle(motion.ballAngle - motion.wheelAngle)).toBe(3)
    expect(motion.rolling()).toBe(0)
    motion.orbit()
    motion.orbit()
    for (let i = 0; i < 120; i++) motion.update(1 / 60)
    expect(motion.mode).toBe('orbit')
    expect(motion.radius).toBeCloseTo(1)
    expect(motion.rolling()).toBeGreaterThan(0)
    motion.land(26, 3)
    motion.orbit()
    expect(motion.mode).toBe('landing')
    for (let i = 0; i < 200; i++) motion.update(1 / 60)
    expect(motion.mode).toBe('rest')
    expect(pocketAtLocalAngle(motion.ballAngle - motion.wheelAngle)).toBe(26)
    expect(events).toEqual(['launch', 'bounce0', 'bounce1', 'bounce2', 'bounce3', 'settled26'])
  })

  it('si llega el resultado sin ronda abierta, lanza la bola y acierta igual', () => {
    const settled: number[] = []
    const motion = new WheelMotion({
      launch: () => {},
      bounce: () => {},
      settled: r => settled.push(r),
    })
    motion.land(0, 1.2)
    for (let i = 0; i < 100; i++) motion.update(1 / 60)
    expect(settled).toEqual([0])
    expect(pocketAtLocalAngle(motion.ballAngle - motion.wheelAngle)).toBe(0)
  })
})
