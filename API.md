# Engine API contract (UI must code against this; engine agent implements it)

import { compile, assemble, parse, render, analyze, relevantVariables, questionnaire, dependencyMap,
         createModel, mergeModel, coerce, validate, computeDerived, humanize, functions } from '../engine/index.js'

compile(templateText) → { ast, analysis, errors: [{message,line,col}] }      // never throws
assemble(templateText, data) → { text, warnings: string[] }
render(ast, data, options?) → { text, warnings, trace:{referenced:Set, missing:Set, relevant:Set} }
analyze(ast) → { variables: Map<path, VarInfo>, structure }
  VarInfo = { path, name, parent, inferredType, usedIn:[{line,col,context}], gatedBy:[string], filters:[string], isListItemField, listPath }
relevantVariables(ast, data) → { relevant: string[], unanswered: string[], blockedBy: Map<path, string[]> }
questionnaire(ast, data, model?) → Question[]   // ordered, only currently-relevant questions
  Question = { path, label, type, required, options?, help?, listPath?, itemFields? }
dependencyMap(ast) → Map<path, [{line, endLine, kind:'if'|'list', condSrc}]>
createModel(analysis) → Model ; mergeModel(existing, analysis) → Model
  Model = { variables: { [path]: { path, label, type, options?, help?, required?, default?, formula?, orphaned? } }, order: string[] }
coerce(value, type) → value ; validate(model, data) → [{path, message}] ; computeDerived(model, data) → data' ; humanize(path) → string

Data shape: plain nested object keyed by variable path segments: { Client: { FullName, IsMarried }, Children: [ {Name, DOB}, ... ] }
Dates stored as 'YYYY-MM-DD' strings; currency/number as JS numbers; booleans as true/false; selection as string; multiselect as string[].

# DOCX API (engine/docx/)
import { textToBlocks, blocksToText } from '../engine/docx/blocks.js'
import { buildDocx, buildDocxSync } from '../engine/docx/docxwrite.js'
import { readDocx } from '../engine/docx/docxread.js'
import { blocksToHtml } from '../engine/docx/html.js'

textToBlocks(text) → Block[]        // markdown-ish text → blocks. One paragraph per line; blank line = empty paragraph.
                                    // `# ## ###` headings · `**b** *i* __u__` runs (nest; unmatched markers literal; `\*` etc. escape)
                                    // `---` pagebreak · `1.`/`1)`/`a.` decimal, `- `/`* ` bullet (2 leading spaces = 1 level)
                                    // `|a|b|` table rows (consecutive; `|---|---|` ignored) · `>center|right|justify|left ` align · `>title ` Title
                                    // leading tabs → indent · `{[ ... ]}` fields copied verbatim (no markdown inside)
blocksToText(blocks) → string       // inverse (used after import so a DOCX becomes editable template text); textToBlocks(blocksToText(b)) ≡ b
buildDocx(blocks, opts?) → Promise<Uint8Array>   // ASYNC: DEFLATE-compressed via CompressionStream when available, else STORE
buildDocxSync(blocks, opts?) → Uint8Array        // synchronous, STORE (uncompressed)
  opts = { title, font='Times New Roman', fontSize=12 (pt), margins=1 (inches; number or {top,right,bottom,left}), lineSpacing=1, compress=true }
  Emits docProps/core.xml (title). Each numbered list group (broken by a non-empty non-list paragraph, table or pagebreak) restarts at 1.
  Also accepts the legacy spike shape {list:'bullet'|'number', level, align:'both', type:'pageBreak'}.
readDocx(bytes: Uint8Array) → Promise<{ text, blocks }>   // text = blocksToText(blocks). Runs merged per paragraph so split
                                    // placeholders reassemble; curly quotes inside {[ ]} normalized to straight quotes;
                                    // heading/Title styles resolved by id or styles.xml name; w:ind left → indent; page breaks → pagebreak blocks
blocksToHtml(blocks, opts?) → string  // full printable HTML document (font/size/margins/lineSpacing from opts; title);
                                    // opts.fragment=true → only <div class="doc">…</div>. Lists nest as <ol>/<ul>, tables bordered,
                                    // pagebreak → <div class="pagebreak"> (CSS page-break-after). All text HTML-escaped.
Block = {type:'paragraph', runs:[{text,bold?,italic?,underline?}], style:'Normal'|'Title'|'Heading1'|'Heading2'|'Heading3', align:'left'|'center'|'right'|'justify', numbering?:{kind:'bullet'|'decimal', level}, indent?:number}
      | {type:'table', rows: Block[][][]}  (rows → cells → paragraph blocks) | {type:'pagebreak'}
Run flags are only present when true (so blocks compare with deepEqual after a round trip).

# Storage (app/store.js) — localStorage keyed 'docassembly.v1'
{ templates: {id: {id, name, description, text, model, folder, createdAt, updatedAt, docxOrigin?}},
  records:   {id: {id, name, data, createdAt, updatedAt}},
  packages:  {id: {id, name, items:[{templateId, includeIf?}], createdAt, updatedAt}},
  settings:  {firmName, attorneyName, defaultFont, defaultFontSize, theme} }
