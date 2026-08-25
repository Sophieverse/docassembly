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

Truthiness: empty text, `null`, `0`, `false`, and empty lists are false; everything else is true. A variable used bare in a condition (`{[if IsMarried]}`, `{[if not HasKids]}`) is inferred to be a Yes/No question.

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
`upper` · `lower` · `title` (Title Case Each Word) · `titlecaps` · `capitalize` (first letter only) · `initcap` (`initcap:true` lowercases the rest) · `trim` · `initials` · `possessive` ("James" → "James'", "Mary" → "Mary's") · `len`/`length` · `contains` · `startswith` · `endswith` · `replace:"a":"b"` · `nbsp` · `blank` · `article` ("a"/"an") · `plural:"child"` → "children" (`plural(word, count)` returns singular for 1) · `quantity(3, "heir")` → "3 heirs" · `salutation(gender)` → Mr./Ms./Mx.

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
`pluralize(count, "child", "children")` → "3 children" · `isAre` · `hasHave` · `doesDo` · `wasWere` (take a count or a list) · `pronoun(gender, form)` with forms `subject` / `object` / `possessive` / `possessiveadj` / `reflexive` (he/him/his/his/himself · she/her/hers/her/herself · they/them/theirs/their/themselves).

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
`default:"fallback"` / `else:"fallback"` · `coalesce(a, b, c)` · `isEmpty` · `if(cond, a, b)` · ternary `cond ? a : b`.

### Value methods
Call these with dot syntax on any value: `.toUpperCase() .toLowerCase() .trim() .length .includes(x) .startsWith(x) .endsWith(x) .replace(a, b) .split(sep) .slice(a, b) .substring(a, b) .indexOf(x) .padStart(n, c) .padEnd(n, c) .toInt() .toFixed(n) .first(n) .last(n) .join(sep) .filter(expr) .map(expr) .sort(expr)`.

### Finance
`finance.PMT(rate, nper, pv, fv, type)`, `PV`, `FV`, `NPER`, `RATE` with Excel semantics (rate per period; payments are negative outflows).

### Custom functions
`registerFunction("shout", s => s.toUpperCase() + "!")` makes `{[Name|shout]}` available everywhere.

## How the questionnaire is inferred

| Template usage | Inferred type |
| --- | --- |
| `{[if X]}`, `{[if not X]}`, names like `IsMarried`, `HasChildren` | boolean (Yes/No) |
| `|currency`, `|dollars`, names ending in Amount / Fee / Price / Cost / Rent / Total … | currency |
| `|number`, `|ordinal`, `|words`, `X > 5`, names ending in Count / Number / Age / Qty … | number |
| `|format:"…"`, date functions, `X < "2026-01-01"`, names ending in Date / DOB / Deadline | date |
| `{[list X]}`, `count(X)`, `X|join` | list |
| `X.Y` | X is an object |
| `X = "CA"` / `X = "NY"`, `pronoun(X, …)` | selection with those options |
| names ending in Notes / Description / Address … | long text |

Inside a list body, any name not defined at the top level of the template is assumed to be a field of the list item (`Children[].Name`). To reference a global variable from inside a list, reference it somewhere outside the list too (or use the `as` alias to make item fields explicit). Types and labels can be overridden in the Variables panel; those edits survive template changes.

Relevance: a variable is asked when it appears in a field whose enclosing conditions are currently true, or in a condition that has been reached. If a condition depends on unanswered variables, the questions inside it wait until the condition can be evaluated. Order follows first appearance in the template.

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
const questions = questionnaire(ast, data);                 // [{path, label, type, required, options?, listPath?, answered}]
```

Modules: `lexer.js` (tokenize) · `expr.js` (parseExpr / evalExpr / collectIdentifiers) · `functions.js` (built-ins, registerFunction) · `parser.js` (parse → AST) · `evaluate.js` (render, renderToBlocks) · `analyze.js` (analyze, relevantVariables, questionnaire, dependencyMap) · `model.js` (createModel, mergeModel, coerce, validate, computeDerived, emptyData).
