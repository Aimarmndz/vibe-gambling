// SPDX-License-Identifier: AGPL-3.0-or-later
// Tope diario de tiradas: el turno no tira ni se guarda, y el mod lo cuenta con un toast que dice
// a qué hora reabre la mesa y una frase de la batería `dailyLimit` (sin repetir la anterior).
import { expect, test } from 'claude-code/testing'

import { phrasesEn } from '../hooks/generated/phrases.en.ts'
import { phrasesEs } from '../hooks/generated/phrases.es.ts'
import { PHRASES, dailyLimitToast } from '../hooks/lib/format.ts'
import { MESSAGES } from '../hooks/lib/messages.ts'
import {
  LOGGED_IN,
  TEST_OPTIONS,
  happyCasino,
  playTurn,
  startSession,
  wallet,
  world,
} from './support/harness.ts'

const REOPENS_AT = '2026-10-15T22:00:00.000Z'
/** La hora como la enseña el mod: en la zona del sistema que corre los tests. */
const timeIn = (bcp47: string) =>
  new Intl.DateTimeFormat(bcp47, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(REOPENS_AT),
  )

test(
  'at the daily limit the toast says when the table reopens, with a closing-time joke',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        ...happyCasino(false),
        '/api/turn/end': {
          json: {
            v: 1,
            status: 'daily_limit',
            limit: 2500,
            reopensAt: REOPENS_AT,
            wallet: wallet({ spins: 2500 }),
          },
        },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.toasts).toHaveLength(1)
    const text = w.toasts[0]!
    expect(text).toStartWith(
      `🎰 Daily spin limit reached · the table reopens at ${timeIn('en')} · “`,
    )
    const filled = phrasesEn.dailyLimit.map(p => p.replaceAll('{limit}', '2,500'))
    expect(filled.some(phrase => text.includes(phrase))).toBe(true)
    expect(text).not.toContain('{')
    // La status line sigue con el saldo: no es un fallo del servidor.
    expect(w.lastStatus()).toBe('🎰 1,000 🪙')
  },
)

test('daily limit toast in Spanish, without repeating the last joke', () => {
  const es = MESSAGES.es
  const first = dailyLimitToast(2500, REOPENS_AT, 'es', es, null, () => 0)
  const second = dailyLimitToast(2500, REOPENS_AT, 'es', es, first.phrase, () => 0)
  expect(first.phrase).not.toBeNull()
  expect(second.phrase).not.toBe(first.phrase)
  expect(phrasesEs.dailyLimit).toContain(second.phrase)
  expect(second.text).toStartWith(
    `🎰 Tope diario de tiradas alcanzado · la mesa reabre a las ${timeIn('es-ES')}`,
  )
  // El {limit} sale con el separador de miles del idioma.
  const withLimit = phrasesEs.dailyLimit.findIndex(p => p.includes('{limit}'))
  const pick = dailyLimitToast(2500, REOPENS_AT, 'es', es, null, () => {
    return (withLimit + 0.5) / phrasesEs.dailyLimit.length
  })
  expect(pick.text).toContain('2.500')
})

test('every language has at least 15 closing-time jokes', () => {
  for (const catalog of Object.values(PHRASES)) {
    expect(catalog.dailyLimit.length).toBeGreaterThanOrEqual(15)
  }
})

test(
  'a malformed daily_limit reply is treated as an offline server',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        ...happyCasino(false),
        '/api/turn/end': {
          json: { v: 1, status: 'daily_limit', limit: 0, reopensAt: 'nope', wallet: wallet() },
        },
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.toasts).toEqual([])
    expect(w.lastStatus()).toBe('🎰 offline')
  },
)
