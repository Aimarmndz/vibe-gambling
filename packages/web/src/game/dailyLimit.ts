// SPDX-License-Identifier: AGPL-3.0-or-later
// Aviso de mesa cerrada (tope diario de tiradas): qué texto enseña la ventana. Lógica pura, sin
// canvas: la frase de la batería `dailyLimit` (sin repetir la anterior), la hora a la que reabre
// en el reloj del navegador y la línea de ayuda real del idioma, discreta.
import { forLocale } from '@vibe-gambling/shared'
import { fillTemplate, pickPhrase } from '@vibe-gambling/shared/i18n'

import type { Translator } from '../i18n/index.ts'

export interface DailyLimitInfo {
  /** El tope (`dailySpinLimit`) que manda el servidor. */
  limit: number
  /** Cuándo reabre la mesa (ISO): la próxima medianoche en la zona de la temporada. */
  reopensAt: string
}

export interface HelpLink {
  label: string
  url: string
}

export interface DailyLimitNotice {
  title: string
  count: string
  reopens: string
  /** La frase ya rellenada, y su plantilla (para no repetirla la próxima vez). */
  phrase: string
  template: string
  /** Línea de ayuda de verdad del idioma, o null si la instancia no tiene ninguna. */
  help: { text: string; link: HelpLink } | null
}

/** Hora de pared de un instante en el idioma y la zona del navegador ("00:00"). */
export function clockTime(iso: string, bcp47: string): string {
  const time = new Intl.DateTimeFormat(bcp47, { hour: '2-digit', minute: '2-digit' })
  // Los espacios especiales de `Intl` (el estrecho de algunos idiomas) pasan a espacios normales.
  return time.format(new Date(iso)).replace(/\s/g, ' ')
}

export function dailyLimitNotice(
  tr: Translator,
  helpLinks: Readonly<Partial<Record<Translator['locale'], readonly HelpLink[]>>>,
  info: DailyLimitInfo,
  previous: string | null,
  random: () => number = Math.random,
): DailyLimitNotice {
  const template = pickPhrase(tr.phrases, 'dailyLimit', previous, random)
  const link = forLocale(helpLinks, tr.locale)?.[0] ?? null
  return {
    title: tr.t('dailyLimit.title'),
    count: tr.t('dailyLimit.count', { n: tr.n(info.limit) }),
    reopens: tr.t('dailyLimit.reopens', { time: clockTime(info.reopensAt, tr.meta.bcp47) }),
    phrase: fillTemplate(template, { limit: tr.n(info.limit) }),
    template,
    help: link ? { text: tr.t('dailyLimit.help', { label: link.label }), link } : null,
  }
}
