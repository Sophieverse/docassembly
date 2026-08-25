// docxwrite.js — build a .docx from Block[] (API.md shape). Browser + Node, zero deps.
//
// Block = {type:'paragraph', runs:[{text,bold,italic,underline}], style:'Normal'|'Title'|'Heading1'|'Heading2'|'Heading3',
//          align:'left'|'center'|'right'|'justify', numbering?:{kind:'bullet'|'decimal', level}, indent?}
//       | {type:'table', rows: Block[][][]} | {type:'pagebreak'}
// The legacy spike shape ({list:'bullet'|'number', level, align:'both', type:'pageBreak'}) is also accepted.
//
// API: buildDocx(blocks, opts): Promise<Uint8Array>      opts = {title, font, fontSize, margins, lineSpacing, compress}
//      buildDocxSync(blocks, opts): Uint8Array           (STORE only)
//      buildDocumentXml(blocks): string
//      normalizeBlocks(blocks): Block[]
//      escapeXml(s): string

import { writeZip, writeZipAsync } from './zipwrite.js';

export function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const BULLET_NUM_ID = 1;

// ---------- normalization (spike shape / API shape -> API shape) ----------
export function normalizeBlocks(blocks) {
  return (blocks || []).map(normalizeBlock);
}
function normalizeBlock(b) {
  if (!b) return { type: 'paragraph', runs: [], style: 'Normal', align: 'left' };
  if (b.type === 'pagebreak' || b.type === 'pageBreak') return { type: 'pagebreak' };
  if (b.type === 'table') return { type: 'table', rows: (b.rows || []).map((r) => r.map((cell) => normalizeBlocks(cell))) };
  if (b.type !== 'paragraph') throw new Error('docxwrite: unknown block type ' + b.type);
  const out = { type: 'paragraph', runs: (b.runs || []).map((r) => ({ text: String(r.text ?? ''), bold: !!r.bold, italic: !!r.italic, underline: !!r.underline })) };
  out.style = b.style && b.style !== 'Normal' ? b.style : 'Normal';
  const a = b.align === 'both' ? 'justify' : b.align;
  out.align = a === 'center' || a === 'right' || a === 'justify' ? a : 'left';
  if (b.numbering) out.numbering = { kind: b.numbering.kind === 'bullet' ? 'bullet' : 'decimal', level: b.numbering.level || 0 };
  else if (b.list) out.numbering = { kind: b.list === 'bullet' ? 'bullet' : 'decimal', level: b.level || 0 };
  if (b.indent) out.indent = b.indent;
  if (b.pageBreakBefore) out.pageBreakBefore = true;
  return out;
}

// ---------- numbering groups: each decimal list restarts at 1 ----------
function isEmptyPara(b) { return b.type === 'paragraph' && !b.numbering && !b.runs.some((r) => r.text.trim()); }

/** Assign _numId to numbered paragraphs. Returns number of decimal groups. */
function assignNumIds(blocks, state = { next: 2 }) {
  let openGroup = null; // numId of the current decimal group
  for (const b of blocks) {
    if (b.type === 'table') { for (const row of b.rows) for (const cell of row) assignNumIds(cell, state); openGroup = null; continue; }
    if (b.type !== 'paragraph') { openGroup = null; continue; }
    if (b.numbering?.kind === 'decimal') { if (openGroup === null) openGroup = state.next++; b._numId = openGroup; }
    else if (b.numbering?.kind === 'bullet') b._numId = BULLET_NUM_ID;
    else if (!isEmptyPara(b)) openGroup = null;
  }
  return state.next - 2;
}

// ---------- XML ----------
const HEADING_SZ = { Title: 8, Heading1: 4, Heading2: 2, Heading3: 0 };

/** Direct font + size on every run, derived from the paragraph style + document options. Word honours styles.xml,
 *  but several importers (Apple textutil/TextEdit/Quick Look) ignore styles.xml and numbering.xml entirely; the direct
 *  font/size keeps headings visibly larger there. Bold/italic/caps stay style-only so readDocx round-trips `**` exactly. */
function styleRunProps(style, ctx) {
  const f = escapeXml(ctx.font);
  const sz = ctx.sz + 2 * (HEADING_SZ[style] ?? 0);
  return `<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`;
}

function runXml(r, style, ctx) {
  let props = styleRunProps(style, ctx);
  if (r.bold) props += '<w:b/><w:bCs/>';
  if (r.italic) props += '<w:i/><w:iCs/>';
  if (r.underline) props += '<w:u w:val="single"/>';
  let inner = '';
  for (const p of r.text.split(/(\t|\n)/)) {
    if (p === '\t') inner += '<w:tab/>';
    else if (p === '\n') inner += '<w:br/>';
    else if (p.length) inner += `<w:t xml:space="preserve">${escapeXml(p)}</w:t>`;
  }
  return `<w:r><w:rPr>${props}</w:rPr>${inner}</w:r>`;
}

const JC = { justify: 'both', center: 'center', right: 'right' };

