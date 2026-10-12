// SPDX-License-Identifier: AGPL-3.0-or-later
// Cabeceras de seguridad (helmet + CSP estricta) y comprobación del `Origin`.
import type { FastifyHelmetOptions } from '@fastify/helmet'
import type { FastifyRequest } from 'fastify'

import type { Config } from '../config.ts'

function wsOriginOf(origin: string): string {
  return origin.replace(/^http/, 'ws')
}

/** CSP sin `unsafe-inline` ni `unsafe-eval`: todo (scripts, estilos, shaders) va en el bundle. */
export function helmetOptions(config: Config): FastifyHelmetOptions {
  const https = config.env.PUBLIC_URL.startsWith('https://')
  const origins = [...config.allowedOrigins]
  return {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', ...config.env.CSP_IMG_ORIGINS],
        fontSrc: ["'self'"],
        mediaSrc: ["'self'"],
        connectSrc: ["'self'", ...origins.map(wsOriginOf)],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(https ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // Los avatares de GitHub son de otro origen y no mandan CORP: sin COEP.
    crossOriginEmbedderPolicy: false,
    // HSTS solo tiene sentido (y efecto) sobre HTTPS.
    strictTransportSecurity: https
      ? { maxAge: config.env.HSTS_MAX_AGE_SECONDS, includeSubDomains: false }
      : false,
    referrerPolicy: { policy: 'no-referrer' },
  }
}

/** `Origin` de la petición; `null` si no lo trae (clientes que no son navegadores). */
export function originOf(request: FastifyRequest): string | null {
  const value = request.headers.origin
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function isAllowedOrigin(config: Config, origin: string | null): boolean {
  return origin !== null && config.allowedOrigins.has(origin)
}
