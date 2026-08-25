/**
 * @module ui-packages
 * #/packages and #/packages/:id — ordered template sets with optional include-if expressions.
 */
import * as store from './store.js';
import { el, clear, toast, confirm, prompt, fmtDate } from './components.js';
import { navigate } from './router.js';

export function renderPackages(main, ctx) {
  const id = ctx && ctx.params && ctx.params.id;
  if (id) return renderPackage(main, id);
  clear(main);
  const list = store.packages.list();
  main.appendChild(el('div.page-head', el('h1', 'Packages'), el('span.muted', `${list.length} package${list.length === 1 ? '' : 's'}`),
    el('div.actions', el('button.btn.btn-primary', { type: 'button', onClick: async () => {
      const name = await prompt('Package name', { title: 'New package', placeholder: 'e.g. Estate planning bundle' });
      if (name == null) return;
      const p = store.newPackage({ name: name.trim() || 'New package' });
      navigate(`/packages/${p.id}`);
    } }, '+ New package'))));
  if (!list.length) {
    main.appendChild(el('div.card.empty', el('h2', 'No packages yet'), el('p', 'A package is an ordered set of templates that share one questionnaire and one record — for example a will, a power of attorney and a health-care directive generated together.')));
    return;
  }
  const tb = el('tbody');
  for (const p of list) {
    tb.appendChild(el('tr',
      el('td', el('a.rowlink', { href: `#/packages/${p.id}` }, el('span.name', p.name))),
      el('td.muted', (p.items || []).map((it) => (store.templates.get(it.templateId) || { name: '(missing)' }).name).join(', ')),
      el('td.muted.nowrap', fmtDate(p.updatedAt)),
      el('td', el('div.actions',
        el('button.btn.btn-sm', { type: 'button', disabled: !(p.items || []).length, onClick: () => navigate(`/interview/pkg/${p.id}`) }, 'Run'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => navigate(`/packages/${p.id}`) }, 'Edit'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', onClick: () => { store.duplicate('packages', p.id); renderPackages(main, {}); } }, 'Duplicate'),
        el('button.btn.btn-sm.btn-ghost', { type: 'button', style: { color: 'var(--danger)' }, onClick: async () => {
          if (await confirm(`Delete package "${p.name}"?`, { okLabel: 'Delete', danger: true })) { store.packages.remove(p.id); renderPackages(main, {}); }
        } }, 'Delete'),
      ))));
  }
  main.appendChild(el('div.table-wrap', el('table.list', el('thead', el('tr', el('th', 'Name'), el('th', 'Templates'), el('th', 'Updated'), el('th', ''))), tb)));
}

function renderPackage(main, id) {
  clear(main);
  const p = store.packages.get(id);
  if (!p) { main.appendChild(el('div.card', 'Package not found. ', el('a', { href: '#/packages' }, 'Back'))); return; }
  const items = p.items || [];
  const allTemplates = store.templates.list();

  main.appendChild(el('div.page-head',
    el('a.btn.btn-ghost.btn-sm', { href: '#/packages' }, '← Packages'),
    el('h1', p.name),
    el('div.actions',
      el('button.btn', { type: 'button', onClick: async () => { const n = await prompt('New name', { title: 'Rename package', value: p.name }); if (n && n.trim()) { store.packages.update(id, { name: n.trim() }); renderPackage(main, id); } } }, 'Rename'),
      el('button.btn.btn-primary', { type: 'button', disabled: !items.length, onClick: () => navigate(`/interview/pkg/${id}`) }, 'Run questionnaire'),
    )));

  const listHost = el('div');
  const card = el('div.card', el('h3', 'Templates in this package'),
    el('p.muted.small', 'Documents are generated in this order. "Include if" is an optional expression using the questionnaire variables, e.g. ', el('code', 'Client.IsMarried'), ' or ', el('code', 'count(Children) > 0'), '. Leave blank to always include.'),
    listHost);
  main.appendChild(card);

  const addSel = el('select', el('option', { value: '' }, '— add a template —'), allTemplates.map((t) => el('option', { value: t.id }, t.name)));
  addSel.addEventListener('change', () => {
    if (!addSel.value) return;
    items.push({ templateId: addSel.value, includeIf: '' });
    save(); addSel.value = ''; draw();
  });
  card.appendChild(el('div.mt', { style: { maxWidth: '380px' } }, addSel));

  function save() { store.packages.update(id, { items }); }
  function draw() {
    clear(listHost);
    if (!items.length) listHost.appendChild(el('p.muted', 'No templates yet — add one below.'));
    items.forEach((it, i) => {
      const t = store.templates.get(it.templateId);
      const cond = el('input', { type: 'text', placeholder: 'Include if (optional expression)', value: it.includeIf || '', class: 'mono', 'aria-label': 'Include if' });
      cond.addEventListener('change', () => { it.includeIf = cond.value.trim(); save(); });
      listHost.appendChild(el('div.pkg-item',
        el('span.handle', `${i + 1}.`),
        el('span', t ? el('a', { href: `#/templates/${t.id}` }, t.name) : el('span.badge.badge-danger', 'missing template')),
        cond,
        el('div.flex',
          el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Move up', disabled: i === 0, onClick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; save(); draw(); } }, '↑'),
          el('button.btn.btn-sm.btn-ghost', { type: 'button', title: 'Move down', disabled: i === items.length - 1, onClick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; save(); draw(); } }, '↓'),
          el('button.btn.btn-sm.btn-ghost', { type: 'button', style: { color: 'var(--danger)' }, onClick: () => { items.splice(i, 1); save(); draw(); } }, 'Remove'),
        )));
    });
  }
  draw();
}
