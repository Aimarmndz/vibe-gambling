// SPDX-License-Identifier: AGPL-3.0-or-later
// Paleta limitada de la consola POLYGONE (ver docs/DECISIONES.md, sección Web). Son tokens de
// diseño, no configuración: cambiarlos es cambiar el aspecto del juego.
import type { PocketColor } from '@vibe-gambling/shared'

export const PALETTE = Object.freeze({
  ink: '#08070d',
  night: '#0d1240',
  menuTop: '#2b3fae',
  menuBottom: '#0d1240',
  frame: '#c9c3d8',
  frameInner: '#5a5f8a',
  line: '#3a3d60',
  felt: '#136b45',
  feltDark: '#0b4a2f',
  chalk: '#e9dfc4',
  red: '#c1272d',
  black: '#1a1820',
  green: '#17a05d',
  gold: '#f2c14e',
  goldDark: '#a8761e',
  cream: '#f3ead6',
  muted: '#9aa0c8',
  win: '#6ee08a',
  loss: '#ff5a6a',
  wood: '#7a4422',
  carpet: '#3a0f1c',
  carpetLine: '#1c2a6a',
  shadow: '#000000',
})

/** Colores de las fichas, de la menor a la mayor (se repiten si hay más fichas). */
export const CHIP_COLORS: readonly string[] = Object.freeze([
  '#e9e4d4',
  '#c1272d',
  '#2b5fd9',
  '#1d9a52',
  '#25222c',
  '#7a3fb0',
  '#e07a1f',
])

export function pocketHex(color: PocketColor): string {
  return color === 'red' ? PALETTE.red : color === 'black' ? PALETTE.black : PALETTE.green
}
