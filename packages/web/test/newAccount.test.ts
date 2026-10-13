// SPDX-License-Identifier: AGPL-3.0-or-later
// Cuentas de GitHub nuevas fuera del ranking: los avisos de la ventana y de la landing.
import { describe, expect, it } from 'vitest'

import { newAccountNotice, newAccountRankLine, newAccountsRule } from '../src/game/newAccount.ts'
import { user } from './fixtures.ts'
import { translator } from './translators.ts'

const en = translator('en')
const es = translator('es')
const waiting = {
  ...user,
  newAccount: { minAgeDays: 30, rankedFrom: '2026-11-12T12:00:00.000Z' },
}

describe('aviso de cuenta de GitHub nueva', () => {
  it('al abrir la ventana: juegas igual, con los días de la regla y la fecha en que sales', () => {
    expect(newAccountNotice(waiting, en)).toBe(
      'Your GitHub account is under 30 days old: you play as usual and join the leaderboard on Nov 12, 2026.',
    )
    expect(newAccountNotice(waiting, es)).toBe(
      'Tu cuenta de GitHub tiene menos de 30 días: juegas igual y sales en la clasificación el 12 nov 2026.',
    )
  })

  it('sin espera (cuenta antigua, servidor viejo), oculto o sin usuario: nada', () => {
    expect(newAccountNotice({ ...user, newAccount: null }, en)).toBeNull()
    expect(newAccountNotice(user, en)).toBeNull()
    expect(newAccountNotice({ ...waiting, hidden: true }, en)).toBeNull()
    expect(newAccountNotice(null, en)).toBeNull()
    expect(newAccountRankLine({ ...waiting, hidden: true }, en)).toBeNull()
    expect(newAccountRankLine(user, en)).toBeNull()
  })

  it('la línea de la clasificación lleva la fecha en el formato del idioma', () => {
    expect(newAccountRankLine(waiting, en)).toBe('New GitHub account: listed from Nov 12, 2026')
    expect(newAccountRankLine(waiting, translator('de'))).toBe(
      'Neues GitHub-Konto: gelistet ab 12.11.2026',
    )
    // Los espacios especiales de Intl (el francés los usa) pasan a espacios normales.
    expect(newAccountRankLine(waiting, translator('fr'))).toMatch(/12 nov\. 2026$/)
  })

  it('la regla de la landing cuenta los días de la configuración, y desaparece con 0', () => {
    expect(newAccountsRule(30, en)).toContain('younger than 30 days can play')
    expect(newAccountsRule(7, es)).toContain('menos de 7 días juegan')
    expect(newAccountsRule(0, en)).toBeNull()
  })
})
