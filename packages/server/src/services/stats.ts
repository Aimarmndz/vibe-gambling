// SPDX-License-Identifier: AGPL-3.0-or-later
// Pantallas ESTADÍSTICAS y BANCO de la ventana: datos de una temporada del propio jugador.
// Solo lee, con límites de `config/game.json` (`stats.*`) para que ninguna respuesta crezca con
// las tiradas: la gráfica se muestrea en SQL y las listas van con `LIMIT`. Las consultas usan los
// índices `rounds_user_season_resolved_idx` y `loans_user_season_idx`.
import { accrueInterest, canRequestLoan, colorOf, totalStake } from '@vibe-gambling/shared'
import type {
  BankEntry,
  BankStatement,
  GameConfig,
  RoundSummary,
  SeasonStats,
} from '@vibe-gambling/shared'
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm'

import type { Database } from '../db/client.ts'
import { rounds, wallets } from '../db/schema.ts'
import type { WalletRow } from '../db/schema.ts'
import { AppError } from '../lib/errors.ts'

export interface StatsDeps {
  db: Database
  game: GameConfig
  /** Temporada en curso según el reloj del servidor. */
  currentSeason: () => string
}

/** Puntos de la gráfica: cada cuántas tiradas se toma una con `points` puntos como mucho. */
export function sampleStep(spins: number, points: number): number {
  // Siempre van el punto 0 (saldo inicial) y la última tirada; el resto, repartidos.
  const interior = points - 2
  if (spins <= points - 1) return 1
  return interior > 0 ? Math.ceil(spins / interior) : 0
}

const asNumber = (value: unknown): number => Number(value)

export class StatsService {
  readonly #d: StatsDeps

  constructor(deps: StatsDeps) {
    this.#d = deps
  }

