# DocAssembly Template Language

Templates are plain text (or imported .docx) with fields written between `{[` and `]}`.
Everything outside a field is copied to the output verbatim.

```
Dear {[Client.FullName]},

Thank you for retaining {[Firm.Name]}. Our fee is {[Fee|currency]} ({[Fee|dollars]}).
{[if Client.IsMarried]}
This letter also applies to your spouse, {[Spouse.FullName]}.
{[end if]}
Your children: {[list Children]}{[Name]} (born {[DOB|format:"long"]}){[_punc]}{[end list]}.

Signed {[SigningDate|format:"legal"]}.
```

With `{Client:{FullName:"Ann Lee", IsMarried:true}, Spouse:{FullName:"Bo Lee"}, Fee:1500, Children:[{Name:"Kim", DOB:"2012-03-14"}, {Name:"Lee", DOB:"2016-11-02"}], SigningDate:"2026-03-05", Firm:{Name:"Lee LLP"}}` this renders:

```
Dear Ann Lee,

Thank you for retaining Lee LLP. Our fee is $1,500.00 (One Thousand Five Hundred and 00/100 Dollars).
This letter also applies to your spouse, Bo Lee.
Your children: Kim (born March 14, 2012) and Lee (born November 2, 2016).

Signed the 5th day of March, 2026.
```

The app scans the template, discovers every variable and condition, and builds the questionnaire automatically. A question is only asked while some included part of the document needs it: `Spouse.FullName` above is asked only after `Client.IsMarried` is answered Yes.

## Fields

| Syntax | Meaning |
| --- | --- |
| `{[Name]}` | Insert a variable |
| `{[Client.Spouse.Name]}` | Nested object property |
| `{[Children[0].Name]}` | First item of a list (0-based) |
| `{[Fee|currency]}` | Apply a filter |
| `{[Fee|currency:"€":0]}` or `{[Fee|currency:"€",0]}` | Filter with arguments (`:` or `,` separate arguments) |
| `{[Name|trim|upper]}` | Filters chain left to right |
| `{[upper(Name)]}` | Same as a filter — `x|f:a` is `f(x, a)` |
| `{[# note to drafter]}` | Comment — never appears in output |

Variable names are case-sensitive but lookups fall back to a case-insensitive match, so `{[client.fullname]}` finds `Client.FullName`. Word's smart quotes are normalized inside fields, so pasting from Word is safe.

Values render as: text as-is · numbers as-is · booleans "Yes"/"No" · dates in the "long" format (`March 5, 2026`) · lists joined with ", " · objects by their `Name`/`FullName`. A missing value renders as empty text and produces a warning ("Missing value: Spouse.Name").

## Conditions

```
{[if Client.IsMarried]}
…married text…
{[else if Client.HasPartner]}
…partner text…
{[else]}
…single text…
{[end if]}
```

Keywords are case-insensitive. Accepted spellings: `if` · `else if` / `elseif` / `elif` · `else` · `end if` / `endif` / `end`.
Blocks nest freely. Inline use is fine too: `He is {[if Married]}married{[else]}single{[end if]}.`

**Blank-line rule:** when a block tag (`if`, `else`, `end if`, `list`, `end list`, comment) sits alone on a line, that whole line is removed, so conditional paragraphs never leave empty lines behind.

Only the tag's own line is removed — blank lines around the block are kept. So this layout leaves a double blank line when the block is skipped (the blank before `{[if]}` and the blank after `{[end if]}` both survive):

```
paragraph.

{[if X]}
optional paragraph.
{[end if]}

next paragraph.
```

Put the separating blank line *inside* the block instead, and nothing is left behind either way:

```
paragraph.
{[if X]}

optional paragraph.
{[end if]}

next paragraph.
```

The same applies inside a sentence: keep the leading space inside the tag (`due.{[if X]} Interest accrues.{[end if]} Next`) rather than before it, or a double space remains when the condition is false. Guard lists that may be empty (`{[if count(Children) > 0]}`), or an empty list prints "children: .".

Truthiness: empty text, `null`, `0`, `false`, and empty lists are false; everything else is true. A variable used *only* bare in conditions (`{[if IsMarried]}`, `{[if not HasKids]}`) is inferred to be a Yes/No question. A variable that is also printed, filtered, or compared (`{[if Court]} in the {[Court]}{[end if]}`) is read as a has-value check and stays a text question — see How the questionnaire is inferred.

