/**
 * @module docgen
 * Shared helpers that turn a template + answers into HTML / DOCX / text, plus model helpers.
 */
import { compile, render, computeDerived, textToBlocks, blocksToHtml, buildDocx, humanize, createModel } from './engine-api.js';

/** Fonts the DOCX writer is asked for; anything else falls back to the first entry. */
export const FONTS = ['Times New Roman', 'Georgia', 'Cambria', 'Garamond', 'Book Antiqua', 'Arial', 'Calibri', 'Helvetica', 'Verdana'];
export const safeFont = (f) => (FONTS.includes(f) ? f : FONTS[0]);

/** Model for template text (empty model if it does not compile). */
export function modelFor(text) {
  try { const c = compile(text || ''); if (!c.errors.length) return createModel(c.analysis); } catch (e) { console.warn('createModel failed', e); }
  return { variables: {}, order: [] };
}
import { getSettings } from './store.js';
import { escapeHtml } from './components.js';

const compileCache = new Map();

/** compile() with a tiny memo so repeated renders of the same text are cheap. */
export function compileCached(text) {
  const key = text;
  let r = compileCache.get(key);
  if (!r) {
    r = compile(text);
    if (compileCache.size > 50) compileCache.delete(compileCache.keys().next().value);
    compileCache.set(key, r);
  }
  return r;
}

/** Full data = record data + computed variables. */
export function withDerived(template, data) {
  try {
    if (template && template.model) {
      const r = computeDerived(template.model, data || {});
      // Engine returns { data, errors }; tolerate a bare data object too.
      if (r && typeof r === 'object' && r.data && typeof r.data === 'object' && Array.isArray(r.errors)) return r.data;
      if (r && typeof r === 'object') return r;
    }
  } catch (e) { console.warn('computeDerived failed', e); }
  return data || {};
}

/**
 * Render template text with data. Returns { text, warnings, html, blocks, errors, trace }.
 * Never throws.
 */
export function renderTemplate(template, data, opts = {}) {
  const text = template.text || '';
  const c = compileCached(text);
  if (c.errors && c.errors.length) {
    return { text: '', warnings: [], html: '', blocks: [], errors: c.errors, trace: null };
  }
  let out;
  try {
    out = render(c.ast, withDerived(template, data), { model: template.model || null, ...opts });
  } catch (e) {
    return { text: '', warnings: [String(e.message || e)], html: '', blocks: [], errors: [{ message: String(e.message || e) }], trace: null };
  }
  let blocks = [], html = '';
  try {
    blocks = textToBlocks(out.text || '');
    html = blocksToHtml(blocks, { fragment: true, ...docOpts() });
  } catch (e) {
    html = `<div class="doc"><div class="doc-plain">${escapeHtml(out.text || '')}</div></div>`;
  }
  return { text: out.text || '', warnings: out.warnings || [], html, blocks, errors: [], trace: out.trace || null };
}

/** Document options (font/size/margins) from settings. */
export function docOpts(title) {
  const s = getSettings();
  const size = Number(s.defaultFontSize);
  return { title: title || 'Document', font: safeFont(s.defaultFont), fontSize: size >= 6 && size <= 36 ? size : 12, margins: 1, lineSpacing: 1 };
}

/** Build a .docx Blob for rendered blocks (async: DEFLATE when available). */
export async function docxBlob(blocks, title) {
  const bytes = await buildDocx(blocks, docOpts(title));
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/** Open a print-friendly window containing only the document (full standalone HTML from the engine). */
export function printBlocks(blocks, title = 'Document') {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(blocksToHtml(blocks, docOpts(title)));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) { /* user can print manually */ } }, 250);
  return true;
}

/** Number of variables in a template model (excluding computed/orphaned). */
export function variableCount(template) {
  const vars = template && template.model && template.model.variables;
  if (!vars) return 0;
  return Object.values(vars).filter((v) => v && !v.orphaned).length;
}

/** A label for a variable from the model, falling back to humanize(path). */
export function labelFor(model, path) {
  const v = model && model.variables && model.variables[path];
  if (v && v.label) return v.label;
  try { return humanize(path); } catch (e) { return path; }
}

/* ---------- nested data helpers ---------- */
const UNSAFE_KEY = /^(__proto__|constructor|prototype)$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function getPath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const seg of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object' || !has(cur, seg)) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/** Set a dotted path, creating objects on the way. Refuses prototype-polluting keys. */
export function setPath(obj, path, value) {
  const segs = String(path).split('.');
  if (segs.some((k) => UNSAFE_KEY.test(k))) return obj;
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    if (!has(cur, segs[i]) || cur[segs[i]] == null || typeof cur[segs[i]] !== 'object') cur[segs[i]] = {};
    cur = cur[segs[i]];
  }
  if (value === undefined) delete cur[segs[segs.length - 1]];
  else cur[segs[segs.length - 1]] = value;
  return obj;
}

/** Deep-copy `data` without empty objects/arrays/blank strings (form rendering creates {} for every group). */
export function pruneEmpty(v) {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? pruneEmpty(x) : x)).filter((x) => x !== undefined && x !== '' && x !== null);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const p = val && typeof val === 'object' ? pruneEmpty(val) : val;
      if (p === undefined || p === null || p === '') continue;
      if (typeof p === 'object' && !Object.keys(p).length) continue;
      out[k] = p;
    }
    return out;
  }
  return v;
}

export function isAnswered(v) {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** Simple mock value generator used by editor preview + "fill sample" */
export function sampleValue(type, path) {
  const name = path.split('.').pop();
  switch (type) {
    case 'boolean': return true;
    case 'number': return 3;
    case 'currency': return 2500;
    case 'date': return new Date().toISOString().slice(0, 10);
    case 'multiselect': return [];
    case 'list': return [];
    case 'object': return {};
    default: return `[${humanizeSafe(name)}]`;
  }
}
function humanizeSafe(p) { try { return humanize(p); } catch (e) { return p; } }
