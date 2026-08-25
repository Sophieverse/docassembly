// blocks.js — markdown-ish template text <-> Block[] (see API.md "DOCX API"). Pure JS, no DOM.
//
// Text model (one paragraph per line):
//   # H1 / ## H2 / ### H3            headings
//   >center >right >justify >left     alignment prefix (may be followed by any of the below)
//   >title                            Title style
//   ---                               page break (alone on a line)
//   1. / 1) / a. / a)  and  - / *     numbered / bullet list items; 2 leading spaces = one nesting level
//   |a|b|                             table rows (consecutive lines); |---|---| separator lines are ignored
//   **bold** *italic* __underline__   inline runs (nest freely; unmatched markers are literal)
//   \*  \_  \#  \|  \>  \-  \\        escapes (literal character)
//   leading tabs                      indent level (kept as Block.indent)
//   blank line                        empty paragraph (vertical spacing)
//   {[ ... ]}                         template fields are copied verbatim (no markdown inside)

const ALIGN_RE = /^>(center|right|justify|left|title)(?:[ \t]+|$)/;
const HEADING_RE = /^(#{1,3})[ \t]+(.*)$/;
const DECIMAL_RE = /^\d+[.)][ \t]+(.*)$/;
const ALPHA_RE = /^(?:[a-z]|[ivx]+)[.)][ \t]+(.*)$/; // only a list marker when indented (so prose like "a. b" / "i. e." stays prose)
const BULLET_RE = /^[-*][ \t]+(.*)$/;
const SEP_CELL_RE = /^:?-{1,}:?$/;
const ESCAPABLE = '\\*_#|>-';

export function para(runs = [], extra = {}) {
  return { type: 'paragraph', runs, style: 'Normal', align: 'left', ...extra };
}

// ---------- inline: text -> runs ----------
export function parseInline(src) {
  const runs = [];
  const state = { bold: false, italic: false, underline: false };
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === state.bold && last.italic === state.italic && last.underline === state.underline) last.text += buf;
    else runs.push({ text: buf, bold: state.bold, italic: state.italic, underline: state.underline });
    buf = '';
  };
  const MARKERS = [['**', 'bold'], ['__', 'underline'], ['*', 'italic']];
  const positions = markerPositions(src); // O(n) once per line instead of rescanning for a closer at every marker
  const nextPos = { '**': 0, '__': 0, '*': 0 };
  const hasCloser = (m, from) => {
    const arr = positions[m];
    let k = nextPos[m];
    while (k < arr.length && arr[k] < from) k++;
    nextPos[m] = k;
    return k < arr.length;
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (ch === '{' && src[i + 1] === '[') {
      const end = src.indexOf(']}', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      buf += src.slice(i, stop); i = stop; continue;
    }
    if (ch === '_' && src[i + 1] === '_' && src[i + 2] === '_') { // a rule/signature line: literal
      let j = i; while (src[j] === '_') j++;
      buf += src.slice(i, j); i = j; continue;
    }
    let matched = false;
    for (const [m, flag] of MARKERS) {
      if (!src.startsWith(m, i)) continue;
      if (state[flag]) { flush(); state[flag] = false; i += m.length; matched = true; break; }
      const after = src[i + m.length];
      const canOpen = after !== undefined && !/\s/.test(after) && hasCloser(m, i + m.length);
      if (canOpen) { flush(); state[flag] = true; i += m.length; matched = true; break; }
      // unmatched: literal, and (for '**') don't let the inner '*' re-match
      buf += m; i += m.length; matched = true; break;
    }
    if (matched) continue;
    buf += ch; i++;
  }
  flush();
  return runs.map(cleanRun);
}

/** Positions of each marker that may act as a closer, skipping escapes, {[ ]} fields and runs of 3+ underscores. */
function markerPositions(src) {
  const out = { '**': [], '__': [], '*': [] };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '{' && src[i + 1] === '[') { const e = src.indexOf(']}', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (ch === '_' && src[i + 1] === '_') {
      if (src[i + 2] === '_') { while (src[i] === '_') i++; continue; }
      out['__'].push(i); i += 2; continue;
    }
    if (ch === '*') {
      if (src[i + 1] === '*') { out['**'].push(i); i += 2; continue; } // '**' is never an italic closer
      out['*'].push(i);
    }
    i++;
  }
  return out;
}

function cleanRun(r) {
  const out = { text: r.text };
  if (r.bold) out.bold = true;
  if (r.italic) out.italic = true;
  if (r.underline) out.underline = true;
  return out;
}

// ---------- text -> blocks ----------
function isTableLine(line) {
  const t = line.trim();
  return t.length >= 2 && t[0] === '|' && t[t.length - 1] === '|';
}

