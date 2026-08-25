// zipwrite.js — minimal ZIP writer. Browser + Node, zero deps.
// API: writeZip(entries): Uint8Array                       (STORE only, synchronous)
//      writeZipAsync(entries, {compress=true}): Promise<Uint8Array>
//        uses CompressionStream('deflate-raw') when available, else falls back to STORE
//      crc32(bytes: Uint8Array): number   (unsigned)
//      entries: Array<{name: string, data: Uint8Array|string, date?: Date}>

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

class ByteWriter {
  constructor() { this.chunks = []; this.length = 0; }
  u16(v) { this.chunks.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff])); this.length += 2; }
  u32(v) { this.chunks.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff])); this.length += 4; }
  bytes(b) { this.chunks.push(b); this.length += b.length; }
  toUint8Array() {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const c of this.chunks) { out.set(c, off); off += c.length; }
    return out;
  }
}

/** Assemble a zip from prepared entries: {nameBytes, data(stored bytes), raw(uncompressed), method, crc, time, date}. */
function assemble(prepared) {
  const w = new ByteWriter();
  const central = [];
  for (const e of prepared) {
    const offset = w.length;
    w.u32(0x04034b50);
    w.u16(20); w.u16(0x0800); w.u16(e.method);
    w.u16(e.time); w.u16(e.date);
    w.u32(e.crc); w.u32(e.data.length); w.u32(e.rawSize);
    w.u16(e.nameBytes.length); w.u16(0);
    w.bytes(e.nameBytes); w.bytes(e.data);
    central.push({ ...e, offset });
  }
  const cdStart = w.length;
  for (const c of central) {
    w.u32(0x02014b50);
    w.u16(20); w.u16(20); w.u16(0x0800); w.u16(c.method);
    w.u16(c.time); w.u16(c.date);
    w.u32(c.crc); w.u32(c.data.length); w.u32(c.rawSize);
    w.u16(c.nameBytes.length); w.u16(0); w.u16(0); w.u16(0); w.u16(0); w.u32(0);
    w.u32(c.offset);
    w.bytes(c.nameBytes);
  }
  const cdSize = w.length - cdStart;
  w.u32(0x06054b50);
  w.u16(0); w.u16(0);
  w.u16(central.length); w.u16(central.length);
  w.u32(cdSize); w.u32(cdStart); w.u16(0);
  return w.toUint8Array();
}

function prepare(entries) {
  const enc = new TextEncoder();
  const now = new Date();
  return entries.map((e) => {
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    return { nameBytes: enc.encode(e.name), raw, rawSize: raw.length, data: raw, method: 0, crc: crc32(raw), ...dosDateTime(e.date || now) };
  });
}

/** Build a ZIP archive using STORE (no compression). Synchronous. */
export function writeZip(entries) {
  return assemble(prepare(entries));
}

export function canDeflate() {
  return typeof CompressionStream === 'function';
}

async function deflateRaw(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/** Build a ZIP archive, DEFLATE-compressing entries when CompressionStream is available. */
export async function writeZipAsync(entries, { compress = true } = {}) {
  const prepared = prepare(entries);
  if (compress && canDeflate()) {
    for (const e of prepared) {
      const d = await deflateRaw(e.raw);
      if (d.length < e.raw.length) { e.data = d; e.method = 8; }
    }
  }
  return assemble(prepared);
}
