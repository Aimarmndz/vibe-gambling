// SPDX-License-Identifier: AGPL-3.0-or-later
// TIENDA (.plan/13-objetos.md §4): tres pestañas que se cambian con ←→ (como el RANKING).
// - TIENDA: los consumibles y `git revert`, con precio, cargas, compras que quedan en la temporada
//   y la letra pequeña con su EV real (lo calcula shared: `finePrint`).
// - BOLSILLO: lo comprado, ✕ arma o desarma; `git revert` si hay algo que revertir; y el
//   Placebómetro (gastado frente a recuperado, % ganado con pata y sin ella, aciertos de la IA).
// - ARMARIO: tapetes y fichas con vista previa en miniatura; ✕ compra o se lo pone.
// Los datos llegan con `shop.request`; comprar es `shop.buy`, armar `item.arm` y vestirse
// `settings.update`. El servidor decide; aquí solo se pinta lo que responde.
import { CHIP_SKIN_IDS, FELT_IDS, cosmeticFor, isConsumable } from '@vibe-gambling/shared'
import type {
  ChipSkinId,
  ConsumableId,
  FeltId,
  Inventory,
  ItemId,
  Shop,
  ShopItem,
} from '@vibe-gambling/shared'

import type { ActionEvent } from '../../../app/input.ts'
import { drawText, measure, wrap } from '../../../font/bitmap.ts'
import {
  finePrintText,
  itemDesc,
  itemName,
  leftThisSeason,
  placeboLines,
  placeboVerdict,
  skinName,
} from '../../../game/shopView.ts'
import { CHIP_SKINS, FELT_SKINS, chipSkin, feltSkin } from '../../../render/skins.ts'
import { drawWindow } from '../../draw.ts'
import { drawItemIcon } from '../../itemIcons.ts'
import { PALETTE } from '../../palette.ts'
import { drawSkinPreview } from '../../skinPreview.ts'
import { SECONDARY, drawBand, drawCorners, drawWell, fit } from '../kit.ts'
import type { HelpItem } from '../kit.ts'
import type { MenuHost, MenuPage } from '../page.ts'

export const SHOP_TABS = ['shop', 'pocket', 'wardrobe'] as const
export type ShopTab = (typeof SHOP_TABS)[number]

/** Lista de la izquierda y ventana de detalle de la derecha. */
export const LIST = Object.freeze({ x: 8, y: 42, w: 132, h: 176, row: 15 })
export const DETAIL = Object.freeze({ x: 146, y: 42, w: 166, h: 176 })
/** Ancho del texto dentro de la ventana de detalle. */
const DETAIL_TEXT_W = DETAIL.w - 12
/** Días que quedan de temporada a partir de los cuales la tienda avisa de que todo caduca. */
const EXPIRY_WARNING_DAYS = 3

export type ShopRow =
  | { kind: 'heading'; text: string }
  | { kind: 'item'; item: ShopItem }
  | { kind: 'pocket'; id: ConsumableId; charges: number; armed: boolean }
  | { kind: 'revert'; refund: number; until: string }
  | { kind: 'skin'; slot: 'felt'; skin: FeltId }
  | { kind: 'skin'; slot: 'chips'; skin: ChipSkinId }

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; shop: Shop }

/** Identificador de petición de compra (idempotencia de los reintentos). */
function requestId(): string {
  return crypto.randomUUID()
}

export class ShopPage implements MenuPage {
  readonly id = 'shop'
  readonly icon = 'bag' as const
  private readonly host: MenuHost
  tab: ShopTab = 'shop'
  private readonly index: Record<ShopTab, number> = { shop: 0, pocket: 0, wardrobe: 0 }
  private load: Load = { kind: 'loading' }
  private request = 0
  /** Carga aplazada hasta que caiga la bola (el Placebómetro destriparía el resultado). */
  private deferred = false
  /** Último bolsillo visto en el estado: si cambia (compra, armado…), se vuelve a pedir. */
  private seen: Inventory | null = null

