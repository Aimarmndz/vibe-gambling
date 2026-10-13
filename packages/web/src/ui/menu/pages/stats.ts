// SPDX-License-Identifier: AGPL-3.0-or-later
// ESTADÍSTICAS (`menu-stats.png`): gráfica pixel del patrimonio de la temporada con los préstamos
// marcados, número que más ha salido, mayor premio, tiradas y las últimas 18. Los datos los da el
// servidor (`stats.request`); ←→ cambia de temporada.
import type { SeasonStats } from '@vibe-gambling/shared'

import type { ActionEvent } from '../../../app/input.ts'
import { drawText, measure } from '../../../font/bitmap.ts'
import { ProgressError } from '../../../net/progress.ts'
import { drawWindow, fillCircle } from '../../draw.ts'
import { PALETTE, pocketHex } from '../../palette.ts'
import { chartGeometry, stepYAt } from '../format.ts'
import type { ChartGeometry } from '../format.ts'
import { SECONDARY } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'

/** Área de trazado de la gráfica y su escala mínima (±, monedas). */
export const PLOT = Object.freeze({ x: 16, y: 48, w: 280, h: 70 })
const MIN_HALF_RANGE = 500
const RECENT_CELLS = 18

/** outCubic: la línea se dibuja deprisa y frena al final. */
export function outCubic(k: number): number {
  const c = Math.max(0, Math.min(1, k))
  return 1 - (1 - c) ** 3
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; stats: SeasonStats; chart: ChartGeometry; at: number }

export class StatsPage implements MenuPage {
  readonly id = 'stats'
  readonly icon = 'bars' as const
  private readonly host: MenuHost
  private load: Load = { kind: 'loading' }
  private request = 0
  private seasons: readonly string[] = []
  private season: string | undefined
  private time = 0
  /** Carga aplazada hasta que caiga la bola (el servidor ya conoce el resultado). */
  private deferred = false

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  title(): string {
    return this.ctx.tr.t('stats.title')
  }

  headerRight(): string | undefined {
    const season = this.season ?? this.ctx.state().shown?.seasonId
    if (!season) return undefined
    const text = this.ctx.tr.t('mc.season', { season })
    return this.seasons.length > 1 ? `◄ ${text} ►` : text
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    const items: HelpItem[] = []
    if (this.seasons.length > 1) items.push({ key: '←→', label: tr.t('stats.season') })
    items.push({ key: this.ctx.buttons().o, label: tr.t('help.back') })
    return items
  }

  enter(t: number): void {
    this.time = t
    if (this.load.kind !== 'ready') this.fetch()
  }

  private fetch(): void {
    const id = ++this.request
    this.load = { kind: 'loading' }
    // Mientras cae la bola, las estadísticas destriparían el resultado: se espera.
    if (this.ctx.state().phase === 'landing') {
      this.deferred = true
      return
    }
    this.deferred = false
    this.ctx.progress('stats', this.season).then(
      stats => {
        if (id !== this.request) return
        // Pedidas antes de que el servidor resolviera la ronda, pero llegadas con la bola cayendo:
        // podrían traerla ya. Se descartan y se vuelven a pedir cuando caiga.
        if (this.ctx.state().phase === 'landing') {
          this.deferred = true
          return
        }
        this.seasons = stats.seasons
        this.season = stats.seasonId
        this.load = {
          kind: 'ready',
          stats,
          chart: chartGeometry(stats, PLOT, MIN_HALF_RANGE),
          at: this.time,
        }
        this.ctx.announce(this.summary(stats))
      },
      (error: unknown) => {
        if (id !== this.request) return
        console.warn('[estadísticas] no se pudieron cargar', error)
        this.load = { kind: 'error' }
        if (error instanceof ProgressError) this.ctx.announce(this.ctx.tr.t('stats.error'))
      },
    )
  }

  /** Resumen para `aria-live`. */
  summary(stats: SeasonStats): string {
    const { tr } = this.ctx
    const parts = [
      tr.plural('stats.a11y', stats.spins, {
        season: stats.seasonId,
        spins: tr.n(stats.spins),
        peak: tr.signed(stats.peakNetWorth),
        low: tr.signed(stats.lowestNetWorth),
      }),
    ]
    if (stats.mostFrequent) {
      parts.push(
        tr.plural('stats.a11yFrequent', stats.mostFrequent.count, {
          number: stats.mostFrequent.result,
          n: tr.n(stats.mostFrequent.count),
        }),
      )
    }
    if (stats.biggestWin) {
      parts.push(tr.t('stats.a11yBiggest', { net: tr.signed(stats.biggestWin.net) }))
    }
    return parts.join(' ')
  }

