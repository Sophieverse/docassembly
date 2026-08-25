# DocAssembly — Personal Legal Document Automation (Knackly-style)

## Product principle (from the user)
**Template-first.** The attorney writes a template (in a text editor in-app, or imports a .docx) containing
merge fields and if/then blocks. The app scans the template, discovers every variable and condition, and
**automatically generates the questionnaire** ("interview"). The interview is dynamic: a question is only
shown when it is *relevant* — i.e., some part of the document that is currently included references it.
Example: `{[if Client.IsMarried]}...{[Spouse.FullName]}...{[end if]}` → "Spouse full name" is asked only when
"Is the client married?" = Yes.

Answers are saved as **Records** (client/matter). One record can drive many templates ("Packages").

## Tech decisions
- Zero build step, zero runtime deps. Vanilla ES modules; runs from `file://` or any static host (GitHub Pages).
- Engine is pure JS and shared between the browser and Node tests (`node --test`).
- Storage: localStorage (with JSON import/export of everything). All data stays on the attorney's machine.
- Output: DOCX (own zero-dep writer), HTML preview, PDF via browser print.
- DOCX import: read document.xml, merge runs per paragraph so split placeholders reassemble.

## Directory layout
```
docassembly/
  index.html            # the app shell (single page, hash routing)
  app/                  # UI modules (browser only)
    main.js  router.js  store.js  ui-templates.js  ui-variables.js  ui-interview.js
    ui-records.js  ui-output.js  ui-packages.js  styles.css  components.js
  engine/               # pure JS, no DOM
    lexer.js            # tokenizes {[ ... ]} fields out of template text
    parser.js           # builds AST: Text | Field | If(cond, then, elifs, else) | List(expr, body) | Comment
    expr.js             # expression parser+evaluator (identifiers, dotted paths, literals, operators, function calls, filters)
    functions.js        # built-in function/filter library (see below)
    evaluate.js         # AST → output document (array of blocks), with relevance tracking
    analyze.js          # static analysis: variables used, per-variable relevance conditions → questionnaire
    model.js            # data model (variable types, objects, lists), validation, defaults, coercion
    docx/ zipwrite.js zipread.js docxwrite.js docxread.js
  tests/                # node --test
  samples/              # example templates (engagement letter, will, LLC operating agreement, NDA, demand letter)
  README.md
```

## Template language (Knackly-like)
Delimiters: `{[` and `]}`. Everything else is literal text.
- Field: `{[Client.FullName]}`, `{[Fee|currency]}`, `{[SigningDate|format:"MMMM d, yyyy"]}`
- Conditions:
  ```
  {[if Client.IsMarried]} ... {[elseif Client.HasPartner]} ... {[else]} ... {[endif]}
  ```
  Accept spelling variants: `end if`, `endif`, `else if`, `elseif`, `elif`.
- Lists: `{[list Children]} {[Name]} born {[DOB|format:"long"]}{[endlist]}` with `{[_index]}`, `{[_first]}`,
  `{[_last]}`, `{[_punc]}` (auto ", " / ", and " / "."), and `{[list Children|filter: Age < 18]}`.
  Inside a list, bare names resolve against the item, then outer scope.
- Comments: `{[# note to drafter]}`
- Expressions: `and or not = != < <= > >= + - * /`, parentheses, string literals `"..."`, numbers,
  `true/false`, `null`, member access `a.b`, list functions `count(Children)`, `any(...)`, `sum(Items, Amount)`.
- Filters (pipe): `upper lower title capitalize trim currency number words ordinal ordinalwords format:"..." default:"..."
  pluralize:"child","children" join:"and" possessive pronoun:"subject|object|possessive" initials`.

## Variable types (inferred from template usage + editable in the Variables panel)
text, longtext, number, currency, date, boolean (true/false), selection (single choice, list of options),
multiselect, object (has child variables), list (repeating group of objects), computed (formula, not asked).
Inference rules: used in `if` alone → boolean; `|currency` → currency; `|format` or name ends in Date/DOB → date;
`list X` → list; `X.Y` → X is object; `count(X)` → list; otherwise text.

## Relevance (auto questionnaire)
`analyze.js` walks the AST with the current answers and computes, for each variable, whether it is *reachable*:
a field is relevant if it sits inside if/list bodies whose conditions currently hold (or are still unanswered).
The interview shows: all relevant unanswered → in template order, grouped by object. Condition variables come
before the variables they gate. Unanswered gating variable → gated variables hidden until answered.
Static analysis also produces a "dependency map" for the designer view: which variables gate which sections.

## Output document model (engine → docx/html)
Evaluation returns `Blocks[]`: `{type:'paragraph', runs:[{text,bold,italic,underline}], style?, align?, numbering?}`,
`{type:'table', rows:[[cells]]}`, `{type:'pagebreak'}`. Template text uses a light markdown subset for structure
when authored in-app: `# Heading`, `## Heading 2`, `**bold**`, `*italic*`, `__underline__`, `---` pagebreak,
`1.` / `-` lists, `|a|b|` tables, `>center` / `>right` alignment prefixes. Imported DOCX keeps its own styles.

## Packages
A Package = ordered set of templates + a shared record. One interview (union of relevant variables across
templates) → generates all documents. Each template in a package can have an inclusion condition.

## UI screens (hash routes)
`#/templates` list · `#/templates/:id` editor (left: template text, right: Variables & structure map, live
preview with sample data) · `#/interview/:templateOrPackageId?record=` generated questionnaire, progress,
validation, then Output screen (preview, Download DOCX, Print/PDF, save answers to record) ·
`#/records` client/matter records (view/edit answers, reuse across templates) · `#/packages` ·
`#/settings` (firm info defaults, export/import all data JSON, theme).

## Testing
`node --test tests/` — lexer/parser/expr/functions/evaluate/analyze/docx round-trip; sample templates render
without error for several answer sets; property-style fuzz on the expression parser.
