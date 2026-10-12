# SPDX-License-Identifier: AGPL-3.0-or-later
"""Compila la fuente bitmap Polygone 12 (font/polygone12.txt).

Genera:
  - public/fonts/polygone12.woff2  → la fuente para el HTML (landing, /privacy, menús DOM).
  - src/font/polygone12.json       → los mapas de bits, para pintar texto en el canvas PSX.

Uso (solo hace falta al cambiar la fuente; los dos archivos generados se versionan):
  python3 -I packages/web/scripts/build_font.py

Requiere fontTools y brotli (pip install fonttools brotli).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'font' / 'polygone12.txt'
OUT_WOFF2 = ROOT / 'public' / 'fonts' / 'polygone12.woff2'
OUT_JSON = ROOT / 'src' / 'font' / 'polygone12.json'

ROWS = 12  # filas de la rejilla
BASELINE = 10  # las filas 0–9 están sobre la línea base
UNIT = 100  # unidades de fuente por píxel
UPM = ROWS * UNIT

# Acentos de 5 píxeles de ancho (se centran o recortan según el ancho de la base).
ACCENTS = {
    'acute': ['...#.', '..#..'],
    'grave': ['.#...', '..#..'],
    'tilde': ['.##.#', '#.##.'],
    'diaeresis': ['.....', '.#.#.'],
}

# Letras compuestas: carácter → (base, acento).
COMPOSED = {
    'á': ('a', 'acute'), 'é': ('e', 'acute'), 'ó': ('o', 'acute'), 'ú': ('u', 'acute'),
    'à': ('a', 'grave'), 'è': ('e', 'grave'), 'ò': ('o', 'grave'), 'ù': ('u', 'grave'),
    'ñ': ('n', 'tilde'), 'ü': ('u', 'diaeresis'), 'ö': ('o', 'diaeresis'),
    'Á': ('A', 'acute'), 'É': ('E', 'acute'), 'Í': ('I', 'acute'), 'Ó': ('O', 'acute'),
    'Ú': ('U', 'acute'), 'À': ('A', 'grave'), 'È': ('E', 'grave'), 'Ò': ('O', 'grave'),
    'Ù': ('U', 'grave'), 'Ñ': ('N', 'tilde'), 'Ü': ('U', 'diaeresis'), 'Ö': ('O', 'diaeresis'),
}


def parse(text: str) -> dict[str, dict]:
    """Lee el archivo fuente: {carácter: {'w': ancho, 'y': fila, 'r': [filas]}}."""
    glyphs: dict[str, dict] = {}
    current: dict | None = None
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if line.startswith('#') and not current:
            continue
        if line.startswith('== '):
            head = line[3:]
            char, _, top = head.rpartition(' @')
            if not char or not top.isdigit():
                sys.exit(f'línea {lineno}: cabecera mal formada: {line!r}')
            char = ' ' if char == 'SPACE' else char
            if len(char) != 1:
                sys.exit(f'línea {lineno}: un glifo es un solo carácter: {char!r}')
            if char in glyphs:
                sys.exit(f'línea {lineno}: glifo repetido: {char!r}')
            current = {'w': 0, 'y': int(top), 'r': []}
            glyphs[char] = current
            continue
        if not line:
            current = None
            continue
        if current is None:
            sys.exit(f'línea {lineno}: fila fuera de un glifo: {line!r}')
        if set(line) - {'#', '.'}:
            sys.exit(f'línea {lineno}: solo se admiten "#" y ".": {line!r}')
        if current['r'] and len(line) != current['w']:
            sys.exit(f'línea {lineno}: ancho distinto dentro del glifo')
        current['w'] = len(line)
        current['r'].append(line)
    for char, g in glyphs.items():
        if g['y'] + len(g['r']) > ROWS:
            sys.exit(f'el glifo {char!r} se sale de la rejilla de {ROWS} filas')
    return glyphs


def compose(glyphs: dict[str, dict]) -> None:
    """Añade las letras acentuadas a partir de la base y el acento."""
    for char, (base_char, accent_name) in COMPOSED.items():
        base = glyphs[base_char]
        accent = ACCENTS[accent_name]
        w = base['w']
        # Recorte centrado del acento de 5 píxeles al ancho de la base.
        start = max(0, (5 - w) // 2)
        mark = [row[start:start + w].ljust(w, '.') for row in accent]
        top = 0 if base_char.isupper() else 2
        rows = [''.join('.' for _ in range(w)) for _ in range(base['y'] + len(base['r']) - top)]
        for i, row in enumerate(mark):
            rows[i] = row
        for i, row in enumerate(base['r']):
            rows[base['y'] - top + i] = row
        glyphs[char] = {'w': w, 'y': top, 'r': rows}


def contours(g: dict) -> list[list[tuple[int, int]]]:
    """Contorno exterior de los píxeles (unión exacta, sin solapes), en unidades de fuente.

    Cada píxel aporta sus cuatro aristas en sentido horario (y hacia arriba); las aristas
    compartidas entre dos píxeles se anulan y las que quedan se encadenan en bucles.
    """
    filled = {(x, g['y'] + j) for j, row in enumerate(g['r']) for x, c in enumerate(row) if c == '#'}
    edges: dict[tuple[int, int], list[tuple[int, int]]] = {}
    count: dict[tuple[tuple[int, int], tuple[int, int]], int] = {}

    def add(a: tuple[int, int], b: tuple[int, int]) -> None:
        if (b, a) in count:
            count[(b, a)] -= 1
            if count[(b, a)] == 0:
                del count[(b, a)]
        else:
            count[(a, b)] = count.get((a, b), 0) + 1

    for x, row in filled:
        # Coordenadas de rejilla con y hacia arriba: la fila r ocupa [BASELINE-r-1, BASELINE-r].
        y0 = BASELINE - row - 1
        y1 = y0 + 1
        # Horario: arriba-izquierda → arriba-derecha → abajo-derecha → abajo-izquierda.
        add((x, y1), (x + 1, y1))
        add((x + 1, y1), (x + 1, y0))
        add((x + 1, y0), (x, y0))
        add((x, y0), (x, y1))
    for (a, b) in count:
        edges.setdefault(a, []).append(b)

    loops = []
    while edges:
        start = next(iter(edges))
        loop = [start]
        prev = None
        cur = start
        while True:
            options = edges[cur]
            if len(options) > 1 and prev is not None:
                # Vértice en diagonal: gira siempre a la derecha para cerrar el píxel propio.
                dx, dy = cur[0] - prev[0], cur[1] - prev[1]
                right = (cur[0] + dy, cur[1] - dx)
                nxt = right if right in options else options[0]
            else:
                nxt = options[0]
            options.remove(nxt)
            if not options:
                del edges[cur]
            prev, cur = cur, nxt
            if cur == start:
                break
            loop.append(cur)
        loops.append(simplify(loop))
    return [[(x * UNIT, y * UNIT) for x, y in loop] for loop in loops]


def simplify(loop: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Quita los puntos intermedios de los tramos rectos."""
    out = []
    n = len(loop)
    for i, p in enumerate(loop):
        a, b = loop[i - 1], loop[(i + 1) % n]
        if (p[0] - a[0]) * (b[1] - p[1]) != (p[1] - a[1]) * (b[0] - p[0]):
            out.append(p)
    return out