  private switchSeason(dir: number): void {
    if (this.seasons.length < 2) return
    const i = this.seasons.indexOf(this.season ?? '')
    // ← va a la anterior (más antigua: la lista va de la más reciente a la más antigua).
    const next = this.seasons[Math.max(0, Math.min(this.seasons.length - 1, i - dir))]
    if (!next || next === this.season) return
    this.season = next
    this.ctx.sfx.play('move')
    this.fetch()
  }

  action(e: ActionEvent): boolean {
    if (e.action === 'left' || e.action === 'right') {
      this.switchSeason(e.action === 'left' ? -1 : 1)
      return true
    }
    return false
  }

  update(_dt: number, t: number): void {
    this.time = t
    if (this.deferred && this.ctx.state().phase !== 'landing') this.fetch()
  }

  draw(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    // Con el ratón: ◄ y ► de la cabecera cambian de temporada.
    const header = this.headerRight()
    if (header && this.seasons.length > 1) {
      const left = 314 - measure(header)
      this.ctx.hits.add({
        x: left - 3,
        y: 0,
        w: 12,
        h: 20,
        id: 'stats:prev',
        onClick: () => this.switchSeason(-1),
      })
      this.ctx.hits.add({
        x: 305,
        y: 0,
        w: 15,
        h: 20,
        id: 'stats:next',
        onClick: () => this.switchSeason(1),
      })
    }
    drawWindow(g, 8, 28, 304, 98)
    drawText(g, tr.t('stats.netWorth'), 16, 37, { color: PALETTE.cream, shadow: PALETTE.ink })
    if (this.load.kind !== 'ready') {
      const text = this.load.kind === 'error' ? tr.t('stats.error') : tr.t('lb.loading')
      if (this.load.kind === 'error' || this.host.still || Math.floor(t * 2) % 2 === 0) {
        drawText(g, text, 160, 80, {
          color: this.load.kind === 'error' ? PALETTE.loss : PALETTE.cream,
          align: 'center',
          shadow: PALETTE.ink,
        })
      }
      return
    }
    const { stats, chart } = this.load
    drawText(g, tr.t('stats.peak', { value: tr.signed(stats.peakNetWorth) }), 304, 37, {
      color: PALETTE.cream,
      align: 'right',
      shadow: PALETTE.ink,
    })
    const k = this.host.still
      ? 1
      : outCubic(((t - this.load.at) * 1000) / Math.max(1, this.ctx.client.menu.chartDrawMs))
    this.drawChart(g, stats, chart, k)
    this.drawCards(g, stats)
    this.drawRecent(g, stats)
  }

  private drawChart(
    g: CanvasRenderingContext2D,
    stats: SeasonStats,
    chart: ChartGeometry,
    progress: number,
  ): void {
    const { tr } = this.ctx
    const right = PLOT.x + Math.round((PLOT.w - 1) * progress)
    // Relleno al 35 %: verde sobre el cero, rojo por debajo.
    g.globalAlpha = 0.35
    for (let x = PLOT.x; x <= right; x++) {
      const y = stepYAt(chart.points, x)
      if (y === null || y === chart.zeroY) continue
      g.fillStyle = y < chart.zeroY ? PALETTE.win : PALETTE.loss
      const top = Math.min(y, chart.zeroY)
      g.fillRect(x, top, 1, Math.abs(chart.zeroY - y))
    }
    g.globalAlpha = 1
    // Cero discontinuo (2 sí, 2 no) y su etiqueta.
    g.fillStyle = PALETTE.cream
    for (let x = PLOT.x; x < PLOT.x + PLOT.w; x += 4) g.fillRect(x, chart.zeroY, 2, 1)
    drawText(g, '0', PLOT.x + 1, chart.zeroY - 9, { color: PALETTE.cream, shadow: PALETTE.ink })
    // Línea en escalón, oro, de 1 px.
    g.fillStyle = PALETTE.gold
    chart.points.forEach((p, i) => {
      if (p.x > right) return
      const next = chart.points[i + 1]
      const end = next ? Math.min(next.x, right) : p.x
      g.fillRect(p.x, p.y, end - p.x + 1, 1)
      if (next && next.x <= right) {
        g.fillRect(next.x, Math.min(p.y, next.y), 1, Math.abs(next.y - p.y) + 1)
      }
    })
    // ▼ en cada préstamo.
    for (const x of chart.loans) {
      if (x > right) continue
      const y = stepYAt(chart.points, x) ?? chart.zeroY
      drawText(g, '▼', x, Math.max(PLOT.y, y - 10), {
        color: PALETTE.cream,
        align: 'center',
        shadow: PALETTE.ink,
      })
    }
    // Leyenda en la fila del título (abajo la tapaba la línea cuando el patrimonio toca fondo).
    if (chart.loans.length > 0) {
      drawText(g, `▼ ${tr.t('stats.loan')}`, 172, 37, {
        color: PALETTE.cream,
        align: 'center',
        shadow: PALETTE.ink,
      })
    }
    // Punto oro y valor en la última tirada (cuando la línea llega).
    const last = chart.points[chart.points.length - 1]
    if (last && progress >= 1) {
      fillCircle(g, last.x, last.y, 2, PALETTE.gold)
      const above = last.y - 14 >= PLOT.y
      const label = tr.n(last.value)
      const ly = above ? last.y - 12 : last.y + 5
      // Sobre una caja de tinta: el valor se lee encima del relleno y de la línea.
      const lw = measure(label)
      g.fillStyle = PALETTE.ink
      g.fillRect(last.x - 6 - lw, ly - 2, lw + 4, 11)
      drawText(g, label, last.x - 4, ly, {
        color: last.value < 0 ? PALETTE.loss : PALETTE.win,
        align: 'right',
      })
    }
    if (stats.spins === 0) {
      drawText(g, tr.t('stats.noSpins'), 160, 66, {
        color: PALETTE.cream,
        align: 'center',
        shadow: PALETTE.ink,
      })
    }
  }

