// SPDX-License-Identifier: AGPL-3.0-or-later
// Genera las secciones de esquemas de `docs/PROTOCOLO.md` a partir de los zod de `packages/shared`
// (con `toJSONSchema` de zod 4), para que la documentación del protocolo no se desincronice.
//
// El documento mezcla texto escrito a mano con bloques generados entre marcadores:
//
//   <!-- BEGIN GENERATED route:turnStart -->
//   …lo escribe este script…
//   <!-- END GENERATED route:turnStart -->
//
// Además, cada ejemplo precedido de `<!-- example: <nombreDelEsquema> -->` se valida contra ese
// esquema de `shared`: un ejemplo que ya no cumple el contrato hace fallar la comprobación.
//
// Uso: `node scripts/gen-protocol-docs.ts` (reescribe los bloques) o con `--check` (falla si el
// documento está desactualizado, si falta o sobra un bloque o si un ejemplo no valida).
// `packages/shared/test/protocol-docs.test.ts` ejecuta la misma comprobación en los tests.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, resolveConfig } from 'prettier'

import * as shared from '../packages/shared/src/index.ts'
import type { ApiRouteName } from '../packages/shared/src/protocol/routes.ts'
import { statusOf } from '../packages/server/src/lib/errors.ts'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const PROTOCOL_DOC = join(REPO_ROOT, 'docs/PROTOCOLO.md')

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

/** Lo que este script necesita de un esquema de zod 4. */
interface Documentable {
  toJSONSchema(params?: { io?: 'input' | 'output' }): unknown
  safeParse(data: unknown): { success: boolean; error?: { issues: unknown[] } }
}

/** Nombres de los esquemas exportados por `shared` (`turnStartRequestSchema`…). */
type SchemaName = Extract<keyof typeof shared, `${string}Schema`>

const EXPORTS = shared as unknown as Record<string, unknown>

function isDocumentable(value: unknown): value is Documentable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Documentable).toJSONSchema === 'function' &&
    typeof (value as Documentable).safeParse === 'function'
  )
}

function schemaByName(name: string): Documentable | null {
  const value = EXPORTS[name]
  return name.endsWith('Schema') && isDocumentable(value) ? value : null
}

function schemaOf(name: SchemaName): Documentable {
  const schema = schemaByName(name)
  if (!schema) throw new Error(`${name} no es un esquema de zod exportado por shared`)
  return schema
}

/**
 * JSON Schema de la **entrada** del esquema: lo que tiene que viajar por la red para que el otro
 * extremo lo acepte (los valores por defecto aparecen como opcionales).
 */
function jsonSchemaOf(name: SchemaName): JsonObject {
  const raw = schemaOf(name).toJSONSchema({ io: 'input' }) as JsonObject
  const { $schema: _ignored, ...rest } = raw
  return rest
}

// ---------------------------------------------------------------- piezas comunes

/** Esquemas que se documentan una vez y a los que el resto enlaza. Nombre → esquema. */
const COMMON = {
  PublicUser: 'publicUserSchema',
  SelfUser: 'selfUserSchema',
  Wallet: 'walletSchema',
  Slip: 'slipSchema',
  Bet: 'betSchema',
  BetSelection: 'betSelectionSchema',
  BetAmount: 'betAmountSchema',
  BetOutcome: 'betOutcomeSchema',
  ColorStreak: 'colorStreakSchema',
  OpenRound: 'openRoundSchema',
  Spectacle: 'spectacleSchema',
  ResolvedRound: 'resolvedRoundSchema',
  Achievement: 'achievementSchema',
  RoundSummary: 'roundSummarySchema',
  SeasonStats: 'seasonStatsSchema',
  BankEntry: 'bankEntrySchema',
  BankStatement: 'bankStatementSchema',
  LeaderboardRow: 'leaderboardRowSchema',
  HallOfRuinRow: 'hallOfRuinRowSchema',
  ReferralStatus: 'referralStatusSchema',
  PublicGameConfig: 'publicGameConfigSchema',
  ErrorResponse: 'errorResponseSchema',
} as const satisfies Record<string, SchemaName>
type CommonName = keyof typeof COMMON

