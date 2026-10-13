// SPDX-License-Identifier: AGPL-3.0-or-later
// Contenido de la página de invitación `/r/<código>`: quién invita (solo si no está oculto del
// ranking), qué ganas, cómo instalar y el comando para canjear. Todo como texto (nunca HTML).
import { normalizeReferralCode } from '@vibe-gambling/shared'
import type { ReferralLookupResponse, WebConfig } from '@vibe-gambling/shared'

import type { Translator } from '../i18n/index.ts'
import { webUrl } from '../net/urls.ts'

/** Lo que se sabe de la invitación: aún cargando, que no existe o quién invita (null: oculto). */
export type InviteState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'found'; inviter: ReferralLookupResponse['inviter'] }

/** Código de la URL (`/r/<código>`), ya normalizado; null si no puede ser un código. */
export function codeFromPath(pathname: string): string | null {
  const match = /^\/r\/([^/]+)\/?$/.exec(pathname)
  if (!match?.[1]) return null
  let raw: string
  try {
    raw = decodeURIComponent(match[1])
  } catch {
    return null
  }
  return normalizeReferralCode(raw)
}

/** Lo que pide el `/r/<código>` a la API, ya resuelto en un estado de la página. */
export function stateOf(lookup: ReferralLookupResponse): InviteState {
  return lookup.found ? { kind: 'found', inviter: lookup.inviter } : { kind: 'missing' }
}

const $ = (root: Document, id: string) => root.getElementById(id)!

/**
 * Pinta la página en `root` (el documento). `code` es el de la URL, ya normalizado (o null).
 * El enlace del avatar y el login vienen de la API: el login va como texto y el avatar solo si es
 * una URL http(s).
 */
export function renderInvite(
  root: Document,
  args: { web: WebConfig; tr: Translator; code: string | null; state: InviteState },
): void {
  const { web, tr, code, state } = args
  const r = web.game.referral
  const from = $(root, 'invite-from')
  const who = $(root, 'invite-who')
  const avatar = $(root, 'invite-avatar') as HTMLImageElement
  const offer = $(root, 'invite-offer')
  const status = $(root, 'invite-state')
  const redeemStep = $(root, 'invite-redeem-step')

  const found = state.kind === 'found'
  from.hidden = !found
  offer.hidden = !found
  redeemStep.hidden = !found
  avatar.hidden = true
  if (found) {
    const inviter = state.inviter
    who.textContent = inviter
      ? tr.t('invite.from', { login: inviter.login })
      : tr.t('invite.fromAnon')
    const src = inviter ? webUrl(inviter.avatarUrl) : null
    if (src) {
      avatar.src = src
      avatar.referrerPolicy = 'no-referrer'
      avatar.hidden = false
    } else avatar.removeAttribute('src')
    offer.textContent = tr.t('invite.offer', {
      bonus: tr.n(r.welcomeBonus),
      commission: tr.n(r.commission),
      spins: tr.n(r.activationSpins),
    })
  }
  status.textContent =
    state.kind === 'loading'
      ? tr.t('invite.loading')
      : state.kind === 'missing'
        ? tr.t('invite.notFound')
        : ''
  status.hidden = status.textContent === ''

  $(root, 'invite-step1').textContent = tr.t('invite.step1')
  $(root, 'invite-install').textContent = web.site.installCommand
  $(root, 'invite-step2').textContent = tr.t('invite.step2')
  $(root, 'invite-step3').textContent = tr.t('invite.step3', {
    days: tr.n(r.redeemWindowDays),
    spins: tr.n(r.redeemMaxSpins),
  })
  $(root, 'invite-redeem').textContent = code ? `/vibe-redeem ${code}` : ''
  $(root, 'invite-fine').textContent = tr.t('invite.fine')
}
