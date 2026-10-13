// SPDX-License-Identifier: AGPL-3.0-or-later
// Landing pública: presentación, instalación en un comando, ranking de la temporada (los más
// arruinados como estrella), Salón de la Ruina y pie. La ruleta PSX en vivo se carga aparte.
// Primero de todo: zod sin `new Function` (CSP sin 'unsafe-eval'), ver zodJitless.ts.
import './zodJitless.ts'
import './styles/landing.css'

import type {
  HallOfRuinResponse,
  LeaderboardBoard,
  LeaderboardResponse,
  WebConfig,
} from '@vibe-gambling/shared'

import { clientConfig, loadWebConfig } from './config.ts'
import type { Translator } from './i18n/index.ts'
import { newAccountsRule } from './game/newAccount.ts'
import { fetchHallOfRuin, fetchLeaderboard } from './net/api.ts'
import { applyI18n, el, externalLink, renderFooter, withLanguage } from './pages/common.ts'
import { webUrl } from './net/urls.ts'
import { hasWebGL2 } from './render/pipeline.ts'

interface BoardState {
  board: LeaderboardBoard
  season: string | undefined
  data: LeaderboardResponse | null
  error: boolean
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

function streakText(s: number): string {
  return s > 0 ? `▲${s}` : s < 0 ? `▼${-s}` : '–'
}

function avatar(url: string): HTMLImageElement {
  const src = webUrl(url)
  const img = el('img', {
    // Sin URL válida no se pide nada: queda el hueco del avatar roto.
    ...(src ? { src } : {}),
    alt: '',
    width: '32',
    height: '32',
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    class: 'avatar',
  })
  if (!src) img.classList.add('broken')
  img.addEventListener('error', () => img.classList.add('broken'))
  return img
}

function renderBoard(state: BoardState, tr: Translator): void {
  const titleKey = `landing.lb.title.${state.board}` as const
  $('board-title').textContent = tr.t(titleKey)
  document.querySelectorAll<HTMLButtonElement>('[data-board]').forEach(b => {
    // Botones de alternar (no pestañas ARIA: no hay paneles ni navegación con flechas).
    b.setAttribute('aria-pressed', String(b.dataset.board === state.board))
  })
  const tbody = $('board-rows')
  const status = $('board-state')
  tbody.replaceChildren()
  if (state.error) {
    status.textContent = tr.t('landing.lb.error')
    return
  }
  if (!state.data) {
    status.textContent = tr.t('landing.lb.loading')
    return
  }
  const data = state.data
  $('board-kicker').textContent = tr.t('landing.lb.kicker', {
    season: data.season,
    players: tr.n(data.players),
  })
  const select = $('season') as HTMLSelectElement
  select.replaceChildren(...data.seasons.map(s => el('option', { value: s }, s)))
  select.value = data.season
  status.textContent = data.rows.length === 0 ? tr.t('landing.lb.empty') : ''
  for (const row of data.rows) {
    const tr_ = el('tr', row.rank === 1 ? { class: 'top' } : {})
    const who = el('td')
    const inner = el('span', { class: 'who' })
    inner.append(avatar(row.avatarUrl), externalLink(row.profileUrl, row.login))
    who.append(inner)
    const net = el(
      'td',
      { class: `num-col ${row.netWorth < 0 ? 'loss' : 'win'}` },
      tr.n(row.netWorth),
    )
    const streak = el(
      'td',
      {
        class: `num-col ${row.currentStreak > 0 ? 'win' : row.currentStreak < 0 ? 'loss' : 'muted'}`,
      },
      streakText(row.currentStreak),
    )
    tr_.append(
      el('td', { class: 'rank' }, String(row.rank)),
      who,
      net,
      el('td', { class: 'num-col' }, tr.n(row.spins)),
      streak,
    )
    tbody.append(tr_)
  }
}

/** Regla antiabuso junto al ranking: las cuentas de GitHub nuevas salen al cumplir N días. */
function renderNewAccountsNote(web: WebConfig, tr: Translator): void {
  const note = $('board-note')
  const text = newAccountsRule(web.game.minAccountAgeDays, tr)
  note.hidden = text === null
  note.textContent = text ?? ''
}

function renderHall(hall: HallOfRuinResponse | null, failed: boolean, tr: Translator): void {
  $('hall-lede').textContent = tr.t('landing.hall.lede')
  const root = $('hall-seasons')
  const state = $('hall-state')
  root.replaceChildren()
  if (failed) {
    state.textContent = tr.t('landing.lb.error')
    return
  }
  if (!hall) {
    state.textContent = tr.t('landing.lb.loading')
    return
  }
  state.textContent = hall.seasons.length === 0 ? tr.t('landing.hall.empty') : ''
  for (const season of hall.seasons) {
    const card = el('article', { class: 'hall-card' })
    card.append(el('h3', {}, tr.t('landing.hall.season', { season: season.seasonId })))
    const list = el('ol')
    for (const row of season.rows) {
      const item = el('li')
      item.append(
        el('span', { class: 'rank' }, String(row.rank)),
        avatar(row.avatarUrl),
        externalLink(row.profileUrl, row.login),
        el('span', { class: 'loss num-col' }, tr.n(row.netWorth)),
      )
      list.append(item)
    }
    card.append(list)
    root.append(card)
  }
}

async function startAttract(
  tr: Translator,
): Promise<{ setTranslator(tr: Translator): void } | null> {
  const canvas = $<HTMLCanvasElement>('attract')
  const still = $<HTMLImageElement>('attract-still')
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || !hasWebGL2()) {
    canvas.hidden = true
    still.hidden = false
    return null
  }
  try {
    const { startAttractMode } = await import('./app/attract.ts')
    return startAttractMode(canvas, tr)
  } catch (error) {
    console.warn('[landing] sin ruleta en vivo', error)
    canvas.hidden = true
    still.hidden = false
    return null
  }
}

