/**
 * @module store
 * localStorage persistence keyed 'docassembly.v1' (see API.md).
 */
const KEY = 'docassembly.v1';

const DEFAULT_SETTINGS = {
  firmName: '',
  attorneyName: '',
  defaultFont: 'Times New Roman',
  defaultFontSize: 12,
  theme: 'light',
};

function emptyState() {
  return { templates: {}, records: {}, packages: {}, settings: { ...DEFAULT_SETTINGS } };
}

const PREV_KEY = KEY + '.prev';
/** Set when load() found unreadable data: { stashKey|null, raw, recoveredFromSnapshot } */
let recovery = null;
const listeners = new Set();
let saveTimer = null;
let lastError = null;

const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const plainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, fallback = '') => (v == null ? fallback : String(v));
const isoOrNow = (v) => { const t = str(v); return t && !isNaN(Date.parse(t)) ? t : now(); };

/** Validate + normalise one stored item so a bad import can never crash list()/render. Returns null if unusable. */
export function sanitizeItem(kind, item) {
  if (!plainObject(item)) return null;
  const id = str(item.id).trim();
  if (!id || BAD_KEYS.has(id)) return null;
  const out = { ...item, id, name: str(item.name).trim() || (kind === 'templates' ? 'Untitled template' : kind === 'records' ? 'Untitled record' : 'Untitled package') };
  out.createdAt = isoOrNow(item.createdAt);
  out.updatedAt = isoOrNow(item.updatedAt);
  if (kind === 'templates') {
    out.text = typeof item.text === 'string' ? item.text : '';
    out.description = str(item.description);
    out.folder = str(item.folder);
    const m = plainObject(item.model) ? item.model : {};
    out.model = { variables: plainObject(m.variables) ? m.variables : {}, order: Array.isArray(m.order) ? m.order.filter((x) => typeof x === 'string') : [] };
    for (const k of Object.keys(out.model.variables)) if (BAD_KEYS.has(k) || !plainObject(out.model.variables[k])) delete out.model.variables[k];
    if (item.docxOrigin != null) out.docxOrigin = str(item.docxOrigin);
    if (item.sampleAnswers != null && !plainObject(item.sampleAnswers)) delete out.sampleAnswers;
  } else if (kind === 'records') {
    out.data = plainObject(item.data) ? item.data : {};
  } else if (kind === 'packages') {
    out.items = (Array.isArray(item.items) ? item.items : []).filter(plainObject).map((it) => ({ templateId: str(it.templateId), includeIf: str(it.includeIf) }));
  }
  return out;
}

function fromParsed(parsed) {
  if (!plainObject(parsed)) throw new Error('stored data is not an object');
  const s = emptyState();
  for (const kind of ['templates', 'records', 'packages']) {
    const src = parsed[kind];
    const arr = Array.isArray(src) ? src : plainObject(src) ? Object.values(src) : [];
    for (const item of arr) { const clean = sanitizeItem(kind, item); if (clean) s[kind][clean.id] = clean; }
  }
  if (plainObject(parsed.settings)) s.settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
  return s;
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { console.error('store: localStorage unavailable', e); return emptyState(); }
  if (!raw) return emptyState();
  try {
    return fromParsed(JSON.parse(raw));
  } catch (e) {
    // Never overwrite the only copy: stash the unreadable text, then fall back to the last good snapshot.
    console.error('store: stored data is unreadable, keeping a copy', e);
    const stashKey = KEY + '.corrupt-' + Date.now();
    let stashed = false;
    try { localStorage.setItem(stashKey, raw); stashed = true; } catch (e2) { /* quota — keep in memory only */ }
    recovery = { stashKey: stashed ? stashKey : null, raw, recoveredFromSnapshot: false, error: String(e && e.message || e) };
    try {
      const prev = localStorage.getItem(PREV_KEY);
      if (prev) { const s = fromParsed(JSON.parse(prev)); recovery.recoveredFromSnapshot = true; return s; }
    } catch (e3) { /* snapshot also bad */ }
    return emptyState();
  }
}

/** Info about an unreadable store found at startup (or null). */
export function getRecovery() { return recovery; }
export function clearRecovery() { recovery = null; }

let state = load();

export function genId(prefix = 'id') {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export function now() { return new Date().toISOString(); }

/** Flush pending write immediately. Returns true if it succeeded. */
export function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const json = JSON.stringify(state);
  try {
    // Keep the previous good copy as a rolling snapshot so a corrupt write is never the only copy.
    try { const cur = localStorage.getItem(KEY); if (cur && cur !== json) localStorage.setItem(PREV_KEY, cur); } catch (e) { /* best effort */ }
    localStorage.setItem(KEY, json);
    lastError = null;
    return true;
  } catch (e) {
    // Out of room: drop the snapshot and retry once before giving up.
    try { localStorage.removeItem(PREV_KEY); localStorage.setItem(KEY, json); lastError = null; return true; } catch (e2) { /* fall through */ }
    lastError = e;
    console.error('store: save failed', e);
    const quota = /quota|exceeded|storage/i.test(String(e && (e.name + ' ' + e.message)));
    emit({ type: 'error', quota, error: e });
    return false;
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 150);
}