function paragraphXml(p, ctx) {
  const pPr = [];
  if (p.style !== 'Normal') pPr.push(`<w:pStyle w:val="${escapeXml(p.style)}"/>`);
  if (p.style === 'Title' && p.align === 'left') p = { ...p, align: 'center' };
  else if (p.numbering) pPr.push('<w:pStyle w:val="ListParagraph"/>');
  if (p.numbering) pPr.push(`<w:numPr><w:ilvl w:val="${p.numbering.level}"/><w:numId w:val="${p._numId || BULLET_NUM_ID}"/></w:numPr>`);
  if (p.indent) pPr.push(`<w:ind w:left="${720 * p.indent}"/>`);
  if (JC[p.align]) pPr.push(`<w:jc w:val="${JC[p.align]}"/>`);
  const pb = p.pageBreakBefore ? '<w:r><w:br w:type="page"/></w:r>' : '';
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${pb}${p.runs.map((r) => runXml(r, p.style, ctx)).join('')}</w:p>`;
}

const BORDERS = '<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>' +
  '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>';

function tableXml(t, ctx) {
  const rows = t.rows.map((row) => {
    const cells = row.map((cell) => {
      const blocks = cell.length ? cell.map((b) => blockXml(b, ctx)).join('') : '<w:p/>';
      return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${blocks}</w:tc>`;
    }).join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${BORDERS}</w:tblBorders></w:tblPr>${rows}</w:tbl>`;
}

function blockXml(b, ctx) {
  switch (b.type) {
    case 'paragraph': return paragraphXml(b, ctx);
    case 'pagebreak': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    case 'table': return tableXml(b, ctx);
    default: throw new Error('docxwrite: unknown block type ' + b.type);
  }
}

function marginsTwips(m) {
  const inch = (v) => Math.round((v == null ? 1 : +v) * 1440);
  if (typeof m === 'number' || m == null) return { top: inch(m), right: inch(m), bottom: inch(m), left: inch(m) };
  return { top: inch(m.top), right: inch(m.right), bottom: inch(m.bottom), left: inch(m.left) };
}

/** document.xml for normalized blocks (numIds already assigned). */
function documentXml(blocks, opts) {
  const m = marginsTwips(opts.margins);
  const ctx = { font: String(opts.font || 'Times New Roman'), sz: Math.round((+opts.fontSize || 12) * 2) };
  let body = blocks.map((b) => blockXml(b, ctx)).join('');
  if (blocks.length && blocks[blocks.length - 1].type === 'table') body += '<w:p/>'; // Word requires a paragraph after a trailing table
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document ${W_NS}><w:body>${body}` +
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="${m.top}" w:right="${m.right}" w:bottom="${m.bottom}" w:left="${m.left}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`;
}

export function buildDocumentXml(blocks, opts = {}) {
  const norm = normalizeBlocks(blocks);
  assignNumIds(norm);
  return documentXml(norm, opts);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>DocAssembly</Application></Properties>`;

function coreXml(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(title || '')}</dc:title><dc:creator>DocAssembly</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function stylesXml({ font = 'Times New Roman', fontSize = 12, lineSpacing = 1 }) {
  const sz = Math.round(fontSize * 2);
  const line = Math.round(240 * (lineSpacing || 1));
  const f = escapeXml(font);
  const H = (id, name, lvl, before, size, extra = '') =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${lvl}"/></w:pPr><w:rPr><w:b/>${extra}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="${sz + 8}"/><w:szCs w:val="${sz + 8}"/></w:rPr></w:style>
${H('Heading1', 'heading 1', 0, 240, sz + 4)}
${H('Heading2', 'heading 2', 1, 200, sz + 2)}
${H('Heading3', 'heading 3', 2, 160, sz, '<w:i/>')}
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders>${BORDERS}</w:tblBorders></w:tblPr></w:style>
</w:styles>`;
}

function numberingLevels(kind) {
  const lvls = [];
  for (let i = 0; i < 9; i++) {
    const left = 720 * (i + 1);
    if (kind === 'bullet') {
      const chars = ['•', 'o', '▪'];
      const font = i % 3 === 1 ? 'Courier New' : 'Symbol';
      lvls.push(`<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${chars[i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr></w:lvl>`);
    } else {
      const fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
      lvls.push(`<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmts[i % 3]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`);
    }
  }
  return lvls.join('');
}

function numberingXml(decimalGroups) {
  const overrides = Array.from({ length: 9 }, (_, i) => `<w:lvlOverride w:ilvl="${i}"><w:startOverride w:val="1"/></w:lvlOverride>`).join('');
  let nums = `<w:num w:numId="${BULLET_NUM_ID}"><w:abstractNumId w:val="0"/></w:num>`;
  for (let g = 0; g < Math.max(1, decimalGroups); g++) nums += `<w:num w:numId="${g + 2}"><w:abstractNumId w:val="1"/>${overrides}</w:num>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${numberingLevels('bullet')}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${numberingLevels('decimal')}</w:abstractNum>
${nums}
</w:numbering>`;
}

function packageEntries(blocks, opts) {
  const norm = normalizeBlocks(blocks);
  const groups = assignNumIds(norm);
  return [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'docProps/core.xml', data: coreXml(opts.title) },
    { name: 'docProps/app.xml', data: APP_XML },
    { name: 'word/document.xml', data: documentXml(norm, opts) },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS },
    { name: 'word/styles.xml', data: stylesXml(opts) },
    { name: 'word/numbering.xml', data: numberingXml(groups) },
  ];
}

/**
 * Build a .docx. Async: DEFLATE-compresses parts via CompressionStream when available, otherwise STORE.
 * @param {Block[]} blocks
 * @param {{title?:string, font?:string, fontSize?:number, margins?:number|{top,right,bottom,left}, lineSpacing?:number, compress?:boolean}} opts
 * @returns {Promise<Uint8Array>}
 */
export function buildDocx(blocks, opts = {}) {
  return writeZipAsync(packageEntries(blocks, opts), { compress: opts.compress !== false });
}

/** Synchronous variant (STORE, uncompressed). */
export function buildDocxSync(blocks, opts = {}) {
  return writeZip(packageEntries(blocks, opts));
}
