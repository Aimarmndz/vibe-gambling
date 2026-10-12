// SPDX-License-Identifier: AGPL-3.0-or-later
/** Misma URL de Postgres apuntando a otra base de datos. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url)
  u.pathname = `/${database}`
  return u.toString()
}
