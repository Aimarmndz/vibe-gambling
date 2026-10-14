// SPDX-License-Identifier: AGPL-3.0-or-later
// TIENDA vista por la ventana, sin canvas: nombres de los objetos, la letra pequeña con su EV real,
// los números del Placebómetro y las líneas de cada objeto en la pantalla de resultado. Todo sale
// del catálogo de shared y de lo que manda el servidor (nada de números escritos aquí).
import { POCKET_COUNT, cosmeticOf, isCosmetic } from '@vibe-gambling/shared'
import type {
  ChipSkinId,
  FeltId,
  ItemId,
  PlacebometerView,
  PublicGameConfig,
  RoundItemEffect,
  ShopItem,
} from '@vibe-gambling/shared'

import type { MessageKey, Translator } from '../i18n/index.ts'

/** Número con `digits` decimales como mucho y la coma del idioma ("2,43", "94,59"). */
export function decimal(value: number, tr: Translator, digits = 2): string {
  return new Intl.NumberFormat(tr.meta.bcp47, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value)
}

/** Porcentaje con hasta dos decimales ("2,7 %", "30 %"); "–" sin datos. */
export function percent(part: number, total: number, tr: Translator): string {
  if (total <= 0) return '–'
  return `${decimal((part / total) * 100, tr, 1)} %`
}

/** La probabilidad de acertar un número cualquiera (1/37), en porcentaje: "2,7 %". */
export function oneInPockets(tr: Translator): string {
  return `${decimal(100 / POCKET_COUNT, tr, 2)} %`
}

/** Nombre de un tapete o de unas fichas. */
export function skinName(
  slot: 'felt' | 'chips',
  skin: FeltId | ChipSkinId,
  tr: Translator,
): string {
  return tr.t(`skin.${slot}.${skin}` as MessageKey)
}

/** Nombre de cualquier artículo (los cosméticos, con el nombre de su tapete o sus fichas). */
export function itemName(id: ItemId, tr: Translator): string {
  if (isCosmetic(id)) {
    const c = cosmeticOf(id)
    return skinName(c.slot, c.skin, tr)
  }
  return tr.t(`item.${id}.name` as MessageKey)
}

/** Qué hace (de verdad) un objeto. */
export function itemDesc(id: ItemId, game: PublicGameConfig, tr: Translator): string {
  if (isCosmetic(id)) return tr.t('shop.cosmetic.desc')
  const items = game.items
  const vars: Record<string, string> = {}
  if (items) {
    vars.rate = `${decimal(items.insurance.refundRate * 100, tr, 1)} %`
    vars.cap = tr.n(items.insurance.coverCap)
    vars.multiplier = decimal(items.turbo.multiplier, tr, 2)
    vars.turboCap = tr.n(items.turbo.coverCap)
    vars.refund = tr.n(items.revert.maxRefund)
    vars.minutes = decimal(items.revert.windowMs / 60_000, tr, 1)
  }
  return tr.t(`item.${id}.desc` as MessageKey, vars)
}

/** La letra pequeña con el EV real, a partir de `finePrint` (lo que calcula shared). */
export function finePrintText(item: ShopItem, tr: Translator): string {
  const fp = item.finePrint
  const vars = {
    price: tr.n(item.price),
    charges: tr.n(item.charges),
    perCharge: decimal(fp.perCharge, tr),
    maxExpected: decimal(fp.maxExpected, tr),
    minEdge: decimal(fp.minEdge, tr),
  }
  const key = isCosmetic(item.id) ? 'shop.cosmetic.fine' : `item.${item.id}.fine`
  return tr.t(key as MessageKey, vars)
}

/** Compras que le quedan este temporada (null: sin tope). */
export function leftThisSeason(item: ShopItem): number | null {
  return item.maxPerSeason === null ? null : Math.max(0, item.maxPerSeason - item.bought)
}

/** Las cuentas del Placebómetro, listas para pintar (etiqueta, valor y si es "malo"). */
export interface PlaceboLine {
  label: string
  value: string
  tone: 'good' | 'bad' | 'neutral'
}

