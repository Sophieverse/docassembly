/**
 * @module ui-settings
 * #/settings — firm defaults, theme, export/import all, reset.
 */
import * as store from './store.js';
import { el, clear, toast, confirm, modal, download, pickFile, readFileText } from './components.js';
import { applyTheme } from './main.js';

const FONTS = ['Times New Roman', 'Georgia', 'Cambria', 'Garamond', 'Book Antiqua', 'Arial', 'Calibri', 'Helvetica', 'Verdana'];

export function renderSettings(main) {
  clear(main);
  const s = store.getSettings();
  main.appendChild(el('div.page-head', el('h1', 'Settings')));

  const firm = el('input', { type: 'text', value: s.firmName, placeholder: 'e.g. Walters & Associates, LLP' });
  const attorney = el('input', { type: 'text', value: s.attorneyName, placeholder: 'e.g. Ariel Walters, Esq.' });
  const font = el('select', FONTS.map((f) => el('option', { value: f, selected: f === s.defaultFont }, f)));
  if (!FONTS.includes(s.defaultFont) && s.defaultFont) font.appendChild(el('option', { value: s.defaultFont, selected: true }, s.defaultFont));
  const size = el('input', { type: 'number', min: 8, max: 24, step: 0.5, value: s.defaultFontSize });
  const theme = el('select', [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match system']].map(([v, l]) => el('option', { value: v, selected: s.theme === v }, l)));

  const save = () => {
    store.updateSettings({ firmName: firm.value.trim(), attorneyName: attorney.value.trim(), defaultFont: font.value, defaultFontSize: Number(size.value) || 12, theme: theme.value });
    applyTheme(theme.value);
  };
  for (const c of [firm, attorney, font, size, theme]) c.addEventListener('change', () => { save(); toast('Settings saved', 'ok', 1200); });

  const left = el('div',
    el('div.card',
      el('h3', 'Firm defaults'),
      el('p.muted.small', 'Available in every template as ', el('code', '{[FirmName]}'), ' and ', el('code', '{[AttorneyName]}'), ' (unless the record supplies its own values).'),
      el('div.field', el('label', 'Firm name'), firm),
      el('div.field', el('label', 'Attorney name'), attorney),
    ),
    el('div.card',
      el('h3', 'Document output'),
      el('div.inline-fields',
        el('div.field', el('label', 'Default font'), font),
        el('div.field', el('label', 'Font size (pt)'), size),
      ),
      el('div.field', el('label', 'Theme'), theme),
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
        if (!(await confirm('Really delete ALL data? Export first if you want a backup. This cannot be undone.', { okLabel: 'Delete everything', danger: true }))) return;
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
      toast(`Imported ${n.templates} templates, ${n.records} records, ${n.packages} packages`, 'ok', 5000);
      setTimeout(() => location.reload(), 300);
    } catch (e) {
      toast('Import failed: ' + (e.message || e), 'error', 6000);
    }
  }
}
