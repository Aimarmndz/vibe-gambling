// SPDX-License-Identifier: AGPL-3.0-or-later
// Tokens opacos de 256 bits (sesiones, enlaces, polling). En la base de datos solo va su SHA-256.
// Y los códigos de afiliado, que son públicos (van en el enlace) y se guardan tal cual.
import { createHash, randomBytes, randomInt } from 'node:crypto'

import { makeReferralCode } from '@vibe-gambling/shared'

/** Bytes de entropía de cada token: 32 bytes = 256 bits = 43 caracteres en base64url. */
const TOKEN_BYTES = 32

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** Hash hexadecimal (64 caracteres) con el que se guarda y se busca un token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Código de afiliado aleatorio (`crypto.randomInt`, uniforme en el alfabeto de shared). */
export function generateReferralCode(): string {
  return makeReferralCode(n => randomInt(0, n))
}