Per-item list tests work in conditions too: `{[if Children|any: yearsBetween(DOB, today()) < 18]}…{[end if]}` needs no stored "IsMinor" answer.

## Lists

```
{[list Children]}
- {[Name]}, born {[DOB|format:"long"]}
{[end list]}
```

Accepted spellings: `list` / `repeat` / `foreach` … `end list` / `endlist` / `end repeat` / `endforeach` / `end`.
Inside the body, bare names resolve against the current item first, then the outer scope. Use `{[list Children as child]}…{[child.Name]}…` to name the item explicitly.

Special variables inside a list:

| Variable | Value |
| --- | --- |
| `_index` / `_index0` | 1-based / 0-based position |
| `_first` / `_last` | true on the first / last item |
| `_count` | number of items |
| `_item` / `this` | the item itself (useful for lists of plain values) |
| `_punc` | ", " between items, ", and " before the last of 3+, " and " for exactly 2, "" after the last |

`{[list Names]}{[_item]}{[_punc]}{[end list]}` → `Ann, Bo, and Cy`.

Lists can be filtered, sorted, and punctuated by example:

```
{[list Children|filter: Age < 18]}…{[end list]}
{[list Children|sort: -Age]}…{[end list]}
{[list Children|punc:"1; 2; or 3."]}{[Name]}{[_punc]}{[end list]}   → A; B; or C.
```

Lists nest: `{[list Trusts]}{[Name]}: {[list Beneficiaries]}{[Name]} ({[Share]}%){[_punc]}{[end list]}{[end list]}`.

## Expressions

Operators (lowest → highest precedence): `|` filters · `? :` ternary · `or` `||` · `and` `&&` · `not` · `= == != <>` · `< <= > >=` · `+ -` · `* / %` · unary `- !` · `.` `[ ]` `( )`.

- Literals: `42`, `3.5`, `"text"`, `'text'`, `true`, `false`, `null`
- Dates compare naturally: `{[if Deadline < "2026-01-01"]}`; `Date + 30` adds days; `DateA - DateB` gives days.
- Numeric strings compare as numbers: `"10" > "9"`.
- `=` is loose: `Flag = "true"` is true for boolean `true`.
- Ternary: `{[IsMarried ? "married" : "single"]}`
- Method style on values: `{[Name.toUpperCase()]}`, `{[Name.length]}`, `{[Tags.join("; ")]}`, `{[Fee.toInt()]}` — see Value methods.
- Namespaces: `date.today()`, `date.addDays(D, 30)`, `math.floor(x)`, `finance.PMT(rate, nper, pv)`.

Missing variables evaluate to empty (never an error) and are reported in the warnings/trace.

## Filters and functions

Every filter is also callable as a function with the value first: `{[Fee|currency:"€"]}` = `{[currency(Fee, "€")]}`. Names are case-insensitive. All functions tolerate missing input and return "" (or a neutral value).

### Text
`upper` · `lower` · `title` (Title Case Each Word) · `titlecaps` · `capitalize` (first letter only) · `initcap` (`initcap:true` lowercases the rest) · `trim` · `initials` ("John Doe" → "JD"; `initials:"."` → "J.D."; `initials:" "` → "J. D.") · `possessive` ("James" → "James'", "Mary" → "Mary's") · `len`/`length` · `contains` · `startswith` · `endswith` · `replace:"a":"b"` · `nbsp` · `blank` · `article` ("a"/"an") · `plural:"child"` → "children" (`plural(word, count)` returns singular for 1) · `quantity(3, "heir")` → "3 heirs" · `salutation(gender)` → Mr./Ms./Mx.

### Numbers and money
`currency` (`$1,234.50`; args symbol, decimals) · `number` (`1,234,567.89`; arg decimals) · `round` · `abs` · `min` · `max` · `words`/`cardinal` (`1234` → "one thousand two hundred thirty-four") · `ordinal` (`1` → "1st") · `ordinalwords`/`ordinalword` (`1` → "first") · `ordsuffix` (`22` → "nd") · `cardinaldec:2` (`12.35` → "twelve point three five") · `roman` · `alpha` (`27` → "aa")

Money in words — pick the house style:

