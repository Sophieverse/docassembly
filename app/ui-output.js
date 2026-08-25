/**
 * @module ui-output
 * #/output/:templateId?record=ID and #/output/pkg/:packageId?record=ID — final document(s).
 */
import * as store from './store.js';
import { el, clear, toast, download, copyText, safeFilename } from './components.js';
import { renderTemplate, docxBlob, printBlocks } from './docgen.js';
import { resolveTargets, includeIfHolds } from './ui-interview.js';

export function renderOutput(main, ctx) {
  clear(main);
  const { targets, name, error, pkg, template } = resolveTargets(ctx.params);
  if (error || !targets.length) { main.appendChild(el('div.card', error || 'Nothing to generate.', ' ', el('a', { href: '#/templates' }, 'Back'))); return; }
  const record = ctx.query.record ? store.records.get(ctx.query.record) : null;
  const data = record ? record.data || {} : {};
  const backHash = (pkg ? `#/interview/pkg/${pkg.id}` : `#/interview/${template.id}`) + (record ? `?record=${record.id}` : '');

  const docs = [];
  for (const { template: t, includeIf } of targets) {
    if (!includeIfHolds(includeIf, data)) { docs.push({ template: t, skipped: true }); continue; }
    const r = renderTemplate(t, data);
    docs.push({ template: t, ...r, filename: safeFilename(record ? `${t.name} - ${record.name}` : t.name, 'docx') });
  }
  const included = docs.filter((d) => !d.skipped && !d.errors.length);
  const allWarnings = included.flatMap((d) => d.warnings.map((w) => (targets.length > 1 ? `${d.template.name}: ${w}` : w)));

  main.appendChild(el('div.page-head',
    el('a.btn.btn-ghost.btn-sm', { href: backHash }, '← Back to questionnaire'),
    el('h1', name), record ? el('span.muted', '· ', record.name) : el('span.badge.badge-warn', 'no record — blank answers'),
  ));

  const body = el('div');
  for (const d of docs) {
    if (targets.length > 1) body.appendChild(el('div.flex.mb.no-print', el('h2', { style: { margin: 0 } }, d.template.name),
      d.skipped ? el('span.badge.badge-warn', 'not included') : el('button.btn.btn-sm', { type: 'button', onClick: () => dl(d) }, 'Download .docx')));
    if (d.skipped) continue;
    if (d.errors.length) { body.appendChild(el('div.errors', 'This template has syntax errors and could not be generated: ', d.errors[0].message, ' ', el('a', { href: `#/templates/${d.template.id}` }, 'Open editor'))); continue; }
    body.appendChild(el('div.doc-host.mb', { html: d.html || '<div class="doc"><p>(empty document)</p></div>' }));
  }

  const side = el('div.output-side.no-print',
    included.length > 1
      ? el('button.btn.btn-primary', { type: 'button', onClick: () => { included.forEach((d, i) => setTimeout(() => dl(d), i * 400)); } }, `Download all (${included.length} .docx)`)
      : el('button.btn.btn-primary', { type: 'button', disabled: !included.length, onClick: () => dl(included[0]) }, 'Download .docx'),
    el('button.btn', { type: 'button', disabled: !included.length, onClick: () => {
      const blocks = included.flatMap((d, i) => (i ? [{ type: 'pagebreak' }] : []).concat(d.blocks));
      if (!printBlocks(blocks, name)) toast('Pop-up blocked — allow pop-ups for this page to print.', 'error');
    } }, 'Print / Save as PDF'),
    el('button.btn', { type: 'button', disabled: !included.length, onClick: async () => { await copyText(included.map((d) => d.text).join('\n\n')); toast('Copied document text', 'ok'); } }, 'Copy text'),
    el('button.btn', { type: 'button', onClick: () => location.hash = backHash }, 'Back to questionnaire'),
    record ? el('a.btn', { href: `#/records/${record.id}` }, 'Open record') : null,
    allWarnings.length
      ? el('div.warn-list.mt', el('strong', `${allWarnings.length} missing value${allWarnings.length === 1 ? '' : 's'}`), el('ul', allWarnings.map((w) => el('li', w))))
      : included.length ? el('div.badge.badge-ok.mt', 'All values supplied') : null,
  );
  main.appendChild(el('div.output-layout', body, side));

  async function dl(d) {
    try {
      download(d.filename, await docxBlob(d.blocks, d.template.name));
    } catch (e) {
      console.error(e);
      toast('Could not build .docx: ' + (e.message || e), 'error', 6000);
    }
  }
}