const COMMON_BY_JSON: ReadonlyMap<string, CommonName> = new Map(
  (Object.keys(COMMON) as CommonName[]).map(name => [
    JSON.stringify(jsonSchemaOf(COMMON[name])),
    name,
  ]),
)

function commonOf(node: Json): CommonName | null {
  return COMMON_BY_JSON.get(JSON.stringify(node)) ?? null
}

/** Ancla de GitHub del título `### <Nombre>` de una pieza común. */
function anchor(name: CommonName): string {
  return `#${name.toLowerCase()}`
}

/**
 * Sustituye las piezas comunes anidadas por `{"$ref": "#/$defs/<Nombre>"}`. Para no repetir
 * `ResolvedRound` entero en cada mensaje, las definiciones no se copian en cada bloque: cada
 * `$defs/<Nombre>` es la sección <Nombre> de "Piezas comunes" del propio documento.
 */
function withRefs(root: JsonObject): JsonObject {
  const walk = (node: Json, isRoot: boolean): Json => {
    if (Array.isArray(node)) return node.map(item => walk(item, false))
    if (node === null || typeof node !== 'object') return node
    const common = isRoot ? null : commonOf(node)
    if (common) return { $ref: `#/$defs/${common}` }
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, false)]))
  }
  return walk(root, true) as JsonObject
}

// ---------------------------------------------------------------- resumen legible

function isObject(node: Json | undefined): node is JsonObject {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
}

function code(value: string): string {
  return `\`${value}\``
}

/** Límites numéricos sin los ±`Number.MAX_SAFE_INTEGER` que zod añade a todos los enteros. */
function bounds(node: JsonObject): string {
  const safe = (n: Json | undefined): n is number =>
    typeof n === 'number' && Math.abs(n) < Number.MAX_SAFE_INTEGER
  const min = safe(node.minimum) ? node.minimum : null
  const exMin = safe(node.exclusiveMinimum) ? node.exclusiveMinimum : null
  const max = safe(node.maximum) ? node.maximum : null
  if (min !== null && max !== null) return ` ${min}–${max}`
  const parts: string[] = []
  if (min !== null) parts.push(`≥ ${min}`)
  if (exMin !== null) parts.push(`> ${exMin}`)
  if (max !== null) parts.push(`≤ ${max}`)
  return parts.length > 0 ? ` ${parts.join(', ')}` : ''
}

function summarize(node: Json | undefined): string {
  if (!isObject(node)) return 'cualquiera'
  const common = commonOf(node)
  if (common) return `[${common}](${anchor(common)})`
  const fallback = 'default' in node ? ` (por defecto ${code(JSON.stringify(node.default))})` : ''
  if ('const' in node) return code(JSON.stringify(node.const))
  if (Array.isArray(node.enum)) return node.enum.map(v => code(JSON.stringify(v))).join(' | ')
  const variants = Array.isArray(node.anyOf) ? node.anyOf : node.oneOf
  if (Array.isArray(variants)) return variants.map(summarize).join(' | ') + fallback
  switch (node.type) {
    case 'string': {
      const extras: string[] = []
      if (typeof node.format === 'string') extras.push(node.format)
      if (typeof node.pattern === 'string') extras.push(code(`/${node.pattern}/`))
      const min = typeof node.minLength === 'number' ? node.minLength : null
      const max = typeof node.maxLength === 'number' ? node.maxLength : null
      if (min !== null || max !== null) extras.push(`${min ?? 0}–${max ?? '∞'} car.`)
      return `${code('string')}${extras.length > 0 ? ` (${extras.join(', ')})` : ''}${fallback}`
    }
    case 'integer':
    case 'number':
      return `${code(node.type)}${bounds(node)}${fallback}`
    case 'boolean':
      return code('boolean') + fallback
    case 'null':
      return code('null')
    case 'array': {
      const min = typeof node.minItems === 'number' ? node.minItems : null
      const max = typeof node.maxItems === 'number' ? node.maxItems : null
      const size = min !== null || max !== null ? ` (${min ?? 0}–${max ?? '∞'} elementos)` : ''
      const items = summarize(node.items)
      return `${items.includes(' | ') ? `(${items})` : items}[]${size}`
    }
    case 'object':
      return isObject(node.propertyNames)
        ? `${code('object')} (${summarize(node.propertyNames)} → ${summarize(node.additionalProperties)})`
        : `${code('object')} (ver JSON Schema)`
    default:
      return 'cualquiera'
  }
}

