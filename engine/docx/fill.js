// fill.js — in-place DOCX filling (Knackly / HotDocs workflow). Browser + Node 20, zero deps.
//
// The attorney's original Word file with {[ ]} tags IS the template. Output = the same .docx with every
// style, header/footer, numbering, table and font preserved; only the tags are resolved.
//
// API: fillDocx(bytes, data, options?) → Promise<{ bytes, warnings, text }>
//        options = { model, functions, dateFormat, yes, no, compress }   (render options of evaluate.js)
//      extractTemplateText(bytes) → Promise<string>   tag-bearing plain text (headers, body, footers, notes)
//      fillPartXml(xml, data, options?, label?) → { xml, warnings }     one WordprocessingML part
//      partTemplateText(xml) → string                                  paragraph texts of one part
//
// Algorithm
//  1. Every part that contains "{[" (document, header*, footer*, footnotes, endnotes, comments) is parsed into a
//     raw-offset tree (no re-serialization: untouched nodes are emitted as the original byte slices).
//  2. Per paragraph the runs are gathered (descending into hyperlinks / sdt / smartTag / ins, skipping w:del),
//     tags are located in the joined text even when Word split them across runs / proofErr / rsid boundaries,
//     smart quotes are normalized, and each tag is consolidated into one run inheriting the w:rPr of the run
//     where it started.
//  3. A paragraph (or table row) whose text is only structural tags is a block MARKER: the block spans whole
//     paragraphs / rows (removed when false, repeated per item). A row whose first tag opens a block that its
//     last tag closes ({[list X]} … {[endlist]}) repeats per item. Other tags are inline within the paragraph.
//     A paragraph that is entirely wrapped by one inline block and renders to nothing is removed.
//  4. Expressions are evaluated with engine/expr.js; values are formatted with evaluate.js formatValue.
//  5. Newlines → <w:br/>, tabs → <w:tab/>, text xml-escaped with xml:space="preserve".
//  6. The zip is rewritten with every entry untouched except modified parts ([Content_Types].xml stays first).

import { readZip } from './zipread.js';
import { writeZipAsync } from './zipwrite.js';
import { unescapeXml, readDocx } from './docxread.js';
import { escapeXml } from './docxwrite.js';
import { classifyTag } from '../parser.js';
import { parseExpr, evalExpr, createScope, createTrace, truthy, pathOf, listIdentity, stripPuncFilter } from '../expr.js';
import { functions as builtins } from '../functions.js';
import { formatValue, itemVars } from '../evaluate.js';
import { normalizeSmartQuotes } from '../lexer.js';

const TEMPLATE_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
const RUN_CONTAINERS = new Set(['w:hyperlink', 'w:smartTag', 'w:ins', 'w:moveTo', 'w:fldSimple', 'w:customXml', 'w:dir', 'w:bdo']);
const BLOCK_CONTAINERS = new Set(['w:body', 'w:tc', 'w:txbxContent', 'w:hdr', 'w:ftr', 'w:footnote', 'w:endnote', 'w:comment', 'w:sdtContent', 'w:customXml']);
const NEEDS_PARA = new Set(['w:body', 'w:tc', 'w:txbxContent', 'w:hdr', 'w:ftr', 'w:footnote', 'w:endnote', 'w:comment', 'w:sdtContent']);
const INVISIBLE = new Set(['w:proofErr', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:commentRangeStart', 'w:commentRangeEnd', 'w:permStart', 'w:permEnd', 'w:moveFromRangeStart', 'w:moveFromRangeEnd', 'w:moveToRangeStart', 'w:moveToRangeEnd', 'w:del', 'w:moveFrom']);
const OPENERS = new Set(['if', 'list']);
const CLOSERS = { if: new Set(['endif', 'end']), list: new Set(['endlist', 'end']) };

/** Does the XML contain "{[" once markup is stripped (Word may split "{" and "[" into separate runs)? */
export function hasTagText(xml) {
  return xml.replace(/<[^>]*>/g, '').includes('{[');
}

// ---------- raw-offset XML tree ----------
// Node: {name, start, end, openEnd, closeStart, selfClosing, children, parent}; '#text' / '#other' / '#cdata' leaves.
function parseRaw(xml) {
  const n = xml.length;
  const root = { name: '#root', start: 0, end: n, openEnd: 0, closeStart: n, children: [], parent: null };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const leaf = (name, s, e) => { if (e > s) top().children.push({ name, start: s, end: e, children: [], parent: top() }); };
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { leaf('#text', i, n); break; }
    leaf('#text', i, lt);
    let skip = null;
    if (xml.startsWith('<!--', lt)) skip = ['-->', 4, '#other'];
    else if (xml.startsWith('<?', lt)) skip = ['?>', 2, '#other'];
    else if (xml.startsWith('<![CDATA[', lt)) skip = [']]>', 9, '#cdata'];
    else if (xml.startsWith('<!', lt)) skip = ['>', 2, '#other'];
    if (skip) {
      const e = xml.indexOf(skip[0], lt + skip[1]);
      const end = e < 0 ? n : e + skip[0].length;
      leaf(skip[2], lt, end);
      i = end;
      continue;
    }
    let j = lt + 1, q = null;
    while (j < n) { const c = xml[j]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '>') break; j++; }
    if (j >= n) { leaf('#text', lt, n); break; }
    const tag = xml.slice(lt + 1, j);
    i = j + 1;
    if (tag[0] === '/') {
      const nm = tag.slice(1).trim();
      let k = stack.length - 1;
      while (k > 0 && stack[k].name !== nm) k--;
      if (k > 0) {
        while (stack.length - 1 > k) { const t = stack.pop(); t.closeStart = lt; t.end = lt; }
        const t = stack.pop(); t.closeStart = lt; t.end = i;
      }
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const m = /^([^\s/>]+)/.exec(tag);
    if (!m) continue;
    const node = { name: m[1], start: lt, openEnd: i, end: i, closeStart: i, selfClosing, children: [], parent: top() };
    top().children.push(node);
    if (!selfClosing) stack.push(node);
  }
  while (stack.length > 1) { const t = stack.pop(); t.closeStart = n; t.end = n; }
  return root;
}

/** Split rendered text into run pieces: newline → w:br, tab → w:tab. */
function textPieces(text) {
  const pieces = [];
  let buf = '';
  const flush = () => { if (buf) { pieces.push({ kind: 't', text: buf }); buf = ''; } };
  for (const ch of String(text).replace(/\r\n?/g, '\n')) {
    if (ch === '\n') { flush(); pieces.push({ kind: 'br' }); }
    else if (ch === '\t') { flush(); pieces.push({ kind: 'tab' }); }
    else buf += ch;
  }
  flush();
  return pieces;
}

/** Index of the "]}" balancing nested "{[ … ]}" pairs (comments may quote tags). */
function balancedClose(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src.startsWith('{[', i)) { depth++; i++; }
    else if (src.startsWith(']}', i)) { if (depth === 0) return i; depth--; i++; }
  }
  return -1;
}

