/**
 * @module main
 * App bootstrap: theme, routes, first-run experience.
 */
import { route, start, navigate, dispatch, setNotFound } from './router.js';
import * as store from './store.js';
import { toast, modal, el, download } from './components.js';
import { modelFor } from './docgen.js';
import { compile, mergeModel } from './engine-api.js';
import { renderTemplates } from './ui-templates.js';
import { renderEditor } from './ui-editor.js';
import { renderInterview } from './ui-interview.js';
import { renderOutput } from './ui-output.js';
import { renderRecords } from './ui-records.js';
import { renderPackages } from './ui-packages.js';
import { renderSettings } from './ui-settings.js';
import { renderHelp } from './help.js';

export let samples = [];
try {
  const mod = await import('./samples-index.js');
  samples = mod.samples || [];
} catch (e) {
  console.warn('Samples not available:', e && e.message);
  samples = [];
}

/* ---------- theme ---------- */
export function applyTheme(theme) {
  let t = theme || store.getSettings().theme || 'light';
  if (t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
}
applyTheme();
document.getElementById('theme-toggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  store.updateSettings({ theme: next });
  applyTheme(next);
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (store.getSettings().theme === 'system') applyTheme('system'); });

function updateFirm() {
  const s = store.getSettings();
  document.getElementById('topbar-firm').textContent = s.firmName || '';
}
updateFirm();
let lastStorageToast = 0;
store.subscribe((evt) => {
  if (evt.type === 'error') {
    // Autosave fires per keystroke; do not stack a toast per failure.
    if (Date.now() - lastStorageToast < 8000) return;
    lastStorageToast = Date.now();
    toast(evt.quota ? 'Storage is full — could not save. Export your data and delete unused templates/records.' : 'Could not save to browser storage.', 'error', 6000);
  } else if (evt.kind === 'settings' || evt.kind === 'all') {
    updateFirm();
  }
});

/* ---------- recovery banner (unreadable localStorage found at startup) ---------- */
function showRecoveryBanner() {
  const r = store.getRecovery();
  if (!r) return;
  const banner = el('div.banner.banner-warn', { role: 'alert' },
    el('strong', 'Your saved data could not be read. '),
    r.recoveredFromSnapshot ? 'The previous good copy was restored instead. ' : 'DocAssembly started with an empty workspace. ',
    r.stashKey ? 'The unreadable copy was kept untouched in this browser. ' : '',
    el('button.btn.btn-sm', { type: 'button', onClick: () => download(`docassembly-unreadable-${new Date().toISOString().slice(0, 10)}.txt`, r.raw, 'text/plain') }, 'Download unreadable copy'),
    el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => { banner.remove(); store.clearRecovery(); } }, 'Dismiss'),
  );
  document.body.insertBefore(banner, document.getElementById('main'));
}
showRecoveryBanner();

/* ---------- routes ---------- */
const main = document.getElementById('main');
const wrap = (fn, wide = false) => (ctx) => { main.className = 'main' + (wide ? ' wide' : ''); main.scrollTop = 0; window.scrollTo(0, 0); return fn(main, ctx); };

route('/', () => navigate('/templates', { replace: true }));
route('/templates', wrap(renderTemplates));
route('/templates/:id', wrap(renderEditor, true));
route('/interview/pkg/:packageId', wrap((m, ctx) => renderInterview(m, { ...ctx, params: { packageId: ctx.params.packageId } }), true));
route('/interview/:templateId', wrap(renderInterview, true));
route('/output/pkg/:packageId', wrap((m, ctx) => renderOutput(m, { ...ctx, params: { packageId: ctx.params.packageId } })));
route('/output/:templateId', wrap(renderOutput));
route('/records', wrap(renderRecords));
route('/records/:id', wrap(renderRecords));
route('/packages', wrap(renderPackages));
route('/packages/:id', wrap(renderPackages));
route('/settings', wrap(renderSettings));
route('/help', wrap(renderHelp));
setNotFound(wrap((m, ctx) => {
  m.appendChild(el('div.card.empty', el('h2', 'Page not found'), el('p', 'There is nothing at ', el('code', '#' + ctx.path), '.'),
    el('div.flex', { style: { justifyContent: 'center' } }, el('a.btn.btn-primary', { href: '#/templates' }, 'Go to templates'), el('a.btn', { href: '#/help' }, 'Help'))));
}));

/* ---------- first run ---------- */
export function loadSample(sample) {
  // Samples may ship a curated model (labels/types/options/help); merge it with what analysis discovers so new variables still appear.
  let model = modelFor(sample.text);
  if (sample.model && typeof sample.model === 'object') {
    try {
      const c = compile(sample.text || '');
      const base = sample.model.variables ? sample.model : { variables: sample.model, order: [] };
      model = c.errors.length ? JSON.parse(JSON.stringify(base)) : mergeModel(JSON.parse(JSON.stringify(base)), c.analysis);
    } catch (e) { console.warn('sample model merge failed', e); }
  }
  const t = store.newTemplate({ name: sample.name, description: sample.description || '', text: sample.text, model });
  if (sample.sampleAnswers) store.templates.update(t.id, { sampleAnswers: sample.sampleAnswers }, { silent: true });
  return t;
}
export function loadAllSamples() {
  let n = 0;
  for (const s of samples) { loadSample(s); n++; }
  return n;
}

function firstRun() {
  if (store.templates.list().length) return;
  if (sessionStorage.getItem('docassembly.firstRunShown')) return;
  sessionStorage.setItem('docassembly.firstRunShown', '1');
  const body = el('div',
    el('p', 'DocAssembly turns a template with merge fields and if/then logic into an automatic questionnaire, then produces a finished Word document. Everything stays in this browser.'),
    samples.length
      ? el('p', `Would you like to start with ${samples.length} sample template${samples.length === 1 ? '' : 's'} (engagement letter, will, and more)? You can delete them at any time.`)
      : el('p', 'Start by creating a new template, or import a .docx that already contains {[fields]}.'),
  );
  modal({
    title: 'Welcome to DocAssembly',
    body,
    buttons: samples.length
      ? [{ label: 'Start empty', value: 'empty' }, { label: 'Load sample templates', primary: true, value: 'samples', onClick: () => { const n = loadAllSamples(); toast(`Loaded ${n} sample templates`, 'ok'); dispatch(); } }]
      : [{ label: 'Get started', primary: true, value: 'ok' }],
  });
}

start();
firstRun();