/** Celda de tabla Markdown: `|` escapado (GFM lo admite también dentro de `código`). */
function cell(text: string): string {
  return text.replaceAll('|', '\\|')
}

function fieldTable(node: JsonObject): string {
  const properties = isObject(node.properties) ? node.properties : {}
  const required = new Set(Array.isArray(node.required) ? node.required : [])
  const names = Object.keys(properties)
  if (names.length === 0) return '_Sin campos._'
  const rows = names.map(
    name =>
      `| ${code(name)} | ${cell(summarize(properties[name]))} | ${required.has(name) ? 'sí' : 'no'} |`,
  )
  return ['| Campo | Tipo | Obligatorio |', '| --- | --- | --- |', ...rows].join('\n')
}

/** Variantes de una unión de objetos, con el campo que las distingue (`status`, `type`…). */
function variantsOf(node: JsonObject): { label: string; variant: JsonObject }[] | null {
  const list = Array.isArray(node.oneOf)
    ? node.oneOf
    : Array.isArray(node.anyOf)
      ? node.anyOf
      : null
  if (!list || !list.every(isObject) || !list.every(v => v.type === 'object')) return null
  const objects = list as JsonObject[]
  const props = objects.map(v => (isObject(v.properties) ? v.properties : {}))
  const first = props[0] ?? {}
  // El campo que distingue las variantes: constante en todas y con un valor distinto en cada una.
  const constOf = (p: JsonObject, key: string): string | null =>
    isObject(p[key]) && 'const' in p[key] ? JSON.stringify(p[key].const) : null
  const discriminator = Object.keys(first).find(key => {
    const values = props.map(p => constOf(p, key))
    return values.every(v => v !== null) && new Set(values).size === values.length
  })
  return objects.map((variant, i) => {
    const value = discriminator ? (props[i]?.[discriminator] as JsonObject).const : null
    const label = discriminator
      ? code(`${discriminator}: ${JSON.stringify(value)}`)
      : `variante ${i + 1}`
    return { label, variant }
  })
}

function details(node: JsonObject): string {
  return [
    '<details><summary>JSON Schema</summary>',
    '',
    '```json',
    // Prettier lo formatea con el resto del documento (agrupa lo que cabe en una línea).
    JSON.stringify(withRefs(node)),
    '```',
    '',
    '</details>',
  ].join('\n')
}

/** Tabla de campos (o una por variante) + JSON Schema plegado. */
function describeSchema(title: string, name: SchemaName): string {
  const node = jsonSchemaOf(name)
  const variants = variantsOf(node)
  const head = `**${title}** (${code(name)})`
  const body = variants
    ? [
        'Una de estas variantes:',
        ...variants.map(({ label, variant }) => `- ${label}\n\n${indent(fieldTable(variant))}`),
      ].join('\n\n')
    : node.type === 'object'
      ? fieldTable(node)
      : `Tipo: ${cell(summarize(node))}`
  return [head, body, details(node)].join('\n\n')
}

function indent(text: string): string {
  return text
    .split('\n')
    .map(line => (line.length > 0 ? `  ${line}` : line))
    .join('\n')
}