// ---------- generic block-sequence parser (paragraph-level, row-level and inline all use it) ----------
// items: {type:'content', item} | {type:'marker', kind, expr, src, itemName}
function parseSeq(items) {
  const root = [];
  const stack = [{ kind: 'root', current: root, node: null }];
  const top = () => stack[stack.length - 1];
  for (const it of items) {
    if (it.type === 'content') { top().current.push({ type: 'content', item: it.item }); continue; }
    switch (it.kind) {
      case 'comment': break;
      case 'if': {
        const node = { type: 'if', branches: [{ cond: it.expr, src: it.src, body: [] }], elseBody: null };
        top().current.push(node);
        stack.push({ kind: 'if', node, current: node.branches[0].body });
        break;
      }
      case 'elseif': {
        const f = top();
        if (f.kind !== 'if') return { error: `{[else if ${it.src}]} is not inside an {[if]} block` };
        if (f.node.elseBody) return { error: `{[else if ${it.src}]} comes after {[else]}` };
        const br = { cond: it.expr, src: it.src, body: [] };
        f.node.branches.push(br);
        f.current = br.body;
        break;
      }
      case 'else': {
        const f = top();
        if (f.kind !== 'if') return { error: '{[else]} is not inside an {[if]} block' };
        if (f.node.elseBody) return { error: 'Duplicate {[else]}' };
        f.node.elseBody = [];
        f.current = f.node.elseBody;
        break;
      }
      case 'endif': {
        const f = top();
        if (f.kind !== 'if') return { error: f.kind === 'list' ? '{[end if]} closes a {[list]}; expected {[end list]}' : '{[end if]} has no matching {[if]}' };
        stack.pop();
        break;
      }
      case 'list': {
        const node = { type: 'list', expr: it.expr, src: it.src, itemName: it.itemName, body: [] };
        top().current.push(node);
        stack.push({ kind: 'list', node, current: node.body });
        break;
      }
      case 'endlist': {
        const f = top();
        if (f.kind !== 'list') return { error: f.kind === 'if' ? '{[end list]} closes an {[if]}; expected {[end if]}' : '{[end list]} has no matching {[list]}' };
        stack.pop();
        break;
      }
      case 'end': {
        if (top().kind === 'root') return { error: '{[end]} has no matching {[if]} or {[list]}' };
        stack.pop();
        break;
      }
      default: return { error: `Unknown tag kind ${it.kind}` };
    }
  }
  if (stack.length > 1) {
    const f = top();
    const src = f.kind === 'if' ? f.node.branches[0].src : f.node.src;
    return { error: `{[${f.kind} ${src || ''}]} has no matching {[end ${f.kind}]}` };
  }
  return { nodes: root };
}

/** Do the tags form one block: tags[0] opens, tags[last] closes it, no else/elseif at depth 1 (unless allowElse)? */
function wrapsWholeBlock(tags, allowElse) {
  if (tags.length < 2) return false;
  const first = tags[0], last = tags[tags.length - 1];
  if (first.literal || last.literal || !OPENERS.has(first.cls.kind) || !CLOSERS[first.cls.kind].has(last.cls.kind)) return false;
  let depth = 0;
  for (let i = 0; i < tags.length; i++) {
    const k = tags[i].literal ? 'field' : tags[i].cls.kind;
    if (OPENERS.has(k)) depth++;
    else if (k === 'endif' || k === 'endlist' || k === 'end') depth--;
    else if (!allowElse && depth === 1 && (k === 'else' || k === 'elseif')) return false;
    if (depth === 0 && i < tags.length - 1) return false;
  }
  return depth === 0;
}

