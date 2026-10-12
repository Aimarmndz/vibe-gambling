// SPDX-License-Identifier: AGPL-3.0-or-later
// Logros de broma: catálogo y condiciones (lógica pura). El servidor los evalúa dentro de la misma
// transacción de la tirada, del préstamo o de la tirada guardada como pendiente, y los guarda una
// sola vez por usuario (son para siempre, no por temporada). Los textos van a i18n con las claves
// `achievements.<id>.title`, `achievements.<id>.desc` y `achievements.<id>.hint`.
//
// El orden del catálogo es el orden de la pantalla de logros. Un logro nuevo se añade al final
// (los ids nunca se reutilizan ni se renombran: están guardados en la base de datos).
import type { GameConfig } from './config.ts'
import { zonedParts } from './season.ts'
import type { Spectacle } from './spectacle.ts'
import { gamblersFallacyPick } from './streaks.ts'
import type { ColorStreak } from './streaks.ts'

/** Viernes en `Date#getUTCDay()`. "Push el viernes" es el chiste en sí, no un ajuste. */
const FRIDAY = 5

/** Qué ha pasado para que se evalúen los logros. */
export const ACHIEVEMENT_EVENTS = ['round', 'loan', 'queue'] as const
export type AchievementEvent = (typeof ACHIEVEMENT_EVENTS)[number]

/** Configuración que miran los logros (la del juego, tal cual). */
export type AchievementRules = Pick<
  GameConfig,
  'achievements' | 'pendingSpins' | 'loan' | 'bigWin'
> & {
  readonly streak: Pick<GameConfig['streak'], 'onFireAt' | 'colorWarningAt'>
}

/** La ronda que se acaba de resolver, vista por los logros. */
export interface AchievementRound {
  readonly result: number
  readonly net: number
  readonly staked: number
  readonly jackpot: boolean
  readonly testFailed: boolean
  readonly bets: ReadonlyArray<{
    readonly won: boolean
    readonly selection: { readonly kind: string; readonly numbers?: readonly number[] }
  }>
  readonly spectacle: Spectacle
}

/** Cartera de la temporada después del evento. */
export interface AchievementWallet {
  readonly netWorth: number
  readonly debt: number
  readonly loans: number
  readonly spins: number
  readonly bestStreak: number
  readonly pendingSpins: number
}

export interface AchievementContext {
  readonly event: AchievementEvent
  /** Solo en `round`. */
  readonly round: AchievementRound | null
  readonly wallet: AchievementWallet
  /** Si el patrimonio ya había caído a 0 o menos en esta temporada antes de este evento. */
  readonly wasBankrupt: boolean
  /** Racha de color de las tiradas anteriores a esta (la que veía el jugador al apostar). */
  readonly previousColorStreak: ColorStreak | null
  /** Veces que le ha salido el 0 (todas las temporadas, contando esta tirada). */
  readonly lifetimeZeros: number
  /** Día de la semana (0 = domingo) y hora de pared en la zona horaria de la temporada. */
  readonly local: { readonly weekday: number; readonly hour: number }
  /**
   * Lo mismo, pero del momento en que terminó el turno que trajo la tirada (el del `git push`).
   * Solo cambia con las tiradas pendientes, que se tiran después; sin él, `local`.
   */
  readonly turnLocal?: { readonly weekday: number; readonly hour: number }
}

/** Lo que enseña la barra de progreso de los logros contables. */
export interface ProgressSnapshot {
  readonly loans: number
  readonly debt: number
  readonly spins: number
  readonly bestStreak: number
  readonly pendingSpins: number
  readonly lifetimeZeros: number
}

export interface AchievementDef {
  readonly id: string
  /** Secreto: la pantalla enseña "???" hasta conseguirlo. */
  readonly hidden: boolean
  readonly check: (ctx: AchievementContext, rules: AchievementRules) => boolean
  /** Valores para los `{marcadores}` de sus textos (además de `goal` en los contables). */
  readonly params?: (rules: AchievementRules) => Record<string, number>
  /** Solo los contables: valor actual y meta. */
  readonly progress?: (
    snap: ProgressSnapshot,
    rules: AchievementRules,
  ) => { current: number; goal: number }
}

