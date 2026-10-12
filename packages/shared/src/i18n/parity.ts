// SPDX-License-Identifier: AGPL-3.0-or-later
// Comprobaciones de un idioma contra el de referencia (el inglés): mismas claves y mismos
// `{marcadores}` en cada texto. Las usan `scripts/gen-locales.ts` y los tests de paridad.
import { PHRASE_CATEGORIES } from './phrases.ts'
import type { PhraseCatalog } from './phrases.ts'
import { placeholdersOf } from './schemas.ts'
import type { TextCatalog } from './schemas.ts'

/** Problemas de un catálogo de textos frente al de referencia (lista vacía si está bien). */
export function textParityProblems(reference: TextCatalog, other: TextCatalog): string[] {
  const problems: string[] = []
  for (const key of Object.keys(reference)) {
    if (!(key in other)) {
      problems.push(`falta la clave "${key}"`)
      continue
    }
    const want = placeholdersOf(reference[key]!).join(', ')
    const got = placeholdersOf(other[key]!).join(', ')
    if (want !== got) problems.push(`"${key}": marcadores {${got}} en vez de {${want}}`)
  }
  for (const key of Object.keys(other)) {
    if (!(key in reference)) problems.push(`sobra la clave "${key}"`)
  }
  return problems
}

/**
 * Problemas de las frases: cada categoría usa los mismos marcadores que la de referencia (las
 * frases son libres, no se traducen una a una, pero el código que las rellena es el mismo).
 */
export function phraseParityProblems(reference: PhraseCatalog, other: PhraseCatalog): string[] {
  const problems: string[] = []
  const markers = (list: readonly string[]): string => placeholdersOf(list.join(' ')).join(', ')
  for (const category of PHRASE_CATEGORIES) {
    const want = markers(reference[category])
    const got = markers(other[category])
    if (want !== got) problems.push(`frases "${category}": marcadores {${got}} en vez de {${want}}`)
  }
  return problems
}

/** Total de frases de un catálogo. */
export function phraseCount(catalog: PhraseCatalog): number {
  return PHRASE_CATEGORIES.reduce((total, category) => total + catalog[category].length, 0)
}