// ---------- one WordprocessingML part ----------
class Part {
  constructor(xml, data, options = {}, label = '') {
    this.xml = xml;
    this.label = label;
    this.options = options;
    this.fns = options.functions ? { ...builtins, ...options.functions } : builtins;
    this.warnings = [];
    this.warned = new Set();
    this.root = parseRaw(xml);
    this.rootScope = createScope(data || {});
  }

  warn(msg) {
    const m = this.label ? `${this.label}: ${msg}` : msg;
    if (!this.warned.has(m)) { this.warned.add(m); this.warnings.push(m); }
  }

  // ----- raw access -----
  raw(n) { return this.xml.slice(n.start, n.end); }
  open(n) { return this.xml.slice(n.start, n.openEnd); }
  close(n) { return n.selfClosing ? '' : this.xml.slice(n.closeStart, n.end); }
  attr(n, name) {
    const re = new RegExp('\\s' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')');
    const m = re.exec(this.open(n));
    return m ? unescapeXml(m[1] ?? m[2]) : undefined;
  }
  textOf(n) {
    let s = '';
    for (const c of n.children) {
      if (c.name === '#text') s += unescapeXml(this.xml.slice(c.start, c.end));
      else if (c.name === '#cdata') s += this.xml.slice(c.start + 9, c.end - 3);
      else if (c.name[0] !== '#') s += this.textOf(c);
    }
    return s;
  }
  hasTags(n) {
    if (n._has === undefined) n._has = hasTagText(this.raw(n));
    return n._has;
  }
  isBlockContainer(n) {
    return BLOCK_CONTAINERS.has(n.name) && n.children.some((c) => c.name === 'w:p' || c.name === 'w:tbl');
  }

  // ----- atoms: the flat run model of a paragraph -----
  // {kind:'run', node, intact?, ancestry, openTag, rPr, pieces:[{kind:'t',text}|{kind:'tab'}|{kind:'br'}|{kind:'opaque',node}]}
  // {kind:'raw', node, ancestry}   {kind:'tag', inner, ancestry, openTag, rPr, cls, expr?, literal?, consumed?}
  collectAtoms(node, ancestry, atoms) {
    for (const c of node.children) {
      if (c.name === 'w:pPr') continue;
      if (c.name === 'w:r') atoms.push(this.runAtom(c, ancestry));
      else if (RUN_CONTAINERS.has(c.name) && !c.selfClosing) {
        this.collectAtoms(c, [...ancestry, { open: this.open(c), close: this.close(c) }], atoms);
      } else if (c.name === 'w:sdt' && !c.selfClosing) {
        const content = c.children.find((x) => x.name === 'w:sdtContent');
        if (!content) { atoms.push({ kind: 'raw', node: c, ancestry }); continue; }
        const before = c.children.filter((x) => x.start < content.start).map((x) => this.raw(x)).join('');
        const after = c.children.filter((x) => x.start > content.start).map((x) => this.raw(x)).join('');
        const entry = { open: this.open(c) + before + this.open(content), close: this.close(content) + after + this.close(c) };
        this.collectAtoms(content, [...ancestry, entry], atoms);
      } else atoms.push({ kind: 'raw', node: c, ancestry });
    }
    return atoms;
  }

  runAtom(r, ancestry) {
    const pieces = [];
    let rPr = '';
    for (const c of r.children) {
      if (c.name === 'w:rPr') rPr = this.raw(c);
      else if (c.name === 'w:t') pieces.push({ kind: 't', text: this.textOf(c) });
      else if (c.name === 'w:tab') pieces.push({ kind: 'tab' });
      else if (c.name === 'w:cr') pieces.push({ kind: 'br' });
      else if (c.name === 'w:br') { const t = this.attr(c, 'w:type'); pieces.push(t === 'page' || t === 'column' ? { kind: 'opaque', node: c } : { kind: 'br' }); }
      else if (c.name === '#text' && !this.xml.slice(c.start, c.end).trim()) continue;
      else pieces.push({ kind: 'opaque', node: c });
    }
    return { kind: 'run', node: r, intact: true, ancestry, openTag: this.open(r), rPr, pieces };
  }

  invisible(a) {
    if (a.kind === 'tag') return true;
    if (a.kind === 'raw') return INVISIBLE.has(a.node.name) || (a.node.name[0] === '#' && !this.raw(a.node).trim());
    if (a.kind === 'run') return a.pieces.every((p) => p.kind === 'tab' || (p.kind === 't' && !p.text.trim()));
    return false;
  }
  visibleAtom(a) {
    if (a.kind === 'run') return a.pieces.some((p) => p.kind === 'br' || p.kind === 'opaque' || (p.kind === 't' && p.text.trim() !== ''));
    if (a.kind === 'raw') return !this.invisible(a);
    return false;
  }

