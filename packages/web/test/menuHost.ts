// SPDX-License-Identifier: AGPL-3.0-or-later
// Anfitrión de mentira para probar las páginas del menú v2 sin canvas ni WebGL.
import type { AppContext } from '../src/app/context.ts'
import type { MenuHost, MenuPage } from '../src/ui/menu/page.ts'
import { NO_ICONS } from '../src/render/menuIcons/layer.ts'

export interface FakeHost extends MenuHost {
  opened: MenuPage[]
  backs: number
  closes: number
}

export function fakeHost(ctx: AppContext, still = true): FakeHost {
  const host: FakeHost = {
    ctx,
    icons: NO_ICONS,
    still,
    opened: [],
    backs: 0,
    closes: 0,
    open: page => {
      host.opened.push(page)
    },
    back: () => {
      host.backs++
    },
    close: () => {
      host.closes++
    },
    cornerGap: () => 2,
  }
  return host
}