function splitCells(line) {
  const t = line.trim().slice(1, -1);
  const cells = [];
  let buf = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '\\' && i + 1 < t.length) { buf += ch + t[i + 1]; i++; continue; }
    if (ch === '{' && t[i + 1] === '[') { const e = t.indexOf(']}', i + 2); const stop = e < 0 ? t.length : e + 2; buf += t.slice(i, stop); i = stop - 1; continue; }
    if (ch === '|') { cells.push(buf); buf = ''; continue; }
    buf += ch;
  }
  cells.push(buf);
  return cells.map((c) => c.trim());
}

function parseLine(line) {
  if (line.trim() === '') return para();
  if (/^\s*---+\s*$/.test(line)) return { type: 'pagebreak' };

  let rest = line;
  let indent = 0;
  while (rest[0] === '\t') { indent++; rest = rest.slice(1); }
  const extra = {};
  if (indent) extra.indent = indent;

  const lead = /^ */.exec(rest)[0].length;
  const level = Math.floor(lead / 2);
  const unindented = rest.slice(lead);

  let m = ALIGN_RE.exec(unindented);
  if (m) {
    if (m[1] === 'title') extra.style = 'Title';
    else extra.align = m[1];
    rest = unindented.slice(m[0].length);
  } else if (unindented[0] === '\\' && unindented.length > 1 && !ESCAPABLE.includes(unindented[1])) {
    return para(parseInline(unindented.slice(1)), extra); // escaped line start
  } else {
    // leading spaces only mean nesting for list items; a plain paragraph keeps them (Word preserves leading spaces)
    if ((m = DECIMAL_RE.exec(unindented))) return para(parseInline(m[1]), { ...extra, numbering: { kind: 'decimal', level } });
    if (level >= 1 && (m = ALPHA_RE.exec(unindented))) return para(parseInline(m[1]), { ...extra, numbering: { kind: 'decimal', level } });
    if ((m = BULLET_RE.exec(unindented))) return para(parseInline(m[1]), { ...extra, numbering: { kind: 'bullet', level } });
    if ((m = HEADING_RE.exec(unindented))) { extra.style = 'Heading' + m[1].length; return para(parseInline(m[2]), extra); }
    return para(parseInline(rest), extra);
  }
  if (rest[0] === '\\' && rest.length > 1 && !ESCAPABLE.includes(rest[1])) return para(parseInline(rest.slice(1)), extra);
  if ((m = HEADING_RE.exec(rest))) {
    extra.style = 'Heading' + m[1].length;
    return para(parseInline(m[2]), extra);
  }
  if ((m = DECIMAL_RE.exec(rest))) return para(parseInline(m[1]), { ...extra, numbering: { kind: 'decimal', level } });
  if (level >= 1 && (m = ALPHA_RE.exec(rest))) return para(parseInline(m[1]), { ...extra, numbering: { kind: 'decimal', level } });
  if ((m = BULLET_RE.exec(rest))) return para(parseInline(m[1]), { ...extra, numbering: { kind: 'bullet', level } });
  return para(parseInline(rest), extra);
}

/** Convert markdown-ish template/rendered text into Block[]. */
export function textToBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '' && lines.length > 1) lines.pop(); // trailing newline
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (isTableLine(lines[i])) {
      const rows = [];
      while (i < lines.length && isTableLine(lines[i])) {
        const cells = splitCells(lines[i]);
        if (!cells.every((c) => SEP_CELL_RE.test(c))) rows.push(cells.map((c) => [para(parseInline(c))]));
        i++;
      }
      i--;
      if (rows.length) blocks.push({ type: 'table', rows });
      continue;
    }
    blocks.push(parseLine(lines[i]));
  }
  return blocks;
}

// ---------- blocks -> text ----------
function escapeText(s) {
  // escape inline markers outside {[ ]} fields
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{' && s[i + 1] === '[') { const e = s.indexOf(']}', i + 2); const stop = e < 0 ? s.length : e + 2; out += s.slice(i, stop); i = stop - 1; continue; }
    if (ch === '\\' || ch === '*' || ch === '|') out += '\\' + ch;
    else if (ch === '_' && s[i + 1] === '_') {
      let j = i; while (s[j] === '_') j++;
      if (j - i >= 3) { out += s.slice(i, j); i = j - 1; } // rule / signature line: parser treats it as literal
      else { out += '\\_'; }
    }
    else out += ch;
  }
  return out;
}

/**
 * Split runs at `{[ ... ]}` boundaries computed over the paragraph's whole text, so a placeholder Word
 * broke into differently formatted runs ("{[Client." + "**FullName**" + "]}") is seen as one field span.
 * @returns {Array<{text:string, bold?:boolean, italic?:boolean, underline?:boolean, field:boolean}>}
 */
