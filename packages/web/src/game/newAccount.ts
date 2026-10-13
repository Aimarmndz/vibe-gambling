// SPDX-License-Identifier: AGPL-3.0-or-later
// Antiabuso: una cuenta de GitHub más nueva que `leaderboard.minAccountAgeDays` juega igual, pero
// no sale en el ranking (ni en el Salón de la Ruina) hasta cumplir esa edad. El servidor manda en
// `user.newAccount` los días y la fecha en que saldrá; aquí solo se decide el texto. Ocultarse
// manda más: un jugador oculto no saldrá cuando cumpla los días, así que no se le promete nada.
import type { SelfUser } from '@vibe-gambling/shared'

import type { Translator } from '../i18n/index.ts'

/** Lo que el servidor dice de la espera, si este usuario la tiene y se le puede prometer. */
function pending(user: SelfUser | null): NonNullable<SelfUser['newAccount']> | null {
  if (!user || user.hidden) return null
  return user.newAccount ?? null
}

/** Aviso al abrir la ventana: juegas, y sales en el ranking a partir de esta fecha. */
export function newAccountNotice(user: SelfUser | null, tr: Translator): string | null {
  const wait = pending(user)
  if (!wait) return null
  return tr.t('toast.newAccount', {
    days: tr.n(wait.minAgeDays),
    date: tr.date(wait.rankedFrom),
  })
}

/** Línea de la CLASIFICACIÓN en lugar de un puesto que no se ve en la lista. */
export function newAccountRankLine(user: SelfUser | null, tr: Translator): string | null {
  const wait = pending(user)
  if (!wait) return null
  return tr.t('lb.newAccount', { date: tr.date(wait.rankedFrom) })
}

/** La regla, para la landing (junto al ranking): `null` si está desactivada (0 días). */
export function newAccountsRule(minAccountAgeDays: number, tr: Translator): string | null {
  if (minAccountAgeDays === 0) return null
  return tr.t('landing.lb.newAccounts', { days: tr.n(minAccountAgeDays) })
}