| Filter | 1234.56 → |
| --- | --- |
| `dollars` | One Thousand Two Hundred Thirty-Four and 56/100 Dollars |
| `dollarsWords` | One Thousand Two Hundred Thirty-Four Dollars and 56/100 |
| `dollarsAndCents` | One Thousand Two Hundred Thirty-Four Dollars and Fifty-Six Cents |
| `dollarsFull` | One Thousand Two Hundred Thirty-Four Dollars and Fifty-Six Cents ($1,234.56) |
| `cardinalcur:"dollars":"cents"` | One Thousand Two Hundred Thirty-Four Dollars and Fifty-Six Cents |
| `cents` | 56 |

### Dates
Accepted input: `2026-03-05`, `3/5/2026`, `March 5, 2026`, `5 March 2026`, Date objects. Dates are treated as local calendar dates — no timezone drift.

`format:"…"` presets: `long` (March 5, 2026) · `short` (3/5/2026) · `legal` (the 5th day of March, 2026) · `iso` · `medium` (Mar 5, 2026) · `full` (Thursday, March 5, 2026).

Tokens: `yyyy`/`YYYY` `yy`/`YY` · `MMMM` `MMM` `MM` `M` · `dd`/`DD` `d`/`D` `Do` (5th) · `EEEE`/`dddd` (Thursday) `EEE`/`ddd`/`E` (Thu). Literal text goes in `[brackets]` or `'quotes'`: `format:"Do [day of] MMMM, YYYY"`.

Format by example — write the date the way you want it: `format:"June 3, 1990"`, `"3 June 1990"`, `"06/03/1990"`, `"6/3/90"`, `"June 3rd, 1990"`, `"3rd day of June, 1990"`, `"Monday, June 3, 1990"`, `"1990-06-03"`.

Date math: `today()` · `addDays` · `addMonths` · `addYears` · `addWeeks` · `subDays` · `yearsBetween(a, b)` / `age(DOB)` · `dateDiffDays` · `monthsBetween` · `year` · `month` · `day` · `monthName` · `weekday`. Namespace form: `date.today()`, `date.parse(t)`, `date.new(y,m,d)`, `date.addDays/subDays/addMonths/addYears(d,n)`, `date.age(d)`, `date.dayOf/monthOf/yearOf/dayOfWeek(d)`, `date.daysBetween/monthsBetween/yearsBetween(a,b)`.

### Format by example for numbers and text
`format` also infers from an example: `format:"9,999.00"` → 1,234.50 · `"$9,999.00"` · `"9,999.99%"` · `"0,0.00"` · `"0%"` · `"nine"` / `"Nine"` / `"NINE"` (words) · `"3rd"` (ordinal) · `"third"` / `"Third"` · `"Nine Dollars and Twelve Cents"` · `"Nine Dollars and 9/100"` · `"Nine and 9/100 Dollars"`. For text: `format:"LIKE THIS"`, `"Like This"`, `"like this"`. For booleans: `format:"heads":"tails"`.

### Grammar helpers
`pluralize(count, "child", "children")` → "3 children" (third argument `true` omits the number: `{[count(Children)|pluralize:"child","children",true]}` → "children") · `isAre` · `hasHave` · `doesDo` · `wasWere` (take a count or a list) · `pronoun(gender, form)` with forms `subject` / `object` / `possessive` / `possessiveadj` / `reflexive` (he/him/his/his/himself · she/her/hers/her/herself · they/them/theirs/their/themselves).

### Lists
`join` (`A, B, and C`; args conjunction, oxford) · `punc:"1, 2, and 3"` (join by example; trailing "." kept) · `count` · `sum(list, "Field")` · `any` · `all` · `first` · `last` · `sort(list, "Field", "desc")` · `filter(list, "Field", value)` · `find` · `map`/`pluck` · `group` · `unique` · `reverse` · `list(a, b, c)` literal.

Per-item expressions — unquoted arguments are evaluated for each item, with bare names resolving to the item, `this` = the item, and `_result` = the accumulator:

```
{[Children|filter: Age < 18|map: Name|join]}
{[Children|find: Role == "Executor"]}
{[Children|any: Age >= 18]}   {[Children|every: Age >= 18]}
{[Children|sort: +LastName : -FirstName]}
{[Children|group: date.yearOf(DOB)]}      → items {_key, _values}
{[Children|reduce: _result + Cost : 0]}
{[sum(Items, Qty * Price)|currency]}
```