  constructor(host: MenuHost) {
    this.host = host
  }

  private get ctx() {
    return this.host.ctx
  }

  /** Lo que se ha cargado (para los tests E2E). */
  get shop(): Shop | null {
    return this.load.kind === 'ready' ? this.load.shop : null
  }

  title(): string {
    return this.ctx.tr.t('shop.title')
  }

  headerRight(): string | undefined {
    const w = this.ctx.state().shown
    return w ? this.ctx.tr.t('shop.header', { balance: this.ctx.tr.n(w.balance) }) : undefined
  }

  help(): HelpItem[] {
    const { tr } = this.ctx
    const b = this.ctx.buttons()
    const items: HelpItem[] = [
      { key: '←→', label: tr.t('shop.tabHelp') },
      { key: '↑↓', label: tr.t('help.move') },
    ]
    const label = this.actionLabel(this.selected())
    if (label) items.push({ key: b.x, label })
    items.push({ key: b.o, label: tr.t('help.back') })
    return items
  }

  enter(): void {
    this.seen = this.ctx.state().inventory
    this.fetch()
  }

  update(): void {
    const state = this.ctx.state()
    if (state.phase === 'landing') return
    if (this.deferred) {
      this.fetch()
      return
    }
    // El bolsillo ha cambiado (compra, armado, cargas gastadas): la tienda también.
    if (state.inventory !== this.seen) {
      this.seen = state.inventory
      this.fetch()
    }
  }

  private fetch(): void {
    const id = ++this.request
    if (this.ctx.state().phase === 'landing') {
      this.deferred = true
      return
    }
    this.deferred = false
    this.ctx.progress('shop').then(
      shop => {
        if (id !== this.request) return
        if (this.ctx.state().phase === 'landing') {
          this.deferred = true
          return
        }
        const first = this.load.kind !== 'ready'
        this.load = { kind: 'ready', shop }
        this.clamp()
        if (first) this.ctx.announce(this.describe())
      },
      (error: unknown) => {
        if (id !== this.request) return
        console.warn('[tienda] no se pudo cargar', error)
        this.load = { kind: 'error' }
        this.ctx.announce(this.ctx.tr.t('shop.error'))
      },
    )
  }

  // ---------------------------------------------------------------- filas

  /** Bolsillo que se enseña: el del estado (congelado con la bola cayendo) o el de la tienda. */
  inventory(): Inventory | null {
    return this.ctx.state().shownInventory ?? this.shop?.inventory ?? null
  }

  rows(tab: ShopTab = this.tab): ShopRow[] {
    const { tr } = this.ctx
    const shop = this.shop
    switch (tab) {
      case 'shop':
        return (shop?.items ?? [])
          .filter(item => item.kind !== 'cosmetic')
          .map(item => ({ kind: 'item', item }))
      case 'pocket': {
        const inv = this.inventory()
        const rows: ShopRow[] = (inv?.items ?? [])
          .filter(i => i.charges > 0)
          .map(i => ({ kind: 'pocket', id: i.id, charges: i.charges, armed: i.armed }))
        if (inv?.revert) {
          rows.push({ kind: 'revert', refund: inv.revert.refund, until: inv.revert.until })
        }
        return rows
      }
      case 'wardrobe':
        return [
          { kind: 'heading', text: tr.t('shop.wardrobe.felts') },
          ...FELT_IDS.map(skin => ({ kind: 'skin', slot: 'felt', skin }) as const),
          { kind: 'heading', text: tr.t('shop.wardrobe.chips') },
          ...CHIP_SKIN_IDS.map(skin => ({ kind: 'skin', slot: 'chips', skin }) as const),
        ]
    }
  }

  /** Índices de las filas que se pueden elegir (sin los títulos). */
  private selectable(tab: ShopTab = this.tab): number[] {
    return this.rows(tab).flatMap((r, i) => (r.kind === 'heading' ? [] : [i]))
  }

