// SPDX-License-Identifier: AGPL-3.0-or-later
// Clasificación dentro de la ventana: arruinados, ricos y más tiradas de la temporada.
// Los avatares se reducen a 12×12 píxeles (muy de la época); si no cargan, se pinta la inicial.
import { LEADERBOARD_BOARDS } from '@vibe-gambling/shared'
import type { LeaderboardBoard, LeaderboardResponse } from '@vibe-gambling/shared'

import type { AppContext, Screen } from '../../app/context.ts'
import type { ActionEvent } from '../../app/input.ts'
import { drawText, measure } from '../../font/bitmap.ts'
import { dim, drawWindow } from '../draw.ts'
import { webUrl } from '../../net/urls.ts'
import { PALETTE } from '../palette.ts'

const AVATAR = 12
const avatars = new Map<string, HTMLCanvasElement | 'loading' | 'failed'>()

/** Avatar reducido a 12×12 (se carga una vez y se guarda en memoria). */
function avatar(url: string): HTMLCanvasElement | null {
  const cached = avatars.get(url)
  if (cached instanceof HTMLCanvasElement) return cached
  if (cached) return null
  const safe = webUrl(url)
  if (!safe) {
    avatars.set(url, 'failed')
    return null
  }
  avatars.set(url, 'loading')
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.referrerPolicy = 'no-referrer'
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = AVATAR
    const g = canvas.getContext('2d')
    if (!g) {
      avatars.set(url, 'failed')
      return
    }
    g.imageSmoothingEnabled = true
    g.drawImage(img, 0, 0, AVATAR, AVATAR)
    avatars.set(url, canvas)
  }
  img.onerror = () => avatars.set(url, 'failed')
  const sized = new URL(safe)
  sized.searchParams.set('s', '24')
  img.src = sized.toString()
  return null
}

function truncate(text: string, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text
  let out = text
  while (out.length > 1 && measure(`${out}…`) > maxWidth) out = out.slice(0, -1)
  return `${out}…`
}

export class LeaderboardScreen implements Screen {
  readonly id = 'leaderboard'
  readonly opaque = true
  private readonly ctx: AppContext
  private board: LeaderboardBoard = 'broke'
  private data: LeaderboardResponse | null = null
  private error = false
  private rank: number | null = null
  private request = 0

  /** Carga aplazada hasta que caiga la bola (para no destripar el resultado). */
  private deferred = false
  private rankLoaded = false

  constructor(ctx: AppContext) {
    this.ctx = ctx
    this.load()
  }

  /**
   * Mientras cae la bola el servidor ya conoce el resultado: el ranking (y el puesto propio) lo
   * reflejaría antes de revealAt. Se espera a que termine la caída.
   */
  private load(): void {
    const id = ++this.request
    this.data = null
    this.error = false
    if (this.ctx.state().phase === 'landing') {
      this.deferred = true
      return
    }
    this.deferred = false
    if (!this.rankLoaded) {
      this.rankLoaded = true
      this.ctx.brokeRank().then(
        rank => (this.rank = rank),
        (error: unknown) => console.warn('[ranking] sin puesto propio', error),
      )
    }
    this.ctx.leaderboard(this.board, this.ctx.client.leaderboard.inGameLimit).then(
      data => {
        if (id === this.request) this.data = data
      },
      (error: unknown) => {
        console.warn('[ranking] no se pudo cargar', error)
        if (id === this.request) this.error = true
      },
    )
  }

  private switchBoard(dir: number): void {
    const i = LEADERBOARD_BOARDS.indexOf(this.board)
    const n = LEADERBOARD_BOARDS.length
    this.board = LEADERBOARD_BOARDS[(i + dir + n) % n]!
    this.ctx.sfx.play('move')
    this.load()
  }

  update(): void {
    if (this.deferred && this.ctx.state().phase !== 'landing') this.load()
  }