### Logic
`default:"fallback"` / `else:"fallback"` (replace empty text/null only — `0` and `false` are *not* replaced, and `{[X|currency|default:…]}` never fires because `currency(0)` is "$0.00"; use `{[if X > 0]}` for numeric fallbacks) · `coalesce(a, b, c)` · `isEmpty` · `if(cond, a, b)` · ternary `cond ? a : b`. Booleans add up in arithmetic, so section numbers can be computed: `# {[5 + (IncludeWaiver ? 1 : 0)]}. Termination` or `# ARTICLE {[roman(3 + (PetTrust ? 1 : 0))]}`.

### Value methods
Call these with dot syntax on any value: `.toUpperCase() .toLowerCase() .trim() .length .includes(x) .startsWith(x) .endsWith(x) .replace(a, b) .split(sep) .slice(a, b) .substring(a, b) .indexOf(x) .padStart(n, c) .padEnd(n, c) .toInt() .toFixed(n) .first(n) .last(n) .join(sep) .filter(expr) .map(expr) .sort(expr)`.

### Finance
`finance.PMT(rate, nper, pv, fv, type)`, `PV`, `FV`, `NPER`, `RATE` with Excel semantics (rate per period; payments are negative outflows).

### Custom functions
`registerFunction("shout", s => s.toUpperCase() + "!")` makes `{[Name|shout]}` available everywhere.

## Template annotations

Questionnaire metadata can live in the template itself, so the template stays the single source of truth. Put `@key Path: value` lines inside a comment, one per line; a single comment may hold several, and plain lines in the same comment are ignored. Keys are case-insensitive. Paths use the model's form (`Client.FullName`, `Children[].DOB`).

```
{[# @label Client.FullName: Client's full legal name
@help IsMarried: Legally married at signing
@options FeeType: Hourly | Flat | Contingency
@default Firm.State: California
@required Children[].DOB
@type Retainer: currency
@min Retainer: 0
@validate Members: sum(Members, "Percent") = 100 :: Member percentages must total 100
@formula Children[].IsMinor: yearsBetween(DOB, today()) < 18]}
```

| Key | Value | Effect on the variable |
| --- | --- | --- |
| `@label` | text | question label |
| `@help` | text | help text under the question |
| `@options` | `A \| B \| C` | choice list; a text variable becomes a `selection` (unless `@type` says otherwise) |
| `@default` | text | default answer, coerced to the variable's type (`yes` → true, `1,500` → 1500; `a \| b` for multiselect) |
| `@required` / `@optional` | none, or `false` / `no` / `0` / `off` | required flag |
| `@type` | `text` `longtext` `number` `currency` `date` `boolean` `selection` `multiselect` `email` `phone` `list` `object` `computed` | type |
| `@min` / `@max` | number, or ISO date (`2020-01-01`) | bounds (see Validation rules) |
| `@minLength` / `@maxLength` | whole number | character count for text, item count for lists |
| `@pattern` | regular-expression source | pattern the text must match |
| `@validate` | `expression [:: message]` | rule expression; the part after `::` becomes the error message |
| `@message` | text | custom error text for every failing rule on that variable |
| `@formula` | expression | makes the variable `computed`; creates it if the template never prints it (`Children[].IsMinor`) |

With the comment above, `createModel(compile(text).analysis)` yields `FeeType` as `{type: "selection", options: ["Hourly","Flat","Contingency"]}`, `Firm.State` with `default: "California"`, `Retainer` as `currency` with `min: 0`, `Members` with `validate` and `message`, and a new computed variable `Children[].IsMinor` (label "Children — Is minor?"). Each value that came from the template is also recorded in `def.fromTemplate` (e.g. `{type: "currency", min: 0}` on `Retainer`) and copied onto the question as `question.fromTemplate`, so a UI can show "set in template".

Mistakes never break compilation: `compile()` still returns `errors: []`, and the problems land in `analysis.annotationErrors` as `[{message, line, col}]`. Reported: an unknown key (`@bogus X: 1` → "Unknown annotation @bogus (known: @label, @help, …)"), an invalid regex (`@pattern Zip: (` → "@pattern Zip: invalid regular expression: …"), a non-integer length (`@maxLength Zip: two` → '@maxLength Zip: expected a whole number, got "two"'), an unknown `@type`, and an empty `@validate`. An annotation for a variable the template never uses is ignored, except `@formula`/`@type computed`, which create the variable.

