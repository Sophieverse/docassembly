# Code review round 2 — engine/ (all reproduced; round-1 items verified fixed, no regressions)

1. HIGH blocks.js:257-259 `runsToInline` opens `**`/`*`/`__` before leading whitespace of a formatted run → literal asterisks after DOCX import (`Hello` + bold ` World` → `Hello** World**`). Fix: emit leading whitespace first; skip marker change if the rest is empty.
2. HIGH model.js:410-413 ReDoS — user `@pattern` compiled/run with no caps (`^(a+)+$` freezes the tab). Fix: cap pattern length ≤256, test `String(value).slice(0,4096)`, lint nested quantifiers at annotation time and in validate, memoise RegExp.
3. HIGH fill.js:757-758 + zipread.js:80 zip-bomb amplification: per-entry 50 MB cap but every entry inflated (300 KB → +383 MB RSS). Fix: package budget (256 MB) + entry-count cap (4096) in readZip; fillDocx passes non-template parts through precompressed (writeZipAsync "raw" branch).
4. MEDIUM model.js:473 multiselect validation ignores `{value,label}` option objects (also `@default` at model.js:161).
5. MEDIUM docxwrite.js:16-20 `escapeXml`: strip U+FFFE/U+FFFF and replace lone surrogates with U+FFFD.
6. LOW model.js:422 `@validate` uses JS truthiness; use template `truthy()` from expr.js.
7. LOW model.js:306,460 `Infinity` accepted as number/currency → `Number.isFinite` checks.
8. LOW analyze.js:114-129 `{[Client.constructor]}` compiles into an unanswerable variable → reject unsafe segments as a TemplateError in compile().errors.
9. LOW analyze.js:114-127 concrete-index reference (`{[Trusts[0].Name]}` before `{[list Trusts]}`) orders the item field before its list → ensure(parent) before variables.set.
