// SPDX-License-Identifier: AGPL-3.0-or-later
// Modelo de datos (Drizzle). Las migraciones de `drizzle/` se generan a partir de este archivo
// con `pnpm --filter @vibe-gambling/server db:generate`; nunca se editan a mano.
//
// Reglas:
// - Monedas en `bigint` (modo number: siempre dentro de Number.MAX_SAFE_INTEGER por el tope de deuda).
// - Todo lo que cuelga de un usuario se borra en cascada al borrar la cuenta.
// - Los tokens (sesión, enlace, polling) solo se guardan como SHA-256 en hexadecimal.
import type { Bet } from '@vibe-gambling/shared'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const coins = (name: string) => bigint(name, { mode: 'number' })

// ---------------------------------------------------------------- usuarios y sesiones

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Id numérico de GitHub: lo único estable (el login puede cambiar). */
    githubId: bigint('github_id', { mode: 'number' }).notNull(),
    login: text('login').notNull(),
    avatarUrl: text('avatar_url').notNull(),
    /**
     * Cuándo se creó la cuenta de GitHub (`created_at` del perfil público), para la regla
     * antiabuso de `leaderboard.minAccountAgeDays`. Se rellena en cada login; `null` en las
     * cuentas de antes de la regla que aún no han vuelto a entrar (cuentan como antiguas).
     */
    githubCreatedAt: ts('github_created_at'),
    hidden: boolean('hidden').notNull().default(false),
    locale: text('locale'),
    /** Última apuesta resuelta (para repetirla si no apuesta). */
    lastBets: jsonb('last_bets').$type<Bet[]>(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  t => [
    uniqueIndex('users_github_id_key').on(t.githubId),
    // Solo el formato del código: la lista de idiomas válidos sale de `locales/` (localeSchema) y
    // un idioma nuevo no necesita migración.
    check(
      'users_locale_check',
      sql`${t.locale} is null or ${t.locale} ~ '^[a-z]{2,3}(-[A-Z]{2})?$'`,
    ),
  ],
)

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    kind: text('kind').$type<'mod' | 'web'>().notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  t => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
    check('sessions_kind_check', sql`${t.kind} in ('mod', 'web')`),
  ],
)