  /** Locate {[ … ]} in the paragraph text; rewrite the runs so that each tag is a single 'tag' atom. */
  consolidate(atoms, describe) {
    let full = '';
    for (const a of atoms) if (a.kind === 'run') for (const p of a.pieces) full += p.kind === 't' ? p.text : p.kind === 'tab' ? '\t' : p.kind === 'br' ? '\n' : '';
    if (!full.includes('{[')) return { atoms, tags: [], text: full };
    const tags = [];
    let pos = 0, open;
    while ((open = full.indexOf('{[', pos)) !== -1) {
      const isComment = /^\s*#/.test(full.slice(open + 2, open + 10));
      const close = isComment ? balancedClose(full, open + 2) : full.indexOf(']}', open + 2);
      if (close === -1) { this.warn(`Unterminated field "{[" in ${describe()} — left as text`); break; }
      const nextOpen = full.indexOf('{[', open + 2);
      if (!isComment && nextOpen !== -1 && nextOpen < close) { this.warn(`Unterminated field "{[" in ${describe()} — left as text`); pos = nextOpen; continue; }
      tags.push({ start: open, end: close + 2, inner: normalizeSmartQuotes(full.slice(open + 2, close)).trim() });
      pos = close + 2;
    }
    if (!tags.length) return { atoms, tags: [], text: full };
    const out = [];
    const tagAtoms = [];
    let cursor = 0, ti = 0;
    for (const a of atoms) {
      if (a.kind !== 'run') { out.push(a); continue; }
      let len = 0;
      for (const p of a.pieces) len += p.kind === 't' ? p.text.length : p.kind === 'tab' || p.kind === 'br' ? 1 : 0;
      const atomEnd = cursor + len;
      if (!tags[ti] || tags[ti].start >= atomEnd) { out.push(a); cursor = atomEnd; continue; }
      let cur = null;
      const add = (piece) => { (cur || (cur = [])).push(piece); };
      const flush = () => { if (cur && cur.length) out.push({ kind: 'run', node: a.node, ancestry: a.ancestry, openTag: a.openTag, rPr: a.rPr, pieces: cur }); cur = null; };
      for (const p of a.pieces) {
        if (p.kind === 'opaque') { add(p); continue; }
        const text = p.kind === 't' ? p.text : p.kind === 'tab' ? '\t' : '\n';
        const s = cursor, e = cursor + text.length;
        cursor = e;
        const sub = (x, y) => { if (y <= x) return; add(p.kind === 't' ? { kind: 't', text: text.slice(x - s, y - s) } : { kind: p.kind }); };
        let k = s;
        while (k < e) {
          const tag = tags[ti];
          if (!tag || tag.start >= e) { sub(k, e); k = e; break; }
          if (tag.start > k) { sub(k, tag.start); k = tag.start; }
          if (k === tag.start) {
            flush();
            const ta = { kind: 'tag', inner: tag.inner, ancestry: a.ancestry, openTag: a.openTag, rPr: a.rPr };
            out.push(ta); tagAtoms.push(ta);
          }
          k = Math.min(tag.end, e);
          if (tag.end <= e) ti++;
        }
      }
      flush();
    }
    return { atoms: out, tags: tagAtoms, text: full };
  }

  classifyTagAtom(t, describe) {
    t.cls = classifyTag(t.inner);
    const k = t.cls.kind;
    if (k === 'field' || k === 'if' || k === 'elseif' || k === 'list') {
      if ((k === 'if' || k === 'elseif' || k === 'list') && !t.cls.arg) {
        this.warn(`{[${t.inner}]} needs an expression (${describe()}) — left as text`);
        t.literal = true;
        return;
      }
      try { t.expr = parseExpr(t.cls.arg); } catch (e) {
        this.warn(`Bad expression in {[${t.inner}]} (${describe()}): ${e.message.replace(/ \(line \d+, col \d+\)$/, '')} — left as text`);
        t.literal = true;
      }
    }
  }

  tagItem(t) {
    if (t.consumed) return { type: 'content', item: { kind: 'nothing' } };
    if (t.literal || t.cls.kind === 'field') return { type: 'content', item: t };
    return { type: 'marker', kind: t.cls.kind, expr: t.expr, src: t.cls.arg, itemName: t.cls.itemName };
  }

  /** Fallback when a sequence is unbalanced: comments vanish, structural tags stay as text. */
  literalItems(items) {
    return items.filter((it) => !(it.type === 'marker' && it.kind === 'comment')).map((it) => (it.type === 'marker' ? { type: 'content', item: it.tag ? Object.assign(it.tag, { literal: true }) : it.item } : it));
  }