  private clamp(): void {
    for (const tab of SHOP_TABS) {
      const sel = this.selectable(tab)
      if (sel.length === 0) this.index[tab] = 0
      else if (!sel.includes(this.index[tab])) this.index[tab] = sel[0]!
    }
  }

  selected(): ShopRow | null {
    const rows = this.rows()
    const row = rows[this.index[this.tab]]
    return row && row.kind !== 'heading' ? row : null
  }

  /** Artículo de la tienda por id (precio, tope, si es tuyo). */
  private item(id: ItemId): ShopItem | null {
    return this.shop?.items.find(i => i.id === id) ?? null
  }

  private owns(slot: 'felt' | 'chips', skin: string): boolean {
    const inv = this.inventory()
    if (skin === 'classic') return true
    if (!inv) return false
    return slot === 'felt'
      ? (inv.cosmetics.felts as readonly string[]).includes(skin)
      : (inv.cosmetics.chips as readonly string[]).includes(skin)
  }

  private wearing(slot: 'felt' | 'chips', skin: string): boolean {
    const user = this.ctx.state().user
    const current = slot === 'felt' ? (user?.felt ?? 'classic') : (user?.chipSkin ?? 'classic')
    return current === skin
  }

  private balance(): number {
    return this.ctx.state().wallet?.balance ?? 0
  }

  /** Qué hace ✕ en esta fila (null: nada). */
  actionLabel(row: ShopRow | null): string | null {
    const { tr } = this.ctx
    if (!row) return null
    switch (row.kind) {
      case 'item': {
        if (leftThisSeason(row.item) === 0) return null
        if (row.item.price > this.balance())
          return this.shop?.canBorrow ? tr.t('shop.borrow') : null
        return row.item.id === 'revert' ? tr.t('shop.revert') : tr.t('shop.buy')
      }
      case 'pocket':
        return row.armed ? tr.t('shop.disarm') : tr.t('shop.arm')
      case 'revert':
        return tr.t('shop.revert')
      case 'skin': {
        if (this.wearing(row.slot, row.skin)) return null
        if (this.owns(row.slot, row.skin)) return tr.t('shop.equip')
        const id = cosmeticForRow(row)
        const item = id ? this.item(id) : null
        if (item && item.price > this.balance()) {
          return this.shop?.canBorrow ? tr.t('shop.borrow') : null
        }
        return tr.t('shop.buy')
      }
      case 'heading':
        return null
    }
  }

  // ---------------------------------------------------------------- acciones

  private buy(id: ItemId): void {
    const ok = this.ctx.send({ type: 'shop.buy', itemId: id, requestId: requestId() })
    this.ctx.sfx.play(ok ? 'accept' : 'error')
  }

  /** ✕ sobre la fila elegida. */
  accept(): void {
    const row = this.selected()
    const { ctx } = this
    if (!row || !this.actionLabel(row)) {
      ctx.sfx.play('error')
      return
    }
    switch (row.kind) {
      case 'item':
        if (row.item.price > this.balance()) {
          // "¿Financiamos tu pata de conejo?": a la ventanilla del banco.
          ctx.offerLoan()
          return
        }
        this.buy(row.item.id)
        return
      case 'pocket': {
        const armed = !row.armed
        const ok = ctx.send({ type: 'item.arm', itemId: row.id, armed })
        ctx.sfx.play(ok ? 'accept' : 'error')
        if (ok) {
          ctx.announce(
            ctx.tr.t(armed ? 'shop.armedOn' : 'shop.armedOff', {
              item: itemName(row.id, ctx.tr),
            }),
          )
        }
        return
      }
      case 'revert':
        this.buy('revert')
        return
      case 'skin': {
        if (this.owns(row.slot, row.skin)) {
          const ok = ctx.send(
            row.slot === 'felt'
              ? { type: 'settings.update', felt: row.skin }
              : { type: 'settings.update', chipSkin: row.skin },
          )
          ctx.sfx.play(ok ? 'accept' : 'error')
          return
        }
        const id = cosmeticForRow(row)
        if (!id) return
        const item = this.item(id)
        if (item && item.price > this.balance()) {
          ctx.offerLoan()
          return
        }
        this.buy(id)
        return
      }
      case 'heading':
        return
    }
  }