Precedence per field is **user edit in the Variables panel > annotation > inference**. `mergeModel(existing, analysis)` re-applies annotations after every template change unless the user edited that field in the UI (an explicit `custom: {label: true}` flag, or a stored value that differs from both what inference produces and what the last annotation set). Removing an annotation from the template reverts the field to inference: delete the `@help IsMarried` line and the help goes back to `""`. A variable created by `@formula` whose annotation disappears is orphaned like any other unused variable.

## Validation rules

Rules live on the variable definition (`model.variables[path]`), set either in the Variables panel or with the annotations above.

| Field | Applies to | Meaning |
| --- | --- | --- |
| `min`, `max` | number, currency, date | Inclusive bounds. Dates take an ISO string (`"2020-01-01"`); the answer may be in any accepted date format. A bound of the wrong kind (a number on a date) is ignored. |
| `minLength`, `maxLength` | text-like; lists and multiselect | Characters for text, items for lists. |
| `pattern` | text, phone, email… | Regular-expression source, tested with `new RegExp(pattern).test(value)` — add `^`/`$` for a full match. |
| `validate` | any | An expression in the template language. Scope: the whole data object plus `value` / `this` for the current answer. For a list item field the item's fields come first (shadowing top-level data) along with `_index`, `_first`, `_last`, `_count`; for a list variable `value` is the array. Falsy result (or empty text / empty list) = invalid. |
| `message` | any | Custom error text. Replaces the default text of **every** failing rule on that variable (not the "is required" / type messages). |

`validate(model, data, { relevant?, requiredOnly? })` returns `[{path, message}]`. Per value the order is: blank → only the required check; then the type check (a malformed number/date/email/selection stops there, so rule errors never pile on top of a type error); then the rules. With `requiredOnly: true` only missing required answers are reported.

```
{[# @min Hours: 1
@max Hours: 10
@min StartDate: 2020-01-01
@minLength Zip: 5
@pattern Client.Phone: ^\d{3}-\d{3}-\d{4}$
@validate Retainer: this >= Hours * 100
@validate Members: sum(Members, "Percent") = 100 :: Member percentages must total 100
@min Members[].Percent: 0
@max Members[].Percent: 100]}
```

