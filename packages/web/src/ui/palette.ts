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
  /** Ventanas de aviso: error (rojo), dinero (verde), pantallas completas y jackpot. */
  alertTop: '#7a1420',
  moneyTop: '#1d6b3a',
  deepTop: '#1b2368',
  jackpotBottom: '#5a0d12',
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

/** Mezcla lineal de dos colores `#rrggbb` (t = 0 → a, t = 1 → b), como el degradado del canvas. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = rgbOf(a)
  const pb = rgbOf(b)
  const out = pa.map((v, i) => Math.round(v + (pb[i]! - v) * t))
  return `#${out.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Relación de contraste WCAG 2.x entre dos colores `#rrggbb`. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = rgbOf(hex).map(c => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }) as [number, number, number]
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
