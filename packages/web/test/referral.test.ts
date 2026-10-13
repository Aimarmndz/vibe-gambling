// SPDX-License-Identifier: AGPL-3.0-or-later
// AFILIADOS en la ventana: la petición `referral.request`, la pantalla (código, enlace, cuentas,
// reglas, copiar), la demo y el aviso de comisión en el reductor de estado.
import { serverMessageSchema } from '@vibe-gambling/shared'
import type { ServerMessage } from '@vibe-gambling/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Bitmap from '../src/font/bitmap.ts'
import { INITIAL_STATE, reduce } from '../src/game/state.ts'
import { DemoLink } from '../src/net/demo.ts'
import { withVersion } from '../src/net/link.ts'
import { ProgressRequests } from '../src/net/progress.ts'
import { NoticeQueue } from '../src/render/fx/notices.ts'
import { ReferralPage, linkLines } from '../src/ui/menu/pages/referral.ts'
import { clientConfig } from '../src/config.ts'
import { REFERRAL, fakeCanvas2d, fakeContext } from './menuFixtures.ts'
import { fakeHost } from './menuHost.ts'
import { msg, testGame, testWebConfig, wallet } from './fixtures.ts'

const painted: { text: string; color: string }[] = []
vi.mock('../src/font/bitmap.ts', async importOriginal => {
  const real = await importOriginal<typeof Bitmap>()
  return {
    ...real,
    drawText: (_g: unknown, text: string, _x: number, _y: number, style: { color: string }) => {
      painted.push({ text, color: style.color })
      return real.measure(text)
    },
  }
})

const press = (page: ReferralPage, action: string) => page.action({ action, fine: false } as never)
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  painted.length = 0
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('petición referral.request', () => {
  it('va y vuelve como las de estadísticas y banco', async () => {
    const sent: unknown[] = []
    const req = new ProgressRequests(m => sent.push(m) > 0, 1000)
    const pending = req.request('referral')
    expect(sent).toEqual([{ type: 'referral.request' }])
    expect(req.busy).toBe(true)
    expect(req.receive(msg({ type: 'referral', referral: REFERRAL }))).toBe(true)
    await expect(pending).resolves.toEqual(REFERRAL)
    expect(req.busy).toBe(false)
  })
})

describe('pantalla AFILIADOS', () => {
  it('carga, anuncia, pinta el enlace partido y las cuentas, y desplaza las reglas', async () => {
    const ctx = fakeContext()
    const page = new ReferralPage(fakeHost(ctx))
    page.draw(fakeCanvas2d(), 0)
    expect(painted.map(p => p.text)).toContain('CARGANDO…')
    page.enter()
    await flush()
    expect(ctx.progressCalls).toContainEqual(['referral', undefined])
    expect(ctx.announced.at(-1)).toBe(
      'Tu código ABCD2345. 4 invitados, 2 activados, 1.500 monedas ganadas. Comisiones esta temporada: 2 de 4.',
    )
    painted.length = 0
    page.draw(fakeCanvas2d(), 0)
    const texts = painted.map(p => p.text)
    expect(texts).toEqual(
      expect.arrayContaining([
        'TU CÓDIGO',
        'test.invalid',
        '/r/ABCD2345',
        'X COPIAR ENLACE',
        'PIRÁMIDE',
        '2/4 ESTA TEMPORADA',
        'INVITADOS',
        '1.500',
      ]),
    )
    // Las reglas van debajo de las cuentas: ↑↓ las traen.
    const lines = page.lines()
    expect(lines.length).toBeGreaterThan(4)
    for (let i = 0; i < lines.length; i++) press(page, 'down')
    painted.length = 0
    page.draw(fakeCanvas2d(), 0)
    expect(painted.some(p => p.text.includes('/vibe-redeem'))).toBe(true)
    expect(page.help().map(h => h.label)).toContain('COPIAR ENLACE')
  })

  it('tope lleno en rojo; con el código ya canjeado lo dice en vez de la pista', async () => {
    const ctx = fakeContext()
    ctx.progressReply.referral = Promise.resolve({
      ...REFERRAL,
      season: { ...REFERRAL.season, commissions: 4 },
      canRedeem: false,
      invitedBy: { redeemedAt: '2026-10-10T00:00:00.000Z', bonus: 250, activated: true },
    })
    const page = new ReferralPage(fakeHost(ctx))
    page.enter()
    await flush()
    page.draw(fakeCanvas2d(), 0)
    expect(painted.find(p => p.text === 'TOPE LLENO')).toBeTruthy()
    const all = page.lines().map(l => (l.kind === 'text' ? l.text : l.label))
    expect(all.join(' ')).toContain('Entraste por invitación: +250 de bienvenida.')
    expect(all.join(' ')).not.toContain('¿Te invitó alguien?')
  })

  it('✕ copia el enlace; sin portapapeles, el aviso enseña el enlace', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const ctx = fakeContext()
    const page = new ReferralPage(fakeHost(ctx))
    // Sin datos aún: no hace nada.
    press(page, 'accept')
    expect(writeText).not.toHaveBeenCalled()
    page.enter()
    await flush()
    press(page, 'accept')
    await flush()
    expect(writeText).toHaveBeenCalledWith(REFERRAL.url)
    expect(ctx.announced.at(-1)).toBe('Enlace copiado. Ahora, a perder amigos.')
    // Clic en la fila de copiar.
    page.draw(fakeCanvas2d(), 0)
    ctx.hits.at(20, 130)?.onClick()
    expect(writeText).toHaveBeenCalledTimes(2)

    vi.stubGlobal('navigator', {})
    press(page, 'accept')
    expect(ctx.announced.at(-1)).toBe(`No se pudo copiar. Tu enlace: ${REFERRAL.url}`)
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('no')) } })
    press(page, 'accept')
    await flush()
    expect(ctx.announced.at(-1)).toBe(`No se pudo copiar. Tu enlace: ${REFERRAL.url}`)
  })

  it('sin respuesta: error en rojo, sin botón de copiar', async () => {
    const ctx = fakeContext()
    ctx.progressReply.referral = Promise.reject(new Error('offline'))
    const page = new ReferralPage(fakeHost(ctx))
    page.enter()
    await flush()
    page.draw(fakeCanvas2d(), 0)
    expect(painted.filter(p => p.text === 'No se pudo cargar la pirámide.').length).toBeGreaterThan(
      0,
    )
    expect(page.help().map(h => h.label)).not.toContain('COPIAR ENLACE')
  })

  it('el enlace se parte en dominio y ruta', () => {
    expect(linkLines('https://vibe.aimar.dev/r/ABCD2345')).toEqual([
      'vibe.aimar.dev',
      '/r/ABCD2345',
    ])
    expect(linkLines('no es una url')).toEqual(['no es una url', ''])
  })
})

