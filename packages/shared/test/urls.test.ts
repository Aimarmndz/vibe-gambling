// SPDX-License-Identifier: AGPL-3.0-or-later
// Las URLs del contrato acaban en un `href` o un `src` de la web o del mod: solo http y https.
import { describe, expect, it } from 'vitest'

import {
  deviceStartResponseSchema,
  httpUrlSchema,
  instanceInfoSchema,
  linkResponseSchema,
  metaResponseSchema,
  opaqueTokenSchema,
  PROTOCOL_VERSION,
  publicUserSchema,
  selfUserSchema,
  toPublicGameConfig,
  webConfigSchema,
} from '../src/index.ts'
import { testGameConfig } from './fixtures.ts'

const HOSTILE = [
  'javascript:alert(1)',
  'javascript://example.test/%0Aalert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'ftp://example.test/x',
  'blob:https://example.test/0b9a8d3c',
]

const instance = {
  operator: { name: 'Operator', url: 'https://example.test/operator' },
  hosting: { en: 'a box in the EU', es: 'una máquina en la UE' },
  networkProxy: 'Some CDN',
  contact: { label: 'example.test/contact', url: 'https://example.test/contact' },
  backupRetentionDays: 14,
}

const webConfig = {
  v: PROTOCOL_VERSION,
  publicUrl: 'http://localhost:8787',
  instanceName: 'test',
  isOfficial: false,
  serverVersion: '0.0.0',
  game: toPublicGameConfig(testGameConfig()),
  privacy: {
    imageOrigins: ['https://avatars.example.test'],
    modSessionTtlSeconds: 31_536_000,
    webSessionTtlSeconds: 2_592_000,
    linkCodeTtlSeconds: 60,
    ipMemorySeconds: 60,
  },
  site: {
    author: { name: 'Author', url: 'https://example.test/author' },
    repoUrl: 'https://example.test/repo',
    installCommand: '/plugin install test',
    helpLinks: { en: [{ label: 'Help', url: 'https://example.test/help' }], es: [] },
    moreProjects: [{ label: 'Other', url: 'https://example.test/other', description: 'x' }],
    instance,
  },
}

/** Copia de `webConfig` con `value` en la ruta `path`. */
function withValue(path: readonly (string | number)[], value: unknown): unknown {
  const copy = structuredClone(webConfig) as unknown as Record<string | number, unknown>
  let node = copy
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>
  node[path.at(-1)!] = value
  return copy
}

