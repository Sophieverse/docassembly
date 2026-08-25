# Engine additions: validation rules, per-item computed fields, template annotations

These extend `engine/model.js` and `engine/analyze.js`. Every existing public API keeps its signature and behaviour; the additions are new optional fields on variable definitions, new keys on `analyze()` output and `questionnaire()` items, and a few new exports from `engine/index.js`.

## 1. Validation rules on variable definitions

A variable definition (`model.variables[path]`) may carry:

| Field | Applies to | Meaning |
| --- | --- | --- |
| `min`, `max` | number, currency, date | Inclusive bounds. For dates give an ISO string (`"2020-01-01"`); the answer may be in any accepted date format. A bound of the wrong kind (a number on a date) is ignored. |
| `minLength`, `maxLength` | text-like, and lists / multiselect | Characters for text, items for lists. |
| `pattern` | text, phone, email… | Regular-expression source (`"^\\d{3}-\\d{4}$"`); tested with `new RegExp(pattern).test(value)` — add `^`/`$` for a full match. |
| `validate` | any | An expression in the template language. Scope: the whole data object, plus `value` and `this` for the current answer. For a list item field, the item's fields are in scope first (shadowing top-level data) along with `_index`, `_first`, `_last`, `_count`. For a list variable, `value` is the array. |
| `message` | any | Custom error text. Replaces the default text of every failing **rule** on that variable (not the "is required" / type messages). |

`validate(model, data, { relevant?, requiredOnly? })` returns `[{ path, message }]` as before. Order per value: blank → required check only; then the type check (a malformed number/date/email/selection stops there, so rule errors never pile on top of a type error); then the rules above. With `requiredOnly: true` no type or rule checks run.

Default messages, prefixed with the variable's label:

```
Count must be at least 1                    Count must be at most 10
Start must be on or after 2020-01-01        End must be on or before 2030-12-31
Zip must have at least 5 characters         Members must have at most 2 items
Client — Phone must match pattern ^\d{3}-\d{3}-\d{4}$
Retainer is not valid (rule: this >= Hours * 100)
Hours: bad validation rule: …               Code: invalid pattern /(/
```

### Lists

- A rule on the **list variable** (`Members` with `validate: 'sum(Members, "Percent") = 100'`) reports on path `Members`.
- A rule on an **item field** (`Members[].Percent` with `min: 0, max: 100`) is checked per item and reports concrete paths: `Members[1].Percent`. Nested lists work the same way (`Trusts[0].Beneficiaries[2].Share`).
- `relevant` may mix generic and concrete item paths: `"Members[].Percent"` checks every item; `"Members[1].Percent"` checks only item 1. Omit `relevant` to check everything. (`relevantVariables().unanswered` already yields concrete paths; `relevant` yields generic ones — either works.)

## 2. Per-item computed fields

`computeDerived(model, data)` now also evaluates computed variables whose path is an item path:

```js
model.variables['Children[].IsMinor'] = { path: 'Children[].IsMinor', type: 'computed', formula: 'yearsBetween(DOB, today()) < 18', isListItemField: true, listPath: 'Children' };
model.variables['MinorCount'] = { path: 'MinorCount', type: 'computed', formula: 'count(Children|filter: IsMinor)' };
```

- The formula runs once per item with the item's fields in scope (shadowing top-level data), plus `_index`, `_index0`, `_first`, `_last`, `_count`, `_item`/`this`. The result is stored on the item (`data.Children[0].IsMinor`).
- Nested lists (`Trusts[].Beneficiaries[].Amount`) see the inner item first, then the outer item, then top-level data.
- Dependencies are resolved across both kinds: a top-level formula that reads `Children` (or `Children[].IsMinor`) runs after the per-item ones; an item formula may read another item computed field in the same list by bare name, or any top-level computed. Cycles produce `{ path, message: 'Circular formula: A → B → A' }` and never throw. A missing or non-array list is skipped silently. Orphaned computed variables are skipped.
- `isListItemField`/`listPath` are optional on the definition — the path's `[]` is enough.

## 3. Template annotations in comments

Attorneys can set questionnaire metadata from inside the template, so the template stays the single source of truth:

```
{[# @label Client.FullName: Client's full legal name]}
{[# @help IsMarried: Legally married at signing]}
{[# @options FeeType: Hourly | Flat | Contingency]}
{[# @default Firm.State: California]}
{[# @required Children[].DOB]}
{[# @type Retainer: currency]}
{[# @min Retainer: 0]}
{[# @validate Members: sum(Members, "Percent") = 100 :: Member percentages must total 100]}
```

