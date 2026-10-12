// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import { parseBetAmount, parseBetTarget } from '../src/index.ts'

describe('/bet: casilla', () => {
  it.each([
    ['red', { kind: 'red' }],
    ['ROJO', { kind: 'red' }],
    [' negro ', { kind: 'black' }],
    ['par', { kind: 'even' }],
    ['impar', { kind: 'odd' }],
    ['falta', { kind: 'low' }],
    ['19-36', { kind: 'high' }],
    ['1st12', { kind: 'dozen', index: 1 }],
    ['2ª12', { kind: 'dozen', index: 2 }],
    ['3a12', { kind: 'dozen', index: 3 }],
    ['col2', { kind: 'column', index: 2 }],
    ['columna3', { kind: 'column', index: 3 }],
    ['17', { kind: 'straight', numbers: [17] }],
    ['0', { kind: 'straight', numbers: [0] }],
    ['8-11', { kind: 'split', numbers: [8, 11] }],
    ['0-1-2', { kind: 'street', numbers: [0, 1, 2] }],
    ['12/8/11/9', { kind: 'corner', numbers: [8, 9, 11, 12] }],
    ['31-32-33-34-35-36', { kind: 'line', numbers: [31, 32, 33, 34, 35, 36] }],
  ])('%s', (raw, expected) => {
    expect(parseBetTarget(raw)).toEqual(expected)
  })

  it.each(['', 'verde', '37', '1-9', '1-2-3-4-5', 'x'.repeat(40), '1--2', '-1'])(
    'rechaza %s',
    raw => {
      expect(parseBetTarget(raw)).toBeNull()
    },
  )
})

describe('/bet: cantidad', () => {
  it('acepta enteros y all-in', () => {
    expect(parseBetAmount('200')).toBe(200)
    expect(parseBetAmount('1_000')).toBe(1000)
    expect(parseBetAmount('all-in')).toBe('all-in')
    expect(parseBetAmount('TODO')).toBe('all-in')
  })

  it('rechaza lo demás', () => {
    expect(parseBetAmount('0')).toBeNull()
    expect(parseBetAmount('-5')).toBeNull()
    expect(parseBetAmount('1.5e3')).toBeNull()
    expect(parseBetAmount('mucho')).toBeNull()
    expect(parseBetAmount('9'.repeat(20))).toBeNull()
  })
})
