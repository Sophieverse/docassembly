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

let state = load();
const listeners = new Set();
let saveTimer = null;
let lastError = null;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    const s = emptyState();
    s.templates = parsed.templates || {};
    s.records = parsed.records || {};
    s.packages = parsed.packages || {};
    s.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
    return s;
  } catch (e) {
    console.error('store: failed to load, starting fresh', e);
    return emptyState();
  }
}

export function genId(prefix = 'id') {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export function now() { return new Date().toISOString(); }

/** Flush pending write immediately. Returns true if it succeeded. */
export function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    lastError = null;
    return true;
  } catch (e) {
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
    list: () => Object.values(state[kind]).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')),
    get: (id) => state[kind][id] || null,
    put: (obj) => {
      const t = now();
      if (!obj.id) obj.id = genId(kind.slice(0, 3));
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
 */
export function importAll(json, mode = 'merge') {
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  if (!parsed || typeof parsed !== 'object') throw new Error('Not a DocAssembly export');
  if (mode === 'replace') state = emptyState();
  for (const kind of ['templates', 'records', 'packages']) {
    const src = parsed[kind] || {};
    const arr = Array.isArray(src) ? src : Object.values(src);
    for (const item of arr) {
      if (item && item.id) state[kind][item.id] = item;
    }
  }
  if (parsed.settings) state.settings = { ...DEFAULT_SETTINGS, ...state.settings, ...parsed.settings };
  changed('all');
  return {
    templates: Object.keys(parsed.templates || {}).length,
    records: Object.keys(parsed.records || {}).length,
    packages: Object.keys(parsed.packages || {}).length,
  };
}

export function resetAll() {
  state = emptyState();
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
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