  // ----- paragraphs -----
  prepPara(p) {
    if (p._unit) return p._unit;
    const unit = { kind: 'para', node: p, atoms: null, tags: [], text: '' };
    p._unit = unit;
    const pPr = p.children.find((c) => c.name === 'w:pPr');
    unit.pPr = pPr ? this.raw(pPr) : '';
    unit.sectPr = !!pPr && pPr.children.some((c) => c.name === 'w:sectPr');
    const describe = () => `paragraph "${snippet(unit.text || this.textOf(p))}"`;
    const { atoms, tags, text } = this.consolidate(this.collectAtoms(p, [], []), describe);
    unit.text = text;
    unit.atoms = atoms;
    unit.tags = tags;
    if (!tags.length) { unit.plain = true; return unit; }
    for (const t of tags) this.classifyTagAtom(t, describe);
    this.updateMarker(unit);
    return unit;
  }

  updateMarker(unit) {
    const live = unit.tags.filter((t) => !t.consumed);
    unit.isMarker = live.length > 0 && live.every((t) => !t.literal && t.cls.kind !== 'field') && unit.atoms.every((a) => this.invisible(a));
  }

  finishPara(unit) {
    if (unit.plain || unit.seq) return;
    const items = unit.atoms.map((a) => (a.kind === 'tag' ? Object.assign(this.tagItem(a), { tag: a }) : { type: 'content', item: a }));
    let r = parseSeq(items);
    if (r.error) {
      this.warn(`${r.error} in paragraph "${snippet(unit.text)}" — tags left as text`);
      r = parseSeq(this.literalItems(items));
    }
    unit.seq = r.nodes;
    const live = unit.tags.filter((t) => !t.consumed);
    const vis = unit.atoms.filter((a) => a.kind === 'tag' ? !a.consumed : !this.invisible(a));
    unit.wrapped = vis.length >= 2 && vis[0] === live[0] && vis[vis.length - 1] === live[live.length - 1] && wrapsWholeBlock(live, true);
  }

  evalPara(unit, scope) {
    if (unit.plain || unit.isMarker) return this.rebuildChildren(unit.node, scope); // marker only in fallback (unbalanced container)
    this.finishPara(unit);
    const atoms = [];
    this.evalSeq(unit.seq, scope, (a, sc) => this.emitAtom(a, sc, atoms));
    if (unit.wrapped && !atoms.some((a) => this.visibleAtom(a))) return null;
    return this.open(unit.node) + unit.pPr + this.serializeAtoms(atoms, scope) + this.close(unit.node);
  }

  emitAtom(a, scope, out) {
    if (a.kind === 'run' || a.kind === 'raw') { out.push(a); return; }
    if (a.kind !== 'tag' || a.consumed) return;
    if (a.literal || a.cls.kind !== 'field') {
      if (a.cls && a.cls.kind === 'comment' && !a.literal) return;
      out.push({ kind: 'run', ancestry: a.ancestry, openTag: a.openTag, rPr: a.rPr, pieces: [{ kind: 't', text: `{[${a.inner}]}` }] });
      return;
    }
    const { value, missing } = this.evalIn(a.expr, scope, a.cls.arg);
    const text = formatValue(value, this.fieldOpts(a.expr, value));
    if (text === '' && (value == null || value === '')) {
      const p0 = pathOf(a.expr);
      const paths = missing.size ? [...missing] : p0 && p0.startsWith('_') ? [] : [p0 || a.cls.arg];
      for (const p of paths) this.warn(`Missing value: ${p}`);
      const mt = this.options.missingText ?? '';
      if (mt) out.push({ kind: 'run', ancestry: a.ancestry, openTag: a.openTag, rPr: a.rPr, pieces: textPieces(mt) });
      return;
    }
    out.push({ kind: 'run', ancestry: a.ancestry, openTag: a.openTag, rPr: a.rPr, pieces: textPieces(text) });
  }

  serializeAtoms(atoms, scope) {
    let s = '';
    const open = [];
    for (const a of atoms) {
      const anc = a.ancestry || [];
      let common = 0;
      while (common < open.length && common < anc.length && open[common] === anc[common]) common++;
      while (open.length > common) s += open.pop().close;
      for (let k = common; k < anc.length; k++) { s += anc[k].open; open.push(anc[k]); }
      s += this.serializeAtom(a, scope);
    }
    while (open.length) s += open.pop().close;
    return s;
  }

  serializeAtom(a, scope) {
    if (a.kind === 'raw') return this.rebuild(a.node, scope);
    if (a.kind !== 'run') return '';
    if (a.intact) return this.rebuild(a.node, scope);
    if (!a.pieces.length) return '';
    let s = a.openTag.replace(/\/>$/, '>') + a.rPr;
    for (const p of a.pieces) {
      if (p.kind === 't') s += `<w:t xml:space="preserve">${escapeXml(p.text)}</w:t>`;
      else if (p.kind === 'tab') s += '<w:tab/>';
      else if (p.kind === 'br') s += '<w:br/>';
      else s += this.rebuild(p.node, scope);
    }
    return s + '</w:r>';
  }

  // ----- containers (body, cell, header, textbox …) -----
  prepContainer(node) {
    if (node._cont) return node._cont;
    const cont = { node, units: [], seq: null };
    node._cont = cont;
    for (const c of node.children) {
      if (c.name === 'w:p') cont.units.push(this.prepPara(c));
      else if (c.name === 'w:tbl') cont.units.push(this.prepTable(c));
      else cont.units.push({ kind: 'raw', node: c });
    }
    return cont;
  }

