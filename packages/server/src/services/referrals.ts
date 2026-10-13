// SPDX-License-Identifier: AGPL-3.0-or-later
// Programa de Afiliados Piramidal (legalmente distinto), con base de datos. Reglas puras en
// `game/referral.ts` de shared.
//
// - Código: uno por usuario, aleatorio, creado la primera vez que lo pide (`users.referral_code`,
//   único). Si dos peticiones lo crean a la vez, gana la primera y la otra lee el suyo.
// - Canje (bono para el invitado): con la cartera del invitado bloqueada (`FOR UPDATE`), un cerrojo
//   consultivo de la pareja (dos canjes cruzados se esperan: sin ciclos de dos) y el índice único de
//   `referrals.invitee_id` (un canje por cuenta, aunque lleguen dos a la vez de temporadas distintas).
// - Comisión (para quien invitó): se mira después de cada tirada del invitado y al iniciar sesión,
//   en una transacción aparte que bloquea la cartera de quien invitó y después la fila del canje.
//   Nunca se bloquean dos carteras en la misma transacción, así que no hay interbloqueos aunque las
//   invitaciones formen cadenas o ciclos largos. Se paga una sola vez (`activated_at is null` con
//   la fila bloqueada) y, si algo falla entre medias, la siguiente tirada lo vuelve a intentar.
import {
  commissionFor,
  isActivated,
  netWorth,
  normalizeReferralCode,
  redeemDeadline,
  redeemWindowBlock,
  seasonAt,
} from '@vibe-gambling/shared'
import type {
  Achievement,
  GameConfig,
  PublicUser,
  ReferralLookupResponse,
  ReferralRedeemResponse,
  ReferralStatus,
  SeasonBounds,
  Wallet,
} from '@vibe-gambling/shared'
import { and, count, eq, gte, isNotNull, isNull, sql, sum } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import type { Database, Executor, Tx } from '../db/client.ts'
import { REFERRAL_PAIR_LOCK_SPACE } from '../db/locks.ts'
import { referrals, rounds, users, wallets } from '../db/schema.ts'
import type { Clock } from '../lib/clock.ts'
import { AppError } from '../lib/errors.ts'
import { pendingRankedFrom } from './accountAge.ts'
import type { AchievementService } from './achievements.ts'
import { paidCommissions } from './achievements.ts'
import { ensureSeason, lockWallet, pendingCount } from './game.ts'
import type { Notifier } from './notifier.ts'
import type { Views } from './views.ts'

const V = 1 as const

/** Intentos de crear un código sin chocar con otro (con 6,6 × 10¹¹ códigos, chocar es rarísimo). */
const CODE_ATTEMPTS = 5

/** SQLSTATE 23505: valor repetido en un índice único. */
const UNIQUE_VIOLATION = '23505'

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    if ((e as Error & { code?: unknown }).code === UNIQUE_VIOLATION) return true
  }
  return false
}

export interface ReferralDeps {
  db: Database
  game: GameConfig
  clock: Clock
  views: Views
  notifier: Notifier
  achievements: AchievementService
  publicUrl: string
  /** Genera un código de afiliado aleatorio (inyectable para probar las colisiones). */
  generateCode: () => string
}

/** Comisión recién pagada (o con el tope ya lleno), para avisar a quien invitó. */
interface Payout {
  referrerId: string
  amount: number
  commissions: number
  wallet: Wallet
  unlocked: Achievement[]
}

export class ReferralService {
  readonly #d: ReferralDeps

  constructor(deps: ReferralDeps) {
    this.#d = deps
  }

