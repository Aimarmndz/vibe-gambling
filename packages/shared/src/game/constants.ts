// SPDX-License-Identifier: AGPL-3.0-or-later
// Enumeraciones del juego compartidas por la lógica y el protocolo.

/** De dónde salieron las fichas de una ronda resuelta. */
export const AUTO_BET_SOURCES = ['slip', 'repeat', 'default', 'none'] as const

/** Tablas del ranking de la temporada. */
export const LEADERBOARD_BOARDS = ['broke', 'rich', 'spins'] as const
