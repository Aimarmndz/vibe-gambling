// SPDX-License-Identifier: AGPL-3.0-or-later
// TIENDA en el mod: alias de los objetos (en español e inglés), sus glifos para la status line y
// la lectura a mano (sin zod) de lo que el servidor manda del bolsillo y de los efectos de una
// ronda. Solo se fía de números y de ids del catálogo: ningún texto del servidor llega a pantalla.
// Módulo puro.
import { CONSUMABLE_IDS, ITEM_IDS } from '../generated/protocol.ts'
import type { ConsumableId, ItemId } from '../generated/protocol.ts'

/** Glifo de cada objeto (status line, `/balance`, `/vibe-shop` y toast). Presentación, no reglas. */
export const ITEM_GLYPHS: Readonly<Record<ItemId, string>> = {
  rabbit_foot: '🐇',
  oracle: '🔮',
  insurance: '🛡',
  turbo: '⚡',
  streak_helmet: '⛑',
  revert: '↩',
  felt_memory_blue: '🎨',
  felt_montecarlo97: '🎨',
  felt_dark_mode: '🎨',
  felt_vaporwave: '🎨',
  chips_floppy: '💾',
  chips_cinco_duros: '🪙',
  chips_bottle_cap: '🍾',
}

/**
 * Alias que acepta `/vibe-shop buy` y `/vibe-use`, ya normalizados (`aliasKey`). El id del
 * catálogo vale siempre (`rabbit_foot`, `felt_vaporwave`…).
 */
const ALIASES: Readonly<Record<ItemId, readonly string[]>> = {
  rabbit_foot: [
    'pata',
    'patadeconejo',
    'conejo',
    'rabbit',
    'rabbitfoot',
    'foot',
    'luckyrabbitsfoot',
    'suerte',
    'luck',
  ],
  oracle: [
    'oraculo',
    'vibeoracle',
    'ia',
    'ai',
    'oracle',
    'tipster',
    'aitipster',
    'prediccion',
    'prediction',
  ],
  insurance: ['seguro', 'insurance', 'segurotodoriesgo', 'fullcoverage'],
  turbo: ['turbo', 'turbopleno', 'straightturbo', 'pleno'],
  streak_helmet: ['casco', 'cascoderacha', 'helmet', 'streakhelmet'],
  revert: ['revert', 'gitrevert', 'gitreverthead1', 'ctrlz', 'undo', 'deshacer'],
  felt_memory_blue: ['memoryblue', 'memory', 'azul', 'blue'],
  felt_montecarlo97: ['montecarlo', 'montecarlo97'],
  felt_dark_mode: ['darkmode', 'dark', 'oscuro', 'modooscuro'],
  felt_vaporwave: ['vaporwave', 'vapor'],
  chips_floppy: ['floppy', 'disquete', 'disquetes', 'floppies'],
  chips_cinco_duros: ['cincoduros', 'duros', 'duro', 'fivepesetas'],
  chips_bottle_cap: ['bottlecap', 'bottlecaps', 'caps', 'chapas', 'chapa'],
}

/** Texto de la persona → clave de alias: minúsculas, sin acentos, sin espacios ni signos. */
export function aliasKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const BY_ALIAS: ReadonlyMap<string, ItemId> = new Map(
  ITEM_IDS.flatMap(id => [[aliasKey(id), id] as const, ...ALIASES[id].map(a => [a, id] as const)]),
)

/** Objeto del catálogo que nombra la persona (`pata`, `Rabbit Foot`, `felt_vaporwave`…), o null. */
export function resolveItem(raw: string): ItemId | null {
  const key = aliasKey(raw)
  return key === '' ? null : (BY_ALIAS.get(key) ?? null)
}

export function isConsumableId(id: string): id is ConsumableId {
  return CONSUMABLE_IDS.some(c => c === id)
}

const isItemId = (v: unknown): v is ItemId => ITEM_IDS.some(id => id === v)

// ------------------------------------------------------------------ bolsillo

export interface PocketItem {
  readonly id: ConsumableId
  readonly charges: number
  readonly armed: boolean
}

