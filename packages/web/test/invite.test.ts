// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment happy-dom
// Página /r/<código>: el código de la URL, quién invita (solo si no está oculto) y los pasos.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { codeFromPath, renderInvite, stateOf } from '../src/pages/invite.ts'
import type { InviteState } from '../src/pages/invite.ts'
import { testWebConfig } from './fixtures.ts'
import { translator } from './translators.ts'

const html = readFileSync(resolve(__dirname, '../invite.html'), 'utf8')
const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1]!

const es = translator('es')
const en = translator('en')
const inviter = {
  login: 'pyramid-boss',
  avatarUrl: 'https://avatars.example.invalid/p.png',
  profileUrl: 'https://github.test/pyramid-boss',
}

function render(state: InviteState, code: string | null = 'ABCD2345', tr = es) {
  renderInvite(document, { web: testWebConfig, tr, code, state })
  const $ = (id: string) => document.getElementById(id)!
  return { $, text: (id: string) => $(id).textContent ?? '' }
}

beforeEach(() => {
  document.body.innerHTML = body
})

describe('código de la URL', () => {
  it('normaliza lo que venga y descarta lo que no puede ser un código', () => {
    expect(codeFromPath('/r/ABCD2345')).toBe('ABCD2345')
    expect(codeFromPath('/r/abcd-2345')).toBe('ABCD2345')
    expect(codeFromPath('/r/ABCD2345/')).toBe('ABCD2345')
    expect(codeFromPath('/r/%3Cscript%3E')).toBeNull()
    expect(codeFromPath('/r/%E0%A4%A')).toBeNull()
    expect(codeFromPath('/r/')).toBeNull()
    expect(codeFromPath('/play')).toBeNull()
    expect(stateOf({ v: 1, found: false, inviter: null })).toEqual({ kind: 'missing' })
    expect(stateOf({ v: 1, found: true, inviter: null })).toEqual({ kind: 'found', inviter: null })
  })
})

describe('página', () => {
  it('quien invita, con su avatar, qué ganas y el comando para canjear', () => {
    const { $, text } = render({ kind: 'found', inviter })
    expect($('invite-from').hidden).toBe(false)
    expect(text('invite-who')).toBe('@pyramid-boss te ha invitado')
    const avatar = $('invite-avatar') as HTMLImageElement
    expect(avatar.hidden).toBe(false)
    expect(avatar.getAttribute('src')).toBe(inviter.avatarUrl)
    expect(text('invite-offer')).toContain('250')
    expect(text('invite-offer')).toContain('750')
    expect(text('invite-install')).toBe(testWebConfig.site.installCommand)
    expect(text('invite-redeem')).toBe('/vibe-redeem ABCD2345')
    expect($('invite-redeem-step').hidden).toBe(false)
    expect(text('invite-step3')).toContain('7')
    expect($('invite-state').hidden).toBe(true)
  })

  it('con quien invita oculto del ranking, ni login ni avatar', () => {
    const { $, text } = render({ kind: 'found', inviter: null }, 'ABCD2345', en)
    expect(text('invite-who')).toBe('Someone invited you')
    expect($('invite-avatar').hidden).toBe(true)
    expect(document.body.textContent).not.toContain('pyramid-boss')
  })

  it('un avatar que no es http(s) no se pide', () => {
    const { $ } = render({
      kind: 'found',
      inviter: { ...inviter, avatarUrl: 'javascript:alert(1)' },
    })
    expect($('invite-avatar').hidden).toBe(true)
    expect($('invite-avatar').getAttribute('src')).toBeNull()
  })

  it('cargando y código inexistente: aviso amable, sin paso de canje', () => {
    let page = render({ kind: 'loading' })
    expect(page.text('invite-state')).toBe('Comprobando la invitación…')
    expect(page.$('invite-from').hidden).toBe(true)
    page = render({ kind: 'missing' }, null)
    expect(page.text('invite-state')).toContain('no existe')
    expect(page.$('invite-redeem-step').hidden).toBe(true)
    expect(page.$('invite-from').hidden).toBe(true)
    // Los pasos para instalar siguen ahí: se puede jugar igual.
    expect(page.text('invite-install')).toBe(testWebConfig.site.installCommand)
  })

  it('un login con HTML se pinta como texto', () => {
    const { $ } = render({ kind: 'found', inviter: { ...inviter, login: '<img src=x>' } })
    expect($('invite-who').querySelector('img')).toBeNull()
    expect($('invite-who').textContent).toContain('<img src=x>')
  })
})