// ---------------------------------------------------------------- bloques

/** Esquemas de cada ruta de `API_ROUTES` (tal como los registra `packages/server/src/http/api.ts`). */
const ROUTE_DOCS: Readonly<
  Record<ApiRouteName, { query?: SchemaName; request?: SchemaName; response: SchemaName }>
> = {
  meta: { response: 'metaResponseSchema' },
  deviceStart: { request: 'deviceStartRequestSchema', response: 'deviceStartResponseSchema' },
  devicePoll: { request: 'devicePollRequestSchema', response: 'devicePollResponseSchema' },
  link: { request: 'linkRequestSchema', response: 'linkResponseSchema' },
  redeem: { request: 'redeemRequestSchema', response: 'redeemResponseSchema' },
  logout: { request: 'logoutRequestSchema', response: 'okResponseSchema' },
  turnStart: { request: 'turnStartRequestSchema', response: 'turnStartResponseSchema' },
  turnEnd: { request: 'turnEndRequestSchema', response: 'turnEndResponseSchema' },
  bet: { request: 'betRequestSchema', response: 'betResponseSchema' },
  me: { response: 'meResponseSchema' },
  settings: { request: 'settingsRequestSchema', response: 'settingsResponseSchema' },
  deleteAccount: { request: 'deleteAccountRequestSchema', response: 'okResponseSchema' },
  leaderboard: { query: 'leaderboardQuerySchema', response: 'leaderboardResponseSchema' },
  hallOfRuin: { response: 'hallOfRuinResponseSchema' },
  referral: { response: 'referralResponseSchema' },
  referralRedeem: {
    request: 'referralRedeemRequestSchema',
    response: 'referralRedeemResponseSchema',
  },
  referralLookup: { query: 'referralLookupQuerySchema', response: 'referralLookupResponseSchema' },
}

const AUTH_TEXT: Readonly<Record<shared.RouteAuth, string>> = {
  public: 'pública (sin sesión)',
  mod: '`Authorization: Bearer <token>` de una sesión **del mod**',
  web: 'cookie de sesión **de la web**',
  any: 'Bearer del mod **o** cookie de la web',
}

/** Qué significa cada código de cierre del WebSocket (aplicación, rango 4000–4999). */
const CLOSE_CODE_TEXT: Readonly<Record<keyof typeof shared.WS_CLOSE_CODES, string>> = {
  unauthorized: 'Sin sesión web válida, o la sesión terminó con la ventana abierta.',
  forbiddenOrigin: 'El `Origin` no es `PUBLIC_URL` (ni uno de `EXTRA_ALLOWED_ORIGINS`).',
  tooManyConnections:
    'Demasiadas ventanas del mismo usuario o demasiados intentos de conexión desde la misma IP.',
  protocolError: 'El servidor no pudo preparar el estado inicial (`hello`).',
  sessionEnded: 'El servidor cierra la sesión: va precedido de un mensaje `bye` con el motivo.',
}

function routeBlock(name: ApiRouteName): string {
  const route = shared.API_ROUTES[name]
  const docs = ROUTE_DOCS[name]
  const parts = [
    `${code(`${route.method} ${route.path}`)} · autenticación: ${AUTH_TEXT[route.auth]}`,
  ]
  if (docs.query) parts.push(describeSchema('Parámetros de la query', docs.query))
  if (docs.request) parts.push(describeSchema('Cuerpo de la petición (JSON)', docs.request))
  parts.push(describeSchema('Respuesta 200', docs.response))
  return parts.join('\n\n')
}