async function main(): Promise<void> {
  const web: WebConfig = await loadWebConfig()
  const board: BoardState = { board: 'broke', season: undefined, data: null, error: false }
  let hall: HallOfRuinResponse | null = null
  let hallFailed = false
  let tr: Translator | null = null

  const loadBoard = () => {
    board.data = null
    board.error = false
    if (tr) renderBoard(board, tr)
    const request = { ...board }
    fetchLeaderboard({
      board: request.board,
      season: request.season,
      limit: clientConfig.leaderboard.pageLimit,
    }).then(
      data => {
        if (request.board !== board.board || request.season !== board.season) return
        board.data = data
        if (tr) renderBoard(board, tr)
      },
      (error: unknown) => {
        console.warn('[landing] ranking no disponible', error)
        board.error = true
        if (tr) renderBoard(board, tr)
      },
    )
  }

  document.querySelectorAll<HTMLButtonElement>('[data-board]').forEach(button => {
    button.addEventListener('click', () => {
      board.board = button.dataset.board as LeaderboardBoard
      loadBoard()
    })
  })
  $('season').addEventListener('change', e => {
    board.season = (e.target as HTMLSelectElement).value
    loadBoard()
  })
  const copy = $<HTMLButtonElement>('copy')
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(web.site.installCommand).then(
      () => {
        if (!tr) return
        copy.textContent = tr.t('landing.copied')
        setTimeout(() => tr && (copy.textContent = tr.t('landing.copy')), clientConfig.ui.toastMs)
      },
      (error: unknown) => console.warn('[landing] no se pudo copiar', error),
    )
  })

  let attract: { setTranslator(tr: Translator): void } | null = null
  await withLanguage(next => {
    tr = next
    attract?.setTranslator(next)
    applyI18n(document, next)
    document.title = next.t('landing.title')
    $('install-command').textContent = web.site.installCommand
    $('how-3').textContent = next.t('landing.how.3', { apr: next.n(web.game.loan.displayApr) })
    renderNewAccountsNote(web, next)
    renderBoard(board, next)
    renderHall(hall, hallFailed, next)
    renderFooter($('footer'), web, next)
  })

  loadBoard()
  fetchHallOfRuin().then(
    data => {
      hall = data
      if (tr) renderHall(hall, false, tr)
    },
    (error: unknown) => {
      console.warn('[landing] salón de la ruina no disponible', error)
      hallFailed = true
      if (tr) renderHall(null, true, tr)
    },
  )
  if (tr) {
    startAttract(tr).then(
      handle => (attract = handle),
      (error: unknown) => console.warn('[landing] sin ruleta en vivo', error),
    )
  }
}

main().catch((error: unknown) => {
  console.error('[landing] error al arrancar', error)
  const status = document.getElementById('board-state')
  if (status) status.textContent = String(error)
})
