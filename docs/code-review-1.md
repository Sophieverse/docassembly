# Code review round 1 — actionable findings (by area)

## engine/docx (owner: docx QA)
- HIGH docxread.js:35-38 `parseXml` infinite loop when `<!--`, `<?`, `<![CDATA[`, `<!` lack a terminator (indexOf -1 + n resets i before lt). Fix: `const e = xml.indexOf(term, lt); if (e < 0) { pushText(rest); break; } i = e + term.length;` Also break generic tag scan when `>` never found.
- LOW docxread.js:17 `unescapeXml` throws RangeError on out-of-range numeric entity → try/catch, return raw.
- LOW zipread.js:75 bound `uncompressedSize` (e.g. 50 MB) before inflating; guard sizes past buffer.
- MEDIUM html.js:75,79 font name injected into `<style>`; strip `< > ; { }` and whitelist `/^[\w \-]+$/`.
- LOW blocks.js:64-75 `hasCloser` O(n²) on marker-heavy lines — precompute closer positions per line.
- LOW blocks.js:18 `DECIMAL_RE` turns prose lines starting `a. `/`i. `/`x) ` into list items.

## engine (owner: engine QA)
- HIGH model.js:96-107 `mergeModel` drops user `default` (and any unknown user fields). Fix: `{ ...e, ...f, label..., }` carrying `default`.
- MEDIUM model.js:225-242 `setPath` (and analyze.js:272 `getPath`) prototype-pollutable via `__proto__`/`constructor`/`prototype` segments → reject; validate variable paths `/^[A-Za-z_$][\w$]*(\[\])?(\.[A-Za-z_$][\w$]*(\[\])?)*$/`.
- MEDIUM expr.js:394,426,565,575,592 registries are plain objects → `{[constructor]}`, `{[valueOf]}` resolve inherited members (`valueOf` prints function source). Use `Object.create(null)` / hasOwnProperty checks; reject constructor/prototype/__proto__.
- LOW model.js:177-178 `!options.requiredOnly === false` dead condition.
- LOW model.js:210-215 list-item validation ignores relevance.
- LOW expr.js:272 numeric-string equality: "01234" = "1234" true; coerce only when one side is an actual number.
- LOW evaluate.js:32 `formatValue` reformats any ISO-looking text as a date; prefer model type.
- LOW model.js:254 `computeDerived` skips list-item computed fields (feature gap: per-item computed).
- LOW functions.js:435 `initials()` returns "JD" but help says "J.D." — align (default to periods? pick one and document).

## app (owner: UI QA)
- HIGH store.js:24-38 corrupt localStorage JSON → empty state → next flush overwrites the only copy. Fix: stash raw to `KEY+'.corrupt-'+Date.now()`, keep rolling `KEY+'.prev'` on each successful flush, show recovery banner with download.
- MEDIUM store.js:100 `list()` `.localeCompare` on non-string `updatedAt` from imports crashes every list; sanitize imports (name/text/updatedAt/model shape) + `String(...)`.
- MEDIUM store.js:165-183 importAll: auto-stash exportAll() before merge/replace; report overwrites in merge.
- LOW store.js quota error toast re-fires per keystroke; debounce.
- MEDIUM ui-editor.js:94-124,368 recompile/autosave debouncers not flushed on navigation; register `setLeaveGuard` that flushes both and cancel timers on leave.
- MEDIUM ui-editor.js:117/245 `mergeModel` replaces `tpl.model` while Variables table closes over old `vars` (lastVarKeys guard) → label edits lost. Mutate in place or redraw.
- LOW ui-editor.js:308 logic map reads `u.condSrc` but dependencyMap emits `condition` → blank badge.
- LOW onbeforeunload assigned per view, never cleared (editor/interview/records).
- MEDIUM ui-interview.js:262-267 `setDefault` prototype-pollutable; reuse a hardened setPath.
- MEDIUM ui-interview.js:92,185-198 "Use sample answers"/"Load from record" overwrite dirty answers without confirm.
- MEDIUM ui-interview.js:72-76 defaults for `X[].Field` paths create literal "X[]" keys; skip and apply on Add item.
- LOW ui-interview.js:26-33 includeIf syntax error fails open; surface error in package editor.
- LOW a11y: error summary role=alert; progressbar aria; selection/multiselect `label for` → aria-labelledby; settings inputs need for/id; Variables table inputs aria-label; tabs role=tab.
- LOW ui-fields.js:266 list Remove without confirm when item has answers.
- LOW ui-records.js:149-152 raw JSON applied per keystroke → apply on blur/Apply button.
- LOW ui-settings.js: whitelist defaultFont; Reset should offer export first.
- LOW router.js:47 decodeURIComponent can throw → catch → /templates; router.js:54 use escapeHtml.
- LOW docgen.js:100-108 getPath own-property check.
- LOW components.js:104-107 wrap modal `onClick` in try/catch so a throwing handler doesn't strand the modal.
- LOW light theme `--fg-faint #8b93a5` on white ≈ 3.5:1 — darken to ≥4.5:1.

## Feature gaps noted (for a later wave)
Template version history/undo snapshots; fill-original-.docx-in-place mode; headers/footers/page numbers; sectioned interview + "why am I asked this" link; client→many matters; combined package download; validation rules (min/max/regex/date-after); per-item computed variables; re-import .docx into existing template; periodic backup reminder.
