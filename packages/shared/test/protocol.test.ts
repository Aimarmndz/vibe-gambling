// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import {
  clientMessageSchema,
  leaderboardQuerySchema,
  logoutRequestSchema,
  PROTOCOL_VERSION,
  serverMessageSchema,
  settingsRequestSchema,
  turnEndRequestSchema,
  turnStartRequestSchema,
} from '../src/index.ts'

describe('protocolo', () => {
  it('va por la versión 1', () => {
    expect(PROTOCOL_VERSION).toBe(1)
  })

  it('turn/start y turn/end solo aceptan los campos permitidos (privacidad)', () => {
    const start = { v: 1, turnId: 'abc12345-xyz', pluginVersion: '0.1.0', os: 'linux' }
    expect(turnStartRequestSchema.parse(start)).toEqual(start)
    expect(turnStartRequestSchema.safeParse({ ...start, prompt: 'secreto' }).success).toBe(false)
    expect(turnStartRequestSchema.safeParse({ ...start, cwd: '/home/x' }).success).toBe(false)

    const end = { ...start, durationMs: 1234, gitPushOk: true, testFailed: false }
    expect(turnEndRequestSchema.parse(end)).toEqual(end)
    expect(turnEndRequestSchema.safeParse({ ...end, command: 'git push' }).success).toBe(false)
    expect(turnEndRequestSchema.safeParse({ ...end, durationMs: -1 }).success).toBe(false)
  })

  it('logout: solo la versión, nada más', () => {
    expect(logoutRequestSchema.parse({ v: 1 })).toEqual({ v: 1 })
    expect(logoutRequestSchema.safeParse({ v: 1, all: true }).success).toBe(false)
  })

  it('rechaza versiones de protocolo desconocidas', () => {
    expect(clientMessageSchema.safeParse({ v: 2, type: 'sync' }).success).toBe(false)
  })

  it('valida los mensajes del cliente', () => {
    expect(
      clientMessageSchema.parse({
        v: 1,
        type: 'bet.place',
        selection: { kind: 'split', numbers: [2, 1] },
        amount: 50,
      }),
    ).toEqual({
      v: 1,
      type: 'bet.place',
      selection: { kind: 'split', numbers: [1, 2] },
      amount: 50,
    })
    expect(
      clientMessageSchema.safeParse({
        v: 1,
        type: 'bet.place',
        selection: { kind: 'red' },
        amount: -5,
      }).success,
    ).toBe(false)
    expect(clientMessageSchema.safeParse({ v: 1, type: 'admin.giveMeMoney' }).success).toBe(false)
  })

  it('valida los mensajes del servidor', () => {
    expect(serverMessageSchema.parse({ v: 1, type: 'pong', t: 5 })).toEqual({
      v: 1,
      type: 'pong',
      t: 5,
    })
    expect(serverMessageSchema.safeParse({ v: 1, type: 'bye', reason: 'nope' }).success).toBe(false)
  })

  it('ajustes: al menos un campo', () => {
    expect(settingsRequestSchema.safeParse({ v: 1 }).success).toBe(false)
    expect(settingsRequestSchema.parse({ v: 1, hidden: true })).toEqual({ v: 1, hidden: true })
  })

  it('ranking: valores por defecto y límites', () => {
    expect(leaderboardQuerySchema.parse({})).toEqual({ board: 'broke', limit: 50 })
    expect(leaderboardQuerySchema.parse({ limit: '10', season: '2026-10' })).toEqual({
      board: 'broke',
      limit: 10,
      season: '2026-10',
    })
    expect(leaderboardQuerySchema.safeParse({ limit: 1000 }).success).toBe(false)
  })
})
