// SPDX-License-Identifier: AGPL-3.0-or-later
// Sesiones propias, enlaces de un solo uso y login con GitHub (Device Flow).
// Nunca se guarda un token en claro: solo su SHA-256. El token de GitHub ni siquiera se guarda.
import type {
  DevicePollResponse,
  DeviceStartResponse,
  Locale,
  SelfUser,
} from '@vibe-gambling/shared'
import { and, eq, gt, isNull, lte, or, sql } from 'drizzle-orm'

import type { Database } from '../db/client.ts'
import { deviceAuths, linkCodes, sessions, users } from '../db/schema.ts'
import type { SessionRow, UserRow } from '../db/schema.ts'
import type { Clock } from '../lib/clock.ts'
import { AppError } from '../lib/errors.ts'
import { generateToken, hashToken } from '../lib/tokens.ts'
import type { GitHubClient } from './github.ts'
import { slowDownInterval } from './github.ts'
import type { Notifier } from './notifier.ts'
import type { Views } from './views.ts'

export type SessionKind = 'mod' | 'web'

export interface AuthOptions {
  publicUrl: string
  modSessionTtlSeconds: number
  webSessionTtlSeconds: number
  sessionTouchIntervalSeconds: number
  linkCodeTtlSeconds: number
  devicePollLeewayMs: number
}

export interface AuthDeps {
  db: Database
  clock: Clock
  github: GitHubClient
  views: Views
  notifier: Notifier
  options: AuthOptions
}

export interface Authenticated {
  session: SessionRow
  user: UserRow
}

const V = 1 as const

export class AuthService {
  readonly #d: AuthDeps

  constructor(deps: AuthDeps) {
    this.#d = deps
  }

  // ---------------------------------------------------------------- sesiones

