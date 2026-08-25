// Regression tests for docs/code-review-2.md finding 3: zip-bomb amplification in readZip / fillDocx, and the
// precompressed pass-through in writeZipAsync. Packages are built with python3's zipfile (skipped without it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readZip, MAX_PACKAGE_SIZE, MAX_ENTRIES } from '../engine/docx/zipread.js';
import { writeZipAsync, crc32 } from '../engine/docx/zipwrite.js';
import { fillDocx } from '../engine/docx/fill.js';
import { OUT, W_NS, STYLES } from './docx-fill-fixtures.js';

const HAS_PY = spawnSync('python3', ['-c', 'import zipfile'], { stdio: 'ignore' }).status === 0;
const DIR = join(OUT, 'review2-zip');
mkdirSync(DIR, { recursive: true });

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const DOC = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body><w:p><w:r><w:t xml:space="preserve">Dear {[Name]},</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;

/** Build a zip with python3: parts = [[name, 'text'|'zeros:N'|'random:N', method?]]; method: deflated (default) | stored | bzip2 */
function pyZip(file, parts) {
  const script = `
import zipfile, sys, os, json
out, parts = sys.argv[1], json.loads(sys.argv[2])
M = {'deflated': zipfile.ZIP_DEFLATED, 'stored': zipfile.ZIP_STORED, 'bzip2': zipfile.ZIP_BZIP2}
with zipfile.ZipFile(out, 'w') as z:
    for name, spec, method in parts:
        if spec.startswith('zeros:'): data = b'\\0' * int(spec[6:])
        elif spec.startswith('random:'): data = os.urandom(int(spec[7:]))
        else: data = spec.encode()
        z.writestr(zipfile.ZipInfo(name), data, compress_type=M[method])
`;
  execFileSync('python3', ['-c', script, file, JSON.stringify(parts.map((p) => [p[0], p[1], p[2] || 'deflated']))]);
  return new Uint8Array(readFileSync(file));
}
const base = () => [['[Content_Types].xml', CT], ['_rels/.rels', RELS], ['word/document.xml', DOC]];

test('#3 many large zero entries: readZip refuses the package before inflating anything (256 MB budget)', { skip: !HAS_PY && 'python3 unavailable' }, async () => {
  // 7 × 40 MB of zeros deflate to ~40 KB each: 280 MB inflated from a ~300 KB file
  const parts = base();
  for (let i = 0; i < 7; i++) parts.push([`word/media/bomb${i}.bin`, 'zeros:' + 40 * 1024 * 1024]);
  const bytes = pyZip(join(DIR, 'bomb-budget.docx'), parts);
  assert.ok(bytes.length < 1024 * 1024, 'the bomb itself is small: ' + bytes.length);
  assert.throws(() => readZip(bytes), /package too large/);
  await assert.rejects(fillDocx(bytes, { Name: 'A' }), /package too large/);
  assert.ok(MAX_PACKAGE_SIZE <= 256 * 1024 * 1024);
});

test('#3 entry-count cap: 5000 tiny entries are refused; a package under both caps is read', { skip: !HAS_PY && 'python3 unavailable' }, async () => {
  const parts = base();
  for (let i = 0; i < 5000; i++) parts.push([`word/media/e${i}.bin`, 'x', 'stored']);
  const bytes = pyZip(join(DIR, 'bomb-count.docx'), parts);
  assert.throws(() => readZip(bytes), /too many entries/);
  await assert.rejects(fillDocx(bytes, { Name: 'A' }), /too many entries/);
  assert.equal(MAX_ENTRIES, 4096);
  // under budget: 3 × 40 MB stays under 256 MB and each entry under 50 MB, and fillDocx passes the zeros through
  // without inflating them (the output is still ~KBs and the output entries are byte-identical)
  const ok = base();
  for (let i = 0; i < 3; i++) ok.push([`word/media/z${i}.bin`, 'zeros:' + 40 * 1024 * 1024]);
  const okBytes = pyZip(join(DIR, 'under-budget.docx'), ok);
  const before = process.memoryUsage().rss;
  const r = await fillDocx(okBytes, { Name: 'Ann' });
  const grew = process.memoryUsage().rss - before;
  assert.ok(grew < 64 * 1024 * 1024, `RSS grew ${(grew / 1048576).toFixed(0)} MB (the 120 MB of zeros must not be inflated)`);
  assert.ok(r.bytes.length < 1024 * 1024, 'output stays small: ' + r.bytes.length);
  const inZ = readZip(okBytes), outZ = readZip(r.bytes);
  for (let i = 0; i < 3; i++) {
    const a = inZ.get(`word/media/z${i}.bin`), b = outZ.get(`word/media/z${i}.bin`);
    assert.deepEqual([b.method, b.crc, b.compressedSize, b.uncompressedSize], [a.method, a.crc, a.compressedSize, a.uncompressedSize]);
    assert.deepEqual(b.raw(), a.raw());
  }
  assert.match(r.text, /Dear Ann,/);
});

