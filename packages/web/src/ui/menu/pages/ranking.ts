// SPDX-License-Identifier: AGPL-3.0-or-later
// CLASIFICACIÓN (`menu-ranking.png`): pestañas ARRUINADOS · RICOS · ADICTOS · SALÓN DE LA RUINA,
// filas con el avatar de GitHub reducido a 12×12 con vecino más cercano (luego lo pasa por el
// dithering el compuesto) y tu fila con banda y esquinas. ✕ abre el perfil de la fila elegida.
import { LEADERBOARD_BOARDS } from '@vibe-gambling/shared'
import type { HallOfRuinResponse, LeaderboardResponse } from '@vibe-gambling/shared'

import type { ActionEvent } from '../../../app/input.ts'
import { drawText, measure } from '../../../font/bitmap.ts'
import { webUrl } from '../../../net/urls.ts'
import { drawWindow } from '../../draw.ts'
import { PALETTE } from '../../palette.ts'
import { SECONDARY, drawBand, drawCorners, drawWell, fit } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'

const AVATAR = 12
const avatars = new Map<string, HTMLCanvasElement | 'loading' | 'failed'>()

/** Avatar reducido a 12×12 con vecino más cercano (se carga una vez y se guarda en memoria). */
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
    g.imageSmoothingEnabled = false
    g.drawImage(img, 0, 0, AVATAR, AVATAR)
    avatars.set(url, canvas)
  }
  img.onerror = () => avatars.set(url, 'failed')
  const sized = new URL(safe)
  // El doble del tamaño en el framebuffer: GitHub sirve el avatar ya reducido y nítido.
  sized.searchParams.set('s', String(AVATAR * 2))
  img.src = sized.toString()
  return null
}

/** Las pestañas: los tres rankings de la temporada y el Salón de la Ruina. */
export const RANKING_TABS = [...LEADERBOARD_BOARDS, 'hall'] as const
export type RankingTab = (typeof RANKING_TABS)[number]

/** Una fila ya lista para pintar. */
interface Row {
  rank: number
  login: string
  avatarUrl: string
  profileUrl: string
  netWorth: number
  spins: number
  streak: number | null
}

const LIST = Object.freeze({ x: 8, y: 43, w: 304, h: 173 })
const ROW_H = 15
/** Filas que caben en la lista. */
const FIT_ROWS = 10

export class RankingPage implements MenuPage {
  readonly id = 'leaderboard'
  readonly icon = 'crown' as const
  private readonly host: MenuHost
  private tab: RankingTab = 'broke'
  private board: LeaderboardResponse | null = null
  private hall: HallOfRuinResponse | null = null
  private error = false
  private request = 0
  private index = -1
  /** Puesto propio en ARRUINADOS (para enseñar tu fila aunque no estés entre los 10). */
  private rank: number | null = null
  private rankLoaded = false
  /** Carga aplazada hasta que caiga la bola (para no destripar el resultado). */
  private deferred = false

  constructor(host: MenuHost) {
    this.host = host
    this.load()
  }

  private get ctx() {
    return this.host.ctx
  }

  title(): string {
    return this.ctx.tr.t('lb.title')
  }

  headerRight(): string | undefined {
    const { tr } = this.ctx
    if (this.tab === 'hall') {
      const season = this.hall?.seasons[0]?.seasonId
      return season ? tr.t('mc.season', { season }) : undefined
    }
    if (!this.board) return undefined
    return tr.t('lb.season', { season: this.board.season, players: tr.n(this.board.players) })
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    const b = this.ctx.buttons()
    return [
      { key: '←→', label: tr.t('lb.tab') },
      { key: '↑↓', label: tr.t('help.move') },
      { key: b.x, label: tr.t('lb.profile') },
      { key: b.o, label: tr.t('help.back') },
    ]
  }