  private switchTab(dir: number): void {
    const n = SHOP_TABS.length
    this.tab = SHOP_TABS[(SHOP_TABS.indexOf(this.tab) + dir + n) % n]!
    this.clamp()
    this.ctx.sfx.play('move')
    this.ctx.announce(this.describe())
  }

  private move(dir: number): void {
    const sel = this.selectable()
    if (sel.length === 0) return
    const at = Math.max(0, sel.indexOf(this.index[this.tab]))
    const next = sel[(at + dir + sel.length) % sel.length]!
    if (next === this.index[this.tab]) return
    this.index[this.tab] = next
    this.ctx.sfx.play('move')
    this.ctx.announce(this.describeRow(this.selected()))
  }

  action(e: ActionEvent): boolean {
    switch (e.action) {
      case 'left':
      case 'right':
        this.switchTab(e.action === 'left' ? -1 : 1)
        return true
      case 'up':
      case 'down':
        this.move(e.action === 'up' ? -1 : 1)
        return true
      case 'accept':
        this.accept()
        return true
      default:
        return false
    }
  }

  wheel(delta: number): void {
    this.move(delta > 0 ? 1 : -1)
  }

  // ---------------------------------------------------------------- textos

  describe(): string {
    const { tr } = this.ctx
    const tab = tr.t(`shop.tab.${this.tab}`)
    const row = this.selected()
    if (this.tab === 'pocket' && !row) return `${tab}. ${tr.t('shop.pocket.empty')}`
    return `${tab}. ${this.describeRow(row)}`
  }

  describeRow(row: ShopRow | null): string {
    const { tr } = this.ctx
    if (!row) return ''
    switch (row.kind) {
      case 'item':
        return `${itemName(row.item.id, tr)}. ${tr.t('shop.price', {
          price: tr.n(row.item.price),
        })}. ${finePrintText(row.item, tr)}`
      case 'pocket':
        return `${itemName(row.id, tr)}. ${tr.plural('shop.charges', row.charges, {
          n: tr.n(row.charges),
        })}. ${row.armed ? tr.t('shop.armed') : ''}`
      case 'revert':
        return `${itemName('revert', tr)}. ${tr.t('shop.pocket.revertReady', {
          refund: tr.n(row.refund),
          time: this.time(row.until),
        })}`
      case 'skin':
        return `${skinName(row.slot, row.skin, tr)}. ${this.skinStatus(row)}`
      case 'heading':
        return row.text
    }
  }

