# Research: what Knackly offers (condensed feature inventory)

## Concepts
Workspace → Catalogs (each is a model with Variables/Formulas/Templates/Apps/Layouts) → Records (a client/matter
folder holding answers, apps run, generated docs). Models = reusable object schemas (`party`). Variables: Text,
Number, Date, True/False, Selection, Object, File — each Single or List-of. Formulas = named typed expressions.
Templates = docx (Word add-in) or text; docx sub-templates act as a clause library. Tables (lookup with key
column), Queries (select records from another catalog). Apps = interview + "App Template" listing which
templates to assemble, with `{[if]}` around `{[TemplateName]}` → conditional document sets. Layouts = grid of
questions with info cells and section conditions. External (client-facing) intake links.

## Template syntax
`{[Field]}`, `{[Client.FullName]}`, `{[Children[0].Name]}`, `{[X|filter:arg]}`;
`{[if c]}…{[elseif c]}…{[else]}…{[endif]}`; `{[list Children|punc:"1, 2, and 3"]}{[Name]}{[endlist]}`, `_index`;
table rows repeat when list tags sit in a row. Operators `+ - * / %`, `== != < <= > >=`, `&& || !`, `?:`,
`.`/`[ ]`, `|`. Filters: `upper lower initcap titlecaps contains else format punc cardinal ordinal ordsuffix
cardinaldec cardinalcur filter find any every map sort group reduce`. Date tokens `D DD Do M MM MMM MMMM YYYY
EEE EEEE` with `[literal]`. Number patterns `0,0.00`. Boolean `|format:"heads":"tails"`. Namespaces
`date.*`, `math.*`, `finance.*`, text/list methods, `appLink()`.

## Interview
Per-type options (masks, min/max, pickers, selection sources incl. tables/queries/user data, option templates,
filters). **Relevance**: Automatic (ask only what changes the outcome — the core idea) or Explicit expression;
newer visual rule builder. Layouts with up to 6 columns, markdown info cells, live previews, help text.
Repeating groups from List-of variables. Finish Later saves partial state.

## Output & data
DOCX (primary), PDF forms, text/markdown, .eml; multiple docs per app; one template per object instance;
expression-driven file names; export/import records as JSON/CSV; Clio/Filevine/OneDrive/NetDocuments/Zapier/API;
Secured Signing for e-sign (no built-in).

## Pricing (Aug 2026)
Starter $250/mo (4 users, 400 records/mo) · Done-For-You $500/mo · Professional $1,000/mo (API). No free trial.

## Reviews
Praise: object reuse, complex logic, stays in Word, API, support, cheaper than HotDocs.
Complaints: steep learning curve, relevance over-shows questions, 4-user minimum, no e-sign/portal/library.

## What this clone keeps
Same `{[ ]}` syntax and filters, automatic relevance, typed variables incl. objects/lists, records reused
across templates, packages = conditional document sets, DOCX/PDF/HTML output, JSON export — all local, free.