/** Variantes de una unión de mensajes WS por su `type`. */
function wsVariants(name: 'clientMessageSchema' | 'serverMessageSchema'): Map<string, JsonObject> {
  const node = jsonSchemaOf(name)
  const list = Array.isArray(node.oneOf) ? node.oneOf : []
  const out = new Map<string, JsonObject>()
  for (const variant of list) {
    if (!isObject(variant) || !isObject(variant.properties)) continue
    const type = variant.properties.type
    if (isObject(type) && typeof type.const === 'string') out.set(type.const, variant)
  }
  if (out.size === 0) throw new Error(`${name} no es una unión discriminada por \`type\``)
  return out
}

function wsBlock(direction: 'cliente → servidor' | 'servidor → cliente', node: JsonObject): string {
  return [`Dirección: ${direction}.`, fieldTable(node), details(node)].join('\n\n')
}

function routesTable(): string {
  const names = Object.keys(shared.API_ROUTES) as ApiRouteName[]
  const rows = names.map(name => {
    const r = shared.API_ROUTES[name]
    return `| [${code(name)}](#${name.toLowerCase()}) | ${r.method} | ${code(r.path)} | ${code(r.auth)} |`
  })
  return ['| Nombre | Método | Ruta | Auth |', '| --- | --- | --- | --- |', ...rows].join('\n')
}

function pagesTable(): string {
  const rows = Object.entries(shared.PAGE_PATHS).map(
    ([name, path]) => `| ${code(name)} | ${code(path)} |`,
  )
  return ['| Nombre (`PAGE_PATHS`) | Ruta |', '| --- | --- |', ...rows].join('\n')
}

function errorsTable(): string {
  const rows = shared.ERROR_CODES.map(c => `| ${code(c)} | ${statusOf(c)} |`)
  return ['| `error` | Estado HTTP |', '| --- | --- |', ...rows].join('\n')
}

function closeCodesTable(): string {
  const entries = Object.entries(shared.WS_CLOSE_CODES) as [
    keyof typeof shared.WS_CLOSE_CODES,
    number,
  ][]
  const rows = entries.map(
    ([name, value]) => `| ${value} | ${code(name)} | ${CLOSE_CODE_TEXT[name]} |`,
  )
  return ['| Código | Nombre | Cuándo |', '| --- | --- | --- |', ...rows].join('\n')
}

function limitsTable(): string {
  const rows = Object.entries(shared.TEXT_LIMITS).map(
    ([name, value]) => `| ${code(`TEXT_LIMITS.${name}`)} | ${value} caracteres |`,
  )
  rows.push(
    `| ${code('WS_CLIENT_MESSAGE_MAX_BYTES')} | ${shared.WS_CLIENT_MESSAGE_MAX_BYTES} bytes |`,
  )
  return ['| Constante | Valor |', '| --- | --- |', ...rows].join('\n')
}

/** Todos los bloques que tiene que tener el documento: id → contenido. */
export function renderBlocks(): Map<string, string> {
  const blocks = new Map<string, string>()
  blocks.set(
    'version',
    `Versión actual del protocolo: **${code(`v: ${shared.PROTOCOL_VERSION}`)}** (\`PROTOCOL_VERSION\`).`,
  )
  blocks.set('routes', routesTable())
  blocks.set('pages', pagesTable())
  blocks.set('errors', errorsTable())
  blocks.set('close-codes', closeCodesTable())
  blocks.set('limits', limitsTable())
  for (const name of Object.keys(COMMON) as CommonName[]) {
    blocks.set(`common:${name}`, `### ${name}\n\n${describeSchema(name, COMMON[name])}`)
  }
  for (const name of Object.keys(shared.API_ROUTES) as ApiRouteName[]) {
    blocks.set(`route:${name}`, routeBlock(name))
  }
  for (const [type, node] of wsVariants('clientMessageSchema')) {
    blocks.set(`ws-client:${type}`, wsBlock('cliente → servidor', node))
  }
  for (const [type, node] of wsVariants('serverMessageSchema')) {
    blocks.set(`ws-server:${type}`, wsBlock('servidor → cliente', node))
  }
  blocks.set('web-config', describeSchema('Cuerpo de `/config.json`', 'webConfigSchema'))
  return blocks
}

