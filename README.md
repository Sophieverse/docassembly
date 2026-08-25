# DocAssembly — personal legal document automation with if/then logic

A free, private, single-user clone of the core of [Knackly](https://knackly.io): write a document template
with merge fields and **if / then** conditions, and the app **generates the questionnaire from the
template** — asking only the questions the document actually needs, and only when they are relevant
(e.g. spouse questions appear only after "Is the client married?" = Yes). Answers are saved as client
records and reused across templates. Output is real, editable **.docx**, plus PDF (print) and HTML.

Everything runs in the browser from static files. **No server, no accounts, no data leaves your machine.**

## Quick start

1. Open `index.html` in Chrome, Edge, or Safari (or serve the folder with any static host / GitHub Pages).
2. Click **Load samples** on first run. Open **Last Will** and press **Run questionnaire**.
3. Answer the questions and watch new ones appear as you go (married → spouse; children → guardian).
4. **Generate** → preview → **Download .docx**.

To run the test suite: `node --test tests/` (Node 20+, no dependencies). Browser end-to-end journeys:
`node tools/e2e/run.js` (needs Google Chrome).

## How it works

```
{[if Client.IsMarried]}
My spouse is {[Spouse.FullName]}. All references in this Will to my spouse are to {[Testator.Gender|pronoun:"object"]}.
{[end if]}

{[list Children|punc:"1, 2, and 3"]}{[Name]} (born {[DOB|format:"long"]}){[end list]}
```

| Concept | What you write | What the app does |
|---|---|---|
| Field | `{[Client.FullName]}` | asks "Client — Full name" |
| Condition | `{[if IsMarried]} … {[else]} … {[end if]}` | asks "Is married?" first; asks the fields inside only if Yes |
| Repeating group | `{[list Children]} … {[end list]}` | asks for a list of children with the fields used inside |
| Formatting | `{[Fee\|currency]}`, `{[Fee\|dollars]}`, `{[Date\|format:"legal"]}` | `$1,250.00`, `One Thousand Two Hundred Fifty and 00/100 Dollars`, `the 5th day of March, 2026` |
| Grammar | `{[Children\|count\|isAre]}`, `{[Gender\|pronoun:"subject"]}`, `{[Names\|join:"and"]}` | is/are, he/she/they, "A, B, and C" |

The template language is compatible with Knackly's `{[ ]}` syntax (if/elseif/else/endif, list/endlist,
`==`, `&&`, `||`, `?:`, `|format`, `|punc`, `|upper`, list filters `|filter |map |sort |reduce`, `date.*`,
`math.*`, `finance.*`). Full reference: [engine/README.md](engine/README.md) or the in-app **Help** page.

## Features

- **Template editor** with live compile errors, insert-field/if/list helpers, a **Variables** panel
  (auto-discovered; edit labels, types, options, help text), a **Logic map** (which conditions gate which
  lines) and a **live preview** where you flip booleans and see paragraphs appear/disappear.
- **Auto-generated questionnaire** with relevance: gating questions first, dependent questions only when
  needed, repeating groups (add/remove/reorder), typed inputs (date, currency, yes/no, selection…).
- **Records** — client/matter answer sets, reused across every template; JSON export/import.
- **Packages** — one questionnaire → a whole set of documents, each with an optional inclusion condition
  (Knackly "apps").
- **Word templates (in-place fill)** — keep your existing Word document as the template: put `{[ ]}` tags in
  Word, import it, and generated documents keep *all* Word formatting, styles, numbering, headers/footers and
  tables — only the tags are resolved (paragraph-level `{[if]}` markers remove whole paragraphs; a table row
  containing `{[list X]}…{[endlist]}` repeats per item). Or convert a .docx to an editable text template.
- **Template annotations** — labels, help text, options, defaults, types and rules live in the template so it
  stays the single source of truth: `{[# @label Client.FullName: Client's full legal name]}`,
  `{[# @validate Members: sum(Members, "Percent") = 100 :: Percentages must total 100%]}`.
- **Validation & computed fields** — min/max/pattern/expression rules with inline messages; computed variables
  (top-level and per list item, e.g. `Children[].IsMinor = yearsBetween(DOB, today()) < 18`) that drive logic
  without being asked.
- **Output** — .docx (styles, headings, numbered lists, tables, page breaks), print/PDF, copy text.
- **100+ helper functions** — number-to-words, dollars in words, ordinals, date math & legal date
  formats, pronouns, plurals, is/are, a/an, possessives, list punctuation, HotDocs-style format-by-example.

## Layout

```
index.html    app/ (UI)    engine/ (template language, analysis, model)    engine/docx/ (zero-dep DOCX read/write)
samples/ (7 templates: engagement letter, will, LLC operating agreement, lease, NDA, demand letter, tutorial)
tests/ (node --test, 300+ tests)    tools/e2e/ (headless-Chrome journeys)    docs/ (research + engine reference)
```

## Disclaimer

The sample templates are generic drafting examples for demonstrating conditional logic. They are not legal
advice and must be reviewed and adapted by a licensed attorney for the governing jurisdiction before use.

MIT License.
