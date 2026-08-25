# Browser end-to-end journeys

Headless-Chrome journeys that drive the real app (no test framework, no npm dependencies): a hand-rolled
Chrome DevTools Protocol client (`cdp.js`), a static server for the repo root, and one script per user journey.

```
node tools/e2e/run.js            # run every journey, exit 1 if any console error / exception / FATAL
node tools/e2e/run.js j10 j11    # only journeys whose file name contains j10 or j11
CHROME=/path/to/chrome node tools/e2e/run.js
E2E_JOURNEYS=/some/dir node tools/e2e/run.js   # run journey scripts from another directory
```

`run.js` picks free ports, serves the repo, launches Chrome (`/Applications/Google Chrome.app` on macOS,
`google-chrome`/`chromium` on Linux, or `$CHROME`) with a throw-away profile, then runs the journeys in order
in separate Node processes. Each journey's output and screenshots go to `tools/e2e/out/` (git-ignored).

## Journeys

Journeys run in order and share the browser's localStorage, so later ones rely on the sample templates
`j1` loads (and `j3b` creates the record `j4b` reuses). `c.seed()` resets the store when a journey must
stand alone. A journey must end with `done(c)` (or `process.exit`) — an open CDP socket keeps Node alive, and the
runner kills a silent journey after 180 s and counts it as failed.

| File | Covers |
| --- | --- |
| `j1.js`  | First-run modal, loading the sample templates, editor Variables tab edit + reload |
| `j1b.js` | Variables-tab labels reach the interview |
| `j2.js`  | New template, syntax errors + line jump, toolbar inserts, preview tab |
| `j3.js`  | Will interview: relevance, lists, required-answer validation, Enter key |
| `j3b.js` | Generate → output page, DOCX download, print, records list, record export/import |
| `j4b.js` | Record editor save prunes empty values |
| `j5.js`  | Packages: create, include-if, package interview + output |
| `j6.js`  | Import a .docx as a template |
| `j7.js`  | Settings, light/dark contrast, export all / import (replace) |
| `j8.js`  | Unknown route, storage quota, corrupt-storage recovery |
| `j9.js`  | Keyboard: tab order, Enter behaviour, modal focus trap |
| `j10-validation.js` | Engine validation in the UI: LLC member percentages (list-level rule blocks Generate, 50/50 passes), min/max/pattern attributes, item-count gating, record editor warnings |
| `j11-annotations.js` | Template `@annotations`: "from template" badges, edit → reset to template, Rules editor, annotation warnings with line jump, Insert-annotation helper, help page |
| `j12-word-template.js` | Word-template mode: example .docx download → import ("Keep as Word template") → interview → output; the downloaded .docx has the answers, no tags left, Title style preserved; Replace Word file |

## Writing a journey

```js
const { connect, URL, fixture, outFile, done } = require('../lib.js');
(async () => {
  const c = await connect();                 // CDP client: c.goto, c.eval, c.click, c.type, c.key, c.shot, c.wait
  await c.seed();                            // optional: clean store + load sample templates
  await c.goto(URL + '#/interview/' + await c.findId('Last Will'));
  console.log(await c.eval('document.title'));
  c.report('open interview');               // prints ok/ERR with any console errors since the last report
  done(c);                                   // final report + exit code
})().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
```

`c.eval(expr)` returns JSON-serialisable values (promises are awaited). Console errors, uncaught exceptions
and failed network requests are collected between `c.report()` calls; every `ERR` line fails the run.
Fixtures (e.g. `.docx` files) live in `fixtures/`; files a journey generates go to `out/` via `outFile()`.