/** Códigos de un solo uso que la web canjea por una cookie de sesión. */
export const linkCodes = pgTable(
  'link_codes',
  {
    codeHash: text('code_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
  },
  t => [
    index('link_codes_user_id_idx').on(t.userId),
    index('link_codes_expires_at_idx').on(t.expiresAt),
  ],
)

/**
 * Logins de GitHub en curso (Device Flow). El `device_code` de GitHub vive solo aquí y nunca
 * sale del servidor: el mod hace polling con un `pollId` opaco del que solo guardamos el hash.
 * La fila se borra al terminar (bien, mal o caducada).
 */
export const deviceAuths = pgTable(
  'device_auths',
  {
    pollIdHash: text('poll_id_hash').primaryKey(),
    deviceCode: text('device_code').notNull(),
    /** Intervalo mínimo entre consultas a GitHub (s); sube con cada `slow_down`. */
    intervalSeconds: integer('interval_seconds').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    lastPolledAt: ts('last_polled_at'),
  },
  t => [index('device_auths_expires_at_idx').on(t.expiresAt)],
)

// ---------------------------------------------------------------- temporadas y carteras

export const seasons = pgTable('seasons', {
  /** `AAAA-MM`. */
  id: text('id').primaryKey(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  closedAt: ts('closed_at'),
})

/**
 * Cartera de un usuario en una temporada. Se crea de forma perezosa con la primera operación
 * de dinero. Su fila es el cerrojo de todo lo que toca el dinero del usuario (`FOR UPDATE`).
 * El boleto (`slip`) vive aquí: sus fichas ya están descontadas de `balance`.
 */
export const wallets = pgTable(
  'wallets',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id),
    balance: coins('balance').notNull(),
    debt: coins('debt').notNull().default(0),
    netWorth: coins('net_worth')
      .notNull()
      .generatedAlwaysAs(sql`balance - debt`),
    spins: integer('spins').notNull().default(0),
    loans: integer('loans').notNull().default(0),
    currentStreak: integer('current_streak').notNull().default(0),
    bestStreak: integer('best_streak').notNull().default(0),
    slip: jsonb('slip')
      .$type<Bet[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /**
     * Primera vez en la temporada que el patrimonio cayó a 0 o menos (BANCARROTA — CONTINUE?).
     * Solo se enseña una vez por temporada; null si aún no ha pasado.
     */
    brokeAt: ts('broke_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  t => [
    primaryKey({ columns: [t.userId, t.seasonId] }),
    // Rankings: arruinados (asc) y ricos (desc) usan el mismo índice; más tiradas el suyo.
    index('wallets_season_net_worth_idx').on(t.seasonId, t.netWorth),
    index('wallets_season_spins_idx').on(t.seasonId, t.spins),
    check('wallets_balance_check', sql`${t.balance} >= 0`),
    check('wallets_debt_check', sql`${t.debt} >= 0`),
    check('wallets_spins_check', sql`${t.spins} >= 0`),
  ],
)

export const loans = pgTable(
  'loans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id),
    amount: coins('amount').notNull(),
    /** Interés por tirada vigente al conceder el préstamo (0,02 = 2 %). */
    interestPerSpin: doublePrecision('interest_per_spin').notNull(),
    /** Tiradas de la temporada que llevaba al pedirlo (marca ▼ de la gráfica de ESTADÍSTICAS). */
    afterSpin: integer('after_spin'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  t => [index('loans_user_season_idx').on(t.userId, t.seasonId)],
)

// ---------------------------------------------------------------- rondas, turnos y apuestas

export const rounds = pgTable(
  'rounds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id),
    /**
     * `open`: gira mientras Claude piensa. `resolved`: ya tiene número. `expired`: se cerró sin
     * tirada. `deferred`: tirada pendiente (el turno acabó sin ventana visible) que espera a que
     * el jugador la gaste con GIRAR.
     */
    status: text('status').$type<'open' | 'resolved' | 'expired' | 'deferred'>().notNull(),
    /** Cuándo empezó a girar (en una tirada pendiente, cuándo se gastó). */
    openedAt: ts('opened_at').notNull(),
    resolvedAt: ts('resolved_at'),
    expiredAt: ts('expired_at'),
    revealAt: ts('reveal_at'),
    /** Cuándo se guardó como tirada pendiente (null si se jugó en directo). */
    deferredAt: ts('deferred_at'),
    /**
     * Turno que cerró la ronda: la resolvió, la guardó como pendiente o la descartó por el tope
     * (para responder igual a sus reintentos).
     */
    resolvedByTurnId: text('resolved_by_turn_id'),
    /** `requestId` del GIRAR que gastó esta tirada pendiente (idempotencia de los reintentos). */
    spendRequestId: text('spend_request_id'),
    result: smallint('result'),
    source: text('source').$type<'slip' | 'repeat' | 'default' | 'none'>(),
    staked: coins('staked'),
    returned: coins('returned'),
    net: coins('net'),
    jackpot: boolean('jackpot'),
    gitPushOk: boolean('git_push_ok'),
    testFailed: boolean('test_failed'),
    durationMs: integer('duration_ms'),
    interestCharged: coins('interest_charged'),
    colorStreakColor: text('color_streak_color').$type<'red' | 'black' | 'green'>(),
    colorStreakCount: integer('color_streak_count'),
    /** Número de tirada dentro de la temporada (1, 2, 3…): orden estable de las estadísticas. */
    spinNumber: integer('spin_number'),
    /** Racha del jugador justo después de esta tirada (para el ON FIRE del espectáculo). */
    streakAfter: integer('streak_after'),
    /** Patrimonio justo después de esta tirada (gráfica de ESTADÍSTICAS). */
    netWorthAfter: coins('net_worth_after'),
    /** Si en esta tirada el patrimonio cayó a 0 o menos por primera vez en la temporada. */
    wentBroke: boolean('went_broke'),
  },
  t => [
    // Una sola ronda abierta por usuario, garantizado por la base de datos.
    uniqueIndex('rounds_one_open_per_user_key')
      .on(t.userId)
      .where(sql`${t.status} = 'open'`),
    index('rounds_user_resolved_idx').on(t.userId, t.resolvedAt),
    index('rounds_season_status_idx').on(t.seasonId, t.status),
    // Cola de tiradas pendientes de cada usuario y temporada, de la más antigua a la última.
    index('rounds_user_deferred_idx')
      .on(t.userId, t.seasonId, t.deferredAt)
      .where(sql`${t.status} = 'deferred'`),
    // Estadísticas de la temporada: tiradas resueltas de un usuario en orden.
    index('rounds_user_season_resolved_idx')
      .on(t.userId, t.seasonId, t.resolvedAt)
      .where(sql`${t.status} = 'resolved'`),
    // "Coleccionista de ceros": cuántas veces le ha salido el 0 (todas las temporadas).
    index('rounds_user_zero_idx')
      .on(t.userId)
      .where(sql`${t.status} = 'resolved' and ${t.result} = 0`),
    // Último `revealAt` del usuario: el ritmo de GIRAR lo marca la animación.
    index('rounds_user_reveal_idx').on(t.userId, t.revealAt),
    uniqueIndex('rounds_spend_request_key')
      .on(t.userId, t.spendRequestId)
      .where(sql`${t.spendRequestId} is not null`),
    check('rounds_status_check', sql`${t.status} in ('open', 'resolved', 'expired', 'deferred')`),
    check(
      'rounds_deferred_check',
      sql`${t.status} <> 'deferred' or (${t.deferredAt} is not null and ${t.resolvedByTurnId} is not null)`,
    ),
    check('rounds_result_check', sql`${t.result} is null or (${t.result} between 0 and 36)`),
  ],
)

/** Turnos de Claude Code ya vistos: la clave de idempotencia es (usuario, turnId). */
export const turns = pgTable(
  'turns',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    turnId: text('turn_id').notNull(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    reused: boolean('reused').notNull(),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at'),
  },
  t => [primaryKey({ columns: [t.userId, t.turnId] }), index('turns_round_id_idx').on(t.roundId)],
)

export const bets = pgTable(
  'bets',
  {
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    kind: text('kind').notNull(),
    selection: jsonb('selection').$type<Bet['selection']>().notNull(),
    amount: coins('amount').notNull(),
    won: boolean('won').notNull(),
    payout: coins('payout').notNull(),
  },
  t => [
    primaryKey({ columns: [t.roundId, t.position] }),
    check('bets_amount_check', sql`${t.amount} > 0`),
  ],
)

// ---------------------------------------------------------------- logros

/**
 * Logros de broma conseguidos (`ACHIEVEMENTS` de shared). Son para siempre: uno por usuario y
 * logro, con la temporada en la que se consiguió. No guarda nada del usuario aparte del id.
 */
export const achievements = pgTable(
  'achievements',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievementId: text('achievement_id').notNull(),
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id),
    unlockedAt: ts('unlocked_at').notNull(),
  },
  t => [primaryKey({ columns: [t.userId, t.achievementId] })],
)

// ---------------------------------------------------------------- Salón de la Ruina

export const hallOfRuin = pgTable(
  'hall_of_ruin',
  {
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id),
    rank: smallint('rank').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    netWorth: coins('net_worth').notNull(),
    spins: integer('spins').notNull(),
  },
  t => [
    primaryKey({ columns: [t.seasonId, t.rank] }),
    index('hall_of_ruin_user_id_idx').on(t.userId),
  ],
)

export type UserRow = typeof users.$inferSelect
export type SessionRow = typeof sessions.$inferSelect
export type WalletRow = typeof wallets.$inferSelect
export type RoundRow = typeof rounds.$inferSelect
export type TurnRow = typeof turns.$inferSelect
export type AchievementRow = typeof achievements.$inferSelect