With `{Hours: 12, StartDate: "3/5/2019", Zip: "9410", Client: {Phone: "555-1234"}, Retainer: 500, Members: [{Percent: 60}, {Percent: 150}, {Percent: -10}]}`, `validate(model, data)` reports (messages are prefixed with the variable's label):

```
Hours            Hours must be at most 10
StartDate        Start date must be on or after 2020-01-01
Zip              Zip must have at least 5 characters
Client.Phone     Client — Phone must match pattern ^\d{3}-\d{3}-\d{4}$
Retainer         Retainer is not valid (rule: this >= Hours * 100)
Members          Member percentages must total 100
Members[1].Percent   Members — Percent must be at most 100
Members[2].Percent   Members — Percent must be at least 0
```

Other messages you may see: `Hours must be a number` (type check; `Hours: "abc"`), `Hours is required` (blank), `Hours: bad validation rule: …` (the expression does not parse), `Zip: invalid pattern /(/`.

Lists:

- A rule on the **list variable** (`Members`) reports on path `Members`. Because `message` replaces every failing rule's text, a list with both `@validate … :: msg` and `@maxLength` reports `msg` twice when both fail — give such a list one rule, or use the default texts.
- A rule on an **item field** (`Members[].Percent`) is checked per item and reports concrete paths (`Members[1].Percent`). Nested lists work the same way (`Trusts[0].Beneficiaries[2].Share`).
- `relevant` may mix generic and concrete paths: `relevant: ["Hours", "Members[1].Percent"]` checks `Hours` and only item 1's percent (`"Members[].Percent"` would check every item). Omit `relevant` to check everything. `relevantVariables().relevant` gives generic paths and `.unanswered` concrete ones — either works.

Rules can reference computed values, so run `computeDerived` first and validate the result.

## Computed variables

A variable of type `computed` with a `formula` is evaluated from the other answers instead of being asked. Define it in the Variables panel, with `@formula` in the template, or directly on the model:

```js
model.variables.MinorCount = { path: 'MinorCount', type: 'computed', formula: 'count(Children|filter: IsMinor)' };
model.variables['Children[].IsMinor'] = { path: 'Children[].IsMinor', type: 'computed', isListItemField: true, formula: 'yearsBetween(DOB, today()) < 18' };
```

`computeDerived(model, data)` returns `{ data, errors }` — a copy of the data with every formula filled in, never a throw. Top-level formulas are stored on the data (`data.MinorCount`); **per-item** formulas (path containing `[]`) run once per list item with the item's fields in scope first (shadowing top-level data) plus `_index`, `_index0`, `_first`, `_last`, `_count`, `_item`/`this`, and the result is stored on each item. Given

```
{[# @formula Children[].IsMinor: yearsBetween(DOB, today()) < 18
@formula MinorCount: count(Children|filter: IsMinor)
@formula Children[].Label: Name + " (#" + _index + " of " + _count + ")"]}
```

and `{Children: [{Name: "Kim", DOB: "2012-03-14"}, {Name: "Lee", DOB: "1999-11-02"}]}`, the derived data is

```
{Children: [{Name: "Kim", DOB: "2012-03-14", IsMinor: true,  Label: "Kim (#1 of 2)"},
            {Name: "Lee", DOB: "1999-11-02", IsMinor: false, Label: "Lee (#2 of 2)"}],
 MinorCount: 1}
```

- Formulas run in dependency order across both kinds: `MinorCount` reads `Children`, so it runs after `Children[].IsMinor`; an item formula may use another item computed field of the same list by bare name, or any top-level computed.
- Nested lists (`Trusts[].Beneficiaries[].Amount` with formula `Corpus * Share / 100`) see the inner item first, then the outer item (`Corpus`), then top-level data.
- A cycle yields `{path: "A", message: "Circular formula: A → B → A"}`; a formula that fails to parse yields `Bad formula: …`; a runtime failure yields `Formula error: …` on the concrete path.
- A missing or non-array list is skipped silently. Orphaned computed variables are skipped. Computed variables never appear in the questionnaire and are never validated.
- When you build the definition by hand, set `isListItemField: true` on a per-item path (`createModel`/`@formula` do this for you); without it the path is treated as top-level. `listPath` is optional.

## Questionnaire generation and relevance

`questionnaire(ast, data, model?)` returns the questions to ask **right now**, in template order, one per variable:

```js
[{ path, label, type, required, answered, options?, suggestions?, itemType?, listPath?, help?,
   min?, max?, minLength?, maxLength?, pattern?, default?, fromTemplate? }]
```

- `type` and `label` come from the model when given, else from inference (`humanize(path, type)`). Without a model every question is `required: true`; with a model, `required` follows the definition (booleans, lists and computed default to not required).
- `options` is present only for `selection` / `multiselect`. For `text` / `longtext` the literals the template compares against surface as `suggestions` instead (render as a `<datalist>`).
- `itemType: "text"` marks a list of plain values (`{[Names|join]}`, `{[list Tags]}{[_item]}{[end list]}`, `count(Pets)`): render it as a repeatable text input producing `string[]`. Lists whose body uses item fields have no `itemType`, and their fields appear as their own questions (`Kids[].Name` with `listPath: "Kids"`) once the list has items.
- `answered` is false while any relevant concrete value is blank — for an item field, while any item is missing it.
- `object` and `computed` variables and orphaned definitions are never questions.

Relevance: a variable is asked when it appears in a field whose enclosing conditions are currently true, in a condition that has been reached, or in a list body for a list that has items. If a condition depends on unanswered variables, the questions inside it wait until the condition can be evaluated. Order follows first appearance in the template. For

```
{[Client.Name]}{[if Client.IsMarried]}{[Spouse.Name]}{[end if]}{[if State = "CA"]}{[CAForm]}{[end if]}
{[list Names]}{[_item]}{[end list]}{[list Kids]}{[Name]}{[end list]}
```

with `{Client: {Name: "A"}, Kids: [{}, {Name: "B"}]}`, `relevantVariables(ast, data)` gives

```
relevant:   Client.Name, Client.IsMarried, State, Names, Kids, Kids[].Name
unanswered: Client.IsMarried, State, Names, Kids[0].Name
blockedBy:  Spouse.Name ← Client.IsMarried        CAForm ← State = "CA"
```

`Spouse.Name` and `CAForm` are not asked yet; once `Client.IsMarried` is Yes and `State` is `CA`, both join the questionnaire in their template positions. `blockedBy` lists, for each waiting variable, the condition source that must be decided first; `values` holds every referenced concrete value. `dependencyMap(ast)` gives the designer's view — for each variable, the `if`/`list` blocks it gates and which variables they contain.

## How the questionnaire is inferred

Every variable gets a type, and choice types get options, from how the template uses it. Stronger evidence wins (a filter beats a name hint), and the first-seen use does not matter.

| Template usage | Inferred type |
| --- | --- |
| `{[if X]}`, `{[if not X]}` as the *only* use, or `X = true`, or `\|format:"yes":"no"` | boolean (Yes/No) |
| names starting with Is / Has / Can / Should / Will / Does / Did / Wants / Needs / Include(s) (`IsMarried`, `HasChildren`) | boolean, whatever else the template does with it |
| `\|currency`, `\|dollars`, `\|dollarsWords`, `\|cents` …, names ending in Amount / Fee / Price / Cost / Salary / Rent / Value / Total / Balance / Payment / Deposit / Retainer / Wage / Income / Principal / Debt / Damages … | currency |
| `\|number`, `\|ordinal`, `\|words`, `\|round`, `\|roman`, `\|pluralize` …, `X > 5`, names ending in Count / Number / Num / Qty / Percent / Age / Years / Months / Days / Term / Shares / Units / Hours | number |
| `\|format:"long"` (any non-numeric format), date functions (`addDays`, `age`, `yearsBetween`, `year` …), `X < "2026-01-01"`, names ending in Date / DOB / Birthday / Deadline / Expires / Expiration | date |
| `{[list X]}`, `count(X)`, `X\|join`, `X\|filter: …` and other list functions | list (`itemType: "text"` when the body/usage never touches item fields) |
| `X.Y` | X is an object |
| `X = "CA"` and `X = "NY"` — at least **two distinct** literals | selection with those options |
| `X = "CA"` alone | text, with `CA` offered as a suggestion |
| `pronoun(X, …)`, `salutation(X)`, names ending in Gender / Sex | selection `male` / `female` / `neutral` |
| names ending in Description / Notes / Comments / Narrative / Recitals / Purpose / Address / Terms / Summary / Reason / Details | long text |
| names ending in Email; names ending in Phone / Telephone / Mobile / Fax | email; phone |
| everything else | text |

Name hints are camel-case aware (`StartDate` matches, `Candidate` does not) and only apply when no filter/comparison evidence is stronger.

Has-value checks: `{[if Court]} in the {[Court]}{[end if]}` (or `{[Court|upper]}`, a comparison, a function call) infers **text**, not boolean — a bare condition on a variable that is also printed is read as "has a value". `{[if Notes]}{[Notes]}{[end if]}` is long text by name. The demotion does not happen when the name says boolean (`{[if HasKids]}{[HasKids]}{[end if]}` stays Yes/No) or when a printed use carries boolean evidence (`{[Flag|format:"on":"off"]}`).

Whole filter chains are read: `{[Day|default:"1"|ordinal]}` → number, `{[Fee|default:0|currency]}` → currency, `{[Start|default:"…"|format:"long"]}` → date, `{[Flag|default:false|format:"yes":"no"]}` → boolean, `{[Gender|lower|pronoun:"subject"]}` → selection; function form works too (`ordinal(default(Day, "1"))`). A list reducer in the chain types the result, not the list: `{[Kids|count|ordinal]}` keeps `Kids` a list.

Inside a list body, any name not defined at the top level of the template is assumed to be a field of the list item: in `{[Firm]}{[list Kids]}{[Name]} {[Firm]} {[Other]}{[end list]}`, `Name` and `Other` become `Kids[].Name` / `Kids[].Other` while `Firm` stays global. To reference a global variable from inside a list, reference it somewhere outside the list too (or use the `as` alias to make item fields explicit).

Labels come from `humanize(path, type)`: `SigningDate` → "Signing date", `Client.IsMarried` → "Client — Is married?", `BuiltBefore1978` → "Built before 1978", `Address2` → "Address 2", `ROFRDays` → "ROFR days", `HOA.MonthlyFee` → "HOA — Monthly fee", `Children[].DOB` → "Children — DOB"; a boolean always ends with "?" (`humanize("Court", "boolean")` → "Court?").

Overriding: anything inferred can be changed with a template annotation (`@type`, `@options`, `@label` …) or in the Variables panel; those edits survive template changes (see Template annotations for precedence). Switching a variable from `selection` to a non-choice type in the UI drops its `options` (the inferred ones are kept as suggestions and restored if the type goes back to `selection`). Caveats:

- `pronoun`/`salutation` infer the options `male`/`female`/`neutral` (matching is case-insensitive; `Nonbinary` also works). Relabel the options if you prefer.
- A list used only with `|join` (a list of plain values) is inferred as `list`; set it to `multiselect` with options if it should be a pick-many question.
- `{[N|blank]}` traces `N` for relevance but never warns "Missing value".

## Coming from Knackly

Most Knackly templates run unchanged. Supported equivalents:

| Knackly | Here |
| --- | --- |
| `{[if X]} … {[elseif Y]} … {[else]} … {[endif]}` | same (also `else if`, `elif`, `end if`) |
| `{[list X]} … {[endlist]}` | same (also `repeat`, `foreach`, `end list`) |
| `{[list X|filter: Age < 18]}`, `|sort: -Age`, `|punc:"1, 2, and 3"` | same |
| `_index` (1-based), `_first`, `_last`, `_punc`, `this` | same, plus `_index0`, `_count`, `_item` |
| `==`, `!=`, `&&`, `||`, `!`, `? :` | same (`=`, `<>`, `and`, `or`, `not` also accepted) |
| `Children[0].Name` | same (0-based) |
| `.toUpperCase() .includes() .split() .first(n) .last(n) …` | same |
| `date.today()`, `date.addDays()`, `date.age()`, `date.yearOf()` … | same |
| `math.*`, `finance.PMT/PV/FV/NPER/RATE` | same |
| `|format:"MMMM D, YYYY"`, `|format:"Do \[day of\] MMMM YYYY"` | same tokens; also lowercase `d`/`yyyy` and presets |
| `|else:"fallback"` | same (also `|default`) |
| `|initcap`, `|initcap:true`, `|titlecaps`, `|upper`, `|lower` | same |
| `|contains:"x"` | same (text and lists) |
| `|format:"heads":"tails"` on booleans | same |
| `|format:"0,0.00"`, `"0%"` on numbers | same (plus format-by-example) |
| `|cardinal`, `|ordsuffix`, `|cardinaldec:2`, `|cardinalcur:"dollars":"cents"` | same |
| `|ordinal` → "twenty-third" (words) | **differs:** `|ordinal` → "23rd"; use `|ordinalwords` / `|ordinalword` for "twenty-third" |
| `|filter: …`, `|find: …`, `|any: …`, `|every: …`, `|map: …`, `|sort: +A : -B`, `|group: …`, `|reduce: … : init` | same |
| Booleans print `true`/`false` | **differs:** print "Yes"/"No" (`|format:"true":"false"` to override) |

Not supported: Knackly's HTML/markdown rich formatting tags inside fields, `{[#…]}` other than comments, and external data connectors.

## Programmatic API (engine/index.js)

```js
import { compile, assemble, render, questionnaire, createModel } from './engine/index.js';

const { ast, analysis, errors } = compile(templateText);   // never throws
const { text, warnings, trace } = assemble(templateText, data);
const questions = questionnaire(ast, data, model);          // [{path, label, type, required, answered, options?, suggestions?, itemType?, listPath?, help?, min?, max?, minLength?, maxLength?, pattern?, default?, fromTemplate?}]
// `model` is optional: { variables: { 'Client.FullName': { label, type, options?, help?, required? } } }
// overrides inferred labels/types (see the `model` export of each samples/*.js and mergeModel in model.js).
```

Modules: `lexer.js` (tokenize) · `expr.js` (parseExpr / evalExpr / collectIdentifiers) · `functions.js` (built-ins, registerFunction) · `parser.js` (parse → AST) · `evaluate.js` (render, renderToBlocks) · `analyze.js` (analyze, relevantVariables, questionnaire, dependencyMap, humanize, collectAnnotations, parseAnnotationLine, ANNOTATION_KEYS) · `model.js` (createModel, mergeModel, applyAnnotations, ANNOTATABLE, coerce, validate, computeDerived, emptyData, emptyItem, TYPES).

`analyze(ast)` returns `{ variables, structure, annotations, annotationErrors }`; `createModel(analysis)` applies the annotations, `mergeModel(existing, analysis)` re-applies them while preserving UI edits, `validate(model, data, { relevant?, requiredOnly? })` returns `[{path, message}]`, and `computeDerived(model, data)` returns `{ data, errors }` — see the sections above.