  finishContainer(cont) {
    if (cont.seq) return;
    const items = [];
    for (const u of cont.units) {
      if (u.kind === 'para' && u.isMarker) {
        // A section break lives on the marker paragraph: keep it (emptied) exactly once, whatever the block does.
        if (u.sectPr) (cont.sectUnits || (cont.sectUnits = [])).push(u);
        for (const t of u.tags) if (!t.consumed) items.push(Object.assign(this.tagItem(t), { tag: t, item: u }));
        continue;
      }
      if (u.kind === 'table') this.finishTable(u);
      items.push({ type: 'content', item: u });
    }
    let r = parseSeq(items);
    if (r.error) {
      const where = cont.node.name === 'w:body' ? 'document body' : cont.node.name === 'w:tc' ? 'table cell' : cont.node.name.replace(/^w:/, '');
      this.warn(`${r.error} (paragraph-level block in ${where}) — block tags left as text`);
      r = parseSeq(items.map((it) => (it.type === 'marker' ? { type: 'content', item: it.item } : it)).filter((it, i, arr) => it.item.kind !== 'para' || !it.item.isMarker || arr.findIndex((x) => x.item === it.item) === i));
    }
    cont.seq = r.nodes;
  }

  evalContainer(cont, scope) {
    this.finishContainer(cont);
    const out = [], units = [];
    this.evalSeq(cont.seq, scope, (u, sc) => {
      let x;
      if (u.kind === 'para') x = this.evalPara(u, sc);
      else if (u.kind === 'table') x = this.evalTable(u, sc);
      else x = this.rebuild(u.node, sc);
      if (x != null) { out.push(x); units.push(u); }
    });
    if (cont.sectUnits) {
      for (const su of cont.sectUnits) {
        const idx = cont.units.indexOf(su);
        let at = 0;
        for (let i = units.length - 1; i >= 0; i--) if (cont.units.indexOf(units[i]) < idx) { at = i + 1; break; }
        out.splice(at, 0, this.open(su.node) + su.pPr + this.close(su.node));
        units.splice(at, 0, su);
      }
    }
    if (NEEDS_PARA.has(cont.node.name)) {
      let last = -1;
      for (let i = out.length - 1; i >= 0; i--) if (/^<w:(p|tbl)[\s>/]/.test(out[i])) { last = i; break; }
      if (last < 0 || !/^<w:p[\s>/]/.test(out[last])) {
        let at = last + 1;
        if (last < 0) { at = out.findIndex((x) => /^<w:sectPr[\s>/]/.test(x)); if (at < 0) at = out.length; }
        out.splice(at, 0, '<w:p/>');
      }
    }
    return out.join('');
  }

  // ----- tables -----
  prepTable(tbl) {
    const unit = { kind: 'table', node: tbl, items: [], seq: null };
    for (const c of tbl.children) unit.items.push(c.name === 'w:tr' ? this.prepRow(c) : { kind: 'raw', node: c });
    return unit;
  }

  prepRow(tr) {
    const row = { kind: 'row', node: tr, parts: [], cells: [] };
    for (const c of tr.children) {
      if (c.name === 'w:tc') { const cell = { kind: 'cell', node: c, cont: this.prepContainer(c) }; row.parts.push(cell); row.cells.push(cell); }
      else row.parts.push({ kind: 'raw', node: c });
    }
    return row;
  }

  finishTable(unit) {
    if (unit.seq) return;
    const items = [];
    for (const it of unit.items) {
      if (it.kind !== 'row') { items.push({ type: 'content', item: it }); continue; }
      const paras = [];
      for (const cell of it.cells) for (const u of cell.cont.units) if (u.kind === 'para') paras.push(u);
      const tags = paras.flatMap((u) => u.tags);
      const markerRow = tags.length > 0 && paras.every((u) => (u.plain ? u.atoms.every((a) => this.invisible(a)) : u.isMarker));
      if (markerRow) { for (const t of tags) items.push(Object.assign(this.tagItem(t), { tag: t, item: it })); continue; }
      if (wrapsWholeBlock(tags, false)) {
        const first = tags[0], last = tags[tags.length - 1];
        const firstUnit = paras.find((u) => u.tags.includes(first)), lastUnit = paras.find((u) => u.tags.includes(last));
        const firstCellParas = it.cells[0].cont.units.filter((u) => u.kind === 'para');
        const lastCellParas = it.cells[it.cells.length - 1].cont.units.filter((u) => u.kind === 'para');
        const before = firstUnit.atoms.slice(0, firstUnit.atoms.indexOf(first));
        const after = lastUnit.atoms.slice(lastUnit.atoms.indexOf(last) + 1);
        if (firstCellParas[0] === firstUnit && lastCellParas[lastCellParas.length - 1] === lastUnit && before.every((a) => this.invisible(a)) && after.every((a) => this.invisible(a))) {
          first.consumed = true; last.consumed = true;
          this.updateMarker(firstUnit); this.updateMarker(lastUnit);
          items.push(Object.assign({ type: 'marker', kind: first.cls.kind, expr: first.expr, src: first.cls.arg, itemName: first.cls.itemName }, { tag: first, item: it }));
          items.push({ type: 'content', item: it });
          items.push(Object.assign({ type: 'marker', kind: last.cls.kind }, { tag: last, item: it }));
          continue;
        }
      }
      items.push({ type: 'content', item: it });
    }
    let r = parseSeq(items);
    if (r.error) {
      this.warn(`${r.error} (row-level block in table) — block tags left as text`);
      for (const it of items) if (it.tag) it.tag.consumed = false;
      for (const it of unit.items) if (it.kind === 'row') for (const cell of it.cells) for (const u of cell.cont.units) if (u.kind === 'para' && !u.plain) this.updateMarker(u);
      const seen = new Set();
      r = parseSeq(items.filter((it) => { if (seen.has(it.item)) return false; seen.add(it.item); return true; }).map((it) => ({ type: 'content', item: it.item })));
    }
    unit.seq = r.nodes;
  }