describe('URLs del contrato', () => {
  it('httpUrlSchema acepta http y https (también localhost con puerto)', () => {
    for (const ok of [
      'https://github.com/Aimarmndz',
      'http://localhost:8787',
      'https://avatars.githubusercontent.com/u/1?v=4',
    ]) {
      expect(httpUrlSchema.safeParse(ok).success, ok).toBe(true)
    }
  })

  it('httpUrlSchema rechaza cualquier otro esquema y lo que no es una URL', () => {
    const others = ['not a url', '', '//example.test/x', '/relative', 'HTTPS://EXAMPLE.TEST/x']
    for (const bad of [...HOSTILE, ...others]) {
      expect(httpUrlSchema.safeParse(bad).success, bad).toBe(false)
    }
  })

  it('usuarios: avatar y perfil solo http(s)', () => {
    const user = {
      login: 'octo',
      avatarUrl: 'https://avatars.example.test/1',
      profileUrl: 'https://github.example.test/octo',
    }
    expect(publicUserSchema.safeParse(user).success).toBe(true)
    for (const bad of HOSTILE) {
      expect(publicUserSchema.safeParse({ ...user, avatarUrl: bad }).success, bad).toBe(false)
      expect(publicUserSchema.safeParse({ ...user, profileUrl: bad }).success, bad).toBe(false)
      expect(
        selfUserSchema.safeParse({
          ...user,
          avatarUrl: bad,
          hidden: false,
          locale: null,
          createdAt: '2026-10-01T00:00:00.000Z',
        }).success,
        bad,
      ).toBe(false)
    }
  })

  it('meta, Device Flow y enlace de la ventana: solo http(s)', () => {
    const token = 'a'.repeat(43)
    expect(opaqueTokenSchema.safeParse(token).success).toBe(true)
    const meta = {
      v: PROTOCOL_VERSION,
      protocol: PROTOCOL_VERSION,
      name: 'test',
      isOfficial: false,
      serverVersion: '0.0.0',
      publicUrl: 'https://vibe.example.test',
    }
    const device = {
      v: PROTOCOL_VERSION,
      pollId: token,
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.example.test/login/device',
      expiresIn: 900,
      interval: 5,
    }
    const link = {
      v: PROTOCOL_VERSION,
      url: `https://vibe.example.test/play?code=${token}`,
      expiresIn: 60,
    }
    expect(metaResponseSchema.safeParse(meta).success).toBe(true)
    expect(deviceStartResponseSchema.safeParse(device).success).toBe(true)
    expect(linkResponseSchema.safeParse(link).success).toBe(true)
    for (const bad of HOSTILE) {
      expect(metaResponseSchema.safeParse({ ...meta, publicUrl: bad }).success, bad).toBe(false)
      expect(
        deviceStartResponseSchema.safeParse({ ...device, verificationUri: bad }).success,
        bad,
      ).toBe(false)
      expect(linkResponseSchema.safeParse({ ...link, url: bad }).success, bad).toBe(false)
    }
  })

  it('/config.json: toda URL (autor, repo, ayuda, proyectos, instancia, imágenes) solo http(s)', () => {
    expect(webConfigSchema.safeParse(webConfig).success).toBe(true)
    const paths: (string | number)[][] = [
      ['publicUrl'],
      ['privacy', 'imageOrigins', 0],
      ['site', 'author', 'url'],
      ['site', 'repoUrl'],
      ['site', 'helpLinks', 'en', 0, 'url'],
      ['site', 'moreProjects', 0, 'url'],
      ['site', 'instance', 'operator', 'url'],
      ['site', 'instance', 'contact', 'url'],
    ]
    for (const path of paths) {
      for (const bad of HOSTILE) {
        const result = webConfigSchema.safeParse(withValue(path, bad))
        expect(result.success, `${path.join('.')} = ${bad}`).toBe(false)
        expect(result.error?.issues[0]?.path).toEqual(path)
      }
    }
  })
})

describe('datos de la instancia (/privacy)', () => {
  it('acepta una instancia sin proxy ni copias de seguridad', () => {
    expect(
      instanceInfoSchema.safeParse({ ...instance, networkProxy: null, backupRetentionDays: null })
        .success,
    ).toBe(true)
  })

  it('exige el alojamiento en el idioma de referencia; los demás caen en él si faltan', () => {
    // Un idioma nuevo (carpeta en locales/) no obliga a tocar la configuración de la instancia.
    expect(instanceInfoSchema.safeParse({ ...instance, hosting: { es: 'UE' } }).success).toBe(false)
    expect(instanceInfoSchema.safeParse({ ...instance, hosting: { en: 'EU' } }).success).toBe(true)
    expect(
      instanceInfoSchema.safeParse({ ...instance, hosting: { en: 'EU', xx: 'nope' } }).success,
    ).toBe(false)
  })

  it('la retención de las copias es un número entero de días razonable', () => {
    for (const bad of [0, -1, 1.5, 3651, '14']) {
      expect(
        instanceInfoSchema.safeParse({ ...instance, backupRetentionDays: bad }).success,
        String(bad),
      ).toBe(false)
    }
  })

  it('no acepta campos de más (la configuración se valida estricta)', () => {
    expect(instanceInfoSchema.safeParse({ ...instance, analytics: 'yes' }).success).toBe(false)
    expect(
      webConfigSchema.safeParse(withValue(['privacy', 'tracker'], 'https://example.test')).success,
    ).toBe(false)
  })

  it('/config.json exige los datos de privacidad del servidor', () => {
    const { privacy: _privacy, ...rest } = webConfig
    expect(webConfigSchema.safeParse(rest).success).toBe(false)
    expect(webConfigSchema.safeParse(withValue(['privacy', 'linkCodeTtlSeconds'], 0)).success).toBe(
      false,
    )
    expect(webConfigSchema.safeParse(withValue(['privacy', 'ipMemorySeconds'], 0)).success).toBe(
      false,
    )
    const { ipMemorySeconds: _ip, ...withoutIp } = webConfig.privacy
    expect(webConfigSchema.safeParse({ ...webConfig, privacy: withoutIp }).success).toBe(false)
  })
})
