// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests de los escritores de .zip y .tar.gz: se leen de vuelta con un lector propio mínimo
// (sin depender de `unzip` ni `tar`, que no están igual en todos los sistemas).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crc32, gunzipSync, inflateRawSync } from 'node:zlib'

import { createTarGz, createZip } from '../lib/archive.ts'

const EPOCH = 1_791_841_686 // 2026-10-12T21:48:06Z
const entries = [
  { path: 'b/second.txt', data: Buffer.from('second\n') },
  { path: 'a.sh', data: Buffer.from('#!/bin/sh\necho hi\n'), executable: true },
  { path: `deep/${'x'.repeat(90)}/${'y'.repeat(60)}.txt`, data: Buffer.alloc(1300, 7) },
]

interface Read {
  path: string
  data: Buffer
  mode: number
}

function readZip(zip: Buffer): Read[] {
  const end = zip.length - 22
  assert.equal(zip.readUInt32LE(end), 0x06054b50)
  const count = zip.readUInt16LE(end + 10)
  let offset = zip.readUInt32LE(end + 16)
  const out: Read[] = []
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50)
    const crc = zip.readUInt32LE(offset + 16)
    const size = zip.readUInt32LE(offset + 20)
    const nameLength = zip.readUInt16LE(offset + 28)
    const mode = (zip.readUInt32LE(offset + 38) >>> 16) & 0o777
    const local = zip.readUInt32LE(offset + 42)
    const path = zip.toString('utf8', offset + 46, offset + 46 + nameLength)
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = inflateRawSync(zip.subarray(start, start + size))
    assert.equal(crc32(data), crc, `crc of ${path}`)
    out.push({ path, data, mode })
    offset += 46 + nameLength
  }
  return out
}

function readTarGz(archive: Buffer): Read[] {
  const tar = gunzipSync(archive)
  const out: Read[] = []
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const field = (start: number, length: number): string =>
      header.toString('utf8', start, start + length).replace(/\0.*$/s, '')
    const size = parseInt(field(124, 12), 8)
    const prefix = field(345, 155)
    let sum = 0
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : (header[i] ?? 0)
    assert.equal(parseInt(field(148, 8), 8), sum, 'tar checksum')
    assert.equal(parseInt(field(136, 12), 8), EPOCH)
    out.push({
      path: prefix === '' ? field(0, 100) : `${prefix}/${field(0, 100)}`,
      data: tar.subarray(offset + 512, offset + 512 + size),
      mode: parseInt(field(100, 8), 8),
    })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

const expected = [...entries]
  .sort((a, b) => (a.path < b.path ? -1 : 1))
  .map(e => ({ path: e.path, data: e.data, mode: e.executable === true ? 0o755 : 0o644 }))

describe('createZip', () => {
  it('writes every entry sorted, with its permissions, and is reproducible', () => {
    const zip = createZip(entries, EPOCH)
    assert.deepEqual(readZip(zip), expected)
    assert.ok(createZip([...entries].reverse(), EPOCH).equals(zip))
  })

  it('rejects unsafe or duplicated paths', () => {
    for (const path of ['/abs', '../up', 'a//b', '']) {
      assert.throws(() => createZip([{ path, data: Buffer.alloc(0) }], EPOCH), /invalid entry path/)
    }
    assert.throws(
      () =>
        createZip(
          [
            { path: 'a', data: Buffer.alloc(0) },
            { path: 'a', data: Buffer.alloc(0) },
          ],
          EPOCH,
        ),
      /duplicated/,
    )
  })
})

describe('createTarGz', () => {
  it('writes ustar entries (long paths in the prefix) and is reproducible', () => {
    const archive = createTarGz(entries, EPOCH)
    assert.deepEqual(readTarGz(archive), expected)
    assert.ok(createTarGz([...entries].reverse(), EPOCH).equals(archive))
    assert.equal(archive[9], 3, 'gzip OS byte is fixed')
  })

  it('refuses names that do not fit in ustar', () => {
    assert.throws(
      () => createTarGz([{ path: 'z'.repeat(101), data: Buffer.alloc(0) }], EPOCH),
      /too long/,
    )
  })
})