test('#3 fillDocx keeps a 2 MB image entry byte-identical without inflating it (unsupported-method entry proves no inflate)', { skip: !HAS_PY && 'python3 unavailable' }, async () => {
  const parts = base();
  parts.push(['word/media/image1.png', 'random:' + 2 * 1024 * 1024, 'deflated']);
  // bzip2 (method 12) cannot be inflated by zipread: fillDocx can only succeed by passing the stored bytes through
  parts.push(['word/media/blob.bin', 'random:' + 65536, 'bzip2']);
  parts.push(['word/media/stored.bin', 'random:' + 65536, 'stored']);
  const bytes = pyZip(join(DIR, 'image.docx'), parts);
  const r = await fillDocx(bytes, { Name: 'Bea' });
  const inZ = readZip(bytes), outZ = readZip(r.bytes);
  for (const name of ['word/media/image1.png', 'word/media/blob.bin', 'word/media/stored.bin', '_rels/.rels']) {
    const a = inZ.get(name), b = outZ.get(name);
    assert.ok(b, name + ' present');
    assert.equal(b.method, a.method, name + ' method');
    assert.equal(b.crc, a.crc, name + ' crc');
    assert.equal(b.compressedSize, a.compressedSize, name + ' compressed size');
    assert.equal(b.uncompressedSize, a.uncompressedSize, name + ' uncompressed size');
    assert.deepEqual(b.raw(), a.raw(), name + ' stored bytes are byte-identical');
  }
  assert.equal(outZ.get('word/media/blob.bin').method, 12);
  const png = await outZ.get('word/media/image1.png').bytes();
  assert.equal(png.length, 2 * 1024 * 1024);
  assert.equal(crc32(png), inZ.get('word/media/image1.png').crc);
  assert.match(r.text, /Dear Bea,/, 'the template part was still filled');
  assert.ok(new TextDecoder().decode(await outZ.get('word/document.xml').bytes()).includes('Bea'));
  // python agrees the result is a valid archive with [Content_Types].xml first
  writeFileSync(join(DIR, 'image-out.docx'), r.bytes);
  const chk = spawnSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(z.namelist()[0])', join(DIR, 'image-out.docx')], { encoding: 'utf8' });
  assert.equal(chk.stdout.trim(), 'None\n[Content_Types].xml');
});

test('#3 writeZipAsync precompressed entries: {name, raw, method, crc, compressedSize, uncompressedSize} are copied verbatim', async () => {
  const text = 'hello '.repeat(1000);
  const src = await writeZipAsync([{ name: 'a.txt', data: text }, { name: 'b.txt', data: 'plain' }]);
  const z = readZip(src);
  const a = z.get('a.txt');
  assert.equal(a.method, 8, 'fixture is deflated');
  const out = await writeZipAsync([
    { name: 'a.txt', raw: a.raw(), method: a.method, crc: a.crc, compressedSize: a.compressedSize, uncompressedSize: a.uncompressedSize },
    { name: 'b.txt', data: 'changed' },
  ]);
  const z2 = readZip(out);
  const a2 = z2.get('a.txt');
  assert.deepEqual([a2.method, a2.crc, a2.compressedSize, a2.uncompressedSize], [a.method, a.crc, a.compressedSize, a.uncompressedSize]);
  assert.deepEqual(a2.raw(), a.raw());
  assert.equal(new TextDecoder().decode(await a2.bytes()), text);
  assert.equal(new TextDecoder().decode(await z2.get('b.txt').bytes()), 'changed');
  // a stored precompressed entry needs no sizes; a mismatching compressedSize is refused
  const st = await writeZipAsync([{ name: 's.txt', raw: new TextEncoder().encode('xyz'), method: 0, crc: crc32(new TextEncoder().encode('xyz')) }]);
  assert.equal(new TextDecoder().decode(await readZip(st).get('s.txt').bytes()), 'xyz');
  await assert.rejects(writeZipAsync([{ name: 'bad', raw: a.raw(), method: 8, crc: a.crc, compressedSize: 1, uncompressedSize: 5 }]), /raw length/);
  await assert.rejects(writeZipAsync([{ name: 'bad', raw: a.raw(), method: 8 }]), /need crc and uncompressedSize/);
});
