// SPDX-License-Identifier: AGPL-3.0-or-later
// Tiradas pendientes: con la ventana cerrada u oculta, el servidor guarda la tirada y el mod lo
// cuenta en la status line y en un toast (sin esperar a ningún giro). En el tope, el prompt se
// descarta con una frase de broma. `/balance` dice cuántas quedan.
import { expect, test } from 'claude-code/testing'

import { phrasesEn } from '../hooks/generated/phrases.en.ts'
import { phrasesEs } from '../hooks/generated/phrases.es.ts'
import { queuedToast, statusText } from '../hooks/lib/format.ts'
import { MESSAGES } from '../hooks/lib/messages.ts'
import {
  LOGGED_IN,
  TEST_OPTIONS,
  command,
  happyCasino,
  meReply,
  playTurn,
  queuedReply,
  startSession,
  wallet,
  world,
} from './support/harness.ts'

test(
  'a queued turn shows the toast at once and the pending count in the status line',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { ...happyCasino(false), '/api/turn/end': queuedReply(20) },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.toasts).toEqual(['🎰 Spin saved for later · 20 pending. Open /roulette and hit SPIN.'])
    expect(w.lastStatus()).toBe('🎰 1,000 🪙 · 20 pending')
  },
)

test(
  'Spanish status line with debt and pending spins',
  { options: { ...TEST_OPTIONS, language: 'es' } },
  async ($, on) => {
    const w = world(on, {
      routes: {
        ...happyCasino(false),
        '/api/turn/end': queuedReply(1234, false, { balance: 750, debt: 300 }),
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.toasts).toEqual([
      '🎰 Tirada guardada · 1.234 pendientes. Abre /roulette y dale a GIRAR.',
    ])
    expect(w.lastStatus()).toBe('🎰 750 🪙 · deuda 300 · 1.234 pendientes')
  },
)

test(
  'at the cap the prompt is dropped with a joke that names the cap',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { ...happyCasino(false), '/api/turn/end': queuedReply(100, true) },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.toasts).toHaveLength(1)
    const text = w.toasts[0]!
    expect(text).toStartWith('🎰 100 pending spins is the limit: this prompt was not saved · “')
    const filled = phrasesEn.pendingDropped.map(p => p.replaceAll('{max}', '100'))
    expect(filled.some(phrase => text.includes(phrase))).toBe(true)
    expect(w.lastStatus()).toBe('🎰 1,000 🪙 · 100 pending')
  },
)

test('queued toast in Spanish, without repeating the last joke', () => {
  const es = MESSAGES.es
  const w = wallet({ pendingSpins: 100 })
  const first = queuedToast(true, w, 'es', es, null, () => 0)
  const second = queuedToast(true, w, 'es', es, first.phrase, () => 0)
  expect(first.phrase).not.toBeNull()
  expect(second.phrase).not.toBe(first.phrase)
  expect(phrasesEs.pendingDropped).toContain(second.phrase)
  expect(second.text).toContain('100 tiradas pendientes es el tope')
  expect(queuedToast(false, w, 'es', es, null).phrase).toBeNull()
})

test('one pending spin is singular in every language', () => {
  const one = wallet({ pendingSpins: 1 })
  expect(statusText(one, 'es', MESSAGES.es)).toBe('🎰 1.000 🪙 · 1 pendiente')
  expect(queuedToast(false, one, 'es', MESSAGES.es, null).text).toBe(
    '🎰 Tirada guardada · 1 pendiente. Abre /roulette y dale a GIRAR.',
  )
  expect(queuedToast(true, one, 'en', MESSAGES.en, null, () => 0).text).toStartWith(
    '🎰 1 pending spin is the limit: this prompt was not saved',
  )
  expect(MESSAGES.en.pendingHint(1, '1')).toBe(
    '🎰 1 pending spin (a prompt with the window closed). Spend it with SPIN in /roulette.',
  )
  expect(MESSAGES.fr.spinDropped(1, '1')).toStartWith('🎰 1 tour en attente,')
  expect(MESSAGES.de.pendingHint(1, '1')).toStartWith('🎰 1 offener Dreh ')
  // Y el plural sigue para el resto (también con la cifra ya agrupada).
  expect(MESSAGES.es.pendingCount(1234, '1.234')).toBe('1.234 pendientes')
  expect(MESSAGES.de.pendingHint(2, '2')).toStartWith('🎰 2 offene Drehs ')
})

test('the status line hides the counter when there are none (or an older server)', () => {
  const en = MESSAGES.en
  expect(statusText(wallet({ pendingSpins: 0 }), 'en', en)).toBe('🎰 1,000 🪙')
  const { pendingSpins: _omit, ...old } = wallet()
  expect(statusText(old as Parameters<typeof statusText>[0], 'en', en)).toBe('🎰 1,000 🪙')
})

test(
  'a server without pending spins (older) still works: no counter, no crash',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const { pendingSpins: _omit, ...old } = wallet({ balance: 640, netWorth: 640 })
    const w = world(on, {
      routes: { ...happyCasino(false), '/api/me': meReply({ wallet: old }) },
      store: LOGGED_IN,
    })
    await startSession($, w)
    expect(w.lastStatus()).toBe('🎰 640 🪙')
  },
)

test(
  'a negative or broken counter is treated as an offline server',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: {
        ...happyCasino(false),
        '/api/turn/end': queuedReply(-3),
      },
      store: LOGGED_IN,
    })
    await startSession($, w)
    await playTurn($, w)
    expect(w.toasts).toEqual([])
    expect(w.lastStatus()).toBe('🎰 offline')
  },
)

test(
  '/balance tells how many pending spins are waiting',
  { options: TEST_OPTIONS },
  async ($, on) => {
    const w = world(on, {
      routes: { '/api/me': meReply({ wallet: wallet({ pendingSpins: 7 }), brokeRank: 3 }) },
      store: LOGGED_IN,
    })
    await startSession($, w)
    const { text } = await command($, 'balance')
    expect(text).toBe(
      '🎰 Balance 1,000 · Debt 0 · Net worth 1,000 · #3\n' +
        '🎰 7 pending spins (prompts with the window closed). Spend them with SPIN in /roulette.',
    )
    expect(w.lastStatus()).toBe('🎰 1,000 🪙 · 7 pending')
  },
)
