// Shared fixture builders for docx-fill-*.test.js (not a test file itself).
// Documents are zipped with python3's zipfile (DEFLATE, like Word) when available, else our STORE writer.
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { writeZipAsync } from '../engine/docx/zipwrite.js';
import { readZip } from '../engine/docx/zipread.js';

export const OUT = '/private/tmp/claude-501/-Users-melod/3d0f23c6-a481-4b3b-a0b2-43cc231b3f85/scratchpad/docx-fill-out';
mkdirSync(OUT, { recursive: true });

export const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

const CONTENT_TYPES = (extra) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>${extra}</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

export const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style></w:styles>`;

export const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;

/** A run: r('text') / r('text', '<w:b/>') / r('text', rPr, ' w:rsidR="00AB12CD"'). */
export function r(text, rPr = '', attrs = '') {
  const t = text === '\t' ? '<w:tab/>' : `<w:t xml:space="preserve">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t>`;
  return `<w:r${attrs}>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${t}</w:r>`;
}
/** A paragraph from runs (strings) with optional pPr inner XML and w:p attributes. */
export function p(runs, pPr = '', attrs = '') {
  return `<w:p${attrs}>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
}
/** Single-run paragraph of plain text. */
export const tp = (text, pPr = '') => p([r(text)], pPr);

export function docXml(bodyXml, sectPr = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>') {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W_NS}><w:body>${bodyXml}${sectPr}</w:body></w:document>`;
}
export function hdrXml(bodyXml) { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${W_NS}>${bodyXml}</w:hdr>`; }
export function ftrXml(bodyXml) { return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${W_NS}>${bodyXml}</w:ftr>`; }

/**
 * Build a .docx from parts. `parts` maps part names to XML strings; document.xml is required.
 * Header/footer parts get content types + document rels automatically.
 */
export async function makeDocx(parts, { name = 'fixture' } = {}) {
  const names = Object.keys(parts);
  const hdrFtr = names.filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n));
  const overrides = hdrFtr.map((n) => `<Override PartName="/${n}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${n.includes('header') ? 'header' : 'footer'}+xml"/>`).join('')
    + names.filter((n) => /^word\/(footnotes|endnotes)\.xml$/.test(n)).map((n) => `<Override PartName="/${n}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${n.includes('foot') ? 'footnotes' : 'endnotes'}+xml"/>`).join('');
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${hdrFtr.map((n, i) => `<Relationship Id="rId${10 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${n.includes('header') ? 'header' : 'footer'}" Target="${n.slice(5)}"/>`).join('')}</Relationships>`;
  const all = {
    '[Content_Types].xml': CONTENT_TYPES(overrides),
    '_rels/.rels': ROOT_RELS,
    'word/_rels/document.xml.rels': docRels,
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
    ...parts,
  };
  // header/footer references in sectPr are optional for our purposes (Word still opens the file).
  const dir = mkdtempSync(join(OUT, name + '-'));
  for (const [n, xml] of Object.entries(all)) { mkdirSync(join(dir, n, '..'), { recursive: true }); writeFileSync(join(dir, n), xml); }
  const out = join(OUT, name + '.docx');
  const py = spawnSync('python3', ['-c', 'import sys'], { stdio: 'ignore' });
  if (py.status === 0) {
    execFileSync('python3', ['-c', `
import zipfile, sys, os
root, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in names: z.write(os.path.join(root, n), n)
`, dir, out, ...Object.keys(all)]);
    return new Uint8Array(readFileSync(out));
  }
  const bytes = await writeZipAsync(Object.entries(all).map(([n, xml]) => ({ name: n, data: xml })));
  writeFileSync(out, bytes);
  return bytes;
}

export function has(tool) { return spawnSync('which', [tool], { stdio: 'ignore' }).status === 0; }

/** `unzip -t` + xmllint every XML part. Returns [] when all good; skips tools that are missing. */
export async function checkDocx(path) {
  const problems = [];
  if (has('unzip')) { const t = spawnSync('unzip', ['-t', path], { encoding: 'utf8' }); if (t.status !== 0) problems.push('unzip -t: ' + t.stdout + t.stderr); }
  if (has('xmllint')) {
    const dec = new TextDecoder();
    for (const [n, e] of readZip(new Uint8Array(readFileSync(path)))) {
      if (!/\.(xml|rels)$/.test(n)) continue;
      const x = spawnSync('xmllint', ['--noout', '-'], { input: dec.decode(await e.bytes()), encoding: 'utf8' });
      if (x.status !== 0) problems.push(`xmllint ${n}: ${x.stderr}`);
    }
  }
  return problems;
}

/** macOS textutil plain-text conversion (empty string when unavailable). */
export function textutil(path) {
  if (!has('textutil')) return null;
  const t = spawnSync('textutil', ['-convert', 'txt', '-stdout', path], { encoding: 'utf8' });
  return t.status === 0 ? t.stdout : null;
}
