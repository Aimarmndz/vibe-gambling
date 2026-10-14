// SPDX-License-Identifier: AGPL-3.0-or-later
// Cosméticos de la TIENDA: paletas de los tapetes y de los juegos de fichas, por id (los ids son
// los de `shared`). Son tokens de diseño, como `palette.ts`: cambiarlos es cambiar el dibujo. Los
// colores de las casillas (rojo, negro y verde) no cambian nunca: son la ruleta, no la decoración.
import { CHIP_SKIN_IDS, DEFAULT_CHIP_SKIN, DEFAULT_FELT, FELT_IDS } from '@vibe-gambling/shared'
import type { ChipSkinId, FeltId } from '@vibe-gambling/shared'

import { CHIP_COLORS, PALETTE } from '../ui/palette.ts'

export interface FeltSkin {
  /** Paño y su grano. */
  readonly felt: string
  readonly feltDark: string
  /** Líneas de tiza del tapete. */
  readonly chalk: string
}

/** Cómo es la cara de cada ficha: el dibujo de su textura. */
export type ChipStyle = 'classic' | 'floppy' | 'coin' | 'cap'

export interface ChipSkin {
  /** Color de cada ficha, de la menor a la mayor (se repiten si hay más). */
  readonly colors: readonly string[]
  readonly style: ChipStyle
}

export const FELT_SKINS: Readonly<Record<FeltId, FeltSkin>> = Object.freeze({
  classic: { felt: PALETTE.felt, feltDark: PALETTE.feltDark, chalk: PALETTE.chalk },
  // Azul y gris de la tarjeta de memoria (y de la BIOS, y de la pantalla azul).
  memory_blue: { felt: '#21418f', feltDark: '#152c66', chalk: '#c9c3d8' },
  // Montecarlo, 1997: granate de moqueta cara y líneas de oro.
  montecarlo97: { felt: '#6e1a26', feltDark: '#4c111a', chalk: PALETTE.gold },
  // Modo oscuro: como el editor, tiza verde de terminal sobre casi negro.
  dark_mode: { felt: '#1d1d26', feltDark: '#14141b', chalk: '#6ee08a' },
  // Vaporwave: violeta y cian, A E S T H E T I C.
  vaporwave: { felt: '#5b2a86', feltDark: '#41195f', chalk: '#5ff5ff' },
})

export const CHIP_SKINS: Readonly<Record<ChipSkinId, ChipSkin>> = Object.freeze({
  classic: { colors: CHIP_COLORS, style: 'classic' },
  // Disquetes de 3½: negro, azul, rojo, beis… con su chapa metálica.
  floppy: {
    colors: ['#2a2a32', '#2b5fd9', '#c1272d', '#d9cba6', '#1d9a52', '#7a3fb0', '#e07a1f'],
    style: 'floppy',
  },
  // Cinco duros: monedas de 5 pesetas (latón, níquel y cobre gastados).
  cinco_duros: {
    colors: ['#c9a85a', '#b8b8c0', '#a8761e', '#d9cba6', '#8d93b8', '#e0c070', '#9a6a46'],
    style: 'coin',
  },
  // Chapas de refresco del bar de abajo.
  bottle_cap: {
    colors: ['#c1272d', '#2b5fd9', '#e9e4d4', '#1d9a52', '#f2c14e', '#25222c', '#e07a1f'],
    style: 'cap',
  },
})

/** Tapete que se usa (el clásico si el id no es uno conocido). */
export function feltSkin(id: string | null | undefined): FeltSkin {
  return (FELT_IDS as readonly string[]).includes(id ?? '')
    ? FELT_SKINS[id as FeltId]
    : FELT_SKINS[DEFAULT_FELT]
}

/** Fichas que se usan (las clásicas si el id no es uno conocido). */
export function chipSkin(id: string | null | undefined): ChipSkin {
  return (CHIP_SKIN_IDS as readonly string[]).includes(id ?? '')
    ? CHIP_SKINS[id as ChipSkinId]
    : CHIP_SKINS[DEFAULT_CHIP_SKIN]
}

/** Color de la ficha i (de la menor a la mayor) en un juego de fichas. */
export function chipColor(skin: ChipSkin, index: number): string {
  return skin.colors[index % skin.colors.length]!
}