  action(e: ActionEvent): void {
    if (e.action === 'left' || e.action === 'right' || e.action === 'chip') {
      this.switchBoard(e.action === 'left' ? -1 : 1)
      return
    }
    if (e.action === 'back' || e.action === 'start' || e.action === 'accept') {
      this.ctx.sfx.play('back')
      this.ctx.pop(this)
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    dim(g, 0.75)
    drawWindow(g, 6, 6, 308, 228)
    drawText(g, tr.t('lb.title'), 160, 13, { color: PALETTE.muted, align: 'center' })

    // Pestañas.
    const tabs = LEADERBOARD_BOARDS.map(b => tr.t(`lb.board.${b}`))
    const widths = tabs.map(text => measure(text) + 10)
    let x = 160 - (widths.reduce((a, b) => a + b, 0) + (tabs.length - 1) * 4) / 2
    LEADERBOARD_BOARDS.forEach((b, i) => {
      const active = b === this.board
      const w = widths[i]!
      if (active) {
        g.fillStyle = PALETTE.gold
        g.fillRect(x, 24, w, 12)
      }
      drawText(g, tabs[i]!, x + w / 2, 27, {
        color: active ? PALETTE.ink : PALETTE.cream,
        align: 'center',
      })
      this.ctx.hits.add({
        x,
        y: 24,
        w,
        h: 12,
        id: `lb:${b}`,
        onClick: () => {
          if (b !== this.board) this.switchBoard(i - LEADERBOARD_BOARDS.indexOf(this.board))
        },
      })
      x += w + 4
    })

    if (this.data) {
      drawText(
        g,
        tr.t('lb.season', { season: this.data.season, players: tr.n(this.data.players) }),
        160,
        42,
        { color: PALETTE.muted, align: 'center' },
      )
    }
    // Cabecera de columnas.
    const y0 = 56
    g.fillStyle = PALETTE.frameInner
    g.fillRect(14, y0 + 8, 292, 1)
    drawText(g, tr.t('lb.rank'), 16, y0, { color: PALETTE.muted })
    drawText(g, tr.t('lb.player'), 50, y0, { color: PALETTE.muted })
    const valueHeader = this.board === 'spins' ? tr.t('lb.spins') : tr.t('lb.net')
    drawText(g, valueHeader, 252, y0, { color: PALETTE.muted, align: 'right' })
    drawText(g, tr.t('lb.streak'), 304, y0, { color: PALETTE.muted, align: 'right' })

    if (this.error) {
      drawText(g, tr.t('lb.error'), 160, 110, { color: PALETTE.loss, align: 'center' })
    } else if (!this.data) {
      if (Math.floor(t * 2) % 2 === 0) {
        drawText(g, tr.t('lb.loading'), 160, 110, { color: PALETTE.muted, align: 'center' })
      }
    } else if (this.data.rows.length === 0) {
      drawText(g, tr.t('lb.empty'), 160, 110, { color: PALETTE.muted, align: 'center' })
    } else {
      const me = this.ctx.state().user?.login
      this.data.rows.slice(0, 10).forEach((row, i) => {
        const y = y0 + 14 + i * 14
        const isMe = row.login === me
        if (isMe) {
          g.fillStyle = 'rgba(242,193,78,0.25)'
          g.fillRect(12, y - 4, 296, 13)
        }
        const top = row.rank === 1
        drawText(g, String(row.rank), 16, y, { color: top ? PALETTE.gold : PALETTE.cream })
        const img = avatar(row.avatarUrl)
        if (img) g.drawImage(img, 34, y - 3)
        else {
          g.fillStyle = PALETTE.line
          g.fillRect(34, y - 3, AVATAR, AVATAR)
          drawText(g, row.login.slice(0, 1).toUpperCase(), 40, y, {
            color: PALETTE.cream,
            align: 'center',
          })
        }
        drawText(g, truncate(row.login, 120), 50, y, { color: isMe ? PALETTE.gold : PALETTE.cream })
        const value = this.board === 'spins' ? tr.n(row.spins) : tr.n(row.netWorth)
        const valueColor =
          this.board === 'spins' ? PALETTE.cream : row.netWorth < 0 ? PALETTE.loss : PALETTE.win
        drawText(g, value, 252, y, { color: valueColor, align: 'right' })
        const s = row.currentStreak
        drawText(g, s > 0 ? `▲${s}` : s < 0 ? `▼${-s}` : '–', 304, y, {
          color: s > 0 ? PALETTE.win : s < 0 ? PALETTE.loss : PALETTE.muted,
          align: 'right',
        })
      })
    }
    if (this.rank !== null) {
      drawText(g, tr.t('lb.you', { rank: this.rank }), 16, 212, { color: PALETTE.gold })
    }
    drawText(g, `${tr.t('lb.switch')}  ${this.ctx.buttons().o}`, 304, 212, {
      color: PALETTE.muted,
      align: 'right',
    })
  }
}
