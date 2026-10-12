// SPDX-License-Identifier: AGPL-3.0-or-later
// Esquemas de los archivos de `locales/<idioma>/`: metadatos, bandera, frases y catálogos de
// textos. Los usa `scripts/gen-locales.ts` para validar cada carpeta, la web para validar lo que
// descubre con `import.meta.glob` y los tests de paridad.
import { z } from 'zod'

import { PHRASE_CATEGORIES } from './phrases.ts'

/** Idioma de referencia: el que define las claves y los marcadores de todos los demás. */
export const REFERENCE_LOCALE = 'en'

/**
 * Tamaño de las banderas en píxeles. Es una regla de diseño (caben en una fila de 16 px del menú
 * del juego y se escalan a múltiplos enteros en la landing), igual para todas.
 */
export const FLAG_WIDTH = 16
export const FLAG_HEIGHT = 11

/** Archivos de textos de cada idioma (todos claves planas → texto con `{marcadores}`). */
export const TEXT_FILES = ['web', 'landing', 'privacy', 'mod'] as const
export type TextFile = (typeof TEXT_FILES)[number]

/** Archivos de cada carpeta de idioma, todos obligatorios. */
export const LOCALE_FILES = ['meta', 'flag', 'phrases', ...TEXT_FILES] as const
export type LocaleFile = (typeof LOCALE_FILES)[number]

/** Código de idioma: el nombre de la carpeta (`es`, `fr`, `pt-BR`…). */
export const localeCodeSchema = z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)

export const localeMetaSchema = z
  .object({
    /** Igual que el nombre de la carpeta; es el valor que viaja en el protocolo. */
    code: localeCodeSchema,
    /** Etiqueta BCP 47 completa (`lang` del HTML, reglas de plural). */
    bcp47: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
    /** Nombre del idioma en ese mismo idioma ("Français"): selector y `aria-label`. */
    nativeName: z.string().min(1).max(40),
    /** Nombre en inglés, para la documentación y los mensajes de error. */
    englishName: z.string().min(1).max(40),
    /** Dirección del texto (el framebuffer del juego solo pinta de izquierda a derecha). */
    dir: z.enum(['ltr', 'rtl']),
    /** Posición en los selectores (de menor a mayor; única). */
    order: z.number().int().min(0).max(999),
    /** Separador de miles de las cifras (`,` `.` o un espacio fino U+202F). */
    groupSeparator: z.string().min(1).max(2),
  })
  .strict()
export type LocaleMeta = z.output<typeof localeMetaSchema>

const hexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

/**
 * Bandera en pixel art: una paleta de colores con un carácter por color y una rejilla de filas en
 * la que cada carácter es un píxel. Todas miden FLAG_WIDTH × FLAG_HEIGHT.
 */
export const flagSchema = z
  .object({
    /** Qué bandera es y cómo se ha dibujado (procedencia, ver ASSETS.md). */
    description: z.string().min(1).max(300),
    width: z.literal(FLAG_WIDTH),
    height: z.literal(FLAG_HEIGHT),
    palette: z.record(z.string().regex(/^[A-Za-z0-9]$/), hexColorSchema),
    pixels: z.array(z.string()).length(FLAG_HEIGHT),
  })
  .strict()
  .superRefine((flag, ctx) => {
    flag.pixels.forEach((row, y) => {
      if (row.length !== FLAG_WIDTH) {
        ctx.addIssue({
          code: 'custom',
          path: ['pixels', y],
          message: `la fila mide ${row.length} y debe medir ${FLAG_WIDTH}`,
        })
      }
      for (const ch of row) {
        if (!(ch in flag.palette)) {
          ctx.addIssue({
            code: 'custom',
            path: ['pixels', y],
            message: `el color "${ch}" no está en la paleta`,
          })
        }
      }
    })
  })
export type Flag = z.output<typeof flagSchema>

/** Frases de ludópata: cada categoría con al menos una. */
export const phraseCatalogSchema = z
  .object(
    Object.fromEntries(PHRASE_CATEGORIES.map(c => [c, z.array(z.string().min(1)).min(1)])) as {
      [K in (typeof PHRASE_CATEGORIES)[number]]: z.ZodArray<z.ZodString>
    },
  )
  .strict()

/**
 * Catálogo de textos: claves planas con puntos (`menu.title`) → texto. Un texto vacío o solo con
 * espacios es una traducción a medias (la paridad de claves no lo vería): no vale.
 */
export const textCatalogSchema = z.record(
  z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9_]+)*$/),
  z.string().refine(text => text.trim() !== '', { message: 'texto vacío (falta traducirlo)' }),
)
export type TextCatalog = z.output<typeof textCatalogSchema>

/** Esquema de cada archivo de la carpeta de un idioma. */
export const LOCALE_FILE_SCHEMAS = {
  meta: localeMetaSchema,
  flag: flagSchema,
  phrases: phraseCatalogSchema,
  web: textCatalogSchema,
  landing: textCatalogSchema,
  privacy: textCatalogSchema,
  mod: textCatalogSchema,
} as const satisfies Record<LocaleFile, z.ZodType>

/** `{marcadores}` de un texto, sin repetir y ordenados. */
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]!))].sort()
}

/** Colores de una bandera como filas de hex (`flag.pixels` resuelto con la paleta). */
export function flagColors(flag: Flag): string[][] {
  return flag.pixels.map(row => [...row].map(ch => flag.palette[ch]!))
}

/** Valida un archivo de la carpeta de un idioma; si no vale, devuelve el error legible. */
export function parseLocaleFile(
  file: LocaleFile,
  raw: unknown,
): { ok: true; data: unknown } | { ok: false; error: string } {
  const parsed = (LOCALE_FILE_SCHEMAS[file] as z.ZodType).safeParse(raw)
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) }
}
