/**
 * @module main
 * App bootstrap: theme, routes, first-run experience.
 */
import { route, start, navigate, dispatch } from './router.js';
import * as store from './store.js';
import { toast, modal, el } from './components.js';
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
store.subscribe((evt) => {
  if (evt.type === 'error') {
    toast(evt.quota ? 'Storage is full — could not save. Export your data and delete unused templates/records.' : 'Could not save to browser storage.', 'error', 6000);
  } else if (evt.kind === 'settings' || evt.kind === 'all') {
    updateFirm();
  }
});

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

/* ---------- first run ---------- */
export function loadSample(sample) {
  const t = store.newTemplate({ name: sample.name, description: sample.description || '', text: sample.text });
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
