// SPDX-License-Identifier: AGPL-3.0-or-later
// IP real del cliente para el rate limit. La cabecera del proxy (p. ej. `CF-Connecting-IP`)
// solo se cree si la conexión llega desde un rango de confianza; si no, cualquiera podría
// inventársela y saltarse el límite.
import { BlockList, isIP } from 'node:net'

export interface RealIpResolver {
  (
    remoteAddress: string | undefined,
    headers: Record<string, string | string[] | undefined>,
  ): string
}

/** Quita el prefijo `::ffff:` de las IPv4 vistas por un socket IPv6. */
export function normalizeAddress(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  return mapped?.[1] ?? address
}

export function buildTrustList(cidrs: readonly string[]): BlockList {
  const list = new BlockList()
  for (const cidr of cidrs) {
    const [address = '', prefix] = cidr.split('/')
    const family = isIP(address) === 6 ? 'ipv6' : 'ipv4'
    if (prefix === undefined) list.addAddress(address, family)
    else list.addSubnet(address, Number(prefix), family)
  }
  return list
}

export function createRealIpResolver(cidrs: readonly string[], header: string): RealIpResolver {
  const trusted = buildTrustList(cidrs)
  const headerName = header.toLowerCase()
  return (remoteAddress, headers) => {
    const peer = normalizeAddress(remoteAddress ?? '')
    if (peer === '' || cidrs.length === 0) return peer || 'unknown'
    const family = isIP(peer)
    if (family === 0 || !trusted.check(peer, family === 6 ? 'ipv6' : 'ipv4')) return peer
    const raw = headers[headerName]
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
    if (value === undefined || isIP(value) === 0) return peer
    return normalizeAddress(value)
  }
}

/** Grupos de 16 bits de una parte de una IPv6 (admite una IPv4 incrustada al final). */
function parseGroups(part: string): number[] {
  if (part === '') return []
  const groups: number[] = []
  for (const piece of part.split(':')) {
    if (piece.includes('.')) {
      const [a = 0, b = 0, c = 0, d = 0] = piece.split('.').map(Number)
      groups.push((a << 8) | b, (c << 8) | d)
    } else {
      groups.push(Number.parseInt(piece, 16))
    }
  }
  return groups
}

/** Los 8 grupos de una IPv6 ya validada con `isIP` (expande `::` y quita la zona `%eth0`). */
function ipv6Groups(address: string): number[] {
  const [head = '', tail] = (address.split('%')[0] ?? '').split('::')
  const first = parseGroups(head)
  if (tail === undefined) return first
  const last = parseGroups(tail)
  return [...first, ...Array<number>(8 - first.length - last.length).fill(0), ...last]
}

/**
 * Clave del rate limit por IP. Una IPv4 cuenta sola; una IPv6 cuenta por su prefijo
 * (`RATE_LIMIT_IPV6_PREFIX`, normalmente /64): cualquier conexión doméstica recibe al menos un
 * /64 y podría estrenar una dirección en cada petición para saltarse el límite.
 */
export function rateLimitKeyOf(ip: string, ipv6Prefix: number): string {
  if (isIP(ip) !== 6) return ip
  const masked = ipv6Groups(ip).map((group, i) => {
    const bits = Math.max(0, Math.min(16, ipv6Prefix - i * 16))
    const mask = bits === 0 ? 0 : (0xffff << (16 - bits)) & 0xffff
    return (group & mask).toString(16)
  })
  return `${masked.join(':')}/${ipv6Prefix}`
}
