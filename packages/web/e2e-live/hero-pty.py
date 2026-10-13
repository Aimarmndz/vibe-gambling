# SPDX-License-Identifier: AGPL-3.0-or-later
# Conduce una sesión INTERACTIVA real de Claude Code en un pseudoterminal y graba todo lo que pinta,
# con la hora de cada trozo, para el GIF principal del README (lo usa record-hero.ts).
#
# No inventa nada: arranca `claude` con el mod cargado, contesta al aviso de confianza de la carpeta
# si sale, escribe el prompt tecla a tecla, lo manda y espera a que el mod enseñe el resultado de la
# tirada. La salida es un JSON con los bytes del terminal (base64) y la hora (epoch, s) de cada uno.
#
# Uso: python3 -I hero-pty.py <config.json>
#   config: { "claude", "cwd", "args": [...], "cols", "rows", "prompt", "out",
#             "keyDelayMs", "readyTimeoutS", "turnTimeoutS", "tailS", "resultPattern" }
import base64
import fcntl
import json
import os
import pty
import random
import re
import select
import signal
import struct
import sys
import termios
import time

ANSI = re.compile(rb'\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]')


def main() -> None:
    cfg = json.load(open(sys.argv[1], encoding='utf8'))
    cols, rows = int(cfg['cols']), int(cfg['rows'])
    # El hijo no hereda las marcas de la sesión de Claude Code que lanza este script (si no,
    # el terminal grabado enseña avisos de "sesión hija" que un usuario normal no ve).
    env = {k: v for k, v in os.environ.items() if not k.startswith(('CLAUDE', 'CLAUDECODE'))}
    env.update({'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'COLUMNS': str(cols), 'LINES': str(rows)})

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cfg['cwd'])
        os.execvpe(cfg['claude'], [cfg['claude'], *cfg['args']], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

    chunks: list[tuple[float, bytes]] = []
    marks: dict[str, float] = {}

    def pump(seconds: float) -> bool:
        """Lee lo que pinte el terminal durante `seconds`. Devuelve False si el proceso cerró."""
        end = time.time() + seconds
        while True:
            left = end - time.time()
            if left <= 0:
                return True
            ready, _, _ = select.select([fd], [], [], min(left, 0.05))
            if ready:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    return False
                if not data:
                    return False
                chunks.append((time.time(), data))

    def text(since: float = 0) -> str:
        raw = b''.join(d for t, d in chunks if t >= since)
        return ANSI.sub(b'', raw).decode('utf8', 'replace')

    def idle_for(seconds: float) -> bool:
        return bool(chunks) and time.time() - chunks[-1][0] >= seconds

    def write(data: bytes) -> None:
        os.write(fd, data)

    # 1. Arranque: aviso de confianza de la carpeta (trae "No, exit" marcado: flecha abajo y Enter)
    #    y espera a que la caja del prompt quede quieta.
    start = time.time()
    trusted = False
    while time.time() - start < cfg['readyTimeoutS']:
        if not pump(0.5):
            raise SystemExit('claude se cerró al arrancar')
        flat = text().replace(' ', '').lower()
        if not trusted and 'trustthisfolder' in flat:
            write(b'\x1b[B')
            pump(0.6)
            write(b'\r')
            trusted = True
            continue
        if '❯' in text() and idle_for(2.0) and time.time() - start > 4:
            break
    else:
        raise SystemExit('la caja del prompt no apareció a tiempo')

    # 2. El prompt, tecla a tecla, a ritmo de persona (con algo de variación).
    marks['typing'] = time.time()
    rng = random.Random(7)
    for ch in cfg['prompt']:
        write(ch.encode('utf8'))
        pump(cfg['keyDelayMs'] / 1000 * rng.uniform(0.6, 1.5))
    pump(0.5)
    write(b'\r')
    marks['submit'] = time.time()

    # 3. Espera al aviso del mod con el resultado de la tirada (sale cuando la bola ya ha caído).
    pattern = re.compile(cfg['resultPattern'])
    while time.time() - marks['submit'] < cfg['turnTimeoutS']:
        if not pump(0.25):
            raise SystemExit('claude se cerró durante el turno')
        if pattern.search(text(marks['submit'])):
            marks['result'] = time.time()
            break
    else:
        raise SystemExit('el mod no enseñó el resultado a tiempo')
    pump(cfg['tailS'])
    marks['end'] = time.time()

    # 4. Salida limpia (fuera del clip).
    write(b'\x03')
    pump(0.5)
    write(b'\x03')
    pump(2)
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)

    with open(cfg['out'], 'w', encoding='utf8') as f:
        json.dump(
            {
                'cols': cols,
                'rows': rows,
                'marks': marks,
                'chunks': [[t, base64.b64encode(d).decode('ascii')] for t, d in chunks],
            },
            f,
        )
    print(json.dumps({'marks': marks, 'chunks': len(chunks)}))


if __name__ == '__main__':
    main()
