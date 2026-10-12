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
