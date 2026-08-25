/**
 * @module ui-templates
 * #/templates — list, new, load sample, import .docx, duplicate, delete, export JSON.
 */
import * as store from './store.js';
import { el, clear, toast, confirm, prompt, modal, download, pickFile, readFileBytes, readFileText, fmtDate, safeFilename } from './components.js';
import { navigate } from './router.js';
import { variableCount, bytesToBase64, isWordTemplate } from './docgen.js';
import { readDocx, compile, createModel, extractTemplateText, textToBlocks, buildDocx } from './engine-api.js';
import { samples, loadSample, loadAllSamples } from './main.js';

export function renderTemplates(main) {
  clear(main);
  const list = store.templates.list();

  const actions = el('div.actions',
    el('button.btn', { type: 'button', onClick: importDocx }, 'Import .docx'),
    el('button.btn.btn-ghost', { type: 'button', title: 'A small Word file with {[ ]} tags: open it in Word to see how a Word template is written, then import it as a Word template', onClick: downloadExampleDocx }, 'Example Word template ↓'),
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
        el('button.btn.btn-ghost', { type: 'button', onClick: downloadExampleDocx }, 'Download example Word template'),
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
        el('td', el('a.rowlink', { href: `#/templates/${t.id}` }, el('span.name', t.name)), isWordTemplate(t) ? el('span.badge.badge-accent', { style: { marginLeft: '.4rem' }, title: `Word template — ${t.docxName || 'original .docx kept'}; tags are filled in place and all Word formatting is preserved` }, 'Word') : t.docxName ? el('span.badge', { style: { marginLeft: '.4rem' }, title: 'Converted from ' + t.docxName }, 'docx') : null, errs.length ? el('span.badge.badge-danger', { style: { marginLeft: '.4rem' }, title: errs[0].message }, `${errs.length} error${errs.length > 1 ? 's' : ''}`) : null),
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

/** Ask how to import a .docx: convert to editable text, or keep the Word file and fill its tags in place. */
export function chooseImportMode(fileName) {
  let choice = null;
  const m = modal({
    title: `Import ${fileName}`,
    body: el('div',
      el('div.import-choice',
        el('button.btn.import-mode', { type: 'button', onClick: () => { choice = 'convert'; m.close('ok'); } },
          el('strong', 'Convert to editable text template'),
          el('div.muted.small', 'The document becomes template text you edit here. Headings, bold/italic, lists and tables are kept in a simple markdown-like form; other Word formatting is dropped.')),
        el('button.btn.import-mode', { type: 'button', onClick: () => { choice = 'word'; m.close('ok'); } },
          el('strong', 'Keep as Word template'),
          el('div.muted.small', 'Preserves all Word formatting — styles, headers/footers, numbering, tables, fonts. The {[ ]} tags are resolved in place. Edit the tags in Word and re-upload the file.')),
      )),
    buttons: [{ label: 'Cancel', value: null }],
  });
  return m.promise.then((v) => (v === 'ok' ? choice : null));
}

/** Build a template from a Word file. mode: 'convert' | 'word'. Returns the stored template (throws on unreadable files). */
export async function templateFromDocx(bytes, fileName, mode) {
  const name = fileName.replace(/\.docx$/i, '');
  const text = mode === 'word' ? await extractTemplateText(bytes) : (await readDocx(bytes)).text;
  const c = compile(text || '');
  let model = { variables: {}, order: [] };
  try { if (!c.errors.length) model = createModel(c.analysis); } catch (e) { /* model later */ }
  const t = store.newTemplate({ name, text: text || '', model, docxName: fileName, ...(mode === 'word' ? { docxOrigin: bytesToBase64(bytes) } : {}) });
  return { template: t, errors: c.errors || [] };
}

export async function importDocx() {
  const file = await pickFile('.docx');
  if (!file) return;
  try {
    const bytes = await readFileBytes(file);
    const mode = await chooseImportMode(file.name);
    if (!mode) return;
    const { template: t, errors } = await templateFromDocx(bytes, file.name, mode);
    toast(`Imported "${t.name}"${mode === 'word' ? ' as a Word template' : ''}${errors.length ? ` with ${errors.length} syntax issue(s)` : ''}`, errors.length ? '' : 'ok');
    navigate(`/templates/${t.id}`);
  } catch (e) {
    console.error(e);
    toast('Could not read that .docx: ' + (e.message || e), 'error', 6000);
  }
}

/**
 * Text of the example Word template: the tutorial sample with every multi-line comment split into one
 * comment per line, so each {[ ]} tag stays inside a single Word paragraph.
 */
export function exampleWordTemplateText() {
  const s = samples.find((x) => x.id === 'tutorial') || samples[0];
  const src = s ? s.text : '# {[DocumentTitle]}\n\nThis agreement is made on {[SigningDate|format:"long"]} between {[Client.FullName]} and {[FirmName]}.\n';
  return src.replace(/\{\[#([\s\S]*?)\]\}/g, (m, body) => {
    if (!body.includes('\n')) return m;
    return body.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `{[# ${l} ]}`).join('\n');
  });
}

/** Build the example .docx on the fly (tags are literal text in the paragraphs) and download it. */
export async function downloadExampleDocx() {
  try {
    const bytes = await buildDocx(textToBlocks(exampleWordTemplateText()), { title: 'Example Word template' });
    download('example-word-template.docx', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
    toast('Open it in Word to see the tags, then import it with "Keep as Word template".', 'ok', 5000);
  } catch (e) {
    console.error(e);
    toast('Could not build the example: ' + (e.message || e), 'error', 6000);
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
