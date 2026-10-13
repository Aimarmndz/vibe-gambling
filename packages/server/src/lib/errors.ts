// SPDX-License-Identifier: AGPL-3.0-or-later
// Errores de la aplicación con su código del protocolo (`ERROR_CODES`) y su estado HTTP.
import type { ErrorCode } from '@vibe-gambling/shared'

const STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  insufficient_funds: 422,
  too_many_bets: 422,
  invalid_bet: 422,
  loan_not_allowed: 422,
  daily_limit: 429,
  protocol_mismatch: 400,
  github_unavailable: 502,
  internal: 500,
})

export class AppError extends Error {
  override name = 'AppError'
  readonly code: ErrorCode
  readonly statusCode: number

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.code = code
    this.statusCode = STATUS[code]
  }
}

export function statusOf(code: ErrorCode): number {
  return STATUS[code]
}