  async createSession(userId: string, kind: SessionKind): Promise<string> {
    const token = generateToken()
    const now = this.#d.clock.now()
    const ttl =
      kind === 'mod' ? this.#d.options.modSessionTtlSeconds : this.#d.options.webSessionTtlSeconds
    await this.#d.db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      kind,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + ttl * 1000),
    })
    return token
  }

  /** Sesión vigente para un token, o `null`. Actualiza `last_used_at` como mucho cada N segundos. */
  async authenticate(token: string): Promise<Authenticated | null> {
    const now = this.#d.clock.now()
    const [row] = await this.#d.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
    if (!row) return null
    const touchAfter =
      row.session.lastUsedAt.getTime() + this.#d.options.sessionTouchIntervalSeconds * 1000
    if (now.getTime() >= touchAfter) {
      await this.#d.db
        .update(sessions)
        .set({ lastUsedAt: now })
        .where(eq(sessions.id, row.session.id))
    }
    return row
  }

  /**
   * Si una sesión sigue valiendo (ni revocada, ni caducada, ni purgada, ni con la cuenta
   * borrada). La ventana la comprueba antes de cada acción: su WebSocket puede vivir más que
   * la sesión con la que se abrió.
   */
  async isSessionActive(sessionId: string): Promise<boolean> {
    const [row] = await this.#d.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, this.#d.clock.now()),
        ),
      )
    return row !== undefined
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.#d.db
      .update(sessions)
      .set({ revokedAt: this.#d.clock.now() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    this.#d.notifier.closeSession(sessionId, 'logout')
  }

  // ---------------------------------------------------------------- enlace de un solo uso

  async createLink(userId: string): Promise<{ url: string; expiresIn: number }> {
    const code = generateToken()
    const now = this.#d.clock.now()
    const ttl = this.#d.options.linkCodeTtlSeconds
    await this.#d.db.insert(linkCodes).values({
      codeHash: hashToken(code),
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl * 1000),
    })
    const url = new URL('/play', this.#d.options.publicUrl)
    url.searchParams.set('code', code)
    return { url: url.toString(), expiresIn: ttl }
  }

  /** Canjea un código: solo una vez y antes de que caduque (garantizado por un UPDATE atómico). */
  async redeemLink(code: string): Promise<{ token: string; user: SelfUser }> {
    const now = this.#d.clock.now()
    const [used] = await this.#d.db
      .update(linkCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(linkCodes.codeHash, hashToken(code)),
          isNull(linkCodes.usedAt),
          gt(linkCodes.expiresAt, now),
        ),
      )
      .returning({ userId: linkCodes.userId })
    if (!used) throw new AppError('unauthorized', 'This link has expired or was already used.')
    const [user] = await this.#d.db.select().from(users).where(eq(users.id, used.userId))
    if (!user) throw new AppError('unauthorized', 'This account no longer exists.')
    const token = await this.createSession(user.id, 'web')
    return { token, user: this.#d.views.selfUser(user) }
  }

  // ---------------------------------------------------------------- Device Flow

  async deviceStart(): Promise<DeviceStartResponse> {
    const code = await this.#d.github.requestDeviceCode()
    const pollId = generateToken()
    const now = this.#d.clock.now()
    await this.#d.db.insert(deviceAuths).values({
      pollIdHash: hashToken(pollId),
      deviceCode: code.deviceCode,
      intervalSeconds: code.interval,
      createdAt: now,
      expiresAt: new Date(now.getTime() + code.expiresIn * 1000),
    })
    return {
      v: V,
      pollId,
      userCode: code.userCode,
      verificationUri: code.verificationUri,
      expiresIn: code.expiresIn,
      interval: code.interval,
    }
  }

  async devicePoll(pollId: string): Promise<DevicePollResponse> {
    const db = this.#d.db
    const pollIdHash = hashToken(pollId)
    const now = this.#d.clock.now()
    const [row] = await db.select().from(deviceAuths).where(eq(deviceAuths.pollIdHash, pollIdHash))
    if (!row) return { v: V, status: 'expired' }
    if (row.expiresAt.getTime() <= now.getTime()) {
      await db.delete(deviceAuths).where(eq(deviceAuths.pollIdHash, pollIdHash))
      return { v: V, status: 'expired' }
    }

    // Reclamamos el turno de consulta con un UPDATE atómico: si dos polls llegan a la vez, o el
    // mod va más rápido que el intervalo, solo uno llega a GitHub (y GitHub no nos penaliza).
    const minGapMs = Math.max(0, row.intervalSeconds * 1000 - this.#d.options.devicePollLeewayMs)
    const threshold = new Date(now.getTime() - minGapMs)
    const [claimed] = await db
      .update(deviceAuths)
      .set({ lastPolledAt: now })
      .where(
        and(
          eq(deviceAuths.pollIdHash, pollIdHash),
          or(isNull(deviceAuths.lastPolledAt), lte(deviceAuths.lastPolledAt, threshold)),
        ),
      )
      .returning({
        deviceCode: deviceAuths.deviceCode,
        intervalSeconds: deviceAuths.intervalSeconds,
      })
    if (!claimed) return { v: V, status: 'pending', interval: row.intervalSeconds }

    const poll = await this.#d.github.pollAccessToken(claimed.deviceCode)
    switch (poll.kind) {
      case 'pending':
        return { v: V, status: 'pending', interval: claimed.intervalSeconds }
      case 'slow_down': {
        const interval = slowDownInterval(claimed.intervalSeconds, poll.interval)
        await db
          .update(deviceAuths)
          .set({ intervalSeconds: interval })
          .where(eq(deviceAuths.pollIdHash, pollIdHash))
        return { v: V, status: 'slow_down', interval }
      }
      case 'expired':
        await db.delete(deviceAuths).where(eq(deviceAuths.pollIdHash, pollIdHash))
        return { v: V, status: 'expired' }
      case 'denied':
        await db.delete(deviceAuths).where(eq(deviceAuths.pollIdHash, pollIdHash))
        return { v: V, status: 'denied' }
      case 'token': {
        // El token de GitHub vive solo en esta llamada: se pide el perfil y se descarta.
        const profile = await this.#d.github.fetchProfile(poll.accessToken)
        const { user, isNew } = await db.transaction(async tx => {
          const [upserted] = await tx
            .insert(users)
            .values({
              githubId: profile.id,
              login: profile.login,
              avatarUrl: profile.avatarUrl,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: users.githubId,
              set: { login: profile.login, avatarUrl: profile.avatarUrl, updatedAt: now },
            })
            .returning({ id: users.id, inserted: sql<boolean>`(xmax = 0)` })
          await tx.delete(deviceAuths).where(eq(deviceAuths.pollIdHash, pollIdHash))
          if (!upserted) throw new Error('el alta del usuario no devolvió fila')
          const [full] = await tx.select().from(users).where(eq(users.id, upserted.id))
          if (!full) throw new Error('usuario recién creado no encontrado')
          return { user: full, isNew: upserted.inserted }
        })
        const token = await this.createSession(user.id, 'mod')
        return { v: V, status: 'ok', token, user: this.#d.views.selfUser(user), isNew }
      }
    }
  }

  // ---------------------------------------------------------------- cuenta

  async updateSettings(
    userId: string,
    changes: { hidden?: boolean | undefined; locale?: Locale | null | undefined },
  ): Promise<SelfUser> {
    const set: Partial<Pick<UserRow, 'hidden' | 'locale' | 'updatedAt'>> = {
      updatedAt: this.#d.clock.now(),
    }
    if (changes.hidden !== undefined) set.hidden = changes.hidden
    if (changes.locale !== undefined) set.locale = changes.locale
    const [user] = await this.#d.db.update(users).set(set).where(eq(users.id, userId)).returning()
    if (!user) throw new AppError('unauthorized', 'This account no longer exists.')
    const view = this.#d.views.selfUser(user)
    this.#d.notifier.send(userId, { v: V, type: 'settings', user: view })
    return view
  }

  /** Borra la cuenta y todo lo que cuelga de ella (en cascada). Pide repetir el login. */
  async deleteAccount(user: UserRow, confirm: string): Promise<void> {
    if (confirm.trim().toLowerCase() !== user.login.toLowerCase()) {
      throw new AppError('invalid_request', 'Type your GitHub login to confirm.')
    }
    await this.#d.db.delete(users).where(eq(users.id, user.id))
    this.#d.notifier.closeUser(user.id, 'account_deleted')
  }

  /** Limpieza periódica: códigos, logins a medias y sesiones caducadas o revocadas. */
  async purgeExpired(): Promise<void> {
    const now = this.#d.clock.now()
    const db = this.#d.db
    await db
      .delete(linkCodes)
      .where(or(lte(linkCodes.expiresAt, now), sql`${linkCodes.usedAt} is not null`))
    await db.delete(deviceAuths).where(lte(deviceAuths.expiresAt, now))
    await db
      .delete(sessions)
      .where(or(lte(sessions.expiresAt, now), sql`${sessions.revokedAt} is not null`))
  }
}