Grammar: `@key Path[: value]`, one per line; a single comment may hold several lines (plain lines in the same comment are ignored). Keys are case-insensitive. Paths use the model's form (`Client.FullName`, `Children[].DOB`).

| Key | Value | Effect on the definition |
| --- | --- | --- |
| `@label` | text | `label` |
| `@help` | text | `help` |
| `@options` | `A \| B \| C` | `options`; a text variable becomes `selection` (unless `@type` says otherwise) |
| `@default` | text | `default`, coerced to the variable's type (`yes` → `true`, `1,500` → `1500`, `a \| b` for multiselect) |
| `@required` / `@optional` | none (or `false`) | `required` |
| `@type` | text, longtext, number, currency, date, boolean, selection, multiselect, email, phone, list, object, computed | `type` |
| `@min` / `@max` | number or ISO date | `min` / `max` (numeric text becomes a number) |
| `@minLength` / `@maxLength` | whole number | `minLength` / `maxLength` |
| `@pattern` | regex source | `pattern` (checked with `new RegExp`) |
| `@validate` | `expr [:: message]` | `validate`, and `message` when `::` is present |
| `@message` | text | `message` |
| `@formula` | expression | `formula`, and `type = computed`. Creates the variable if the template never prints it (e.g. `Children[].IsMinor`). |

### Where they show up

- `analyze(ast).annotations` — `Map<path, { label?, help?, options?, default?, required?, type?, min?, max?, minLength?, maxLength?, pattern?, validate?, message?, formula? }>` with typed values.
- `analyze(ast).annotationErrors` — `[{ message, line, col }]` for unknown keys, bad regexes, non-integer lengths, unknown types, or an empty `@validate`. `compile()` still returns `errors: []` for these; surface them as warnings in the editor.
- `createModel(analysis)` applies them. Each applied field is recorded in `def.fromTemplate[field] = value` so the UI can show "set in template".
- `mergeModel(existing, analysis)` applies them **unless the user edited that field in the UI**. Precedence per field: user edit > annotation > inference.
- Standalone helpers: `collectAnnotations(ast)`, `parseAnnotationLine(line)`, `applyAnnotations(model, annotations)`, `ANNOTATION_KEYS`, `ANNOTATABLE`.

### How "user edited" is decided

`mergeModel` treats a field as user-customized when either:

