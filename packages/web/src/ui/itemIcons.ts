// SPDX-License-Identifier: AGPL-3.0-or-later
// Iconos pixel (9×9) de los objetos de la TIENDA para el HUD, el BOLSILLO y la lista de la tienda.
// Son dibujo, no configuración: cada letra es un color de la paleta y el punto, transparente.
import type { ConsumableId, ItemId } from '@vibe-gambling/shared'

import { PALETTE } from './palette.ts'

const COLORS: Readonly<Record<string, string>> = {
  c: PALETTE.cream,
  p: PALETTE.skin,
  b: PALETTE.chipBlue,
  w: PALETTE.cream,
  g: PALETTE.gold,
  d: PALETTE.goldDark,
  s: PALETTE.steel,
  r: PALETTE.red,
  y: PALETTE.fire2,
  o: PALETTE.fire1,
  k: PALETTE.ink,
  v: '#7a3fb0',
}

export const ICON_SIZE = 9

const SPRITES: Readonly<Record<ConsumableId | 'revert', readonly string[]>> = {
  rabbit_foot: [
    '..c...c..',
    '.ccc.ccc.',
    '.cpc.cpc.',
    '..c...c..',
    '...ccc...',
    '..ccccc..',
    '..cpppc..',
    '..cpppc..',
    '...ccc...',
  ],
  oracle: [
    '...vvv...',
    '..vwvvv..',
    '.vwvvvvv.',
    '.vvvbvvv.',
    '.vvbbbvv.',
    '..vvbvv..',
    '...vvv...',
    '..ddddd..',
    '.ggggggg.',
  ],
  insurance: [
    '.sssssss.',
    '.swwwwws.',
    '.swwrwws.',
    '.swrrrws.',
    '.swwrwws.',
    '..swwws..',
    '..swwws..',
    '...sws...',
    '....s....',
  ],
  turbo: [
    '.....yy..',
    '....yy...',
    '...yy....',
    '..yyyyyy.',
    '.oooooo..',
    '....oo...',
    '...oo....',
    '..oo.....',
    '.o.......',
  ],
  streak_helmet: [
    '...rrr...',
    '..rrrrr..',
    '.rrwwrrr.',
    '.rwrrrrr.',
    '.rrrrrrr.',
    '.kkkkkkk.',
    '.kgggggk.',
    '.k.....k.',
    '.........',
  ],
  revert: [
    '...ggggg.',
    '..g.....g',
    '.g......g',
    'ggg.....g',
    '.g......g',
    '........g',
    '.......g.',
    '..ggggg..',
    '.........',
  ],
}

/** Pinta el icono de un objeto (los cosméticos no tienen: se enseñan con su vista previa). */
export function drawItemIcon(
  g: CanvasRenderingContext2D,
  id: ItemId,
  x: number,
  y: number,
  opts: { scale?: number; dim?: boolean } = {},
): void {
  const sprite = SPRITES[id as keyof typeof SPRITES]
  if (!sprite) return
  const scale = opts.scale ?? 1
  if (opts.dim) g.globalAlpha = 0.45
  sprite.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const color = COLORS[row[i]!]
      if (!color) continue
      g.fillStyle = color
      g.fillRect(x + i * scale, y + j * scale, scale, scale)
    }
  })
  if (opts.dim) g.globalAlpha = 1
}
