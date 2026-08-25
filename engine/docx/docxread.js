// docxread.js — parse a .docx into Block[] (API.md shape) + markdown-ish text. Browser + Node 20, zero deps.
//
// API: readDocx(bytes: Uint8Array): Promise<{ text, blocks }>   text = blocksToText(blocks)
//      parseDocumentXml(xml, numberingXml?, stylesXml?): Block[]
//      parseXml(xml): Node   (tiny generic XML parser)
//
// - adjacent runs with identical bold/italic/underline are merged, so "{[" + "Name" + "]}" becomes "{[Name]}"
// - Word "smart quotes" inside {[ ... ]} fields are normalized to straight quotes

import { readZip } from './zipread.js';
import { blocksToText } from './blocks.js';

// ---------- tiny XML parser ----------
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return e in ENTITIES ? ENTITIES[e] : m;
  });
}

export function parseXml(xml) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  let i = 0;
  const n = xml.length;
  const pushText = (t, raw) => {
    if (!t) return;
    stack[stack.length - 1].children.push({ name: '#text', attrs: {}, children: [], text: raw ? t : unescapeXml(t) });
  };
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { pushText(xml.slice(i)); break; }
    if (lt > i) pushText(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) { i = xml.indexOf('-->', lt) + 3; continue; }
    if (xml.startsWith('<?', lt)) { i = xml.indexOf('?>', lt) + 2; continue; }
    if (xml.startsWith('<![CDATA[', lt)) { const e = xml.indexOf(']]>', lt); pushText(xml.slice(lt + 9, e), true); i = e + 3; continue; }
    if (xml.startsWith('<!', lt)) { i = xml.indexOf('>', lt) + 1; continue; }
    let j = lt + 1, q = null;
    while (j < n) { const c = xml[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
    const tag = xml.slice(lt + 1, j);
    i = j + 1;
    if (tag[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const selfClose = tag.endsWith('/');
    const body = selfClose ? tag.slice(0, -1) : tag;
    const m = /^([^\s\/>]+)/.exec(body);
    if (!m) continue;
    const node = { name: m[1], attrs: {}, children: [] };
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    const rest = body.slice(m[1].length);
    while ((a = attrRe.exec(rest))) node.attrs[a[1]] = unescapeXml(a[3] ?? a[4]);
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

const child = (node, name) => node.children.find((c) => c.name === name);
const childrenNamed = (node, name) => node.children.filter((c) => c.name === name);
const textOf = (node) => node.children.map((c) => (c.name === '#text' ? c.text : textOf(c))).join('');

// ---------- WordprocessingML -> blocks ----------
function isOn(el) {
  if (!el) return false;
  const v = el.attrs['w:val'];
  return v === undefined || (v !== '0' && v !== 'false' && v !== 'off');
}

function runProps(rPr) {
  if (!rPr) return { bold: false, italic: false, underline: false };
  const u = child(rPr, 'w:u');
  return { bold: isOn(child(rPr, 'w:b')), italic: isOn(child(rPr, 'w:i')), underline: !!u && u.attrs['w:val'] !== 'none' };
}

function runText(r) {
  let s = '';
  for (const c of r.children) {
    if (c.name === 'w:t') s += textOf(c);
    else if (c.name === 'w:tab') s += '\t';
    else if (c.name === 'w:br' || c.name === 'w:cr') s += c.attrs['w:type'] === 'page' ? '' : '\n';
    else if (c.name === 'w:sym') s += c.attrs['w:char'] ? String.fromCodePoint(parseInt(c.attrs['w:char'], 16)) : '';
    else if (c.name === 'w:noBreakHyphen') s += '\u2011';
    else if (c.name === 'w:softHyphen') s += '\u00ad';
  }
  return s;
}

const CONTAINERS = new Set(['w:ins', 'w:hyperlink', 'w:smartTag', 'w:fldSimple', 'w:sdt', 'w:sdtContent', 'w:customXml', 'w:dir', 'w:bdo']);

function collectRuns(node, out) {
  for (const c of node.children) {
    if (c.name === 'w:r') {
      if (c.children.some((x) => x.name === 'w:br' && x.attrs['w:type'] === 'page')) out.pageBreak = true;
      const text = runText(c);
      if (text.length) out.push({ text, ...runProps(child(c, 'w:rPr')) });
    } else if (CONTAINERS.has(c.name)) collectRuns(c, out); // skips w:del
  }
  return out;
}

function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.bold === r.bold && last.italic === r.italic && last.underline === r.underline) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/** Replace curly quotes with straight ones, but only inside {[ ... ]} fields (Word auto-converts them). */
export function fixFieldQuotes(runs) {
  const full = runs.map((r) => r.text).join('');
  const fix = new Map();
  const re = /\{\[[\s\S]*?\]\}/g;
  let m;
  while ((m = re.exec(full))) {
    for (let i = 0; i < m[0].length; i++) {
      const ch = m[0][i];
      if (ch === '\u201c' || ch === '\u201d' || ch === '\u201e') fix.set(m.index + i, '"');
      else if (ch === '\u2018' || ch === '\u2019') fix.set(m.index + i, "'");
    }
  }
  if (!fix.size) return runs;
  let pos = 0;
  return runs.map((r) => {
    let t = '';
    for (let i = 0; i < r.text.length; i++, pos++) t += fix.get(pos) ?? r.text[i];
    return { ...r, text: t };
  });
}

function cleanRun(r) {
  const out = { text: r.text };
  if (r.bold) out.bold = true;
  if (r.italic) out.italic = true;
  if (r.underline) out.underline = true;
  return out;
}

function styleOf(id, styleNames) {
  if (!id) return 'Normal';
  const name = (styleNames.get(id) || id).replace(/\s+/g, '').toLowerCase();
  if (name === 'title') return 'Title';
  const h = /^heading([1-3])$/.exec(name);
  if (h) return 'Heading' + h[1];
  return 'Normal';
}

function parseParagraph(p, ctx) {
  const pPr = child(p, 'w:pPr');
  const raw = collectRuns(p, []);
  const runs = fixFieldQuotes(mergeRuns(raw)).map(cleanRun);
  const para = { type: 'paragraph', runs, style: 'Normal', align: 'left' };
  if (pPr) {
    para.style = styleOf(child(pPr, 'w:pStyle')?.attrs['w:val'], ctx.styleNames);
    const jc = child(pPr, 'w:jc')?.attrs['w:val'];
    if (jc === 'center' || jc === 'right') para.align = jc;
    else if (jc === 'both' || jc === 'distribute') para.align = 'justify';
    else if (jc === 'end') para.align = 'right';
    const numPr = child(pPr, 'w:numPr');
    if (numPr) {
      const numId = child(numPr, 'w:numId')?.attrs['w:val'];
      const ilvl = child(numPr, 'w:ilvl')?.attrs['w:val'];
      if (numId && numId !== '0') para.numbering = { kind: ctx.numKinds.get(numId) || 'bullet', level: ilvl ? parseInt(ilvl, 10) : 0 };
    }
    const ind = child(pPr, 'w:ind');
    if (ind && !para.numbering) {
      const left = parseInt(ind.attrs['w:left'] ?? ind.attrs['w:start'] ?? '0', 10);
      if (left >= 360) para.indent = Math.max(1, Math.round(left / 720));
    }
  }
  const text = runs.map((r) => r.text).join('');
  if (raw.pageBreak && !text.length) return [{ type: 'pagebreak' }];
  if (raw.pageBreak) return [{ type: 'pagebreak' }, para];
  return [para];
}

function parseBlocks(container, ctx) {
  const out = [];
  for (const c of container.children) {
    if (c.name === 'w:p') out.push(...parseParagraph(c, ctx));
    else if (c.name === 'w:tbl') out.push({ type: 'table', rows: childrenNamed(c, 'w:tr').map((tr) => childrenNamed(tr, 'w:tc').map((tc) => parseBlocks(tc, ctx))) });
    else if (c.name === 'w:sdt' || c.name === 'w:sdtContent' || c.name === 'w:customXml') out.push(...parseBlocks(c, ctx));
  }
  return out;
}

/** Map w:numId -> 'bullet'|'decimal' from numbering.xml. */
function numberingKinds(numberingXml) {
  const kinds = new Map();
  if (!numberingXml) return kinds;
  const numbering = child(parseXml(numberingXml), 'w:numbering');
  if (!numbering) return kinds;
  const abstractKind = new Map();
  for (const a of childrenNamed(numbering, 'w:abstractNum')) {
    const lvl0 = childrenNamed(a, 'w:lvl').find((l) => l.attrs['w:ilvl'] === '0');
    const fmt = lvl0 && child(lvl0, 'w:numFmt')?.attrs['w:val'];
    abstractKind.set(a.attrs['w:abstractNumId'], fmt === 'bullet' ? 'bullet' : 'decimal');
  }
  for (const nm of childrenNamed(numbering, 'w:num')) {
    kinds.set(nm.attrs['w:numId'], abstractKind.get(child(nm, 'w:abstractNumId')?.attrs['w:val']) || 'decimal');
  }
  return kinds;
}

/** Map styleId -> style name from styles.xml (so localized/renamed heading styles still resolve). */
function styleNameMap(stylesXml) {
  const names = new Map();
  if (!stylesXml) return names;
  const styles = child(parseXml(stylesXml), 'w:styles');
  if (!styles) return names;
  for (const s of childrenNamed(styles, 'w:style')) {
    const id = s.attrs['w:styleId'];
    const name = child(s, 'w:name')?.attrs['w:val'];
    if (id && name) names.set(id, name);
  }
  return names;
}

/** Parse document.xml (+ optional numbering.xml / styles.xml) into Block[]. */
export function parseDocumentXml(xml, numberingXml, stylesXml) {
  const document = child(parseXml(xml), 'w:document');
  const body = document && child(document, 'w:body');
  if (!body) throw new Error('docxread: w:body not found');
  return parseBlocks(body, { numKinds: numberingKinds(numberingXml), styleNames: styleNameMap(stylesXml) });
}

/** Read a .docx: returns { text, blocks }. */
export async function readDocx(bytes) {
  const zip = readZip(bytes);
  const dec = new TextDecoder();
  const part = async (name) => { const e = zip.get(name); return e ? dec.decode(await e.bytes()) : null; };
  const docXml = await part('word/document.xml');
  if (docXml == null) throw new Error('docxread: word/document.xml missing (not a .docx?)');
  const blocks = parseDocumentXml(docXml, await part('word/numbering.xml'), await part('word/styles.xml'));
  return { text: blocksToText(blocks), blocks };
}
