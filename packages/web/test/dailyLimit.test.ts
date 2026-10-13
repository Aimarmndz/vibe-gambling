// SPDX-License-Identifier: AGPL-3.0-or-later
// Aviso de mesa cerrada (tope diario): el mensaje cierra la ronda que giraba sin destripar la bola
// que cae, y el aviso trae una frase de la batería `dailyLimit` sin repetir, la hora a la que
// reabre y la línea de ayuda del idioma. El neón se queda quieto con `prefers-reduced-motion`.
import { LOCALES } from '@vibe-gambling/shared/i18n'
import { describe, expect, it } from 'vitest'

import { clockTime, dailyLimitNotice } from '../src/game/dailyLimit.ts'
import { EMPTY_SLIP, INITIAL_STATE, reduce } from '../src/game/state.ts'
import { neonOn } from '../src/ui/screens/dailyLimit.ts'
import { msg, resolved, user, wallet } from './fixtures.ts'
import { translator } from './translators.ts'

const NOW = Date.parse('2026-10-15T12:00:00.000Z')
const REOPENS_AT = '2026-10-15T22:00:00.000Z'
const HELP = {
  en: [{ label: 'BeGambleAware', url: 'https://www.begambleaware.org/' }],
  es: [{ label: 'jugarbien.es', url: 'https://www.jugarbien.es/' }],
}

function spinning() {
  let state = reduce(
    INITIAL_STATE,
    msg({
      type: 'hello',
      user,
      wallet: wallet(),
      slip: EMPTY_SLIP,
      round: null,
      lastRound: null,
      serverTime: '2026-10-15T12:00:00.000Z',
    }),
    NOW,
  ).state
  state = reduce(
    state,
    msg({ type: 'round.started', round: { roundId: resolved().roundId, openedAt: REOPENS_AT } }),
    NOW,
  ).state
  return state
}

describe('daily_limit en el estado', () => {
  it('cierra la ronda que giraba y pide el aviso', () => {
    const state = spinning()
    expect(state.phase).toBe('spinning')
    const step = reduce(
      state,
      msg({ type: 'daily_limit', limit: 2500, reopensAt: REOPENS_AT, wallet: wallet() }),
      NOW,
    )
    expect(step.state.round).toBeNull()
    expect(step.state.phase).toBe('idle')
    expect(step.effects).toEqual([{ type: 'dailyLimit', limit: 2500, reopensAt: REOPENS_AT }])
  })

  it('con la bola cayendo no la interrumpe', () => {
    let state = spinning()
    state = reduce(
      state,
      msg({ type: 'round.resolved', round: resolved(), wallet: wallet() }),
      NOW,
    ).state
    expect(state.phase).toBe('landing')
    const step = reduce(
      state,
      msg({ type: 'daily_limit', limit: 2500, reopensAt: REOPENS_AT, wallet: wallet() }),
      NOW,
    )
    expect(step.state.phase).toBe('landing')
  })
})

describe('aviso de mesa cerrada', () => {
  it('frase de la batería con el tope rellenado, hora de reapertura y ayuda del idioma', () => {
    const tr = translator('es')
    const withLimit = tr.phrases.dailyLimit.findIndex(p => p.includes('{limit}'))
    const notice = dailyLimitNotice(
      tr,
      HELP,
      { limit: 2500, reopensAt: REOPENS_AT },
      null,
      () => (withLimit + 0.5) / tr.phrases.dailyLimit.length,
    )
    expect(notice.title).toBe('MESA CERRADA')
    expect(notice.count).toBe('2.500 tiradas hoy: es el tope diario.')
    expect(notice.phrase).toContain('2.500')
    expect(notice.phrase).not.toContain('{')
    expect(notice.reopens).toBe(`REABRE A LAS ${clockTime(REOPENS_AT, 'es-ES')}`)
    expect(notice.help?.link.url).toBe('https://www.jugarbien.es/')
    expect(notice.help?.text).toContain('jugarbien.es')
  })

  it('no repite la frase anterior', () => {
    const tr = translator('en')
    const first = dailyLimitNotice(tr, HELP, { limit: 10, reopensAt: REOPENS_AT }, null, () => 0)
    const second = dailyLimitNotice(
      tr,
      HELP,
      { limit: 10, reopensAt: REOPENS_AT },
      first.template,
      () => 0,
    )
    expect(second.template).not.toBe(first.template)
  })

  it('sin ayuda para el idioma usa la de inglés; sin ninguna, no hay línea', () => {
    const fr = dailyLimitNotice(translator('fr'), HELP, { limit: 5, reopensAt: REOPENS_AT }, null)
    expect(fr.help?.link.label).toBe('BeGambleAware')
    const none = dailyLimitNotice(translator('de'), {}, { limit: 5, reopensAt: REOPENS_AT }, null)
    expect(none.help).toBeNull()
  })

  it('al menos 15 frases por idioma, todas con texto', () => {
    for (const locale of LOCALES) {
      const list = translator(locale).phrases.dailyLimit
      expect(list.length, locale).toBeGreaterThanOrEqual(15)
      expect(new Set(list).size, locale).toBe(list.length)
    }
  })

  it('el neón parpadea, salvo con movimiento reducido', () => {
    const samples = Array.from({ length: 320 }, (_, i) => i / 100)
    expect(samples.some(t => !neonOn(t, false))).toBe(true)
    expect(samples.every(t => neonOn(t, true))).toBe(true)
  })
})