1. `def.custom` is `true` (legacy: every field frozen) or `def.custom[field] === true` (per-field flag), or
2. the stored value differs from **both** what inference produces (`humanize(path)` for label, `inferredType` for type, `inferredOptions` for options, the type's default for required, `''` for help, unset for the rest) **and** the value the last annotation set (`def.fromTemplate[field]`).

`def.custom[field] === false` forces "not customized". So the UI does not have to set flags for the heuristic to work, but setting `custom: { field: true }` on edit makes intent explicit (and is the only way to keep a user value that coincidentally equals the inferred one). An annotation removed from the template reverts the field to inference (label back to `humanize`, help to `''`, rules to unset); a `@formula`-created variable whose annotation disappears is orphaned like any other variable. User-created computed variables are still kept as before.

## 4. `questionnaire()` output

Each question now also carries, when set on the model definition: `min`, `max`, `minLength`, `maxLength`, `pattern`, `default`, `help` (already there), and `fromTemplate` (the map above) so the UI can flag template-sourced settings. Unset attributes are absent (empty string / null count as unset). Everything else about the question shape is unchanged.

## What the UI should do

1. **Input attributes** (`app/ui-fields.js`): map question fields onto the control — `min`/`max` on `<input type="number">` and `<input type="date">` (the date bound is already ISO), `minlength`/`maxlength` on text inputs and textareas, `pattern` on text/tel/email inputs, `value`/checked from `default` when the answer is blank, `required` as today. For lists, `minLength`/`maxLength` give the min/max item count (disable "Add" / "Remove" accordingly).
2. **Validation messages next to the field** (`app/ui-interview.js`, currently at the `validate(...)` call around line 250): call `validate(t.model, withDerived(t, data), { relevant })` where `relevant` is `relevantVariables(ast, data).relevant` plus, for lists, the concrete item paths on screen. Index the returned errors by `path`; item errors come back as `Members[1].Percent`, so key list-item controls by their concrete path (`itemFieldName` already produces those). Show `message` under the control and mark the field invalid; show list-level errors (`Members`) at the list header. Run this on blur/change of the field and once more on "Finish". Call `computeDerived` first (as `withDerived` does) so `validate` rules can reference computed values.
3. **Variables tab "set in template"** (`app/ui-editor.js` `drawVariables`): when `v.fromTemplate` has a key, render a small badge (e.g. "from template") next to that input and, on hover, the annotation text. Keep the inputs editable; when the user changes such an input, set `v.custom = { ...(v.custom || {}), [field]: true }` so the edit is kept on the next merge. Offer "Reset to template" that deletes `v.custom[field]` and re-runs `mergeModel`. Also add editors for the new rule fields (`min`, `max`, `minLength`, `maxLength`, `pattern`, `validate`, `message`) in the "⋯" extra row, and list `compiled.analysis.annotationErrors` (line-linked) with the syntax errors.
4. **Per-item computed fields**: the "Formula" editor already exists for `computed`; allow the path `Children[].IsMinor` when adding a computed variable (or let attorneys use `@formula` in the template). `computeDerived` handles the rest; per-item results appear on each item in the rendered data.

## 5. Inference fixes (attorney QA round)

All in `engine/analyze.js` unless noted; covered by `tests/engine-features-inference.test.js`.

1. **Has-value checks.** `{[if Court]} in the {[Court]}{[end if]}` (or `{[Court|upper]}`, `{[upper(Court)]}`, a comparison, a filter) infers **text**, not boolean. A variable is boolean only when its sole evidence is bare `{[if X]}` / `{[if not X]}` usage, or when the name says so (`Is*`, `Has*`, `Can*`, …), or when a printed use carries boolean evidence (`|format:"on":"off"`). Name hints (`Notes` → longtext, `Fee` → currency) still apply after the demotion.
2. **Selection threshold.** `X = "lit"` comparisons produce a `selection` only when at least **two distinct** literals are compared. One literal (`{[if State = "CA"]}…{[else]}`) → `text`; the literal is kept in `VarInfo.options` / `model.inferredOptions` as a suggestion and surfaces as `question.suggestions` (UI: `<datalist>`). `pronoun()` / `salutation()` still produce a gender selection.
3. **Whole filter chain.** `{[Day|default:"1"|ordinal]}` → number; `{[Fee|default:0|currency]}` → currency; `{[Start|default:"…"|format:"long"]}` → date; `{[Flag|default:false|format:"yes":"no"]}` → boolean; `{[Gender|lower|pronoun:"subject"]}` → selection. Function form works too (`ordinal(default(Day, "1"))`). A list reducer in the chain (`count`, `join`, `sum`, `first`…) types the result, not the list: `{[Kids|count|ordinal]}` keeps `Kids` a list.
4. **Options only on choice types.** `questionnaire()` attaches `options` only when the (model) type is `selection`/`multiselect`; for `text`/`longtext` it attaches `suggestions` instead when literals exist. `mergeModel` drops `options` when the user switches the type to a non-choice type (`inferredOptions` stay), and restores inferred options when the type goes back to `selection`. User-typed options on a variable whose type was not changed are kept.
5. **`humanize(path, type?)`.** Digit boundaries (`BuiltBefore1978` → "Built before 1978", `Address2` → "Address 2"), all-caps acronyms kept (`ROFRDays` → "ROFR days", `HOA.MonthlyFee` → "HOA — Monthly fee"), and with `type === 'boolean'` a trailing "?" is guaranteed (`humanize('Court', 'boolean')` → "Court?"). `createModel` / `questionnaire` use the type-aware form; `mergeModel` recognizes such labels as inferred (not user edits) when the type later changes.
6. **Lists of plain values.** A list with no item fields (`{[Names|join]}`, `{[list Tags]}{[_item]}{[end list]}`, `count(Pets)`) gets `VarInfo.itemType = 'text'`, copied to `def.itemType` and to the question as `{ type: 'list', itemType: 'text' }`. Lists whose body uses item fields (`{[list Kids]}{[Name]}{[end list]}`) have no `itemType`. UI: render an `itemType: 'text'` list as a simple repeatable text input (or textarea, one per line) producing `string[]`; `coerce(value, 'list')` still wraps a lone string.
7. **`{[N|blank]}`** (and `blank(N)`) no longer emits "Missing value: N" (`engine/evaluate.js`); the path is still traced for relevance.

## 6. Relevance and question order (fix round 2)

All in `engine/analyze.js` / `engine/expr.js`; covered by `tests/engine-fix2-relevance-order.test.js`.

### Relevance additions

- **Every-branch rule.** When a gate is unanswered, a variable referenced on *every* remaining path through the `if` (each branch from the undecidable one on, and the `else`) is relevant now and, if blank, unanswered. It is listed right after the gate's own variables, and it is not in `blockedBy`. Without an `else` nothing is certain. Nested `if`s count only when the variable is on every path of the inner `if` too; a list body never counts (the list may be empty) but the list expression's variables do. Engagement Letter: `Client.FullName` is asked before `Client.IsEntity` is answered.
- **Empty objects are unanswered.** `Client.Address: {}` (what `emptyData()` scaffolds) is treated like `undefined`: `{[if Client.Address]}` does not take the branch for relevance, and the evaluator traces `Client.Address` as missing. `truthy({})` is unchanged for expressions.
- **Full paths in the trace.** `{[Client.Address.Street]}` with `Client` present but `Address` absent used to be traced as `Client.Address`, so the street question disappeared as soon as any other `Client.*` answer existed. The evaluator now records the whole path.

### Question order

`questionnaire()` shows only the currently relevant questions, but their *order* is a property of the template, not of the answers, so answering never reorders what is already on screen — it only inserts. The order key is computed by `questionOrder(relevant, analysis)` (exported from `analyze.js`):

1. **Document position.** A variable sorts by its first reference anywhere in the template — field, condition or list expression, inside any branch, taken or not. Consequences: a condition's subjects always precede everything they gate; a variable used on every path through a gate follows the gate directly; a variable first printed deep in the document but used as a condition subject earlier sorts at that first condition.
2. **Object grouping.** Every question under the same top-level root (`Client.*`, including `Client.Address.*`; `Trusts[].*` with its list) moves up to the root's first appearance and keeps document order within the group. Top-level scalars are their own group. Last Will: `Testator.Gender`, printed only in the attestation, is asked with the other `Testator.*` questions.

The sort is stable, and both keys ignore the data, so `questionnaire(ast, data1)` and `questionnaire(ast, data2)` always agree on the relative order of the questions they share.

### Required inference

- A variable whose bare `{[if X]}` uses are has-value checks on a printed value (`{[if X]}…{[X]}`, `{[X|currency]}`, comparisons — anything that demotes it from boolean, or types it via a filter in the first place) gets `VarInfo.hasValueCheck = true` and `required: false` in `createModel`. The definition also carries `inferredRequired` so `mergeModel` can tell inference from a user edit: the user's `required` (or `custom.required`) and `@required`/`@optional` annotations win; a model saved before this change with the type default is treated as inference and re-inferred.
- `validate()` therefore no longer reports `Relationship: ''` when `Relationship` is only used as `{[if Relationship]}…{[Relationship]}…`.

### Per-item definitions without flags

`computeDerived` and `validate` derive list-item-ness from the `[]` in the path (`Kids[].Age`) when a hand-built definition lacks `isListItemField` / `listPath`; an explicit `isListItemField: false` without `listPath` is respected.

### What the UI must know

- `Question.required` can now be `false` for plain text variables; keep rendering the "optional" state from it (no `required` attribute, no blocking on Finish).
- Variable definitions gain `inferredRequired` (boolean) next to `inferredType` / `inferredOptions`; treat it as read-only. When the user toggles "required" in the Variables tab, set `custom.required = true` as for the other fields, otherwise a value equal to the inference is re-inferred on the next merge.
- Questions may appear *between* existing ones when a gate is answered (they slot into their document/group position) rather than only at the end; keep keys by `path`, not by index.
- DOCX import: `readDocx().text` no longer contains `**`, `*`, `__` or `\|` inside `{[ ]}` when Word split a placeholder across runs; a whole-field bold run still round-trips as `**{[X]}**`.

## 7. QA round 2 (attorney attack pass)

Covered by `tests/engine-qa2-attack.test.js`. Behaviour confirmed without changes: every-branch rule with `elseif` chains (a variable in 2 of 3 branches is blocked, one in all 3 is pre-asked); a false gate removes its branch variables and `validate(model, data, { relevant })` ignores their stale answers; selection gates (`FeeType` before `HourlyRate`); gates nested 4 deep open one level at a time; gate-and-printed variables ask once; `{[if count(Children) > 0]}`; per-item computed gates (`Children|any: IsMinor`) once `computeDerived` has run; question order is invariant under 200 random partial answer sets; `questionnaire()` on 100 variables / 50 gates runs in about 1 ms; the mergeModel precedence matrix (inference → annotation added / changed / removed, user edits with or without `custom` flags, `@formula` lifecycle) matches §3.

### Fixes

- **`message` reads once per field.** A custom `message` replaced the text of every failing rule, so a value failing `minLength` *and* `pattern` produced the same message twice on one path. `validate()` now dedupes identical messages per value (`engine/model.js` `ruleErrors`). Without `message`, each rule still reports separately.
- **`minLength` on an empty list.** `Members: []` is blank, so only the required check ran and `minLength: 1` ("at least one member") was never enforced. An empty array with `minLength > 0` now reports `Members must have at least 1 item` (or `message`), unless `requiredOnly`.
- **Top-level computed inside a list filter.** `count(Kids|filter: Age < Threshold)` collects `Kids[].Threshold`, so a top-level computed `Threshold` was not a dependency and could be evaluated *after* the count (order-dependent result). `computeDerived` now also treats the bare tail of an item path (`Threshold`, and `Kids[].Threshold` for item formulas) as a dependency candidate. Over-approximation only affects ordering.
- **`@default` is checked against the type** in `applyAnnotations`: booleans need yes/no/true/false, dates must parse (any accepted format, stored ISO), numbers/currency must be numeric (`1,500`, `$2,500.50` fine), selection/multiselect defaults must be among the options when options are known, and `list` / `object` / `computed` variables cannot have a default. A bad default is *not* applied and is reported (see "Where errors show up"). `@default X: today` is rejected with a hint — defaults are fixed values; use a computed variable with `today()`.
- **`@type X: object` on a printed leaf** (no `X.Something` in the template) used to make the question vanish silently. It is now an error and ignored. `@type X: list` on a leaf with no item fields sets `itemType: 'text'` so the UI renders a list of plain values.
- **`@validate` message separator** is the first `::` outside string literals, so `value != "a::b" :: Cannot be a::b` splits correctly and the message may contain `::`.

### Decisions (documented behaviour)

- **Annotation for a variable the template does not use**: a *warning* (`severity: 'warning'`) at the annotation's line, and the variable is **not** created — a stray `@label Client.Name` when the template says `Client.FullName` should be visible, not add an orphan to the Variables tab. `@formula` (and `@type … computed`) still create computed variables. Standalone `collectAnnotations(ast)` without the `variables` map cannot know what is unused and emits no such warning; `analyze()` passes its variables.
- **Same key twice for one path** (in one comment or across comments): the last one wins, with a warning naming the overridden line. `@required` and `@optional` count as the same key.
- **Bare paths inside a list body** resolve to the item field when the list has it: `{[list Children]}{[# @label DOB: …]}` annotates `Children[].DOB`; `{[list Children as Kid]}` accepts `Kid.DOB`. A bare path that is a top-level variable (and not an item field) stays top-level. The explicit form `Children[].DOB` works anywhere; a concrete index (`Children[0].DOB`) is normalised to `[]`.
- **Quotes**: one pair of matching surrounding `"…"` / `'…'` is stripped from `@label`, `@help`, `@message`, `@default`, the `::` message and each `@options` item. `@pattern`, `@validate` and `@formula` are taken verbatim.
- **Self-referencing formulas** (`Self: count(Kids|filter: Self)`, `Kids[].X: X + 1`) are not cycles: the name resolves to the value already stored in the data (so `X + 1` bumps a stored `X`, and an undefined `Self` filters to 0). Two-variable cycles, including through list filters, are still reported.
- **`@type` and `@formula` on the same path**: the variable is computed.

### Where errors show up

- `analyze(ast).annotationErrors` entries now carry `severity: 'error' | 'warning'` (syntax-level: unknown key, bad regex, bad length, unknown type, empty `@validate`; plus the unused-variable and duplicate-key warnings). They are sorted by line.
- Type-aware problems need the model, so `createModel()` and `mergeModel()` return `model.annotationErrors` — `[{ path, message, line, col, severity }]` — for bad `@default`s and `@type object` on a leaf. `applyAnnotations(model, annotations, errors?)` pushes into `errors` when given and into `model.annotationErrors` either way. The UI should show both lists together (`compiled.analysis.annotationErrors` and `tpl.model.annotationErrors`). Line numbers come from a non-enumerable `__pos` property on each annotation object (`annotations.get(path).__pos.default → { line, col, key }`); `Object.entries` / JSON never see it.
