// SPDX-License-Identifier: AGPL-3.0-or-later
// E2E del Programa de Afiliados Piramidal (legalmente distinto) contra la pila real: la página
// pública /r/<código> (quién invita, oculto o no, código inexistente, CSP) y la pantalla AFILIADOS
// de la ventana con el código y el enlace del servidor. Capturas: invite, invite-en,
// invite-missing, menu-referral y menu-referral-en.
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Browser, Page } from '@playwright/test'
import { API_ROUTES, PROTOCOL_VERSION, referralResponseSchema } from '@vibe-gambling/shared'

import { freshLogin, linkUrl, screens, shot } from './support.ts'
import type { Hooks } from './support.ts'

const login = `e2e-${process.env.E2E_RUN_ID}`

async function referralOf(request: APIRequestContext, token: string) {
  const res = await request.get(API_ROUTES.referral.path, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(res.ok()).toBe(true)
  return referralResponseSchema.parse(await res.json()).referral
}

async function setHidden(request: APIRequestContext, token: string, hidden: boolean) {
  const res = await request.post(API_ROUTES.settings.path, {
    headers: { authorization: `Bearer ${token}` },
    data: { v: PROTOCOL_VERSION, hidden },
  })
  expect(res.ok()).toBe(true)
}

/** Página nueva en un idioma, que falla el test si la CSP bloquea algo o hay errores. */
async function pageIn(browser: Browser, locale: string) {
  const context = await browser.newContext({ locale, viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const problems: string[] = []
  page.on('console', m => {
    if (m.type() === 'error') problems.push(m.text())
  })
  page.on('pageerror', e => problems.push(String(e)))
  return { context, page, problems }
}

test('página /r/<código>: quién invita, oculto, inexistente y CSP', async ({
  browser,
  request,
}) => {
  const token = await freshLogin(request)
  const referral = await referralOf(request, token)
  expect(referral.url).toMatch(new RegExp(`/r/${referral.code}$`))

  const es = await pageIn(browser, 'es-ES')
  const res = await es.page.goto(new URL(referral.url).pathname)
  expect(res?.status()).toBe(200)
  const csp = res?.headers()['content-security-policy'] ?? ''
  expect(csp).toContain("script-src 'self'")
  expect(csp).not.toContain('unsafe-inline')
  await expect(es.page.locator('#invite-who')).toHaveText(`@${login} te ha invitado`)
  await expect(es.page.locator('#invite-redeem')).toHaveText(`/vibe-redeem ${referral.code}`)
  await expect(es.page.locator('#invite-avatar')).toBeVisible()
  await expect(es.page).toHaveTitle(/Te han invitado/)
  await es.page.waitForTimeout(300)
  await shot(es.page, 'invite', true)

  // En minúsculas y con guion también vale (la página normaliza el código de la URL).
  const lower = `${referral.code.slice(0, 4).toLowerCase()}-${referral.code.slice(4)}`
  await es.page.goto(`/r/${lower}`)
  await expect(es.page.locator('#invite-redeem')).toHaveText(`/vibe-redeem ${referral.code}`)

  // Oculto del ranking: la página no dice quién es.
  await setHidden(request, token, true)
  await es.page.goto(new URL(referral.url).pathname)
  await expect(es.page.locator('#invite-who')).toHaveText('Alguien te ha invitado')
  await expect(es.page.locator('#invite-avatar')).toBeHidden()
  expect(await es.page.content()).not.toContain(login)
  await setHidden(request, token, false)

  // Código que no existe: el mismo aviso amable, sin paso de canje.
  await es.page.goto('/r/ZZZZ9999')
  await expect(es.page.locator('#invite-state')).toContainText('no existe')
  await expect(es.page.locator('#invite-redeem-step')).toBeHidden()
  await expect(es.page.locator('#invite-install')).not.toBeEmpty()
  await shot(es.page, 'invite-missing', true)
  expect(es.problems).toEqual([])
  await es.context.close()

  const en = await pageIn(browser, 'en-GB')
  await en.page.goto(new URL(referral.url).pathname)
  await expect(en.page.locator('#invite-who')).toHaveText(`@${login} invited you`)
  await en.page.waitForTimeout(300)
  await shot(en.page, 'invite-en', true)
  expect(en.problems).toEqual([])
  await en.context.close()
})

async function waitScreen(page: Page, id: string) {
  await page.waitForFunction(
    s => (window as unknown as { __vg?: Hooks }).__vg?.screens().includes(s) ?? false,
    id,
  )
}

/** Ventana del juego con sesión, en un idioma. */
async function windowIn(
  browser: Browser,
  request: APIRequestContext,
  token: string,
  locale: string,
) {
  const context = await browser.newContext({ locale, viewport: { width: 960, height: 720 } })
  const page = await context.newPage()
  await page.addInitScript(() => localStorage.setItem('vibe-gambling:tip-seen', '1'))
  await page.goto(`${await linkUrl(request, token)}&noboot&nogpuwarn`)
  await page.waitForFunction(
    () => ((window as unknown as { __vg?: Hooks }).__vg?.state().user ?? null) !== null,
  )
  if ((await screens(page)).includes('pendingNotice')) await page.keyboard.press('o')
  return { context, page }
}

/** START → AFILIADOS (la última de la fila de arriba: ← desde CONTINUAR). */
async function openReferral(page: Page) {
  await page.keyboard.press('p')
  await waitScreen(page, 'menu')
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(1300)
  await page.keyboard.press('x')
  await waitScreen(page, 'referral')
}

test('pantalla AFILIADOS con el código y el enlace del servidor', async ({ browser, request }) => {
  const token = await freshLogin(request)
  const referral = await referralOf(request, token)

  const es = await windowIn(browser, request, token, 'es-ES')
  // La rejilla con AFILIADOS elegida: su icono 3D y su texto.
  await es.page.keyboard.press('p')
  await waitScreen(es.page, 'menu')
  await es.page.keyboard.press('ArrowLeft')
  await expect(es.page.locator('#live')).toContainText('AFILIADOS')
  await es.page.waitForTimeout(1300)
  await shot(es.page, 'menu-main-referral')
  await es.page.keyboard.press('o')
  await es.page.waitForTimeout(300)

  await openReferral(es.page)
  await expect(es.page.locator('#live')).toContainText(
    `Tu código ${referral.code}. 0 invitados, 0 activados, 0 monedas ganadas.`,
  )
  await es.page.waitForTimeout(1300)
  await shot(es.page, 'menu-referral')
  await es.context.close()

  const en = await windowIn(browser, request, token, 'en-GB')
  await openReferral(en.page)
  await expect(en.page.locator('#live')).toContainText(`Your code ${referral.code}.`)
  await en.page.waitForTimeout(1300)
  await shot(en.page, 'menu-referral-en')
  await en.context.close()
})
