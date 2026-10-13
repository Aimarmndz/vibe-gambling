// SPDX-License-Identifier: AGPL-3.0-or-later
// Libro de logros de la ventana: el catálogo que llega en `hello.achievements`, actualizado con
// cada `achievement.unlocked`, y qué conseguidos no se han visto aún en la pantalla de LOGROS (el
// punto oro del menú). Lo visto se recuerda en este navegador (comodidad, no estado del juego).
import type { Achievement, ServerMessage } from '@vibe-gambling/shared'

import type { MessageKey, Translator } from '../i18n/index.ts'

/** Almacenamiento mínimo (localStorage o uno de mentira en los tests). */
export interface SeenStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const SEEN_KEY = 'vg.achievementsSeen'

export type AchievementState = 'unlocked' | 'progress' | 'locked' | 'secret'

/** Una fila de la pantalla de LOGROS, ya traducida. */
export interface AchievementRow {
  id: Achievement['id']
  state: AchievementState
  title: string
  desc: string
  /** Fecha en que se consiguió (ISO) o null. */
  unlockedAt: string | null
  progress: { current: number; goal: number } | null
}

/** Estado de un logro: conseguido, contable con progreso, bloqueado o secreto sin conseguir. */
export function achievementState(a: Achievement): AchievementState {
  if (a.unlockedAt) return 'unlocked'
  if (a.hidden) return 'secret'
  if (a.progress) return 'progress'
  return 'locked'
}

/** Textos de una fila. Los secretos sin conseguir no enseñan ni el nombre ni la descripción. */
export function achievementRow(a: Achievement, tr: Translator): AchievementRow {
  const state = achievementState(a)
  const key = (part: 'title' | 'desc') => `achievements.${a.id}.${part}` as MessageKey
  return {
    id: a.id,
    state,
    title: state === 'secret' ? tr.t('ach.secretTitle') : tr.t(key('title'), a.params),
    desc: state === 'secret' ? tr.t('ach.secretDesc') : tr.t(key('desc'), a.params),
    unlockedAt: a.unlockedAt,
    progress: state === 'progress' ? a.progress : null,
  }
}

export class AchievementBook {
  private list: Achievement[] | null = null
  private seen: Set<string>
  private readonly storage: SeenStorage | null

  constructor(storage: SeenStorage | null) {
    this.storage = storage
    this.seen = new Set(readSeen(storage))
  }

  /** Mensaje del servidor. Devuelve true si cambió algo. */
  receive(msg: ServerMessage): boolean {
    if (msg.type === 'hello' && msg.achievements) {
      const first = this.list === null && this.seen.size === 0
      this.list = msg.achievements
      // Primera vez en este navegador: lo ya conseguido no cuenta como "nuevo".
      if (first && !this.storage?.getItem(SEEN_KEY)) this.markAllSeen()
      return true
    }
    if (msg.type === 'achievement.unlocked' && this.list) {
      const i = this.list.findIndex(a => a.id === msg.achievement.id)
      this.list =
        i >= 0
          ? this.list.map((a, k) => (k === i ? msg.achievement : a))
          : [...this.list, msg.achievement]
      return true
    }
    return false
  }

  /** El catálogo (null si el servidor aún no lo ha mandado). */
  all(): readonly Achievement[] | null {
    return this.list
  }

  /** Conseguidos y total. */
  count(): { unlocked: number; total: number } {
    const list = this.list ?? []
    return { unlocked: list.filter(a => a.unlockedAt).length, total: list.length }
  }

  /** ¿Hay alguno conseguido que no se haya visto en la pantalla de LOGROS? */
  hasUnseen(): boolean {
    return (this.list ?? []).some(a => a.unlockedAt && !this.seen.has(a.id))
  }

  /** Se ha abierto la pantalla de LOGROS: todo lo conseguido queda visto. */
  markAllSeen(): void {
    for (const a of this.list ?? []) if (a.unlockedAt) this.seen.add(a.id)
    try {
      this.storage?.setItem(SEEN_KEY, JSON.stringify([...this.seen]))
    } catch (error) {
      // Sin almacenamiento (modo privado estricto): solo se pierde el punto oro entre sesiones.
      console.warn('[logros] no se pudo guardar lo visto', error)
    }
  }
}

function readSeen(storage: SeenStorage | null): string[] {
  try {
    const raw = storage?.getItem(SEEN_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch (error) {
    console.warn('[logros] lo visto no se pudo leer', error)
    return []
  }
}