  evalTable(unit, scope) {
    this.finishTable(unit);
    const out = [];
    this.evalSeq(unit.seq, scope, (it, sc) => out.push(it.kind === 'row' ? this.evalRow(it, sc) : this.rebuild(it.node, sc)));
    if (!out.some((x) => /^<w:tr[\s>/]/.test(x))) return null; // a table without rows is invalid: drop it
    return this.open(unit.node) + out.join('') + this.close(unit.node);
  }

  evalRow(row, scope) {
    if (row.literal) return this.rebuild(row.node, scope);
    let s = this.open(row.node);
    for (const p of row.parts) {
      if (p.kind === 'cell') s += this.open(p.node) + this.evalContainer(p.cont, scope) + this.close(p.node);
      else s += this.rebuild(p.node, scope);
    }
    return s + this.close(row.node);
  }

  // ----- generic rebuild: untouched subtrees are emitted as their original bytes -----
  rebuild(node, scope) {
    if (node.name === '#root') return node.children.map((c) => this.rebuild(c, scope)).join('');
    if (node.name[0] === '#' || !this.hasTags(node)) return this.raw(node);
    if (node.name === 'w:p') return this.evalPara(this.prepPara(node), scope) ?? '';
    if (node.name === 'w:tbl') return this.evalTable(node._tbl || (node._tbl = this.prepTable(node)), scope) ?? '';
    if (this.isBlockContainer(node)) return this.open(node) + this.evalContainer(this.prepContainer(node), scope) + this.close(node);
    return this.rebuildChildren(node, scope);
  }

  rebuildChildren(node, scope) {
    if (node.selfClosing) return this.raw(node);
    return this.open(node) + node.children.map((c) => this.rebuild(c, scope)).join('') + this.close(node);
  }

  // ----- evaluation (mirrors engine/evaluate.js) -----
  evalIn(expr, scope, src) {
    const local = createTrace();
    let value;
    try { value = evalExpr(expr, scope, local, this.fns); } catch (e) {
      if (this.options.strict) throw e;
      this.warn(`Error in {[${src}]}: ${e.message}`);
      value = undefined;
    }
    return { value, missing: local.missing };
  }

  fieldOpts(expr, value) {
    const o = this.options;
    if (!o.model || !o.model.variables || typeof value !== 'string') return o;
    const p = pathOf(expr);
    const def = p ? o.model.variables[p] : null;
    return def && def.type !== 'date' && def.type !== 'computed' ? { ...o, autoDates: false } : o;
  }

  evalSeq(nodes, scope, emit) {
    for (const node of nodes) {
      switch (node.type) {
        case 'content': emit(node.item, scope); break;
        case 'if': {
          let taken = false;
          for (const br of node.branches) {
            const { value } = this.evalIn(br.cond, scope, br.src);
            if (truthy(value)) { this.evalSeq(br.body, scope, emit); taken = true; break; }
          }
          if (!taken && node.elseBody) this.evalSeq(node.elseBody, scope, emit);
          break;
        }
        case 'list': {
          const { ast: listExpr, punc } = stripPuncFilter(node.expr);
          const { value } = this.evalIn(listExpr, scope, node.src);
          const items = Array.isArray(value) ? value : value == null || value === '' ? [] : [value];
          const prefix = listPrefix(listExpr, node.src, scope);
          items.forEach((item, i) => this.evalSeq(node.body, createScope(itemVars(item, i, items.length, node.itemName, punc), scope, prefix), emit));
          break;
        }
        default: break;
      }
    }
  }

  fill() { return this.rebuild(this.root, this.rootScope); }

  /** Plain text of every paragraph (tags normalized and re-joined), one line per paragraph, in document order. */
  templateText() {
    const lines = [];
    const walk = (node) => {
      for (const c of node.children) {
        if (c.name[0] === '#') continue;
        if (c.name === 'w:p') {
          const u = this.prepPara(c);
          let s = '';
          for (const a of u.atoms) {
            if (a.kind === 'tag') s += `{[${a.inner}]}`;
            else if (a.kind === 'run') for (const p of a.pieces) s += p.kind === 't' ? p.text : p.kind === 'tab' ? '\t' : p.kind === 'br' ? '\n' : '';
          }
          lines.push(s);
        }
        walk(c); // nested paragraphs (text boxes) follow their host paragraph
      }
    };
    walk(this.root);
    return lines.join('\n');
  }
}