  /**
   * Mientras cae la bola el servidor ya conoce el resultado: el ranking (y el puesto propio) lo
   * reflejaría antes de revealAt. Se espera a que termine la caída.
   */
  private load(): void {
    const id = ++this.request
    this.board = null
    this.error = false
    this.index = -1
    if (this.ctx.state().phase === 'landing') {
      this.deferred = true
      return
    }
    this.deferred = false
    if (!this.rankLoaded) {
      this.rankLoaded = true
      this.ctx.brokeRank().then(
        rank => {
          // Con la bola cayendo, el puesto ya contaría la ronda: se vuelve a pedir al caer.
          if (this.ctx.state().phase === 'landing') {
            this.rankLoaded = false
            this.deferred = true
            return
          }
          this.rank = rank
        },
        (error: unknown) => console.warn('[ranking] sin puesto propio', error),
      )
    }
    const fail = (error: unknown) => {
      console.warn('[ranking] no se pudo cargar', error)
      if (id === this.request) this.error = true
    }
    // Una respuesta que llega con la bola ya cayendo podría contar la ronda: se vuelve a pedir.
    const late = () => {
      if (this.ctx.state().phase !== 'landing') return false
      this.deferred = true
      return true
    }
    if (this.tab === 'hall') {
      this.ctx.hallOfRuin().then(hall => {
        if (id === this.request) this.hall = hall
      }, fail)
      return
    }
    this.ctx.leaderboard(this.tab, this.ctx.client.leaderboard.inGameLimit).then(data => {
      if (id !== this.request || late()) return
      this.board = data
      this.ctx.announce(this.summary())
    }, fail)
  }

  /** Filas que se enseñan: las que caben, sin pasar de las que se piden al servidor. */
  private get maxRows(): number {
    return Math.min(FIT_ROWS, this.ctx.client.leaderboard.inGameLimit)
  }

  private rows(): Row[] {
    if (this.tab === 'hall') {
      const season = this.hall?.seasons[0]
      return (season?.rows ?? []).map(r => ({ ...r, streak: null }))
    }
    const rows: Row[] = (this.board?.rows ?? [])
      .slice(0, this.maxRows)
      .map(r => ({ ...r, streak: r.currentStreak }))
    // En ARRUINADOS, si no sales entre los primeros, tu fila sustituye a la última.
    const user = this.ctx.state().user
    const w = this.ctx.state().shown
    if (
      this.tab === 'broke' &&
      this.rank !== null &&
      user &&
      w &&
      rows.length === this.maxRows &&
      !rows.some(r => r.login === user.login)
    ) {
      rows[this.maxRows - 1] = {
        rank: this.rank,
        login: user.login,
        avatarUrl: user.avatarUrl,
        profileUrl: user.profileUrl,
        netWorth: w.netWorth,
        spins: w.spins,
        streak: w.currentStreak,
      }
    }
    return rows
  }

  private loaded(): boolean {
    return this.tab === 'hall' ? this.hall !== null : this.board !== null
  }

  summary(): string {
    const { tr } = this.ctx
    const top = this.rows()[0]
    const tab = tr.t(`lb.board.${this.tab}`)
    return top ? tr.t('lb.a11y', { board: tab, login: top.login, net: tr.n(top.netWorth) }) : tab
  }

  private switchTab(dir: number): void {
    const n = RANKING_TABS.length
    this.tab = RANKING_TABS[(RANKING_TABS.indexOf(this.tab) + dir + n) % n]!
    this.ctx.sfx.play('move')
    this.load()
  }

  update(): void {
    if (this.deferred && this.ctx.state().phase !== 'landing') this.load()
  }