  private drawCards(g: CanvasRenderingContext2D, stats: SeasonStats): void {
    const { tr } = this.ctx
    const y = 129
    const cards = [8, 111, 214]
    for (const x of cards) drawWindow(g, x, y, 98, 48)
    const label = (x: number, text: string) =>
      drawText(g, text, x + 8, y + 7, { color: PALETTE.cream, shadow: PALETTE.ink })

    // MÁS REPETIDO.
    label(cards[0]!, tr.t('stats.mostFrequent'))
    const freq = stats.mostFrequent
    if (freq) {
      fillCircle(g, cards[0]! + 20, y + 31, 11, PALETTE.gold)
      fillCircle(g, cards[0]! + 20, y + 31, 10, pocketHex(freq.color))
      drawText(g, String(freq.result), cards[0]! + 21, y + 28, {
        color: PALETTE.cream,
        align: 'center',
        shadow: PALETTE.ink,
      })
      drawText(g, `×${tr.n(freq.count)}`, cards[0]! + 38, y + 19, {
        color: PALETTE.gold,
        scale: 2,
        shadow: PALETTE.ink,
      })
      drawText(g, tr.t('stats.times'), cards[0]! + 38, y + 37, { color: PALETTE.muted })
    } else {
      drawText(g, '—', cards[0]! + 49, y + 24, { color: PALETTE.muted, align: 'center' })
    }

    // MAYOR PREMIO.
    label(cards[1]!, tr.t('stats.biggestWin'))
    const big = stats.biggestWin
    if (big) {
      drawText(g, tr.signed(big.net), cards[1]! + 8, y + 19, {
        color: PALETTE.win,
        scale: 2,
        shadow: PALETTE.ink,
      })
      drawText(g, tr.t('stats.biggestWinOn', { number: big.result }), cards[1]! + 8, y + 37, {
        color: PALETTE.muted,
      })
    } else {
      drawText(g, tr.t('stats.noWins'), cards[1]! + 8, y + 24, { color: PALETTE.muted })
    }

    // TIRADAS.
    label(cards[2]!, tr.t('hud.spins'))
    drawText(g, tr.n(stats.spins), cards[2]! + 8, y + 19, {
      color: PALETTE.gold,
      scale: 2,
      shadow: PALETTE.ink,
    })
    drawText(g, tr.t('stats.bestStreak', { n: tr.n(stats.bestStreak) }), cards[2]! + 8, y + 37, {
      color: PALETTE.muted,
    })
  }

  private drawRecent(g: CanvasRenderingContext2D, stats: SeasonStats): void {
    const { tr } = this.ctx
    const recent = stats.recent.slice(0, RECENT_CELLS)
    drawWindow(g, 8, 180, 304, 37)
    drawText(g, tr.t('stats.recent', { n: tr.n(recent.length) }), 16, 188, {
      color: PALETTE.cream,
      shadow: PALETTE.ink,
    })
    drawText(g, tr.t('stats.newestLeft'), 304, 188, { color: SECONDARY, align: 'right' })
    recent.forEach((r, i) => {
      const x = 16 + i * 16
      const y = 199
      // Casilla de 15×13 con marco crema (oro la más reciente).
      g.fillStyle = i === 0 ? PALETTE.gold : PALETTE.cream
      g.fillRect(x, y, 15, 13)
      g.fillStyle = pocketHex(r.color)
      g.fillRect(x + 1, y + 1, 13, 11)
      drawText(g, String(r.result), x + 8, y + 3, { color: PALETTE.cream, align: 'center' })
    })
    if (recent.length === 0) {
      drawText(g, tr.t('stats.noSpins'), 160, 201, { color: PALETTE.muted, align: 'center' })
    }
  }
}