const round = (ctx: AchievementContext) => (ctx.event === 'round' ? ctx.round : null)

/** ¿Cae `hour` en [from, to)? Si `from > to`, el intervalo cruza la medianoche. */
export function inHourRange(hour: number, fromHour: number, toHour: number): boolean {
  return fromHour < toHour ? hour >= fromHour && hour < toHour : hour >= fromHour || hour < toHour
}

/**
 * "Falacia confirmada": con el aviso de la falacia en pantalla, apostó al color que "TIENE que
 * salir" y esa apuesta perdió.
 */
export function fallacyConfirmed(
  previous: ColorStreak | null,
  bets: AchievementRound['bets'],
  colorWarningAt: number,
): boolean {
  if (!previous || previous.color === 'green' || previous.count < colorWarningAt) return false
  const pick = gamblersFallacyPick(previous)
  return bets.some(bet => bet.selection.kind === pick && !bet.won)
}

export const ACHIEVEMENTS = [
  {
    id: 'first_spin',
    hidden: false,
    check: ctx => round(ctx) !== null,
  },
  {
    id: 'first_ruin',
    hidden: false,
    check: ctx => round(ctx)?.spectacle.bankrupt === true,
  },
  {
    id: 'pro_debtor',
    hidden: false,
    check: (ctx, rules) =>
      ctx.event === 'loan' && ctx.wallet.loans >= rules.achievements.proDebtorLoans,
    progress: (snap, rules) => ({
      current: snap.loans,
      goal: rules.achievements.proDebtorLoans,
    }),
  },
  {
    id: 'all_on_zero',
    hidden: false,
    check: ctx => {
      const r = round(ctx)
      return (
        r !== null &&
        r.result === 0 &&
        r.bets.some(bet => bet.won && bet.selection.kind === 'straight')
      )
    },
  },
  {
    id: 'friday_push',
    hidden: false,
    // El chiste es hacer el push un viernes: con una tirada pendiente cuenta el día del turno,
    // no el día en que se gasta (si no, bastaría con guardar pushes y gastarlos el viernes).
    check: ctx =>
      round(ctx)?.spectacle.jackpot === true && (ctx.turnLocal ?? ctx.local).weekday === FRIDAY,
  },
  {
    id: 'queue_full',
    hidden: false,
    check: (ctx, rules) =>
      ctx.event === 'queue' && ctx.wallet.pendingSpins >= rules.pendingSpins.max,
    progress: (snap, rules) => ({ current: snap.pendingSpins, goal: rules.pendingSpins.max }),
  },
  {
    id: 'on_fire',
    hidden: false,
    check: (ctx, rules) => (round(ctx)?.spectacle.streak ?? 0) >= rules.streak.onFireAt,
    progress: (snap, rules) => ({ current: snap.bestStreak, goal: rules.streak.onFireAt }),
  },
  {
    id: 'fallacy_confirmed',
    hidden: true,
    check: (ctx, rules) => {
      const r = round(ctx)
      return (
        r !== null && fallacyConfirmed(ctx.previousColorStreak, r.bets, rules.streak.colorWarningAt)
      )
    },
  },
  {
    id: 'compound_interest',
    hidden: false,
    check: (ctx, rules) => ctx.wallet.debt >= rules.achievements.compoundInterestDebt,
    progress: (snap, rules) => ({
      current: snap.debt,
      goal: rules.achievements.compoundInterestDebt,
    }),
  },
  {
    id: 'comeback',
    hidden: false,
    check: ctx => round(ctx) !== null && ctx.wasBankrupt && ctx.wallet.netWorth > 0,
  },
  {
    id: 'zero_collector',
    hidden: false,
    check: (ctx, rules) =>
      round(ctx)?.result === 0 && ctx.lifetimeZeros >= rules.achievements.zeroCollectorZeros,
    progress: (snap, rules) => ({
      current: snap.lifetimeZeros,
      goal: rules.achievements.zeroCollectorZeros,
    }),
  },
  {
    id: 'big_win',
    hidden: false,
    params: rules => ({ multiple: rules.bigWin.minNetMultiple }),
    check: ctx => {
      const tier = round(ctx)?.spectacle.tier
      return tier === 'big' || tier === 'mega' || tier === 'straight'
    },
  },
  {
    id: 'mega_win',
    hidden: false,
    params: rules => ({ multiple: rules.bigWin.megaNetMultiple }),
    check: ctx => {
      const tier = round(ctx)?.spectacle.tier
      return tier === 'mega' || tier === 'straight'
    },
  },
  {
    id: 'tests_also_bet',
    hidden: false,
    check: ctx => {
      const r = round(ctx)
      return r !== null && r.testFailed && r.net > 0
    },
  },
  {
    id: 'addict',
    hidden: false,
    check: (ctx, rules) =>
      round(ctx) !== null && ctx.wallet.spins >= rules.achievements.addictSpins,
    progress: (snap, rules) => ({ current: snap.spins, goal: rules.achievements.addictSpins }),
  },
  {
    id: 'night_owl',
    hidden: true,
    params: rules => ({
      from: rules.achievements.nightOwl.fromHour,
      to: rules.achievements.nightOwl.toHour,
    }),
    check: (ctx, rules) => {
      const { fromHour, toHour } = rules.achievements.nightOwl
      return round(ctx) !== null && inHourRange(ctx.local.hour, fromHour, toHour)
    },
  },
  {
    id: 'too_big_to_fail',
    hidden: true,
    params: rules => ({ goal: rules.loan.maxDebt }),
    check: (ctx, rules) => ctx.wallet.debt >= rules.loan.maxDebt,
  },
] as const satisfies readonly AchievementDef[]

