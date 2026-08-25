/**
 * @module lexer
 * Tokenizes template text into literal-text and `{[ ... ]}` field tokens.
 */

/**
 * Error thrown for template syntax problems. Carries line/col (1-based).
 */
export class TemplateError extends Error {
  /**
   * @param {string} message
   * @param {number} [line]
   * @param {number} [col]
   */
  constructor(message, line, col) {
    super(line != null ? `${message} (line ${line}, col ${col})` : message);
    this.name = 'TemplateError';
    this.line = line;
    this.col = col;
  }
}

/**
 * @typedef {Object} Token
 * @property {'text'|'field'} type
 * @property {string} value  literal text, or the trimmed inside of `{[ ... ]}`
 * @property {number} line   1-based line where the token starts
 * @property {number} col    1-based column where the token starts
 */

const OPEN = '{[';
const CLOSE = ']}';

/**
 * Normalize "smart" punctuation Word inserts inside fields so expressions parse.
 * Curly double quotes → ", curly single quotes → ', non-breaking space → space.
 * @param {string} s
 * @returns {string}
 */
export function normalizeSmartQuotes(s) {
  return s
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/ /g, ' ')
    .replace(/[–—]/g, '-');
}

/**
 * Split template text into text and field tokens.
 * @param {string} templateText
 * @returns {Token[]}
 * @throws {TemplateError} on an unterminated `{[`
 */
export function tokenize(templateText) {
  const src = String(templateText == null ? '' : templateText);
  const tokens = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  const advance = (text) => {
    for (const ch of text) {
      if (ch === '\n') { line++; col = 1; } else { col++; }
    }
  };

  while (pos < src.length) {
    const open = src.indexOf(OPEN, pos);
    if (open === -1) {
      tokens.push({ type: 'text', value: src.slice(pos), line, col });
      break;
    }
    if (open > pos) {
      const text = src.slice(pos, open);
      tokens.push({ type: 'text', value: text, line, col });
      advance(text);
      pos = open;
    }
    const startLine = line, startCol = col;
    const close = src.indexOf(CLOSE, open + OPEN.length);
    if (close === -1) {
      throw new TemplateError(`Unterminated field: "{[" has no matching "]}"`, startLine, startCol);
    }
    // A second "{[" before the close is almost always a typo like {[Name} ... {[Other]}
    const nextOpen = src.indexOf(OPEN, open + OPEN.length);
    if (nextOpen !== -1 && nextOpen < close) {
      throw new TemplateError(`Unterminated field: "{[" has no matching "]}" before the next "{["`, startLine, startCol);
    }
    const raw = src.slice(open + OPEN.length, close);
    tokens.push({ type: 'field', value: normalizeSmartQuotes(raw).trim(), line: startLine, col: startCol });
    advance(src.slice(open, close + CLOSE.length));
    pos = close + CLOSE.length;
  }
  return tokens;
}