export interface InventoryView {
  readonly items: readonly PocketItem[]
  readonly maxArmed: number
  readonly enabled: boolean
  /** `git revert` disponible ahora: lo que devolvería y hasta cuándo. */
  readonly revert: { readonly refund: number; readonly until: string } | null
}

type Obj = Readonly<Record<string, unknown>>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

const isPocketItem = (v: unknown): v is PocketItem =>
  isObj(v) && isConsumableId(String(v.id)) && isCount(v.charges) && typeof v.armed === 'boolean'

/** Bolsillo del servidor (`inventory`), o null si no lo trae o no tiene la forma esperada. */
export function inventoryOf(v: unknown): InventoryView | null {
  if (!isObj(v)) return null
  if (!Array.isArray(v.items) || !v.items.every(isPocketItem)) return null
  if (!isCount(v.maxArmed) || typeof v.enabled !== 'boolean') return null
  const revert = v.revert
  if (revert !== null && !(isObj(revert) && isCount(revert.refund) && isIso(revert.until))) {
    return null
  }
  return {
    items: v.items.map(i => ({ id: i.id, charges: i.charges, armed: i.armed })),
    maxArmed: v.maxArmed,
    enabled: v.enabled,
    revert:
      revert === null ? null : { refund: revert.refund as number, until: revert.until as string },
  }
}

/** ¿Actúa en la próxima ronda? (Sin cargas no hace nada aunque siga marcado.) */
export function isArmed(item: PocketItem): boolean {
  return item.armed && item.charges > 0
}

/** Glifos de lo armado, en el orden del catálogo (`🐇🛡`), o "" si no hay nada. */
export function armedGlyphs(inventory: InventoryView | null): string {
  if (inventory === null) return ''
  const armed = new Set(inventory.items.filter(isArmed).map(i => i.id))
  return CONSUMABLE_IDS.filter(id => armed.has(id))
    .map(id => ITEM_GLYPHS[id])
    .join('')
}

/**
 * El bolsillo después de una ronda: una carga menos de cada consumible que ha actuado (es lo que
 * hace el servidor). Así la status line no tiene que volver a preguntar.
 */
export function afterRound(
  inventory: InventoryView,
  effects: readonly ItemEffectView[],
): InventoryView {
  const used = new Set<string>(effects.map(e => e.itemId))
  return {
    ...inventory,
    items: inventory.items.map(item => {
      if (!used.has(item.id)) return item
      const charges = Math.max(0, item.charges - 1)
      return { ...item, charges, armed: item.armed && charges > 0 }
    }),
  }
}

// ------------------------------------------------------------------ efectos de una ronda

export type ItemEffectKind = 'placebo' | 'prediction' | 'refund' | 'boost' | 'shield' | 'revert'
const EFFECT_KINDS: readonly ItemEffectKind[] = [
  'placebo',
  'prediction',
  'refund',
  'boost',
  'shield',
  'revert',
]

export interface ItemEffectView {
  readonly itemId: ItemId
  readonly kind: ItemEffectKind
  readonly amount: number
  readonly prediction?: number
  readonly hit?: boolean
}

const isEffect = (v: unknown): v is ItemEffectView =>
  isObj(v) &&
  isItemId(v.itemId) &&
  EFFECT_KINDS.some(kind => kind === v.kind) &&
  Number.isSafeInteger(v.amount) &&
  (v.prediction === undefined ||
    (Number.isSafeInteger(v.prediction) &&
      (v.prediction as number) >= 0 &&
      (v.prediction as number) <= 36)) &&
  (v.hit === undefined || typeof v.hit === 'boolean')

/**
 * Efectos de los objetos de una ronda (`round.items`). Opcional en el protocolo: un servidor sin
 * tienda no lo manda. Lo que no tenga la forma esperada se ignora (nunca rompe el toast).
 */
export function effectsOf(round: unknown): ItemEffectView[] {
  if (!isObj(round) || !Array.isArray(round.items)) return []
  return round.items.filter(isEffect)
}
