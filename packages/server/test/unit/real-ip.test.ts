// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'

import { createRealIpResolver, normalizeAddress, rateLimitKeyOf } from '../../src/lib/real-ip.ts'

// Dos rangos reales de Cloudflare (cloudflare.com/ips) como ejemplo de test.
const CLOUDFLARE = ['173.245.48.0/20', '2400:cb00::/32']

describe('IP real', () => {
  it('sin rangos de confianza, siempre la IP directa', () => {
    const resolve = createRealIpResolver([], 'cf-connecting-ip')
    expect(resolve('203.0.113.9', { 'cf-connecting-ip': '1.1.1.1' })).toBe('203.0.113.9')
  })

  it('la cabecera solo cuenta si la conexión viene de un rango de confianza', () => {
    const resolve = createRealIpResolver(CLOUDFLARE, 'CF-Connecting-IP')
    expect(resolve('173.245.48.10', { 'cf-connecting-ip': '198.51.100.1' })).toBe('198.51.100.1')
    expect(resolve('2400:cb00::1', { 'cf-connecting-ip': '2001:db8::5' })).toBe('2001:db8::5')
    expect(resolve('203.0.113.9', { 'cf-connecting-ip': '198.51.100.1' })).toBe('203.0.113.9')
  })

  it('ignora cabeceras vacías, repetidas raras o que no son IPs', () => {
    const resolve = createRealIpResolver(CLOUDFLARE, 'cf-connecting-ip')
    const peer = '173.245.48.10'
    expect(resolve(peer, {})).toBe(peer)
    expect(resolve(peer, { 'cf-connecting-ip': 'nope' })).toBe(peer)
    expect(resolve(peer, { 'cf-connecting-ip': '1.2.3.4, 5.6.7.8' })).toBe(peer)
    expect(resolve(peer, { 'cf-connecting-ip': ['9.9.9.9', '8.8.8.8'] })).toBe('9.9.9.9')
  })

  it('entiende las IPv4 mapeadas en IPv6 y sockets sin dirección', () => {
    expect(normalizeAddress('::ffff:173.245.48.10')).toBe('173.245.48.10')
    const resolve = createRealIpResolver(['173.245.48.0/20', '10.0.0.1'], 'x-real-ip')
    expect(resolve('::ffff:173.245.48.10', { 'x-real-ip': '198.51.100.2' })).toBe('198.51.100.2')
    expect(resolve('10.0.0.1', { 'x-real-ip': '198.51.100.3' })).toBe('198.51.100.3')
    expect(resolve(undefined, {})).toBe('unknown')
  })
})

describe('clave del rate limit por IP', () => {
  it('agrupa las IPv6 por prefijo (cambiar de dirección dentro de un /64 no da cupo nuevo)', () => {
    expect(rateLimitKeyOf('2001:db8::1', 64)).toBe(rateLimitKeyOf('2001:db8::ffff:1:2:3', 64))
    expect(rateLimitKeyOf('2001:db8:0:0:abcd::9', 64)).toBe(rateLimitKeyOf('2001:db8::', 64))
    expect(rateLimitKeyOf('2001:db8:0:1::1', 64)).not.toBe(rateLimitKeyOf('2001:db8::1', 64))
    expect(rateLimitKeyOf('2001:db8:aa::1', 48)).toBe(rateLimitKeyOf('2001:db8:aa:ff::2', 48))
    expect(rateLimitKeyOf('2001:db8::1', 128)).not.toBe(rateLimitKeyOf('2001:db8::2', 128))
  })

  it('las IPv4 y lo que no es una IP se quedan como están', () => {
    expect(rateLimitKeyOf('203.0.113.9', 64)).toBe('203.0.113.9')
    expect(rateLimitKeyOf('unknown', 64)).toBe('unknown')
  })
})