export type AchievementId = (typeof ACHIEVEMENTS)[number]['id']
export const ACHIEVEMENT_IDS = ACHIEVEMENTS.map(a => a.id) as [AchievementId, ...AchievementId[]]

const BY_ID: ReadonlyMap<string, AchievementDef> = new Map(ACHIEVEMENTS.map(a => [a.id, a]))

export function achievementDef(id: AchievementId): AchievementDef {
  const def = BY_ID.get(id)
  /* v8 ignore next -- el tipo garantiza que el id existe */
  if (!def) throw new RangeError(`logro desconocido: ${id}`)
  return def
}

/** Logros que se desbloquean con este evento (y aún no tenía), en el orden del catálogo. */
export function evaluateAchievements(
  ctx: AchievementContext,
  rules: AchievementRules,
  unlocked: ReadonlySet<string>,
): AchievementId[] {
  return ACHIEVEMENTS.filter(a => !unlocked.has(a.id) && a.check(ctx, rules)).map(a => a.id)
}

/** Progreso de un logro contable (null si no lo es o si ya se consiguió). */
export function achievementProgress(
  id: AchievementId,
  snap: ProgressSnapshot,
  rules: AchievementRules,
  unlocked: boolean,
): { current: number; goal: number } | null {
  const def = achievementDef(id)
  if (unlocked || !def.progress) return null
  const { current, goal } = def.progress(snap, rules)
  return { current: Math.max(0, Math.min(current, goal)), goal }
}

/** Día de la semana (0 = domingo) y hora de pared de un instante en una zona horaria. */
export function localClock(instant: Date, timeZone: string): { weekday: number; hour: number } {
  const p = zonedParts(instant, timeZone)
  return { weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(), hour: p.hour }
}

const EMPTY_SNAPSHOT: ProgressSnapshot = {
  loans: 0,
  debt: 0,
  spins: 0,
  bestStreak: 0,
  pendingSpins: 0,
  lifetimeZeros: 0,
}

/**
 * Valores de los `{marcadores}` de los textos de un logro: `goal` en los contables (la meta) y lo
 * que declare cada uno (`multiple`, `from`, `to`…). Salen de la configuración de esta instancia.
 */
export function achievementParams(
  id: AchievementId,
  rules: AchievementRules,
): Record<string, number> {
  const def = achievementDef(id)
  return {
    ...(def.progress ? { goal: def.progress(EMPTY_SNAPSHOT, rules).goal } : {}),
    ...def.params?.(rules),
  }
}