function emit(evt) {
  for (const fn of listeners) {
    try { fn(evt); } catch (e) { console.error(e); }
  }
}

/** Subscribe to changes. fn({type:'change'|'error', ...}). Returns unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLastError() { return lastError; }

function changed(kind, id) {
  scheduleSave();
  emit({ type: 'change', kind, id });
}

/* ---------- generic accessors ---------- */
export function getState() { return state; }

export function getSettings() { return state.settings; }
export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  changed('settings');
  return state.settings;
}

function collection(kind) {
  return {
    list: () => Object.values(state[kind]).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))),
    get: (id) => state[kind][id] || null,
    put: (obj) => {
      const t = now();
      if (!obj.id || BAD_KEYS.has(String(obj.id))) obj.id = genId(kind.slice(0, 3));
      if (!obj.createdAt) obj.createdAt = t;
      obj.updatedAt = t;
      state[kind][obj.id] = obj;
      changed(kind, obj.id);
      return obj;
    },
    /** Patch without bumping updatedAt if silent */
    update: (id, patch, { silent = false } = {}) => {
      const cur = state[kind][id];
      if (!cur) return null;
      Object.assign(cur, patch);
      if (!silent) cur.updatedAt = now();
      changed(kind, id);
      return cur;
    },
    remove: (id) => {
      delete state[kind][id];
      changed(kind, id);
    },
  };
}

export const templates = collection('templates');
export const records = collection('records');
export const packages = collection('packages');

export function newTemplate({ name = 'Untitled template', description = '', text = '', model = null, folder = '', docxOrigin } = {}) {
  const t = { id: genId('tpl'), name, description, text, model: model || { variables: {}, order: [] }, folder, createdAt: now(), updatedAt: now() };
  if (docxOrigin) t.docxOrigin = docxOrigin;
  return templates.put(t);
}

export function newRecord({ name = 'New record', data = {} } = {}) {
  return records.put({ id: genId('rec'), name, data, createdAt: now(), updatedAt: now() });
}

export function newPackage({ name = 'New package', items = [] } = {}) {
  return packages.put({ id: genId('pkg'), name, items, createdAt: now(), updatedAt: now() });
}

export function duplicate(kind, id) {
  const col = { templates, records, packages }[kind];
  const src = col.get(id);
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = genId(kind.slice(0, 3));
  copy.name = `${src.name} (copy)`;
  copy.createdAt = now();
  return col.put(copy);
}

/* ---------- import / export ---------- */
export function exportAll() {
  return JSON.stringify({ version: 1, exportedAt: now(), ...state }, null, 2);
}

/**
 * Import a full-data JSON blob.
 * mode 'merge' keeps existing entries and adds/overwrites by id; 'replace' wipes first.
 * The current state is stashed under KEY+'.pre-import' first so a bad import can be undone.
 */
export function importAll(json, mode = 'merge') {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  if (!plainObject(parsed)) throw new Error('Not a DocAssembly export');
  const incoming = fromParsed(parsed);
  try { localStorage.setItem(KEY + '.pre-import', JSON.stringify(state)); } catch (e) { /* best effort */ }
  if (mode === 'replace') state = emptyState();
  const counts = { templates: 0, records: 0, packages: 0, overwritten: 0, skipped: 0 };
  for (const kind of ['templates', 'records', 'packages']) {
    const src = parsed[kind];
    const rawCount = Array.isArray(src) ? src.length : plainObject(src) ? Object.keys(src).length : 0;
    counts.skipped += rawCount - Object.keys(incoming[kind]).length;
    for (const item of Object.values(incoming[kind])) {
      if (state[kind][item.id]) counts.overwritten++;
      state[kind][item.id] = item;
      counts[kind]++;
    }
  }
  if (plainObject(parsed.settings)) state.settings = { ...DEFAULT_SETTINGS, ...state.settings, ...parsed.settings };
  changed('all');
  return counts;
}

export function resetAll() {
  state = emptyState();
  try { localStorage.removeItem(KEY); localStorage.removeItem(PREV_KEY); } catch (e) { /* ignore */ }
  changed('all');
}

export function storageUsage() {
  try {
    const raw = localStorage.getItem(KEY) || '';
    return raw.length * 2; // UTF-16 bytes, approximate
  } catch (e) { return 0; }
}

// Persist before unload if a save is pending.
window.addEventListener('beforeunload', () => { if (saveTimer) flush(); });