  private time(iso: string): string {
    return new Intl.DateTimeFormat(this.ctx.tr.meta.bcp47, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  }

  private skinStatus(row: Extract<ShopRow, { kind: 'skin' }>): string {
    const { tr } = this.ctx
    if (this.wearing(row.slot, row.skin)) return tr.t('shop.equipped')
    if (row.skin === 'classic') return tr.t('shop.free')
    if (this.owns(row.slot, row.skin)) return tr.t('shop.owned')
    const id = cosmeticForRow(row)
    const item = id ? this.item(id) : null
    return item ? tr.t('shop.price', { price: tr.n(item.price) }) : ''
  }

  // ---------------------------------------------------------------- dibujo

  draw(g: CanvasRenderingContext2D, t: number): void {
    this.drawTabs(g)
    drawWindow(g, LIST.x, LIST.y, LIST.w, LIST.h, { top: PALETTE.deepTop })
    drawWindow(g, DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h)
    if (this.load.kind !== 'ready') {
      const failed = this.load.kind === 'error'
      if (failed || this.host.still || Math.floor(t * 2) % 2 === 0) {
        const text = failed ? this.ctx.tr.t('shop.error') : this.ctx.tr.t('lb.loading')
        wrap(text, LIST.w - 12).forEach((line, i) => {
          drawText(g, line, LIST.x + LIST.w / 2, LIST.y + 70 + i * 11, {
            color: failed ? PALETTE.loss : PALETTE.cream,
            align: 'center',
          })
        })
      }
      return
    }
    this.drawList(g, t)
    switch (this.tab) {
      case 'shop':
        this.drawItemDetail(g)
        return
      case 'pocket':
        this.drawPlacebometer(g)
        return
      case 'wardrobe':
        this.drawWardrobeDetail(g)
        return
    }
  }

  private drawTabs(g: CanvasRenderingContext2D): void {
    const { tr } = this.ctx
    let x = 8
    for (const tab of SHOP_TABS) {
      const text = tr.t(`shop.tab.${tab}`)
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
        id: `shop:tab:${tab}`,
        onClick: () => {
          if (tab !== this.tab) this.switchTab(SHOP_TABS.indexOf(tab) - SHOP_TABS.indexOf(this.tab))
        },
      })
      x += w + 4
    }
  }

  private drawList(g: CanvasRenderingContext2D, t: number): void {
    const { tr } = this.ctx
    const rows = this.rows()
    const selected = this.index[this.tab]
    const x = LIST.x + 4
    const w = LIST.w - 8
    let y = LIST.y + 5
    rows.forEach((row, i) => {
      const top = y
      if (row.kind === 'heading') {
        drawText(g, row.text, x + 2, top + 3, { color: SECONDARY })
        y += LIST.row
        return
      }
      const isSel = i === selected
      if (isSel) {
        drawBand(g, x, top, w, LIST.row - 2)
        drawCorners(g, x, top, w, LIST.row - 2, this.host.cornerGap(t), 4, 1)
      }
      this.drawRow(g, row, x, top, w)
      this.ctx.hits.add({
        x,
        y: top,
        w,
        h: LIST.row - 1,
        id: `shop:row:${this.tab}:${i}`,
        onClick: () => {
          if (this.index[this.tab] === i) this.accept()
          else {
            this.index[this.tab] = i
            this.ctx.sfx.play('move')
            this.ctx.announce(this.describeRow(row))
          }
        },
      })
      y += LIST.row
    })
    // Pie de la lista: lo que hay que saber de esa pestaña.
    const footer = this.footer()
    const lines = footer.flatMap(f => wrap(f.text, w - 4).map(text => ({ text, color: f.color })))
    let fy = Math.max(y + 4, LIST.y + LIST.h - 6 - lines.length * 10)
    for (const line of lines) {
      if (fy + 8 > LIST.y + LIST.h - 2) break
      drawText(g, line.text, x + 2, fy, { color: line.color })
      fy += 10
    }
    if (rows.length === 0 && this.tab === 'pocket') {
      wrap(tr.t('shop.pocket.empty'), w - 4).forEach((line, i) => {
        drawText(g, line, x + 2, LIST.y + 8 + i * 10, { color: PALETTE.cream })
      })
    }
  }

  /** Pie de la lista de cada pestaña. */
  footer(): { text: string; color: string }[] {
    const { tr } = this.ctx
    const shop = this.shop
    if (!shop) return []
    switch (this.tab) {
      case 'shop': {
        const out: { text: string; color: string }[] = []
        if (!shop.inventory.enabled) out.push({ text: tr.t('shop.closed'), color: PALETTE.loss })
        const days = Math.max(0, Math.ceil((Date.parse(shop.seasonEndsAt) - Date.now()) / 864e5))
        if (days <= EXPIRY_WARNING_DAYS) {
          out.push({
            text: tr.plural('shop.expires', days, { n: tr.n(days) }),
            color: PALETTE.loss,
          })
        }
        const cheapest = Math.min(
          ...shop.items.filter(i => i.kind === 'consumable').map(i => i.price),
        )
        if (this.balance() < cheapest) {
          out.push({
            text: shop.canBorrow ? tr.t('shop.finance') : tr.t('shop.poor'),
            color: PALETTE.gold,
          })
        }
        if (out.length === 0) out.push({ text: tr.t('shop.motto'), color: SECONDARY })
        return out
      }
      case 'pocket': {
        const inv = this.inventory()
        const armed = (inv?.items ?? []).filter(i => i.armed && i.charges > 0).length
        return [
          {
            text: tr.t('shop.pocket.armedCount', {
              n: tr.n(armed),
              max: tr.n(inv?.maxArmed ?? 0),
            }),
            color: PALETTE.gold,
          },
          { text: tr.t('shop.pocket.nextRound'), color: SECONDARY },
        ]
      }
      case 'wardrobe':
        return []
    }
  }

  private drawRow(g: CanvasRenderingContext2D, row: ShopRow, x: number, y: number, w: number) {
    const { tr } = this.ctx
    const right = x + w - 3
    const textY = y + 3
    switch (row.kind) {
      case 'item': {
        const out = leftThisSeason(row.item) === 0
        const poor = row.item.price > this.balance()
        drawItemIcon(g, row.item.id, x + 2, y + 2, { dim: out })
        const price = tr.n(row.item.price)
        const pw = measure(price)
        drawText(g, price, right, textY, {
          color: out ? SECONDARY : poor ? PALETTE.loss : PALETTE.gold,
          align: 'right',
          shadow: PALETTE.ink,
        })
        drawText(g, fit(itemName(row.item.id, tr), right - pw - 4 - (x + 14)), x + 14, textY, {
          color: out ? SECONDARY : PALETTE.cream,
          shadow: PALETTE.ink,
        })
        return
      }
      case 'pocket': {
        drawItemIcon(g, row.id, x + 2, y + 2)
        const count = `×${tr.n(row.charges)}`
        const cw = measure(count)
        drawText(g, count, right, textY, {
          color: row.armed ? PALETTE.gold : PALETTE.cream,
          align: 'right',
          shadow: PALETTE.ink,
        })
        // Casilla de armado: llena en oro si está armado.
        const bx = right - cw - 10
        g.fillStyle = PALETTE.frame
        g.fillRect(bx, y + 3, 7, 7)
        g.fillStyle = row.armed ? PALETTE.gold : PALETTE.ink
        g.fillRect(bx + 1, y + 4, 5, 5)
        drawText(g, fit(itemName(row.id, tr), bx - 4 - (x + 14)), x + 14, textY, {
          color: row.armed ? PALETTE.gold : PALETTE.cream,
          shadow: PALETTE.ink,
        })
        return
      }
      case 'revert': {
        drawItemIcon(g, 'revert', x + 2, y + 2)
        const refund = `+${tr.n(row.refund)}`
        const rw = measure(refund)
        drawText(g, refund, right, textY, {
          color: PALETTE.win,
          align: 'right',
          shadow: PALETTE.ink,
        })
        drawText(g, fit(itemName('revert', tr), right - rw - 4 - (x + 14)), x + 14, textY, {
          color: PALETTE.cream,
          shadow: PALETTE.ink,
        })
        return
      }
      case 'skin': {
        // Muestra de color: el paño del tapete o la ficha mayor del juego.
        const swatch =
          row.slot === 'felt' ? FELT_SKINS[row.skin].felt : CHIP_SKINS[row.skin].colors[1]!
        g.fillStyle = PALETTE.frame
        g.fillRect(x + 2, y + 2, 9, 9)
        g.fillStyle = swatch
        g.fillRect(x + 3, y + 3, 7, 7)
        const status = this.wearing(row.slot, row.skin)
          ? '►'
          : this.owns(row.slot, row.skin)
            ? ''
            : tr.n(this.item(cosmeticForRow(row)!)?.price ?? 0)
        const sw = status ? measure(status) : 0
        if (status) {
          drawText(g, status, right, textY, {
            color: status === '►' ? PALETTE.win : PALETTE.gold,
            align: 'right',
            shadow: PALETTE.ink,
          })
        }
        drawText(
          g,
          fit(skinName(row.slot, row.skin, tr), right - sw - (sw ? 8 : 4) - (x + 14)),
          x + 14,
          textY,
          {
            color: PALETTE.cream,
            shadow: PALETTE.ink,
          },
        )
        return
      }
      case 'heading':
        return
    }
  }

  /** Líneas de texto de la ventana de detalle, cortadas a lo que cabe. */
  private paragraphs(
    g: CanvasRenderingContext2D,
    blocks: { text: string; color: string; gap?: number }[],
    y0: number,
    bottom: number,
  ): number {
    let y = y0
    for (const block of blocks) {
      y += block.gap ?? 0
      for (const line of wrap(block.text, DETAIL_TEXT_W)) {
        if (y + 8 > bottom) return y
        drawText(g, line, DETAIL.x + 6, y, { color: block.color })
        y += 10
      }
    }
    return y
  }

  private drawActionLine(g: CanvasRenderingContext2D, label: string | null): number {
    const bottom = DETAIL.y + DETAIL.h - 14
    if (!label) return DETAIL.y + DETAIL.h - 4
    g.fillStyle = PALETTE.frameInner
    g.fillRect(DETAIL.x + 6, bottom - 3, DETAIL.w - 12, 1)
    const text = fit(`${this.ctx.buttons().x} ${label}`, DETAIL_TEXT_W)
    drawText(g, text, DETAIL.x + 6, bottom, { color: PALETTE.gold, shadow: PALETTE.ink })
    this.ctx.hits.add({
      x: DETAIL.x + 2,
      y: bottom - 3,
      w: DETAIL.w - 4,
      h: 13,
      id: 'shop:action',
      onClick: () => this.accept(),
    })
    return bottom - 5
  }

  private drawItemDetail(g: CanvasRenderingContext2D): void {
    const { tr } = this.ctx
    const row = this.selected()
    if (!row || row.kind !== 'item') return
    const item = row.item
    drawItemIcon(g, item.id, DETAIL.x + 6, DETAIL.y + 6, { scale: 2 })
    const nameLines = wrap(itemName(item.id, tr), DETAIL.w - 38)
    nameLines.slice(0, 2).forEach((line, i) => {
      drawText(g, line, DETAIL.x + 28, DETAIL.y + 6 + i * 10, {
        color: PALETTE.gold,
        shadow: PALETTE.ink,
      })
    })
    const left = leftThisSeason(item)
    const facts = [
      tr.t('shop.price', { price: tr.n(item.price) }) +
        (item.charges > 0
          ? ` · ${tr.plural('shop.charges', item.charges, { n: tr.n(item.charges) })}`
          : ''),
      item.id === 'revert'
        ? tr.t('shop.instant')
        : left === null
          ? tr.t('shop.permanent')
          : left === 0
            ? tr.t('shop.soldOut')
            : tr.t('shop.left', { n: tr.n(left), max: tr.n(item.maxPerSeason ?? 0) }),
    ]
    const bottom = this.drawActionLine(g, this.actionLabel(row))
    this.paragraphs(
      g,
      [
        { text: facts[0]!, color: PALETTE.cream },
        { text: facts[1]!, color: left === 0 ? PALETTE.loss : SECONDARY },
        { text: itemDesc(item.id, this.ctx.web.game, tr), color: PALETTE.cream, gap: 4 },
        { text: finePrintText(item, tr), color: PALETTE.goldHi, gap: 4 },
      ],
      DETAIL.y + 28,
      bottom,
    )
  }

  private drawPlacebometer(g: CanvasRenderingContext2D): void {
    const { tr } = this.ctx
    const shop = this.shop
    if (!shop) return
    drawText(g, tr.t('placebo.title'), DETAIL.x + DETAIL.w / 2, DETAIL.y + 6, {
      color: PALETTE.gold,
      align: 'center',
      shadow: PALETTE.ink,
    })
    const tone = { good: PALETTE.win, bad: PALETTE.loss, neutral: PALETTE.cream } as const
    let y = DETAIL.y + 20
    for (const line of placeboLines(shop.placebometer, tr)) {
      const value = line.value
      const vw = measure(value)
      drawText(g, fit(line.label, DETAIL_TEXT_W - vw - 6), DETAIL.x + 6, y, { color: SECONDARY })
      drawText(g, value, DETAIL.x + DETAIL.w - 6, y, {
        color: tone[line.tone],
        align: 'right',
        shadow: PALETTE.ink,
      })
      y += 11
    }
    // La fila elegida del bolsillo: `git revert` dice hasta cuándo; un objeto, si está armado.
    const row = this.selected()
    const bottom = this.drawActionLine(g, this.actionLabel(row))
    const blocks: { text: string; color: string; gap?: number }[] = [
      { text: placeboVerdict(shop.placebometer, tr), color: PALETTE.goldHi, gap: 2 },
    ]
    if (row?.kind === 'pocket') {
      // El nombre entero (en la lista puede ir recortado) con sus cargas.
      blocks.push({
        text: `${itemName(row.id, tr)} · ${tr.plural('shop.charges', row.charges, {
          n: tr.n(row.charges),
        })}${row.armed ? ` · ${tr.t('shop.armed')}` : ''}`,
        color: row.armed ? PALETTE.gold : PALETTE.cream,
        gap: 3,
      })
    }
    if (row?.kind === 'revert') {
      blocks.push({
        text: tr.t('shop.pocket.revertReady', {
          refund: tr.n(row.refund),
          time: this.time(row.until),
        }),
        color: PALETTE.win,
        gap: 3,
      })
    }
    this.paragraphs(g, blocks, y, bottom)
  }

  private drawWardrobeDetail(g: CanvasRenderingContext2D): void {
    const { tr } = this.ctx
    const row = this.selected()
    if (!row || row.kind !== 'skin') return
    const user = this.ctx.state().user
    const felt = row.slot === 'felt' ? FELT_SKINS[row.skin] : feltSkin(user?.felt)
    const chips = row.slot === 'chips' ? CHIP_SKINS[row.skin] : chipSkin(user?.chipSkin)
    drawSkinPreview(g, DETAIL.x + 6, DETAIL.y + 6, DETAIL.w - 12, 52, felt, chips, (text, x, y) =>
      drawText(g, text, x, y, { color: PALETTE.cream, align: 'center', shadow: PALETTE.ink }),
    )
    const bottom = this.drawActionLine(g, this.actionLabel(row))
    const id = cosmeticForRow(row)
    const item = id ? this.item(id) : null
    const blocks: { text: string; color: string; gap?: number }[] = [
      { text: skinName(row.slot, row.skin, tr), color: PALETTE.gold },
      { text: this.skinStatus(row), color: PALETTE.cream },
    ]
    if (item && !this.owns(row.slot, row.skin)) {
      blocks.push({ text: finePrintText(item, tr), color: PALETTE.goldHi, gap: 4 })
    }
    blocks.push({ text: tr.t('shop.wardrobe.motto'), color: SECONDARY, gap: 4 })
    this.paragraphs(g, blocks, DETAIL.y + 64, bottom)
  }
}

/** Cosmético que hay que comprar para una fila del ARMARIO (null: el clásico, gratis). */
function cosmeticForRow(row: Extract<ShopRow, { kind: 'skin' }>): ItemId | null {
  return row.slot === 'felt' ? cosmeticFor('felt', row.skin) : cosmeticFor('chips', row.skin)
}

/** ¿Es un consumible con cargas armado? (para el HUD y los tests) */
export function armedItems(inv: Inventory | null): ConsumableId[] {
  return (inv?.items ?? [])
    .filter(i => i.armed && i.charges > 0 && isConsumable(i.id))
    .map(i => i.id)
}
