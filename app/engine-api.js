/**
 * @module engine-api
 * Single import point for the template engine so UI modules never touch engine paths directly.
 * Everything here is re-exported exactly as documented in API.md.
 */
export {
  compile, assemble, parse, render, analyze, relevantVariables, questionnaire, dependencyMap,
  createModel, mergeModel, coerce, validate, computeDerived, humanize, functions,
} from '../engine/index.js';

export { textToBlocks } from '../engine/docx/blocks.js';
export { buildDocx } from '../engine/docx/docxwrite.js';
export { readDocx } from '../engine/docx/docxread.js';
export { blocksToHtml } from '../engine/docx/html.js';