export function placeboLines(p: PlacebometerView, tr: Translator): PlaceboLine[] {
  const r = p.rabbit
  return [
    { label: tr.t('placebo.spent'), value: tr.n(p.spent), tone: 'neutral' },
    { label: tr.t('placebo.recovered'), value: tr.n(p.recovered), tone: 'neutral' },
    {
      label: tr.t('placebo.net'),
      value: tr.signed(p.net),
      tone: p.net < 0 ? 'bad' : p.net > 0 ? 'good' : 'neutral',
    },
    {
      label: tr.t('placebo.withFoot'),
      value: tr.t('placebo.won', {
        pct: percent(r.with.won, r.with.rounds, tr),
        n: tr.n(r.with.rounds),
      }),
      tone: 'neutral',
    },
    {
      label: tr.t('placebo.withoutFoot'),
      value: tr.t('placebo.won', {
        pct: percent(r.without.won, r.without.rounds, tr),
        n: tr.n(r.without.rounds),
      }),
      tone: 'neutral',
    },
    {
      label: tr.t('placebo.oracle'),
      value: tr.t('placebo.hits', {
        hits: tr.n(p.oracle.hits),
        n: tr.n(p.oracle.predictions),
        pct: percent(p.oracle.hits, p.oracle.predictions, tr),
      }),
      tone: 'neutral',
    },
    { label: tr.t('placebo.chance'), value: oneInPockets(tr), tone: 'neutral' },
  ]
}

/** El veredicto del Placebómetro (la conclusión obvia que nadie quiere leer). */
export function placeboVerdict(p: PlacebometerView, tr: Translator): string {
  const r = p.rabbit
  if (r.with.rounds === 0 && p.spent === 0) return tr.t('placebo.verdict.none')
  const withPct = r.with.rounds > 0 ? r.with.won / r.with.rounds : null
  const withoutPct = r.without.rounds > 0 ? r.without.won / r.without.rounds : null
  if (withPct !== null && withoutPct !== null && withPct > withoutPct) {
    return tr.t('placebo.verdict.luckier')
  }
  return tr.t('placebo.verdict.same')
}

/** Líneas de los objetos en la pantalla de resultado ("SEGURO +100", "LA IA FALLÓ…"). */
export function itemLines(
  effects: readonly RoundItemEffect[] | undefined,
  game: PublicGameConfig,
  streak: number,
  tr: Translator,
): string[] {
  const out: string[] = []
  for (const e of effects ?? []) {
    switch (e.kind) {
      case 'placebo':
        out.push(tr.t('result.item.placebo'))
        break
      case 'prediction':
        out.push(
          tr.t(e.hit ? 'result.item.oracleHit' : 'result.item.oracleMiss', {
            n: e.prediction ?? 0,
            chance: oneInPockets(tr),
          }),
        )
        break
      case 'refund':
        out.push(
          e.amount > 0
            ? tr.t('result.item.refund', { amount: tr.signed(e.amount) })
            : tr.t('result.item.refundZero'),
        )
        break
      case 'boost':
        out.push(
          e.amount > 0
            ? tr.t('result.item.boost', {
                amount: tr.signed(e.amount),
                multiplier: decimal(game.items?.turbo.multiplier ?? 1, tr),
              })
            : tr.t('result.item.boostZero'),
        )
        break
      case 'shield':
        out.push(tr.t('result.item.shield', { streak: tr.n(streak) }))
        break
      case 'revert':
        out.push(tr.t('result.item.revert', { amount: tr.signed(e.amount) }))
        break
    }
  }
  return out
}

/** Racha del HUD: "▲7", "▲7*" con asterisco (Casco de Racha), "▼3" o "–". */
export function streakText(streak: number, asterisk: boolean | undefined): string {
  if (streak > 0) return `▲${streak}${asterisk ? '*' : ''}`
  if (streak < 0) return `▼${-streak}`
  return '–'
}