// ---------------------------------------------------------------- documento

const BLOCK_RE = /<!-- BEGIN GENERATED ([\w:.-]+) -->[\s\S]*?<!-- END GENERATED \1 -->/g
const EXAMPLE_RE = /<!-- example: (\w+) -->\s*\n```json\n([\s\S]*?)\n```/g

/** Comprueba que cada ejemplo marcado cumple su esquema. Devuelve los problemas encontrados. */
export function checkExamples(doc: string): string[] {
  const problems: string[] = []
  for (const match of doc.matchAll(EXAMPLE_RE)) {
    const [, name = '', body = ''] = match
    const schema = schemaByName(name)
    if (!schema) {
      problems.push(`ejemplo con un esquema que shared no exporta: ${name}`)
      continue
    }
    let value: unknown
    try {
      value = JSON.parse(body)
    } catch (error) {
      problems.push(`ejemplo de ${name} que no es JSON: ${(error as Error).message}`)
      continue
    }
    const result = schema.safeParse(value)
    if (!result.success) {
      problems.push(
        `ejemplo de ${name} que no cumple el esquema: ${JSON.stringify(result.error?.issues)}`,
      )
    }
  }
  return problems
}

/** Rellena los bloques del documento. Devuelve el texto ya formateado y los problemas. */
export async function renderProtocolDoc(
  current: string,
): Promise<{ text: string; problems: string[] }> {
  const blocks = renderBlocks()
  const problems: string[] = []
  const seen = new Set<string>()
  const filled = current.replace(BLOCK_RE, (_whole, id: string) => {
    const content = blocks.get(id)
    if (content === undefined) {
      problems.push(`bloque generado desconocido: ${id}`)
      return _whole
    }
    if (seen.has(id)) problems.push(`bloque generado repetido: ${id}`)
    seen.add(id)
    return `<!-- BEGIN GENERATED ${id} -->\n\n${content}\n\n<!-- END GENERATED ${id} -->`
  })
  for (const id of blocks.keys()) {
    if (!seen.has(id)) {
      problems.push(
        `falta el bloque «${id}»: añade <!-- BEGIN GENERATED ${id} --> y <!-- END GENERATED ${id} -->`,
      )
    }
  }
  problems.push(...checkExamples(filled))
  const options = await resolveConfig(PROTOCOL_DOC)
  const text = await format(filled, { ...options, filepath: PROTOCOL_DOC })
  return { text, problems }
}

/** Estado del documento en disco: si está al día y qué problemas tiene. */
export async function protocolDocStatus(): Promise<{ upToDate: boolean; problems: string[] }> {
  const current = await readFile(PROTOCOL_DOC, 'utf8')
  const { text, problems } = await renderProtocolDoc(current)
  return { upToDate: text === current, problems }
}

async function main(): Promise<void> {
  const where = relative(REPO_ROOT, PROTOCOL_DOC)
  if (process.argv.includes('--check')) {
    const { upToDate, problems } = await protocolDocStatus()
    for (const problem of problems) console.error(`✗ ${problem}`)
    if (!upToDate) console.error(`✗ ${where} está desactualizado: ejecuta \`pnpm docs:protocol\`.`)
    if (problems.length > 0 || !upToDate) {
      process.exitCode = 1
      return
    }
    console.log(`${where} está al día con packages/shared.`)
    return
  }
  const current = await readFile(PROTOCOL_DOC, 'utf8')
  const { text, problems } = await renderProtocolDoc(current)
  for (const problem of problems) console.error(`✗ ${problem}`)
  if (problems.length > 0) {
    process.exitCode = 1
    return
  }
  if (text === current) {
    console.log(`${where} ya estaba al día.`)
    return
  }
  await writeFile(PROTOCOL_DOC, text)
  console.log(`escrito ${where}`)
}

if (import.meta.main) await main()
