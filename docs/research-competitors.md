# Research: competitor template syntax and features (condensed)

| Tool | Template syntax | Logic | Notes |
|---|---|---|---|
| HotDocs | `«Var»`, `«IF c»…«ELSE IF»…«ELSE»…«END IF»`, `«REPEAT D»…«END REPEAT»`, `«Amount:$9,999.00»` | IF/ELSE IF/WHILE/REPEAT/SET/ASK, computations w/ RESULT | **Format-by-example**: `"Nine Dollars and 9/100"`, `"3rd day of June, 1990"`, list punctuation `"a, b, and c"` |
| Docassemble | YAML interview + Jinja2 in DOCX: `{{ v }}`, `{%p if %}`, `{%p for %}`, `{%tr for %}` | dependency-driven questioning (ask only what's needed), `show if` | Rich object model: `Individual.pronoun_subjective()`, `possessive()`, `comma_and_list()`, `age_in_years()` |
| Gavel (Documate) | docassemble/Jinja under a visual builder | conditional pages, repeating items, calculations | client-facing intake, Clio |
| Clio Draft (Lawyaw) | Word content controls | standalone/triggered/compound conditions | court-form library |
| Woodpecker | Word add-in placeholders | IF/THEN conditional fields, Excel-style formulas, macros | folded into MyCase |
| Knackly | `{[Field]}`, `{[if]}…{[elseif]}…{[else]}…{[endif]}`, `{[list]}…{[endlist]}`, filters `|format:"MMMM D, YYYY"`, `|upper`, `|punc`, `|sort`, `|filter` | JS-like formulas, `date.today()` | typed catalogs, nested lists, external intake |
| Smokeball | `<<Field>>` + If/Then/Else dialog | nested If/Then/Else | tied to Smokeball PM |
| Afterpattern / PatternBuilder | `<< Var >>` + logic blocks | conditional insert expressions, list text blocks | now NetDocuments |
| BRYTER | `{{Placeholder}}`, `{{A==>B}}` collections | tagged conditional regions | logic in module graph |
| docxtemplater | `{name}`, `{#items}…{/items}`, `{^cond}…{/cond}` | angular-expressions filters | JS reference engine |
| python-docx-template | Jinja2: `{{ }}`, `{%p %}`, `{%tr %}`, RichText, Subdoc | Jinja | Python reference engine |

## Top features for a solo attorney (ranked)
1 readable inline tags · 2 if/elseif/else with and/or/not at word/sentence/paragraph level, clean paragraph removal ·
3 repeating groups incl. table rows · 4 list punctuation "A, B, and C" · 5 format-by-example numbers/dates ·
6 dollars in words + numerals · 7 typed variables · 8 conditional questions · 9 dependency-driven questioning ·
10 computed variables · 11 date arithmetic · 12 pronoun/plural/verb helpers · 13 person/entity objects ·
14 defined terms · 15 address formatting · 16 adaptive signature blocks · 17 select w/ Other + defaults ·
18 validation · 19 multi-document packets · 20 answer reuse · 21 editable DOCX + PDF · 22 case helpers ·
23 ordinals/roman/alpha · 24 client intake link · 25 preview with sample answers + undefined-variable report.

## Helper functions attorneys keep needing
Numbers: words, dollars-in-words ("…and 12/100"), ordinal (3rd/third), roman/alpha, percent, sum/count.
Dates: today, format (incl. "the 3rd day of June, 2026"), +days/months/years, age, year/month extraction.
Grammar: pronouns by gender, singular/plural nouns, is/are, does/do, a/an, possessives, capitalization,
join lists with and/or, salutation. Structure: defined terms on first use, address block, signature blocks,
conditional table rows, sub-templates, cross-references that survive clause removal.