function splitRunsAtFields(runs) {
  const full = runs.map((r) => r.text).join('');
  const spans = []; // [start, end) of each field in `full`
  let i = 0;
  while (i < full.length) {
    const s = full.indexOf('{[', i);
    if (s === -1) break;
    const e = full.indexOf(']}', s + 2);
    const end = e === -1 ? full.length : e + 2;
    spans.push([s, end]);
    i = end;
  }
  const out = [];
  let pos = 0, k = 0;
  for (const r of runs) {
    let start = pos;
    const stop = pos + r.text.length;
    while (start < stop) {
      while (k < spans.length && spans[k][1] <= start) k++;
      const sp = spans[k];
      let cut, field;
      if (sp && sp[0] <= start) { cut = Math.min(sp[1], stop); field = sp[0] === start ? 'start' : 'inside'; }
      else { cut = sp ? Math.min(sp[0], stop) : stop; field = false; }
      out.push({ ...r, text: r.text.slice(start - pos, cut - pos), field });
      start = cut;
    }
    pos = stop;
  }
  return out;
}

export function runsToInline(runs) {
  const cur = { bold: false, italic: false, underline: false };
  const marker = { bold: '**', italic: '*', underline: '__' };
  let out = '';
  const pieces = splitRunsAtFields((runs || []).filter((r) => r.text).map((r) => ({ ...r, text: r.text.replace(/\n/g, ' ') })));
  for (const r of pieces) {
    if (!r.text) continue;
    // A field takes the formatting of the run it starts in (so a bold `**{[Name]}**` survives). Formatting
    // changes *inside* a {[ ]} field are noise (Word split the placeholder across runs): emit the raw text
    // with no markers and no escapes, keeping whatever formatting state is open.
    if (r.field === 'inside') { out += r.text; continue; }
    for (const f of ['underline', 'italic', 'bold']) if (cur[f] && !r[f]) { out += marker[f]; cur[f] = false; }
    for (const f of ['bold', 'italic', 'underline']) if (!cur[f] && r[f]) { out += marker[f]; cur[f] = true; }
    out += r.field ? r.text : escapeText(r.text);
  }
  for (const f of ['underline', 'italic', 'bold']) if (cur[f]) out += marker[f];
  return out;
}

function escapeLineStart(s) {
  // a plain paragraph must not be re-read as structure (leading whitespace would become indent / list level)
  if (/^(#{1,3}[ \t]|>(center|right|justify|left|title)|\d+[.)][ \t]|[-*][ \t]|-{3,}\s*$|\t| +(\d+|[a-z]|[ivx]+)[.)][ \t]| +[-*][ \t]| +#{1,3}[ \t])/.test(s) || s[0] === '|') return '\\' + s;
  return s;
}

function paragraphToText(p, counters) {
  const inline = runsToInline(p.runs);
  let prefix = '\t'.repeat(p.indent || 0);
  if (p.style === 'Title') prefix += '>title ';
  else if (p.align && p.align !== 'left') prefix += '>' + p.align + ' ';
  const h = /^Heading([1-3])$/.exec(p.style || '');
  if (h) return prefix + '#'.repeat(+h[1]) + ' ' + inline;
  if (p.numbering) {
    const level = p.numbering.level || 0;
    counters.length = level + 1;
    let mark;
    if (p.numbering.kind === 'bullet') mark = '-';
    else {
      counters[level] = (counters[level] || 0) + 1;
      const n = counters[level];
      // levels cycle decimal / lower letter / lower roman, matching numbering.xml and the HTML preview
      mark = (level % 3 === 0 ? String(n) : level % 3 === 1 ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : toRoman(n)) + '.';
      if (level === 0) prefix += ''; else prefix += '  '.repeat(level);
      return prefix + mark + ' ' + inline;
    }
    return prefix + '  '.repeat(level) + mark + ' ' + inline;
  }
  return prefix + (inline ? escapeLineStart(inline) : '');
}

function toRoman(n) {
  const T = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, r] of T) while (n >= v) { out += r; n -= v; }
  return out || '0';
}

function cellToText(cell) {
  return (cell || []).filter((b) => b.type === 'paragraph').map((b) => runsToInline(b.runs)).join(' ').trim();
}

/** Inverse of textToBlocks: Block[] -> markdown-ish text. */
export function blocksToText(blocks) {
  const lines = [];
  let counters = [];
  for (const b of blocks || []) {
    if (b.type === 'pagebreak') { lines.push('---'); counters = []; }
    else if (b.type === 'table') {
      for (const row of b.rows) lines.push('|' + row.map(cellToText).join('|') + '|');
      counters = [];
    } else if (b.type === 'paragraph') {
      if (!b.numbering && b.runs?.some((r) => r.text?.trim())) counters = [];
      lines.push(paragraphToText(b, counters));
    }
  }
  return lines.join('\n');
}
