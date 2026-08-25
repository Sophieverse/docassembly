// html.js — Block[] -> printable HTML (preview / print-to-PDF). Pure JS, no DOM.
//
// API: blocksToHtml(blocks, opts): string
//      opts = { title, font='Times New Roman', fontSize=12 (pt), margins=1 (in), lineSpacing=1, fragment=false }
//      fragment:true returns only the <div class="doc">…</div> (no <html>/<style>) for embedding.

import { normalizeBlocks } from './docxwrite.js';

export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function runsHtml(runs) {
  return runs.map((r) => {
    let t = escapeHtml(r.text).replace(/\t/g, '<span class="tab"></span>').replace(/\n/g, '<br>');
    if (r.underline) t = `<u>${t}</u>`;
    if (r.italic) t = `<em>${t}</em>`;
    if (r.bold) t = `<strong>${t}</strong>`;
    return t;
  }).join('');
}

function paraAttrs(p) {
  const cls = [];
  if (p.align && p.align !== 'left') cls.push('al-' + p.align);
  if (p.style === 'Title') cls.push('title');
  const style = p.indent ? ` style="margin-left:${p.indent * 0.5}in"` : '';
  return (cls.length ? ` class="${cls.join(' ')}"` : '') + style;
}

function paragraphHtml(p) {
  const inner = runsHtml(p.runs) || '&nbsp;';
  const h = /^Heading([1-3])$/.exec(p.style || '');
  if (h) return `<h${h[1]}${paraAttrs(p)}>${inner}</h${h[1]}>`;
  if (p.style === 'Title') return `<h1${paraAttrs(p)}>${inner}</h1>`;
  return `<p${paraAttrs(p)}>${inner}</p>`;
}

/** Render a sequence of blocks, grouping numbered paragraphs into nested <ol>/<ul>. */
function blocksHtml(blocks) {
  let out = '';
  const stack = []; // open lists: {kind, level}
  const closeTo = (level) => {
    while (stack.length && stack[stack.length - 1].level > level) out += stack.pop().kind === 'bullet' ? '</li></ul>' : '</li></ol>';
  };
  const closeAll = () => { while (stack.length) out += stack.pop().kind === 'bullet' ? '</li></ul>' : '</li></ol>'; };
  for (const b of blocks) {
    if (b.type === 'paragraph' && b.numbering) {
      const { kind, level } = b.numbering;
      closeTo(level); // close deeper lists
      const top = stack[stack.length - 1];
      if (top && top.level === level && top.kind === kind) out += '</li><li>';
      else {
        if (top && top.level === level) out += top.kind === 'bullet' ? '</li></ul>' : '</li></ol>', stack.pop();
        out += (kind === 'bullet' ? '<ul>' : '<ol>') + '<li>';
        stack.push({ kind, level });
      }
      out += paragraphHtml({ ...b, numbering: undefined });
      continue;
    }
    if (b.type === 'paragraph' && !b.runs.some((r) => r.text.trim()) && stack.length) { continue; } // blank inside list: no-op
    closeAll();
    if (b.type === 'paragraph') out += paragraphHtml(b);
    else if (b.type === 'pagebreak') out += '<div class="pagebreak"></div>';
    else if (b.type === 'table') {
      out += '<table>' + b.rows.map((row) => '<tr>' + row.map((cell) => `<td>${blocksHtml(cell) || '&nbsp;'}</td>`).join('') + '</tr>').join('') + '</table>';
    }
  }
  closeAll();
  return out;
}

function css({ font, fontSize, margins, lineSpacing }) {
  const m = typeof margins === 'number' || margins == null ? { top: margins ?? 1, right: margins ?? 1, bottom: margins ?? 1, left: margins ?? 1 } : margins;
  const f = String(font).replace(/["\\]/g, '');
  return `
@page { size: letter; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; }
html, body { background: #fff; color: #000; margin: 0; padding: 0; }
.doc { font-family: "${f}", "Times New Roman", Times, serif; font-size: ${fontSize}pt; line-height: ${1.15 * (lineSpacing || 1)}; max-width: 8.5in; margin: 0 auto; padding: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; box-sizing: border-box; }
.doc p { margin: 0; min-height: 1em; white-space: pre-wrap; }
.doc h1, .doc h2, .doc h3 { margin: 0.8em 0 0.3em; page-break-after: avoid; white-space: pre-wrap; }
.doc h1 { font-size: ${fontSize + 4}pt; } .doc h2 { font-size: ${fontSize + 2}pt; } .doc h3 { font-size: ${fontSize}pt; font-style: italic; }
.doc h1.title { text-align: center; text-transform: uppercase; font-size: ${fontSize + 4}pt; margin: 0 0 1em; }
.doc .al-center { text-align: center; } .doc .al-right { text-align: right; } .doc .al-justify { text-align: justify; }
.doc .tab { display: inline-block; width: 0.5in; }
.doc ol, .doc ul { margin: 0; padding-left: 0.5in; } .doc li > p { display: inline; } .doc li { margin: 0; }
.doc ol ol { list-style-type: lower-alpha; } .doc ol ol ol { list-style-type: lower-roman; }
.doc table { border-collapse: collapse; width: 100%; margin: 0.5em 0; page-break-inside: auto; }
.doc td { border: 1px solid #000; padding: 2pt 6pt; vertical-align: top; }
.doc .pagebreak { page-break-after: always; break-after: page; height: 0; }
@media screen { body { background: #eee; } .doc { background: #fff; box-shadow: 0 0 8px rgba(0,0,0,.25); margin: 1em auto; } .doc .pagebreak { border-top: 1px dashed #999; margin: 1em -${m.left}in; } }
@media print { .doc { box-shadow: none; margin: 0; padding: 0; max-width: none; } }
`;
}

/** Block[] -> HTML document string. */
export function blocksToHtml(blocks, opts = {}) {
  const o = { font: 'Times New Roman', fontSize: 12, margins: 1, lineSpacing: 1, ...opts };
  const body = `<div class="doc">${blocksHtml(normalizeBlocks(blocks))}</div>`;
  if (o.fragment) return body;
  return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(o.title || 'Document')}</title><style>${css(o)}</style></head><body>${body}</body></html>`;
}