  /** Temporadas jugadas (con cartera), de la más reciente a la más antigua, y la en curso. */
  async #seasons(userId: string, wanted: string | undefined) {
    const current = this.#d.currentSeason()
    const rows = await this.#d.db
      .select({ id: wallets.seasonId })
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .orderBy(desc(wallets.seasonId))
    const seasons = rows.map(r => r.id)
    if (!seasons.includes(current)) seasons.unshift(current)
    const seasonId = wanted ?? current
    if (!seasons.includes(seasonId)) {
      throw new AppError('not_found', 'You did not play that season. Lucky you.')
    }
    const [wallet] = await this.#d.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.seasonId, seasonId)))
    return { seasons, seasonId, current, wallet }
  }

  async stats(userId: string, wanted?: string): Promise<SeasonStats> {
    const { db, game } = this.#d
    const { seasons, seasonId, wallet } = await this.#seasons(userId, wanted)
    const start = game.startingBalance
    const mine = and(
      eq(rounds.userId, userId),
      eq(rounds.seasonId, seasonId),
      eq(rounds.status, 'resolved'),
    )

    // Patrimonio tras cada tirada. Las rondas de antes de la v2 no lo guardaron: se reconstruye
    // sumando netos e intereses desde el saldo inicial (los préstamos no cambian el patrimonio).
    const worthCte = sql`
      with r as (
        select
          row_number() over w as rn,
          coalesce(net_worth_after, ${start} + sum(net - interest_charged) over w) as worth
        from ${rounds}
        where ${mine}
        window w as (
          order by spin_number nulls first, resolved_at, id
          rows between unbounded preceding and current row
        )
      )`
    const [agg] = await db.execute<{ n: number; peak: unknown; low: unknown }>(sql`
      ${worthCte}
      select count(*)::int as n, max(worth) as peak, min(worth) as low from r`)
    const n = agg?.n ?? 0
    const step = sampleStep(n, game.stats.seriesPoints)
    const sampled =
      n === 0
        ? []
        : await db.execute<{ rn: number; worth: unknown }>(sql`
            ${worthCte}
            select rn::int as rn, worth from r
            where rn = ${n} or (${step} > 0 and rn % ${Math.max(step, 1)} = 0)
            order by rn`)
    const series = [
      { spin: 0, netWorth: start },
      ...sampled.map(p => ({ spin: p.rn, netWorth: asNumber(p.worth) })),
    ]

    // Préstamos: tirada tras la que se pidió cada uno (los más recientes, en orden). Los de antes
    // de la v2 no la guardaron: se cuentan las tiradas resueltas antes del préstamo.
    const marks = await db.execute<{ after: number }>(sql`
      select coalesce(l.after_spin, (
        select count(*) from ${rounds} r
        where r.user_id = l.user_id and r.season_id = l.season_id
          and r.status = 'resolved' and r.resolved_at < l.created_at
      ))::int as after
      from loans l
      where l.user_id = ${userId} and l.season_id = ${seasonId}
      order by l.created_at desc
      limit ${game.stats.loanMarks}`)

    const summary = {
      roundId: rounds.id,
      resolvedAt: rounds.resolvedAt,
      result: rounds.result,
      staked: rounds.staked,
      net: rounds.net,
    }
    // `nulls last`: en Postgres `desc` pone los nulos primero, y las rondas de antes de la v2 (sin
    // `spin_number`) son las más antiguas; si no, en la temporada de la migración taparían las
    // tiradas nuevas.
    const recent = await db
      .select(summary)
      .from(rounds)
      .where(mine)
      .orderBy(sql`${rounds.spinNumber} desc nulls last`, desc(rounds.resolvedAt), desc(rounds.id))
      .limit(game.stats.recentRounds)
    const [best] = await db
      .select(summary)
      .from(rounds)
      .where(and(mine, gt(rounds.net, 0)))
      .orderBy(desc(rounds.net), asc(rounds.resolvedAt))
      .limit(1)
    const [frequent] = await db
      .select({ result: rounds.result, n: count() })
      .from(rounds)
      .where(mine)
      .groupBy(rounds.result)
      .orderBy(desc(count()), asc(rounds.result))
      .limit(1)

    return {
      seasonId,
      seasons,
      spins: wallet?.spins ?? 0,
      bestStreak: wallet?.bestStreak ?? 0,
      series,
      peakNetWorth: n === 0 ? start : Math.max(start, asNumber(agg?.peak)),
      lowestNetWorth: n === 0 ? start : Math.min(start, asNumber(agg?.low)),
      loanMarks: marks.map(m => m.after).reverse(),
      recent: recent.map(toSummary),
      mostFrequent:
        frequent && frequent.result !== null
          ? { result: frequent.result, color: colorOf(frequent.result), count: frequent.n }
          : null,
      biggestWin: best ? toSummary(best) : null,
    }
  }

  async bank(userId: string, wanted?: string): Promise<BankStatement> {
    const { db, game } = this.#d
    const { seasons, seasonId, current, wallet } = await this.#seasons(userId, wanted)
    const tz = game.season.timeZone
    const limit = game.stats.bankHistory

    // Movimientos de la deuda: cada préstamo por separado y los intereses agrupados por día de
    // pared y por tramo entre préstamos. `loan_seq` cuenta los préstamos hasta cada movimiento,
    // así que un préstamo abre un tramo nuevo de intereses. La deuda tras cada grupo es la suma
    // acumulada (los intereses guardados ya son lo que subió de verdad, con el tope aplicado).
    const rows = await db.execute<{
      kind: 'loan' | 'interest'
      first_at: Date
      last_at: Date
      day: string
      n: number
      amount: unknown
      debt_after: unknown
    }>(sql`
      with ev as (
        select created_at as at, 'loan' as kind, amount, 0 as ord
        from loans where user_id = ${userId} and season_id = ${seasonId}
        union all
        select resolved_at as at, 'interest' as kind, interest_charged as amount, 1 as ord
        from ${rounds}
        where user_id = ${userId} and season_id = ${seasonId} and status = 'resolved'
          and interest_charged > 0
      ),
      seq as (
        select *,
          sum(case when kind = 'loan' then 1 else 0 end) over (order by at, ord) as loan_seq,
          to_char(at at time zone ${tz}, 'YYYY-MM-DD') as day
        from ev
      ),
      grouped as (
        select kind, day, loan_seq, min(at) as first_at, max(at) as last_at,
          count(*)::int as n, sum(amount) as amount, min(ord) as ord
        from seq
        group by kind, day, loan_seq
      )
      select kind, day, first_at, last_at, n, amount,
        sum(amount) over (order by last_at, ord, loan_seq) as debt_after
      from grouped
      order by last_at desc, ord desc, loan_seq desc
      limit ${limit + 1}`)

    const history: BankEntry[] = rows.slice(0, limit).map(r =>
      r.kind === 'loan'
        ? {
            kind: 'loan',
            at: new Date(r.first_at).toISOString(),
            amount: asNumber(r.amount),
            debtAfter: asNumber(r.debt_after),
          }
        : {
            kind: 'interest',
            day: r.day,
            from: new Date(r.first_at).toISOString(),
            to: new Date(r.last_at).toISOString(),
            spins: r.n,
            amount: asNumber(r.amount),
            debtAfter: asNumber(r.debt_after),
          },
    )
    const isCurrent = seasonId === current
    return {
      seasonId,
      seasons,
      ...this.#money(wallet),
      nextInterest: isCurrent && wallet ? accrueInterest(wallet.debt, game) - wallet.debt : 0,
      canBorrow:
        isCurrent &&
        canRequestLoan(
          (wallet?.balance ?? game.startingBalance) + totalStake(wallet?.slip ?? []),
          game,
          wallet?.debt ?? 0,
        ),
      history,
      truncated: rows.length > limit,
    }
  }

  #money(wallet: WalletRow | undefined) {
    const balance = wallet?.balance ?? this.#d.game.startingBalance
    const debt = wallet?.debt ?? 0
    return { balance, debt, netWorth: balance - debt, loans: wallet?.loans ?? 0 }
  }
}

function toSummary(r: {
  roundId: string
  resolvedAt: Date | null
  result: number | null
  staked: number | null
  net: number | null
}): RoundSummary {
  if (r.resolvedAt === null || r.result === null || r.staked === null || r.net === null) {
    throw new Error(`la ronda ${r.roundId} no está resuelta del todo`)
  }
  return {
    roundId: r.roundId,
    resolvedAt: r.resolvedAt.toISOString(),
    result: r.result,
    color: colorOf(r.result),
    staked: r.staked,
    net: r.net,
  }
}
