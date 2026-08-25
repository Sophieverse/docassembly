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
import { textToBlocks } from '../engine/docx/blocks.js'         // markdown-ish text → Block[]
import { buildDocx } from '../engine/docx/docxwrite.js'          // (blocks, opts:{title, font, fontSize, margins}) → Uint8Array (.docx bytes)
import { readDocx } from '../engine/docx/docxread.js'            // (Uint8Array) → Promise<{ text, blocks }>  text is template text with markdown-ish structure
import { blocksToHtml } from '../engine/docx/html.js'            // Block[] → HTML string (for preview)
Block = {type:'paragraph', runs:[{text,bold,italic,underline}], style:'Normal'|'Title'|'Heading1'|'Heading2'|'Heading3', align:'left'|'center'|'right'|'justify', numbering?:{kind:'bullet'|'decimal', level}, indent?}
      | {type:'table', rows: Block[][][]}  (rows → cells → paragraph blocks) | {type:'pagebreak'}

# Storage (app/store.js) — localStorage keyed 'docassembly.v1'
{ templates: {id: {id, name, description, text, model, folder, createdAt, updatedAt, docxOrigin?}},
  records:   {id: {id, name, data, createdAt, updatedAt}},
  packages:  {id: {id, name, items:[{templateId, includeIf?}], createdAt, updatedAt}},
  settings:  {firmName, attorneyName, defaultFont, defaultFontSize, theme} }
