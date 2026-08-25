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
const DECIMAL_RE = /^(?:\d+|[a-z]|[ivx]+)[.)][ \t]+(.*)$/;
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
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (ch === '{' && src[i + 1] === '[') {
      const end = src.indexOf(']}', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      buf += src.slice(i, stop); i = stop; continue;
    }
    let matched = false;
    for (const [m, flag] of MARKERS) {
      if (!src.startsWith(m, i)) continue;
      if (state[flag]) { flush(); state[flag] = false; i += m.length; matched = true; break; }
      if (hasCloser(src, i + m.length, m)) { flush(); state[flag] = true; i += m.length; matched = true; break; }
      // unmatched: literal, and (for '**') don't let the inner '*' re-match
      buf += m; i += m.length; matched = true; break;
    }
    if (matched) continue;
    buf += ch; i++;
  }
  flush();
  return runs.map(cleanRun);
}

function hasCloser(src, from, m) {
  let i = from;
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === '{' && src[i + 1] === '[') { const e = src.indexOf(']}', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (src.startsWith(m, i)) return true;
    // avoid treating the first '*' of a '**' as an italic closer
    if (m === '*' && src.startsWith('**', i)) { i += 2; continue; }
    i++;
  }
  return false;
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
  rest = rest.slice(lead);

  let m = ALIGN_RE.exec(rest);
  if (m) {
    if (m[1] === 'title') extra.style = 'Title';
    else extra.align = m[1];
    rest = rest.slice(m[0].length);
  }
  if (rest[0] === '\\' && rest.length > 1 && !ESCAPABLE.includes(rest[1])) return para(parseInline(rest.slice(1)), extra); // escaped line start
  if ((m = HEADING_RE.exec(rest))) {
    extra.style = 'Heading' + m[1].length;
    return para(parseInline(m[2]), extra);
  }
  if ((m = DECIMAL_RE.exec(rest))) {
    const lvl = /^\d/.test(rest) ? level : Math.max(level, 1);
    return para(parseInline(m[1]), { ...extra, numbering: { kind: 'decimal', level: lvl } });
  }
  if ((m = BULLET_RE.exec(rest))) {
    return para(parseInline(m[1]), { ...extra, numbering: { kind: 'bullet', level } });
  }
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
    else if (ch === '_' && s[i + 1] === '_') out += '\\_';
    else out += ch;
  }
  return out;
}

export function runsToInline(runs) {
  const cur = { bold: false, italic: false, underline: false };
  const marker = { bold: '**', italic: '*', underline: '__' };
  let out = '';
  for (const r of runs || []) {
    if (!r.text) continue;
    for (const f of ['underline', 'italic', 'bold']) if (cur[f] && !r[f]) { out += marker[f]; cur[f] = false; }
    for (const f of ['bold', 'italic', 'underline']) if (!cur[f] && r[f]) { out += marker[f]; cur[f] = true; }
    out += escapeText(r.text.replace(/\n/g, ' '));
  }
  for (const f of ['underline', 'italic', 'bold']) if (cur[f]) out += marker[f];
  return out;
}

function escapeLineStart(s) {
  // a plain paragraph must not be re-read as structure
  if (/^(#{1,3}[ \t]|>(center|right|justify|left|title)|(\d+|[a-z]|[ivx]+)[.)][ \t]|[-*][ \t]|-{3,}\s*$)/.test(s) || s[0] === '|') return '\\' + s;
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
      mark = (level === 0 ? String(n) : String.fromCharCode(96 + ((n - 1) % 26) + 1)) + '.';
      if (level === 0) prefix += ''; else prefix += '  '.repeat(level);
      return prefix + mark + ' ' + inline;
    }
    return prefix + '  '.repeat(level) + mark + ' ' + inline;
  }
  return prefix + (inline ? escapeLineStart(inline) : '');
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