  get #rules() {
    return this.#d.game.referral
  }

  #season(now: Date): SeasonBounds {
    const { timeZone, startDay } = this.#d.game.season
    return seasonAt(now, timeZone, startDay)
  }

  /** `PUBLIC_URL/r/<código>`. */
  urlOf(code: string): string {
    return new URL(`/r/${code}`, this.#d.publicUrl).toString()
  }

  // ---------------------------------------------------------------- código y estado

  /** Código del usuario; si aún no tiene, lo crea (una sola vez aunque se pida a la vez). */
  async codeOf(userId: string): Promise<string> {
    const db = this.#d.db
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const [user] = await db
        .select({ code: users.referralCode })
        .from(users)
        .where(eq(users.id, userId))
      if (!user) throw new AppError('unauthorized', 'This account no longer exists.')
      if (user.code) return user.code
      try {
        const [set] = await db
          .update(users)
          .set({ referralCode: this.#d.generateCode() })
          .where(and(eq(users.id, userId), isNull(users.referralCode)))
          .returning({ code: users.referralCode })
        if (set?.code) return set.code
        // Otra petición lo ha creado a la vez: se lee en la siguiente vuelta.
      } catch (error) {
        // El código ya era de otro: se prueba con otro.
        if (!isUniqueViolation(error)) throw error
      }
    }
    throw new Error('no se ha podido crear un código de afiliado libre')
  }

  /** Situación del usuario en la pirámide (pantalla AFILIADOS y `/vibe-invite`). */
  async status(userId: string): Promise<ReferralStatus> {
    const db = this.#d.db
    const now = this.#d.clock.now()
    const season = this.#season(now)
    const rules = this.#rules
    const code = await this.codeOf(userId)
    const [user] = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
    if (!user) throw new AppError('unauthorized', 'This account no longer exists.')

    const [totals] = await db
      .select({
        invited: count(),
        activated: count(referrals.activatedAt),
        waiting:
          sql<number>`count(*) filter (where ${referrals.activatedAt} is null and ${referrals.inviteeId} is not null)`.mapWith(
            Number,
          ),
        earned: sum(referrals.commission).mapWith(Number),
      })
      .from(referrals)
      .where(eq(referrals.referrerId, userId))
    const [mine] = await db
      .select({
        redeemedAt: referrals.redeemedAt,
        bonus: referrals.welcomeBonus,
        activatedAt: referrals.activatedAt,
      })
      .from(referrals)
      .where(eq(referrals.inviteeId, userId))
    const spins = await this.#spins(db, userId, null, rules.redeemMaxSpins)
    const blocked = redeemWindowBlock({ accountCreatedAt: user.createdAt, spins, now }, rules)
    return {
      code,
      url: this.urlOf(code),
      invited: totals?.invited ?? 0,
      activated: totals?.activated ?? 0,
      waiting: totals?.waiting ?? 0,
      earned: totals?.earned ?? 0,
      season: {
        seasonId: season.id,
        commissions: await paidCommissions(db, userId, season.id),
        cap: rules.maxCommissionsPerSeason,
      },
      invitedBy: mine
        ? {
            redeemedAt: mine.redeemedAt.toISOString(),
            bonus: mine.bonus,
            activated: mine.activatedAt !== null,
          }
        : null,
      canRedeem: !mine && blocked === null,
      redeemUntil: redeemDeadline(user.createdAt, rules).toISOString(),
      rules: { ...rules, minAccountAgeDays: this.#d.game.leaderboard.minAccountAgeDays },
    }
  }

  /**
   * Quién invita con un código, para la página `/r/<código>`. Lo que llega de la URL se normaliza;
   * si no puede ser un código, simplemente no existe. Con el invitador oculto del ranking, existe
   * pero no se dice quién es.
   */
  async lookup(raw: string): Promise<ReferralLookupResponse> {
    const code = normalizeReferralCode(raw)
    if (!code) return { v: V, found: false, inviter: null }
    const [inviter] = await this.#d.db
      .select({ login: users.login, avatarUrl: users.avatarUrl, hidden: users.hidden })
      .from(users)
      .where(eq(users.referralCode, code))
    if (!inviter) return { v: V, found: false, inviter: null }
    return { v: V, found: true, inviter: this.#publicInviter(inviter) }
  }

  #publicInviter(user: { login: string; avatarUrl: string; hidden: boolean }): PublicUser | null {
    return user.hidden ? null : this.#d.views.publicUser(user)
  }

  // ---------------------------------------------------------------- canje

  /** `/vibe-redeem <código>`: bono de bienvenida para el invitado. */
  async redeem(inviteeId: string, code: string): Promise<ReferralRedeemResponse> {
    const now = this.#d.clock.now()
    const season = this.#season(now)
    const rules = this.#rules
    const reject = (reason: Extract<ReferralRedeemResponse, { status: 'rejected' }>['reason']) =>
      ({ v: V, status: 'rejected', reason }) as const

    const result = await this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await lockWallet(tx, this.#d.game.startingBalance, inviteeId, season.id)

      const [already] = await tx
        .select({ id: referrals.id })
        .from(referrals)
        .where(eq(referrals.inviteeId, inviteeId))
      if (already) return reject('already_redeemed')

      const [invitee] = await tx
        .select({ createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, inviteeId))
      if (!invitee) throw new AppError('unauthorized', 'This account no longer exists.')
      const spins = await this.#spins(tx, inviteeId, null, rules.redeemMaxSpins)
      const blocked = redeemWindowBlock({ accountCreatedAt: invitee.createdAt, spins, now }, rules)
      if (blocked) return reject(blocked)

      const [inviter] = await tx
        .select({
          id: users.id,
          login: users.login,
          avatarUrl: users.avatarUrl,
          hidden: users.hidden,
        })
        .from(users)
        .where(eq(users.referralCode, code))
      if (!inviter) return reject('not_found')
      if (inviter.id === inviteeId) return reject('own_code')

      // Canjes cruzados a la vez (A con el código de B y B con el de A): el segundo espera aquí al
      // primero y después ve su fila. Sin esto, cada uno vería que el otro aún no ha canjeado.
      const pair = [inviter.id, inviteeId].sort().join(':')
      await tx.execute(
        sql`select pg_advisory_xact_lock(${REFERRAL_PAIR_LOCK_SPACE}::int, hashtext(${pair}))`,
      )
      const [cycle] = await tx
        .select({ id: referrals.id })
        .from(referrals)
        .where(and(eq(referrals.inviteeId, inviter.id), eq(referrals.referrerId, inviteeId)))
      if (cycle) return reject('cycle')

      const inserted = await tx
        .insert(referrals)
        .values({
          referrerId: inviter.id,
          inviteeId,
          redeemedAt: now,
          seasonId: season.id,
          welcomeBonus: rules.welcomeBonus,
        })
        .onConflictDoNothing()
        .returning({ id: referrals.id })
      if (inserted.length === 0) return reject('already_redeemed')

      const [updated] = await tx
        .update(wallets)
        .set({ balance: wallet.balance + rules.welcomeBonus, updatedAt: now })
        .where(and(eq(wallets.userId, inviteeId), eq(wallets.seasonId, season.id)))
        .returning()
      if (!updated) throw new Error('la cartera bloqueada ha desaparecido')
      return {
        v: V,
        status: 'redeemed',
        bonus: rules.welcomeBonus,
        wallet: this.#d.views.wallet(
          updated,
          season.id,
          await pendingCount(tx, inviteeId, season.id),
        ),
        inviter: this.#publicInviter(inviter),
      } as const
    })
    if (result.status === 'redeemed') {
      this.#d.notifier.send(inviteeId, { v: V, type: 'wallet', wallet: result.wallet })
    }
    return result
  }

  // ---------------------------------------------------------------- activación y comisión

  /**
   * ¿Se acaba de activar este usuario como invitado? Si sí, paga la comisión a quien le invitó (o
   * la marca a 0 si ya cobró el tope de la temporada) y le avisa. Barato cuando no hay nada que
   * hacer: una consulta por índice. Idempotente.
   */
  async settle(inviteeId: string): Promise<void> {
    const db = this.#d.db
    const now = this.#d.clock.now()
    const [ref] = await db
      .select({
        id: referrals.id,
        referrerId: referrals.referrerId,
        redeemedAt: referrals.redeemedAt,
      })
      .from(referrals)
      .where(and(eq(referrals.inviteeId, inviteeId), isNull(referrals.activatedAt)))
    if (!ref?.referrerId) return

    const [invitee] = await db
      .select({ githubCreatedAt: users.githubCreatedAt })
      .from(users)
      .where(eq(users.id, inviteeId))
    if (!invitee) return
    const minAge = this.#d.game.leaderboard.minAccountAgeDays
    const githubOldEnough = pendingRankedFrom(invitee.githubCreatedAt, minAge, now) === null
    const spinsSinceRedeem = await this.#spins(
      db,
      inviteeId,
      ref.redeemedAt,
      this.#rules.activationSpins,
    )
    if (!isActivated({ spinsSinceRedeem, githubOldEnough }, this.#rules)) return

    const payout = await this.#pay(ref.id, ref.referrerId, now)
    if (!payout) return
    const { wallet } = payout
    this.#d.notifier.send(payout.referrerId, {
      v: V,
      type: 'referral.commission',
      amount: payout.amount,
      capped: payout.amount === 0,
      commissions: payout.commissions,
      cap: this.#rules.maxCommissionsPerSeason,
      wallet,
    })
    for (const achievement of payout.unlocked) {
      this.#d.notifier.send(payout.referrerId, { v: V, type: 'achievement.unlocked', achievement })
    }
  }

  async #pay(referralId: string, referrerId: string, now: Date): Promise<Payout | null> {
    const season = this.#season(now)
    const rules = this.#rules
    return this.#d.db.transaction(async tx => {
      await ensureSeason(tx, season)
      const wallet = await lockWallet(tx, this.#d.game.startingBalance, referrerId, season.id)
      const [ref] = await tx
        .select({ id: referrals.id })
        .from(referrals)
        .where(
          and(
            eq(referrals.id, referralId),
            eq(referrals.referrerId, referrerId),
            isNull(referrals.activatedAt),
          ),
        )
        .for('update')
      // Ya pagada por otra petición, o una de las dos cuentas se ha borrado entre medias.
      if (!ref) return null

      const paid = await paidCommissions(tx, referrerId, season.id)
      const amount = commissionFor(paid, rules)
      await tx
        .update(referrals)
        .set({ activatedAt: now, commission: amount, paidSeasonId: season.id })
        .where(eq(referrals.id, referralId))
      const [updated] =
        amount > 0
          ? await tx
              .update(wallets)
              .set({ balance: wallet.balance + amount, updatedAt: now })
              .where(and(eq(wallets.userId, referrerId), eq(wallets.seasonId, season.id)))
              .returning()
          : [wallet]
      if (!updated) throw new Error('la cartera bloqueada ha desaparecido')
      const commissions = paid + (amount > 0 ? 1 : 0)
      const [activated] = await tx
        .select({ n: count() })
        .from(referrals)
        .where(and(eq(referrals.referrerId, referrerId), isNotNull(referrals.activatedAt)))
      const pending = await pendingCount(tx, referrerId, season.id)
      const unlocked = await this.#d.achievements.unlock(tx, {
        userId: referrerId,
        seasonId: season.id,
        now,
        ctx: {
          event: 'referral',
          round: null,
          wallet: {
            netWorth: netWorth(updated.balance, updated.debt),
            debt: updated.debt,
            loans: updated.loans,
            spins: updated.spins,
            bestStreak: updated.bestStreak,
            pendingSpins: pending,
          },
          wasBankrupt: updated.brokeAt !== null,
          previousColorStreak: null,
          lifetimeZeros: 0,
          referral: { activated: activated?.n ?? 0, seasonCommissions: commissions },
        },
      })
      return {
        referrerId,
        amount,
        commissions,
        wallet: this.#d.views.wallet(updated, season.id, pending),
        unlocked,
      }
    })
  }

  /**
   * Tiradas jugadas por el usuario (todas las temporadas; desde `since` si se da), contando como
   * mucho hasta `cap`: solo hace falta saber si llega al umbral.
   */
  async #spins(db: Executor, userId: string, since: Date | null, cap: number): Promise<number> {
    const conditions: SQL[] = [eq(rounds.userId, userId), eq(rounds.status, 'resolved')]
    if (since) conditions.push(gte(rounds.resolvedAt, since))
    const played = db
      .select({ one: sql`1`.as('one') })
      .from(rounds)
      .where(and(...conditions))
      .limit(cap)
      .as('played')
    const [row] = await db.select({ n: count() }).from(played)
    return row?.n ?? 0
  }
}
