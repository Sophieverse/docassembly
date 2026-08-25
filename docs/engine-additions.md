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
