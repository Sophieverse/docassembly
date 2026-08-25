/**
 * @module engine
 * Public entry point: re-exports every module plus `compile` and `assemble`.
 */

export { tokenize, TemplateError, normalizeSmartQuotes } from './lexer.js';
export { parseExpr, evalExpr, evaluate, collectIdentifiers, collectFunctions, createScope, createTrace, truthy, compareValues, valuesEqual, pathOf, listIdentity } from './expr.js';
export { functions, registerFunction, parseDate, formatDate, toISODate, namespaces, methods } from './functions.js';
export { parse, walk, classifyTag } from './parser.js';
export { render, renderToBlocks, formatValue, itemVars } from './evaluate.js';
export { analyze, relevantVariables, questionnaire, dependencyMap, humanize, getPath } from './analyze.js';
export { createModel, mergeModel, coerce, validate, computeDerived, emptyData, emptyItem, setPath, TYPES } from './model.js';

import { parse } from './parser.js';
import { analyze } from './analyze.js';
import { render } from './evaluate.js';

/**
 * Parse and analyze a template. Never throws: syntax errors are returned in `errors`.
 * @param {string} templateText
 * @returns {{ast:Object|null, analysis:Object|null, errors:Array<{message:string,line?:number,col?:number}>}}
 */
export function compile(templateText) {
  try {
    const ast = parse(templateText);
    const analysis = analyze(ast);
    return { ast, analysis, errors: [] };
  } catch (e) {
    return { ast: null, analysis: null, errors: [{ message: e.message, line: e.line, col: e.col }] };
  }
}

/**
 * Parse + render in one call.
 * @param {string} templateText
 * @param {Object} data
 * @param {Object} [options] render options
 * @returns {{text:string, warnings:string[], trace:Object}}
 */
export function assemble(templateText, data, options) {
  const ast = parse(templateText);
  return render(ast, data, options);
}