def glyph_name(char: str) -> str:
    return 'space' if char == ' ' else f'uni{ord(char):04X}'


def build(glyphs: dict[str, dict]) -> None:
    order = ['.notdef'] + [glyph_name(c) for c in glyphs]
    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({ord(c): glyph_name(c) for c in glyphs})

    tt_glyphs = {}
    metrics = {}
    pen = TTGlyphPen(None)
    # .notdef: un rectángulo hueco.
    for loop in ([(0, 0), (0, 700), (500, 700), (500, 0)], [(100, 100), (400, 100), (400, 600), (100, 600)]):
        pen.moveTo(loop[0])
        for p in loop[1:]:
            pen.lineTo(p)
        pen.closePath()
    tt_glyphs['.notdef'] = pen.glyph()
    metrics['.notdef'] = (600, 0)
    for char, g in glyphs.items():
        pen = TTGlyphPen(None)
        for loop in contours(g):
            pen.moveTo(loop[0])
            for p in loop[1:]:
                pen.lineTo(p)
            pen.closePath()
        name = glyph_name(char)
        tt_glyphs[name] = pen.glyph()
        metrics[name] = ((g['w'] + 1) * UNIT, 0)

    fb.setupGlyf(tt_glyphs)
    fb.setupHorizontalMetrics(metrics)
    ascent = BASELINE * UNIT
    descent = (ROWS - BASELINE) * UNIT
    fb.setupHorizontalHeader(ascent=ascent, descent=-descent)
    fb.setupNameTable({
        'familyName': 'Polygone 12',
        'styleName': 'Regular',
        'copyright': 'Copyright (c) 2026 Aimar (github.com/Aimarmndz)',
        'licenseDescription': 'SIL Open Font License 1.1',
        'licenseInfoURL': 'https://openfontlicense.org',
        'designer': 'Aimar',
        'version': 'Version 1.000',
    })
    fb.setupOS2(
        sTypoAscender=ascent, sTypoDescender=-descent, sTypoLineGap=0,
        usWinAscent=ascent, usWinDescent=descent, sxHeight=500, sCapHeight=700,
        fsType=0, achVendID='AIMR',
    )
    fb.setupPost(isFixedPitch=0)
    fb.font.flavor = 'woff2'
    OUT_WOFF2.parent.mkdir(parents=True, exist_ok=True)
    fb.save(str(OUT_WOFF2))


def main() -> None:
    glyphs = parse(SOURCE.read_text(encoding='utf-8'))
    compose(glyphs)
    build(glyphs)
    atlas = {
        'name': 'Polygone 12',
        'license': 'OFL-1.1',
        'rows': ROWS,
        'baseline': BASELINE,
        'glyphs': {c: {'w': g['w'], 'y': g['y'], 'r': g['r']} for c, g in glyphs.items()},
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(atlas, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'{len(glyphs)} glifos → {OUT_WOFF2.relative_to(ROOT)} y {OUT_JSON.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
