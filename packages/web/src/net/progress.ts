// SPDX-License-Identifier: AGPL-3.0-or-later
// Peticiones de las pantallas ESTADÍSTICAS y BANCO (`stats.request` → `stats`, `bank.request` →
// `bank`). El servidor responde solo a la ventana que pregunta y sin id de petición, así que aquí
// se empareja cada respuesta con la petición más antigua de su tipo que siga esperando.
import type { BankStatement, SeasonStats, ServerMessage } from '@vibe-gambling/shared'

export type ProgressKind = 'stats' | 'bank'
export interface ProgressData {
  stats: SeasonStats
  bank: BankStatement
}

/** La petición no tuvo respuesta a tiempo o no se pudo mandar. */
export class ProgressError extends Error {
  override name = 'ProgressError'
  readonly reason: 'timeout' | 'offline' | 'not_found'

  constructor(reason: 'timeout' | 'offline' | 'not_found') {
    super(`sin respuesta del servidor: ${reason}`)
    this.reason = reason
  }
}

interface Waiting<K extends ProgressKind> {
  seasonId: string | undefined
  resolve: (data: ProgressData[K]) => void
  reject: (error: ProgressError) => void
  timer: ReturnType<typeof setTimeout>
}

export type ProgressSend = (msg: {
  type: 'stats.request' | 'bank.request'
  seasonId?: string
}) => boolean

export class ProgressRequests {
  private readonly waiting: { [K in ProgressKind]: Waiting<K>[] } = { stats: [], bank: [] }
  private readonly send: ProgressSend
  private readonly timeoutMs: number

  constructor(send: ProgressSend, timeoutMs: number) {
    this.send = send
    this.timeoutMs = timeoutMs
  }

  /** Pide las estadísticas o el banco de una temporada (sin `seasonId`, la en curso). */
  request<K extends ProgressKind>(kind: K, seasonId?: string): Promise<ProgressData[K]> {
    return new Promise<ProgressData[K]>((resolve, reject) => {
      const type = kind === 'stats' ? 'stats.request' : 'bank.request'
      if (!this.send(seasonId ? { type, seasonId } : { type })) {
        reject(new ProgressError('offline'))
        return
      }
      const list = this.waiting[kind] as Waiting<K>[]
      const entry: Waiting<K> = {
        seasonId,
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = list.indexOf(entry)
          if (i >= 0) list.splice(i, 1)
          reject(new ProgressError('timeout'))
        }, this.timeoutMs),
      }
      list.push(entry)
    })
  }

  /** ¿Hay alguna petición esperando? (un `error` del servidor puede ser su respuesta). */
  get busy(): boolean {
    return this.waiting.stats.length + this.waiting.bank.length > 0
  }

  /** Mensaje del servidor. Devuelve true si era la respuesta de una petición. */
  receive(msg: ServerMessage): boolean {
    if (msg.type === 'stats') return this.settle('stats', msg.stats)
    if (msg.type === 'bank') return this.settle('bank', msg.bank)
    // Una temporada en la que no jugó responde `not_found`; solo puede ser de una petición con
    // temporada explícita (la en curso siempre existe).
    if (msg.type === 'error' && msg.error === 'not_found') {
      for (const kind of ['stats', 'bank'] as const) {
        const list = this.waiting[kind]
        const i = list.findIndex(w => w.seasonId !== undefined)
        if (i >= 0) {
          const [entry] = list.splice(i, 1)
          clearTimeout(entry!.timer)
          entry!.reject(new ProgressError('not_found'))
          return true
        }
      }
    }
    return false
  }

  private settle<K extends ProgressKind>(kind: K, data: ProgressData[K]): boolean {
    const list = this.waiting[kind] as Waiting<K>[]
    // La respuesta de la temporada pedida; si no la hay (la en curso), la más antigua.
    const i = Math.max(
      0,
      list.findIndex(w => w.seasonId === data.seasonId),
    )
    const entry = list.splice(i, 1)[0]
    if (!entry) return false
    clearTimeout(entry.timer)
    entry.resolve(data)
    return true
  }

  /** Se cae la conexión: lo que esperaba ya no llegará. */
  failAll(): void {
    for (const kind of ['stats', 'bank'] as const) {
      for (const entry of this.waiting[kind].splice(0)) {
        clearTimeout(entry.timer)
        entry.reject(new ProgressError('offline'))
      }
    }
  }
}