  action(e: ActionEvent): boolean {
    const rows = this.rows().slice(0, this.maxRows)
    switch (e.action) {
      case 'left':
      case 'right':
      case 'chip':
        this.switchTab(e.action === 'left' ? -1 : 1)
        return true
      case 'up':
      case 'down': {
        if (rows.length === 0) return true
        const next = Math.max(
          0,
          Math.min(rows.length - 1, this.index + (e.action === 'up' ? -1 : 1)),
        )
        if (next !== this.index) {
          this.index = next
          this.ctx.sfx.play('move')
          const row = rows[next]!
          this.ctx.announce(`${row.rank}. ${row.login}. ${this.ctx.tr.n(row.netWorth)}`)
        }
        return true
      }
      case 'accept': {
        const row = rows[this.index]
        if (row) this.ctx.openLink(row.profileUrl)
        return true
      }
      default:
        return false
    }
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    // Pestañas: la activa en oro con texto tinta; el resto, en pozos.
    let x = 8
    RANKING_TABS.forEach(tab => {
      const text = tr.t(`lb.tab.${tab}`)
      const w = measure(text) + 12
      const active = tab === this.tab
      if (active) {
        g.fillStyle = PALETTE.gold
        g.fillRect(x, 26, w, 13)
      } else drawWell(g, x, 26, w, 13)
      drawText(g, text, x + w / 2, 29, {
        color: active ? PALETTE.ink : PALETTE.cream,
        align: 'center',
      })
      this.ctx.hits.add({
        x,
        y: 26,
        w,
        h: 13,
        id: `lb:${tab}`,
        onClick: () => {
          if (tab !== this.tab)
            this.switchTab(RANKING_TABS.indexOf(tab) - RANKING_TABS.indexOf(this.tab))
        },
      })
      x += w + 4
    })

    drawWindow(g, LIST.x, LIST.y, LIST.w, LIST.h, { top: PALETTE.deepTop })
    const y0 = 51
    const hall = this.tab === 'hall'
    drawText(g, tr.t('lb.rank'), 16, y0, { color: SECONDARY })
    drawText(g, tr.t('lb.player'), 44, y0, { color: SECONDARY })
    drawText(g, tr.t('lb.netShort'), 232, y0, { color: SECONDARY, align: 'right' })
    drawText(g, tr.t('lb.spinsShort'), 266, y0, { color: SECONDARY, align: 'right' })
    if (!hall) drawText(g, tr.t('lb.streak'), 304, y0, { color: SECONDARY, align: 'right' })
    g.fillStyle = PALETTE.frameInner
    g.fillRect(14, y0 + 8, 292, 1)

    const rows = this.rows().slice(0, this.maxRows)
    if (this.error) {
      drawText(g, tr.t('lb.error'), 160, 120, { color: PALETTE.loss, align: 'center' })
      return
    }
    if (!this.loaded()) {
      if (this.host.still || Math.floor(t * 2) % 2 === 0) {
        drawText(g, tr.t('lb.loading'), 160, 120, { color: PALETTE.cream, align: 'center' })
      }
      return
    }
    if (rows.length === 0) {
      drawText(g, tr.t(hall ? 'lb.hallEmpty' : 'lb.empty'), 160, 120, {
        color: PALETTE.cream,
        align: 'center',
      })
      return
    }
    const me = this.ctx.state().user?.login
    // Sin elegir aún: empieza en tu fila (también si llega después, con tu puesto).
    if (this.index < 0) this.index = rows.findIndex(r => r.login === me)
    const hover = this.ctx.hoverId()
    rows.forEach((row, i) => {
      const y = y0 + 15 + i * ROW_H
      const id = `lb:row:${i}`
      if (hover === id) this.index = i
      const selected = i === this.index
      const isMe = row.login === me
      if (selected) drawBand(g, 12, y - 4, 296, ROW_H - 1)
      const nameColor = isMe ? PALETTE.gold : PALETTE.cream
      drawText(g, String(row.rank), 16, y, {
        color: row.rank <= 3 ? PALETTE.gold : PALETTE.cream,
        shadow: PALETTE.ink,
      })
      const img = avatar(row.avatarUrl)
      if (img) g.drawImage(img, 28, y - 3)
      else {
        g.fillStyle = PALETTE.line
        g.fillRect(28, y - 3, AVATAR, AVATAR)
        drawText(g, row.login.slice(0, 1).toUpperCase(), 34, y, {
          color: PALETTE.cream,
          align: 'center',
        })
      }
      const name = isMe ? tr.t('lb.me', { login: row.login }) : row.login
      drawText(g, fit(name, 140), 44, y, { color: nameColor, shadow: PALETTE.ink })
      // Sobre la banda azul el rojo no llega a 4,5:1: ahí el signo basta y va en crema.
      const negative = selected ? PALETTE.cream : PALETTE.loss
      const valueColor =
        this.tab === 'spins' ? PALETTE.cream : row.netWorth < 0 ? negative : PALETTE.win
      drawText(g, tr.n(row.netWorth), 232, y, {
        color: valueColor,
        align: 'right',
        shadow: PALETTE.ink,
      })
      drawText(g, tr.n(row.spins), 266, y, {
        color: PALETTE.cream,
        align: 'right',
        shadow: PALETTE.ink,
      })
      if (row.streak !== null) {
        const s = row.streak
        drawText(g, s > 0 ? `▲${s}` : s < 0 ? `▼${-s}` : '–', 304, y, {
          color: s > 0 ? PALETTE.win : s < 0 ? negative : selected ? PALETTE.cream : PALETTE.muted,
          align: 'right',
          shadow: PALETTE.ink,
        })
      }
      if (selected) drawCorners(g, 12, y - 4, 296, ROW_H - 1, this.host.cornerGap(t), 5, 2)
      this.ctx.hits.add({
        x: 12,
        y: y - 4,
        w: 296,
        h: ROW_H - 1,
        id,
        onClick: () => {
          this.index = i
          this.ctx.openLink(row.profileUrl)
        },
      })
    })
  }
}
