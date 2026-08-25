/**
 * @module ui-templates
 * #/templates — list, new, load sample, import .docx, duplicate, delete, export JSON.
 */
import * as store from './store.js';
import { el, clear, toast, confirm, prompt, modal, download, pickFile, readFileBytes, readFileText, fmtDate, safeFilename } from './components.js';
import { navigate } from './router.js';
import { variableCount } from './docgen.js';
import { readDocx, compile, createModel } from './engine-api.js';
import { samples, loadSample, loadAllSamples } from './main.js';

export function renderTemplates(main) {
  clear(main);
  const list = store.templates.list();

  const actions = el('div.actions',
    el('button.btn', { type: 'button', onClick: importDocx }, 'Import .docx'),
    el('button.btn', { type: 'button', onClick: importJson }, 'Import JSON'),
    samples.length ? el('button.btn', { type: 'button', onClick: pickSample }, 'Load sample') : null,
    el('button.btn.btn-primary', { type: 'button', onClick: createBlank }, '+ New template'),
  );
  main.appendChild(el('div.page-head', el('h1', 'Templates'), el('span.muted', `${list.length} template${list.length === 1 ? '' : 's'}`), actions));

  if (!list.length) {
    main.appendChild(el('div.card.empty',
      el('h2', 'No templates yet'),
      el('p', 'A template is ordinary document text with merge fields like ', el('code', '{[Client.FullName]}'), ' and conditions like ', el('code', '{[if Client.IsMarried]} … {[end if]}'), '. DocAssembly turns it into a questionnaire automatically.'),
      el('div.flex', { style: { justifyContent: 'center', flexWrap: 'wrap' } },
        el('button.btn.btn-primary', { type: 'button', onClick: createBlank }, 'Create a blank template'),
        samples.length ? el('button.btn', { type: 'button', onClick: () => { const n = loadAllSamples(); toast(`Loaded ${n} samples`, 'ok'); renderTemplates(main); } }, `Load ${samples.length} sample templates`) : null,
        el('button.btn', { type: 'button', onClick: importDocx }, 'Import a .docx'),
      ),
    ));
    return;
  }

  const search = el('input', { type: 'search', placeholder: 'Filter templates…', 'aria-label': 'Filter templates', style: { maxWidth: '320px' } });
  main.appendChild(el('div.mb', search));
  const table = el('table.list');
  main.appendChild(el('div.table-wrap', table));

  function draw() {
    const q = search.value.trim().toLowerCase();
    clear(table);
    table.appendChild(el('thead', el('tr', el('th', 'Name'), el('th', 'Description'), el('th.right', 'Variables'), el('th', 'Updated'), el('th', ''))));
    const tb = el('tbody');
    for (const t of list) {
      if (q && !(t.name + ' ' + (t.description || '')).toLowerCase().includes(q)) continue;
      const errs = compile(t.text || '').errors || [];
      tb.appendChild(el('tr',
        el('td', el('a.rowlink', { href: `#/templates/${t.id}` }, el('span.name', t.name)), t.docxOrigin ? el('span.badge', { style: { marginLeft: '.4rem' }, title: 'Imported from ' + t.docxOrigin }, 'docx') : null, errs.length ? el('span.badge.badge-danger', { style: { marginLeft: '.4rem' }, title: errs[0].message }, `${errs.length} error${errs.length > 1 ? 's' : ''}`) : null),
        el('td.muted', t.description || ''),
        el('td.right', String(variableCount(t))),
        el('td.muted.nowrap', fmtDate(t.updatedAt)),
        el('td', el('div.actions',
          el('button.btn.btn-sm', { type: 'button', onClick: () => navigate(`/interview/${t.id}`) }, 'Run'),
          el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => navigate(`/templates/${t.id}`) }, 'Edit'),
          el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Duplicate', onClick: () => { store.duplicate('templates', t.id); toast('Duplicated'); renderTemplates(main); } }, 'Duplicate'),
          el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Export JSON', onClick: () => exportTemplate(t) }, 'Export'),
          el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Delete', style: { color: 'var(--danger)' }, onClick: async () => {
            if (await confirm(`Delete "${t.name}"? This cannot be undone.`, { okLabel: 'Delete', danger: true })) { store.templates.remove(t.id); toast('Deleted'); renderTemplates(main); }
          } }, 'Delete'),
        )),
      ));
    }
    if (!tb.children.length) tb.appendChild(el('tr', el('td.muted', { colspan: 5 }, 'No templates match.')));
    table.appendChild(tb);
  }
  search.addEventListener('input', draw);
  draw();

  function createBlank() {
    const t = store.newTemplate({ name: 'Untitled template', text: '# {[DocumentTitle]}\n\nThis agreement is made on {[SigningDate|format:"MMMM d, yyyy"]} between {[Client.FullName]} ("Client") and {[FirmName]}.\n\n{[if Client.IsMarried]}The Client is married to {[Spouse.FullName]}.{[else]}The Client is unmarried.{[end if]}\n' });
    navigate(`/templates/${t.id}`);
  }

  async function pickSample() {
    const body = el('div.picker-list', samples.map((s) => el('button', { type: 'button', onClick: () => { m.close(); const t = loadSample(s); toast(`Loaded "${t.name}"`, 'ok'); navigate(`/templates/${t.id}`); } },
      el('span', el('strong', s.name), el('div.muted.small', s.description || '')))));
    const m = modal({ title: 'Load a sample template', body, buttons: [{ label: 'Load all', onClick: () => { loadAllSamples(); toast('Loaded all samples', 'ok'); renderTemplates(main); } }, { label: 'Cancel' }] });
  }
}

export async function importDocx() {
  const file = await pickFile('.docx');
  if (!file) return;
  try {
    const bytes = await readFileBytes(file);
    const { text } = await readDocx(bytes);
    const name = file.name.replace(/\.docx$/i, '');
    const c = compile(text || '');
    let model = { variables: {}, order: [] };
    try { if (!c.errors.length) model = createModel(c.analysis); } catch (e) { /* model later */ }
    const t = store.newTemplate({ name, text: text || '', model, docxOrigin: file.name });
    toast(`Imported "${name}"${c.errors.length ? ` with ${c.errors.length} syntax issue(s)` : ''}`, c.errors.length ? '' : 'ok');
    navigate(`/templates/${t.id}`);
  } catch (e) {
    console.error(e);
    toast('Could not read that .docx: ' + (e.message || e), 'error', 6000);
  }
}

export async function importJson() {
  const file = await pickFile('.json');
  if (!file) return;
  try {
    const parsed = JSON.parse(await readFileText(file));
    const items = Array.isArray(parsed) ? parsed : parsed.templates ? Object.values(parsed.templates) : [parsed];
    let n = 0;
    for (const it of items) {
      if (!it || typeof it.text !== 'string') continue;
      const existing = it.id && store.templates.get(it.id);
      if (existing) {
        if (!(await confirm(`A template named "${existing.name}" with the same id already exists. Overwrite it?`, { okLabel: 'Overwrite', danger: true }))) { delete it.id; }
      }
      store.templates.put({ ...it, model: it.model || { variables: {}, order: [] } });
      n++;
    }
    toast(`Imported ${n} template${n === 1 ? '' : 's'}`, 'ok');
    navigate('/templates');
    location.reload();
  } catch (e) {
    toast('Invalid JSON: ' + (e.message || e), 'error');
  }
}

export function exportTemplate(t) {
  download(safeFilename(t.name, 'template.json'), JSON.stringify(t, null, 2), 'application/json');
}
