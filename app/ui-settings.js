/**
 * @module ui-settings
 * #/settings — firm defaults, theme, export/import all, reset.
 */
import * as store from './store.js';
import { el, clear, toast, confirm, modal, download, pickFile, readFileText } from './components.js';
import { applyTheme } from './main.js';
import { FONTS, safeFont } from './docgen.js';

export function renderSettings(main) {
  clear(main);
  const s = store.getSettings();
  main.appendChild(el('div.page-head', el('h1', 'Settings')));

  const firm = el('input#set-firm', { type: 'text', value: s.firmName, placeholder: 'e.g. Walters & Associates, LLP' });
  const attorney = el('input#set-attorney', { type: 'text', value: s.attorneyName, placeholder: 'e.g. Ariel Walters, Esq.' });
  const curFont = safeFont(s.defaultFont);
  const font = el('select#set-font', FONTS.map((f) => el('option', { value: f, selected: f === curFont }, f)));
  const size = el('input#set-size', { type: 'number', min: 8, max: 24, step: 0.5, value: s.defaultFontSize });
  const theme = el('select#set-theme', [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match system']].map(([v, l]) => el('option', { value: v, selected: s.theme === v }, l)));

  const save = () => {
    const sz = Math.min(24, Math.max(8, Number(size.value) || 12));
    size.value = sz;
    const th = ['light', 'dark', 'system'].includes(theme.value) ? theme.value : 'light';
    store.updateSettings({ firmName: firm.value.trim(), attorneyName: attorney.value.trim(), defaultFont: safeFont(font.value), defaultFontSize: sz, theme: th });
    applyTheme(th);
  };
  for (const c of [firm, attorney, font, size, theme]) c.addEventListener('change', () => { save(); toast('Settings saved', 'ok', 1200); });

  const left = el('div',
    el('div.card',
      el('h3', 'Firm defaults'),
      el('p.muted.small', 'Available in every template as ', el('code', '{[FirmName]}'), ' and ', el('code', '{[AttorneyName]}'), ' (unless the record supplies its own values).'),
      el('div.field', el('label', { for: 'set-firm' }, 'Firm name'), firm),
      el('div.field', el('label', { for: 'set-attorney' }, 'Attorney name'), attorney),
    ),
    el('div.card',
      el('h3', 'Document output'),
      el('div.inline-fields',
        el('div.field', el('label', { for: 'set-font' }, 'Default font'), font),
        el('div.field', el('label', { for: 'set-size' }, 'Font size (pt)'), size),
      ),
      el('div.field', el('label', { for: 'set-theme' }, 'Theme'), theme),
    ),
  );

  const usage = store.storageUsage();
  const right = el('div',
    el('div.card',
      el('h3', 'Your data'),
      el('p.muted.small', `All templates, records and packages live in this browser's local storage (about ${(usage / 1024).toFixed(0)} KB used). Export regularly to keep a backup.`),
      el('div.flex.flex-wrap',
        el('button.btn.btn-primary', { type: 'button', onClick: () => download(`docassembly-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportAll(), 'application/json') }, 'Export all data'),
        el('button.btn', { type: 'button', onClick: () => importAll('merge') }, 'Import (merge)'),
        el('button.btn', { type: 'button', onClick: () => importAll('replace') }, 'Import (replace)'),
      ),
    ),
    el('div.card',
      el('h3', 'Reset'),
      el('p.muted.small', 'Deletes every template, record, package and setting from this browser.'),
      el('button.btn.btn-danger', { type: 'button', onClick: async () => {
        const exportNow = () => download(`docassembly-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportAll(), 'application/json');
        const choice = await modal({
          title: 'Reset app',
          body: el('div', el('p', 'This deletes every template, record, package and setting from this browser. It cannot be undone.'), el('p.muted.small', 'Export a backup first if you might want any of it back.')),
          buttons: [{ label: 'Cancel', value: null }, { label: 'Export backup first', value: 'export', onClick: () => { exportNow(); return false; } }, { label: 'Delete everything', value: 'reset', danger: true }],
        }).promise;
        if (choice !== 'reset') return;
        store.resetAll(); store.flush(); sessionStorage.clear();
        toast('All data cleared'); location.hash = '#/templates'; location.reload();
      } }, 'Reset app'),
    ),
    el('div.card',
      el('h3', 'About'),
      el('p.muted.small', 'DocAssembly — personal document automation. No server, no accounts; templates and answers never leave this machine. See ', el('a', { href: '#/help' }, 'Help'), ' for the template language.'),
    ),
  );
  main.appendChild(el('div.settings-grid', left, right));

  async function importAll(mode) {
    const file = await pickFile('.json');
    if (!file) return;
    try {
      const text = await readFileText(file);
      if (mode === 'replace' && !(await confirm('Replace ALL existing data with the contents of this file?', { okLabel: 'Replace', danger: true }))) return;
      const n = store.importAll(text, mode);
      store.flush();
      toast(`Imported ${n.templates} templates, ${n.records} records, ${n.packages} packages` + (n.overwritten ? ` (${n.overwritten} replaced)` : '') + (n.skipped ? ` — ${n.skipped} unreadable item${n.skipped === 1 ? '' : 's'} skipped` : ''), 'ok', 5000);
      setTimeout(() => location.reload(), 300);
    } catch (e) {
      toast('Import failed: ' + (e.message || e), 'error', 6000);
    }
  }
}