function snippet(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 57) + '…' : t;
}

function prefixOf(scope) { for (let s = scope; s; s = s.parent) if (s.prefix) return s.prefix; return null; }
function rootVars(scope) { let s = scope; while (s.parent) s = s.parent; return s.vars; }
function hasKeyCI(obj, key) {
  if (!obj || typeof obj !== 'object') return false;
  const lk = String(key).toLowerCase();
  return Object.keys(obj).some((k) => k.toLowerCase() === lk);
}
function listPrefix(listExpr, src, scope) {
  const id = listIdentity(listExpr);
  const outer = prefixOf(scope);
  if (id && id.startsWith('_')) return outer ? outer + '.' + id + '[]' : id + '[]';
  if (id && outer && !(id in (rootVars(scope) || {})) && !hasKeyCI(rootVars(scope), id.split('.')[0]) && hasKeyCI(scope.vars, id.split('.')[0])) return outer + '.' + id + '[]';
  return (id || src) + '[]';
}

// ---------- public API ----------

/** Fill one WordprocessingML part (document.xml, header1.xml …). */
export function fillPartXml(xml, data, options = {}, label = '') {
  const part = new Part(xml, data, options, label);
  return { xml: part.fill(), warnings: part.warnings };
}

/** Tag-bearing plain text of one part, one line per paragraph. */
export function partTemplateText(xml) {
  return new Part(xml, {}, {}, '').templateText();
}

function partLabel(name) {
  const m = /^word\/(.*)\.xml$/.exec(name);
  return m && m[1] !== 'document' ? m[1] : '';
}

/**
 * Fill a .docx template in place.
 * @param {Uint8Array} bytes  the attorney's Word file with {[ ]} tags
 * @param {Object} data       answers
 * @param {Object} [options]  { model, functions, dateFormat, yes, no, missingText, compress }
 * @returns {Promise<{bytes:Uint8Array, warnings:string[], text:string}>}
 */
export async function fillDocx(bytes, data, options = {}) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  let zip;
  try { zip = readZip(bytes); } catch (e) { throw new Error('fillDocx: not a .docx file — ' + e.message.replace(/^zipread: /, '')); }
  if (!zip.has('word/document.xml')) throw new Error('fillDocx: word/document.xml missing (not a .docx?)');
  const dec = new TextDecoder(), enc = new TextEncoder();
  const warnings = [];
  const entries = [];
  for (const [name, entry] of zip) {
    // Only template parts are inflated; everything else (images, fonts, embedded files) passes through as the
    // stored bytes, so a 300 KB package that inflates to hundreds of MB never does, and a 2 MB photo is copied,
    // not re-encoded.
    if (TEMPLATE_PART.test(name)) {
      const data_ = await entry.bytes();
      const xml = dec.decode(data_);
      if (hasTagText(xml)) {
        const r = fillPartXml(xml, data, options, partLabel(name));
        for (const w of r.warnings) if (!warnings.includes(w)) warnings.push(w);
        entries.push({ name, data: enc.encode(r.xml) });
        continue;
      }
    }
    entries.push({ name, raw: entry.raw(), method: entry.method, crc: entry.crc, compressedSize: entry.compressedSize, uncompressedSize: entry.uncompressedSize });
  }
  const ct = entries.findIndex((e) => e.name === '[Content_Types].xml');
  if (ct > 0) entries.unshift(...entries.splice(ct, 1));
  const out = await writeZipAsync(entries, { compress: options.compress !== false });
  let text = '';
  try { text = (await readDocx(out)).text; } catch { /* preview text is best-effort */ }
  return { bytes: out, warnings, text };
}

/**
 * The tag-bearing plain text of a .docx (headers, body, footers, footnotes, endnotes — parts without tags are
 * skipped except the body), one line per paragraph, so compile()/questionnaire() can analyze it.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function extractTemplateText(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  let zip;
  try { zip = readZip(bytes); } catch (e) { throw new Error('extractTemplateText: not a .docx file — ' + e.message.replace(/^zipread: /, '')); }
  if (!zip.has('word/document.xml')) throw new Error('extractTemplateText: word/document.xml missing (not a .docx?)');
  const dec = new TextDecoder();
  const names = [...zip.keys()].sort();
  const pick = async (re, always = false) => {
    const out = [];
    for (const name of names.filter((n) => re.test(n))) {
      const xml = dec.decode(await zip.get(name).bytes());
      if (always || hasTagText(xml)) out.push(partTemplateText(xml));
    }
    return out;
  };
  const parts = [
    ...(await pick(/^word\/header\d*\.xml$/)),
    ...(await pick(/^word\/document\.xml$/, true)),
    ...(await pick(/^word\/footer\d*\.xml$/)),
    ...(await pick(/^word\/(footnotes|endnotes)\.xml$/)),
  ];
  return parts.join('\n');
}
