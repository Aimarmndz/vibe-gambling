// SPDX-License-Identifier: AGPL-3.0-or-later
// Escritores mínimos y REPRODUCIBLES de .zip y .tar.gz, sin dependencias: mismas entradas y
// misma fecha → mismos bytes, en cualquier máquina. Por eso no se usan `zip` ni `tar` del
// sistema (cada uno pone fechas, dueños y orden a su manera).
//
// - Entradas ordenadas por ruta, rutas con `/`, sin directorios explícitos.
// - Fecha fija (la del commit, o SOURCE_DATE_EPOCH), dueño 0:0, permisos 0644 o 0755.
import { crc32, deflateRawSync, gzipSync } from 'node:zlib'

export interface ArchiveEntry {
  /** Ruta dentro del archivo, relativa y con `/`. */
  readonly path: string
  readonly data: Buffer
  /** Ejecutable (0755) o no (0644). */
  readonly executable?: boolean
}

function checkEntries(entries: readonly ArchiveEntry[]): ArchiveEntry[] {
  const seen = new Set<string>()
  for (const { path } of entries) {
    if (path === '' || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '')) {
      throw new Error(`archive: invalid entry path "${path}"`)
    }
    if (seen.has(path)) throw new Error(`archive: duplicated entry "${path}"`)
    seen.add(path)
  }
  // Orden por bytes de la ruta, independiente de la configuración regional.
  return [...entries].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
}

const modeOf = (entry: ArchiveEntry): number => (entry.executable === true ? 0o755 : 0o644)

// ------------------------------------------------------------------------------------- zip

/** Fecha y hora de MS-DOS (resolución de 2 s; el formato no admite antes de 1980). */
function dosDateTime(epochSeconds: number): { date: number; time: number } {
  const d = new Date(Math.max(epochSeconds, 315532800) * 1000)
  return {
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  }
}

/** Crea un .zip (deflate, sin ZIP64: cada archivo y el total por debajo de 4 GiB). */
export function createZip(entries: readonly ArchiveEntry[], epochSeconds: number): Buffer {
  const { date, time } = dosDateTime(epochSeconds)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of checkEntries(entries)) {
    const name = Buffer.from(entry.path, 'utf8')
    const compressed = deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // firma de cabecera local
    local.writeUInt16LE(20, 4) // versión necesaria: 2.0 (deflate)
    local.writeUInt16LE(0x0800, 6) // bit 11: nombres en UTF-8
    local.writeUInt16LE(8, 8) // método: deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // sin campo extra
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // firma del directorio central
    central.writeUInt16LE((3 << 8) | 20, 4) // hecho en Unix (permisos en los atributos externos)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comentario
    central.writeUInt16LE(0, 34) // disco
    central.writeUInt16LE(0, 36) // atributos internos
    central.writeUInt32LE(((0o100000 | modeOf(entry)) << 16) >>> 0, 38) // archivo regular + modo
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // fin del directorio central
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  if (offset + directory.length > 0xffffffff || entries.length > 0xffff) {
    throw new Error('archive: zip too large (ZIP64 is not supported)')
  }
  return Buffer.concat([...locals, directory, end])
}

// ------------------------------------------------------------------------------------- tar

/** Campo numérico octal de ustar, terminado en NUL. */
function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, '0')}\0`
}

/** Cabecera ustar; las rutas largas se parten en prefijo (155) + nombre (100). */
function tarHeader(path: string, size: number, mode: number, epochSeconds: number): Buffer {
  let name = path
  let prefix = ''
  if (Buffer.byteLength(name) > 100) {
    // El primer `/` que deja el nombre en 100 bytes da el prefijo más corto posible.
    const split = [...path.matchAll(/\//g)]
      .map(m => m.index)
      .find(i => Buffer.byteLength(path.slice(i + 1)) <= 100)
    if (split === undefined || Buffer.byteLength(path.slice(0, split)) > 155) {
      throw new Error(`archive: path too long for ustar: ${path}`)
    }
    prefix = path.slice(0, split)
    name = path.slice(split + 1)
  }
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write(octal(mode, 8), 100, 'ascii')
  header.write(octal(0, 8), 108, 'ascii') // uid
  header.write(octal(0, 8), 116, 'ascii') // gid
  header.write(octal(size, 12), 124, 'ascii')
  header.write(octal(epochSeconds, 12), 136, 'ascii')
  header.write('        ', 148, 'ascii') // la suma se calcula con el campo en blanco
  header.write('0', 156, 'ascii') // archivo regular
  header.write('ustar\0', 257, 'ascii')
  header.write('00', 263, 'ascii')
  header.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  return header
}

/** Crea un .tar.gz (ustar, gzip nivel 9 sin nombre ni fecha en la cabecera de gzip). */
export function createTarGz(entries: readonly ArchiveEntry[], epochSeconds: number): Buffer {
  const blocks: Buffer[] = []
  for (const entry of checkEntries(entries)) {
    blocks.push(tarHeader(entry.path, entry.data.length, modeOf(entry), epochSeconds), entry.data)
    const padding = (512 - (entry.data.length % 512)) % 512
    if (padding > 0) blocks.push(Buffer.alloc(padding))
  }
  blocks.push(Buffer.alloc(1024)) // dos bloques vacíos cierran el tar
  const gz = gzipSync(Buffer.concat(blocks), { level: 9 })
  // Byte de SO de la cabecera gzip: siempre "Unix", para que Windows dé los mismos bytes.
  gz[9] = 3
  return gz
}
