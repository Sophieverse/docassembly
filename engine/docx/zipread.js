// zipread.js — minimal ZIP reader (STORE + DEFLATE via DecompressionStream). Browser + Node 20, zero deps.
// API: readZip(bytes: Uint8Array): Map<string, ZipEntry>
//      ZipEntry = { name, method, crc, compressedSize, uncompressedSize, dataOffset, bytes: () => Promise<Uint8Array> }
//      readZipText(bytes, name): Promise<string>

const dec = new TextDecoder();

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

function findEOCD(b) {
  // EOCD is min 22 bytes; comment can be up to 65535 bytes. Scan backwards.
  const min = Math.max(0, b.length - 22 - 65535);
  for (let i = b.length - 22; i >= min; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i;
  }
  throw new Error('zipread: EOCD signature not found (not a zip?)');
}

async function inflateRaw(compressed, maxSize = Infinity) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('zipread: DecompressionStream unavailable; cannot inflate DEFLATE entries');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(compressed).catch(() => {}); // rejected (AbortError) if the read side is cancelled by the size cap
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
    if (total > maxSize) { reader.cancel().catch(() => {}); throw new Error(`zipread: inflated entry exceeds ${maxSize} bytes`); }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Parse the central directory. Does not decompress until entry.bytes() is called.
 * @param {Uint8Array} b
 * @returns {Map<string, object>}
 */
export const MAX_ENTRY_SIZE = 50 * 1024 * 1024; // refuse to inflate parts larger than this (zip bombs)

export function readZip(b, { maxEntrySize = MAX_ENTRY_SIZE } = {}) {
  if (!(b instanceof Uint8Array)) throw new Error('zipread: expected a Uint8Array');
  if (b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    throw new Error('zipread: this is a legacy binary Word file (.doc / OLE compound document), not a .docx. Open it in Word and "Save As" .docx first.');
  }
  const eocd = findEOCD(b);
  const count = u16(b, eocd + 10);
  const cdOffset = u32(b, eocd + 16);
  if (cdOffset >= eocd) throw new Error('zipread: central directory offset out of range');
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new Error('zipread: bad central directory signature at ' + p);
    const method = u16(b, p + 10);
    const crc = u32(b, p + 16);
    const compressedSize = u32(b, p + 20);
    const uncompressedSize = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const localOffset = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    // Local header name/extra lengths may differ from central ones — always re-read.
    if (localOffset + 30 > b.length || u32(b, localOffset) !== 0x04034b50) throw new Error('zipread: bad local header for ' + name);
    const lNameLen = u16(b, localOffset + 26);
    const lExtraLen = u16(b, localOffset + 28);
    const dataOffset = localOffset + 30 + lNameLen + lExtraLen;
    if (dataOffset + compressedSize > b.length) throw new Error('zipread: entry data past end of file: ' + name);
    if (uncompressedSize > maxEntrySize) throw new Error(`zipread: entry ${name} too large (${uncompressedSize} bytes)`);

    const entry = {
      name, method, crc, compressedSize, uncompressedSize, dataOffset,
      async bytes() {
        const raw = b.subarray(dataOffset, dataOffset + compressedSize);
        if (method === 0) return raw;
        if (method === 8) {
          const out = await inflateRaw(raw, maxEntrySize);
          return out;
        }
        throw new Error(`zipread: unsupported compression method ${method} for ${name}`);
      },
    };
    entries.set(name, entry);
  }
  return entries;
}

/** Convenience: read one entry as UTF-8 text. */
export async function readZipText(b, name) {
  const e = readZip(b).get(name);
  if (!e) throw new Error('zipread: entry not found: ' + name);
  return dec.decode(await e.bytes());
}