describe('demo', () => {
  it('contesta referral.request con una pirámide vacía y un código válido', async () => {
    vi.useFakeTimers()
    const link = new DemoLink(
      testWebConfig.game,
      { ...clientConfig.demo, achievements: testGame.achievements },
      false,
      testWebConfig.publicUrl,
    )
    const got: ServerMessage[] = []
    link.onMessage(m => got.push(serverMessageSchema.parse(m)))
    link.onStatus(() => undefined)
    link.start()
    vi.advanceTimersByTime(1)
    link.send(withVersion({ type: 'referral.request' }))
    await vi.advanceTimersByTimeAsync(50)
    const reply = got.at(-1)
    expect(reply?.type).toBe('referral')
    if (reply?.type !== 'referral') throw new Error('sin respuesta')
    expect(reply.referral).toMatchObject({ invited: 0, earned: 0, canRedeem: true })
    expect(reply.referral.url).toBe(`${testWebConfig.publicUrl}/r/${reply.referral.code}`)
    expect(reply.referral.rules.welcomeBonus).toBe(testGame.referral.welcomeBonus)
    link.stop()
    vi.useRealTimers()
  })
})

describe('comisión cobrada', () => {
  it('actualiza la cartera y pide el aviso (también con el tope lleno)', () => {
    const w = wallet({ balance: 2500 })
    const step = reduce(
      INITIAL_STATE,
      msg({
        type: 'referral.commission',
        amount: 750,
        capped: false,
        commissions: 1,
        cap: 4,
        wallet: w,
      }),
      0,
    )
    expect(step.state.wallet?.balance).toBe(2500)
    expect(step.effects).toEqual([
      { type: 'commission', amount: 750, capped: false, commissions: 1, cap: 4 },
    ])
    const response = reduce(INITIAL_STATE, msg({ type: 'referral', referral: REFERRAL }), 0)
    expect(response.effects).toEqual([])
  })

  it('la cola de avisos acepta comisiones con su propio id junto a los logros', () => {
    const q = new NoticeQueue<{ id: string }>(clientConfig.fx.achievement, true)
    q.push({ id: 'commission:1' })
    q.push({ id: 'commission:2' })
    q.push({ id: 'commission:1' })
    expect(q.pending).toBe(2)
    expect(q.tick(16, true)?.id).toBe('commission:1')
  })
})
