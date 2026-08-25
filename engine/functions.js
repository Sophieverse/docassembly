/**
 * @module functions
 * Built-in function / filter library. Every function is defensive: null/undefined
 * inputs produce "" (for text outputs) or a sensible neutral value.
 *
 * Filters are sugar: `{[Fee|currency:"$",0]}` === `{[currency(Fee, "$", 0)]}`.
 */

// ---------------------------------------------------------------- helpers

const isBlank = (v) => v == null || v === '' || (typeof v === 'string' && v.trim() === '');
const str = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(str).join(', ') : v instanceof Date ? formatDate(v, 'long') : String(v));
const num = (v) => {
  if (typeof v === 'number') return v;
  if (v == null || v === '' || typeof v === 'boolean') return typeof v === 'boolean' ? Number(v) : NaN;
  const cleaned = String(v).replace(/[$,\s]/g, '');
  return cleaned === '' ? NaN : Number(cleaned);
};
const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const pad2 = (n) => String(n).padStart(2, '0');

function getField(item, field) {
  if (item == null) return undefined;
  if (isBlank(field)) return item;
  if (typeof item !== 'object') return undefined;
  const parts = String(field).split('.');
  let v = item;
  for (const p of parts) {
    if (v == null || typeof v !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(v, p)) v = v[p];
    else {
      const k = Object.keys(v).find((x) => x.toLowerCase() === p.toLowerCase());
      v = k === undefined ? undefined : v[k];
    }
  }
  return v;
}

/**
 * Template truthiness (mirrors expr.js).
 */
function truthy(v) {
  if (v == null || v === false || v === '' || v === 0) return false;
  if (typeof v === 'number' && Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

// ---------------------------------------------------------------- dates

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Does the value look like a date (Date object or a recognised date string)?
 * @param {any} v
 */
export function isDateLike(v) {
  if (v instanceof Date) return !Number.isNaN(v.getTime());
  if (typeof v !== 'string') return false;
  const s = v.trim().replace(/^[A-Za-z]+day,?\s+/i, '').replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');
  return /^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}(T.*)?$/.test(s) || /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(s) || /^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/.test(s) || /^\d{1,2} [A-Za-z]{3,9}\.? \d{4}$/.test(s);
}

/**
 * Parse a date as a *local* date (no timezone shift). Accepts ISO 'YYYY-MM-DD',
 * 'M/D/YYYY', 'MMMM D, YYYY', 'D MMMM YYYY', and Date objects.
 * @param {any} v
 * @returns {Date|null}
 */
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // Tolerate a leading weekday ("Tuesday, March 5, 2026") and ordinal suffixes ("March 5th, 2026").
  const s = String(v).trim().replace(/^[A-Za-z]+day,?\s+/i, '').replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');
  let m;
  if ((m = /^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:T.*)?$/.exec(s))) return mk(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(s))) { let y = +m[3]; if (m[3].length === 2) y += y < 50 ? 2000 : 1900; return mk(y, +m[1], +m[2]); }
  if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s))) { const mo = monthIndex(m[1]); return mo < 0 ? null : mk(+m[3], mo + 1, +m[2]); }
  if ((m = /^(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})$/.exec(s))) { const mo = monthIndex(m[2]); return mo < 0 ? null : mk(+m[3], mo + 1, +m[1]); }
  return null;
}
function monthIndex(name) {
  const n = name.toLowerCase();
  return MONTHS.findIndex((M) => M.toLowerCase() === n || M.toLowerCase().slice(0, 3) === n.slice(0, 3));
}
function mk(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1) return null; // e.g. Feb 30
  return dt;
}

/** Format a Date to ISO 'YYYY-MM-DD' (local). */
export function toISODate(d) {
  const dt = parseDate(d);
  return dt ? `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}` : '';
}

const DATE_PRESETS = {
  long: 'MMMM d, yyyy',
  short: 'M/d/yyyy',
  iso: 'yyyy-MM-dd',
  medium: 'MMM d, yyyy',
  full: 'EEEE, MMMM d, yyyy',
  legal: 'Do [day of] MMMM, yyyy',
};

/**
 * Format a date. Tokens (both Knackly/moment-style and lowercase forms accepted):
 *   year:    yyyy YYYY yy YY
 *   month:   MMMM (June) MMM (Jun) MM (06) M (6)
 *   day:     dd DD (03) d D (3) Do (3rd)
 *   weekday: EEEE dddd (Monday) EEE ddd E (Mon)
 * Literal text: [like this], \[like this\], or 'like this'.
 * Presets: "long" (June 3, 2026), "short" (6/3/2026), "iso", "medium", "full",
 * "legal" ("the 3rd day of June, 2026").
 * A format-by-example string ("June 3, 1990", "06/03/1990", "3rd day of June, 1990") is also accepted.
 * @param {any} value
 * @param {string} [pattern='long']
 * @returns {string}
 */
export function formatDate(value, pattern = 'long') {
  const d = parseDate(value);
  if (!d) return '';
  const p = String(pattern || 'long');
  const lp = p.toLowerCase();
  if (lp === 'legal') return 'the ' + formatDate(d, DATE_PRESETS.legal);
  let pat = DATE_PRESETS[lp] || inferDatePattern(p) || p;
  pat = pat.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
  const y = d.getFullYear(), mo = d.getMonth(), day = d.getDate(), dow = d.getDay();
  // A run of letters is only expanded when it is made entirely of tokens; plain words
  // ("day of", "Dated") pass through as literal text.
  return pat.replace(/\[([^\]]*)\]|'([^']*)'|[A-Za-z]+/g, (word, lit1, lit2) => {
    if (lit1 !== undefined) return lit1;
    if (lit2 !== undefined) return lit2;
    if (!DATE_TOKEN_WORD.test(word)) return word;
    return word.replace(DATE_TOKEN, (tok) => dateToken(tok, y, mo, day, dow));
  });
}
const DATE_TOKEN = /yyyy|YYYY|yy|YY|MMMM|MMM|MM|M|dddd|ddd|DD|Do|D|dd|d|EEEE|EEE|E/g;
const DATE_TOKEN_WORD = /^(?:yyyy|YYYY|yy|YY|MMMM|MMM|MM|M|dddd|ddd|DD|Do|D|dd|d|EEEE|EEE|E)+$/;
function dateToken(tok, y, mo, day, dow) {
  {
    switch (tok) {
      case 'yyyy': case 'YYYY': return String(y);
      case 'yy': case 'YY': return pad2(y % 100);
      case 'MMMM': return MONTHS[mo];
      case 'MMM': return MONTHS[mo].slice(0, 3);
      case 'MM': return pad2(mo + 1);
      case 'M': return String(mo + 1);
      case 'dd': case 'DD': return pad2(day);
      case 'd': case 'D': return String(day);
      case 'Do': return ordinal(day);
      case 'EEEE': case 'dddd': return DAYS[dow];
      case 'EEE': case 'E': case 'ddd': return DAYS[dow].slice(0, 3);
      default: return tok;
    }
  }
}

/**
 * Format-by-example for dates: "June 3, 1990" → "MMMM D, YYYY". Returns null if the
 * string doesn't look like an example date.
 * @param {string} ex
 * @returns {string|null}
 */
export function inferDatePattern(ex) {
  const s = String(ex).trim();
  const ORD = '(?:st|nd|rd|th)';
  let m;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'YYYY-MM-DD';
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    const M = m[1].length === 2 && m[1][0] === '0' ? 'MM' : 'M';
    const D = m[2].length === 2 && m[2][0] === '0' ? 'DD' : 'D';
    return `${M}/${D}/${m[3].length === 2 ? 'YY' : 'YYYY'}`;
  }
  if ((m = /^(\d{1,2})(st|nd|rd|th) day of ([A-Za-z]+)(,?) (\d{4})$/i.exec(s))) return `Do [day of] MMMM${m[4]} YYYY`;
  if ((m = new RegExp(`^([A-Za-z]+day|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\\.?, ([A-Za-z]+)\\.? (\\d{1,2})(${ORD})?, (\\d{4})$`, 'i').exec(s)) && monthIndex(m[2]) >= 0) {
    return `${m[1].length > 5 ? 'EEEE' : 'EEE'}, ${monthTok(m[2])} ${m[4] ? 'Do' : 'D'}, YYYY`;
  }
  if ((m = new RegExp(`^([A-Za-z]+)\\.? (\\d{1,2})(${ORD})?,? (\\d{4})$`).exec(s)) && monthIndex(m[1]) >= 0) {
    return `${monthTok(m[1])} ${m[3] ? 'Do' : 'D'}${s.includes(',') ? ',' : ''} YYYY`;
  }
  if ((m = new RegExp(`^(\\d{1,2})(${ORD})? ([A-Za-z]+)\\.? (\\d{4})$`).exec(s)) && monthIndex(m[3]) >= 0) {
    return `${m[2] ? 'Do' : 'D'} ${monthTok(m[3])} YYYY`;
  }
  return null;
}
function monthTok(name) { return name.length > 3 ? 'MMMM' : 'MMM'; }

// ---------------------------------------------------------------- numbers

/**
 * Format a number with thousands separators.
 * @param {any} value
 * @param {number} [decimals] fixed decimals; omitted = as-is (max 10)
 */
export function number(value, decimals) {
  const n = num(value);
  if (Number.isNaN(n)) return '';
  const dec = decimals == null || decimals === '' ? undefined : Number(decimals);
  const fixed = dec === undefined ? String(+n.toFixed(10)) : Math.abs(n).toFixed(dec);
  const neg = dec === undefined ? fixed.startsWith('-') : n < 0 && Number(fixed) !== 0;
  const body = fixed.replace(/^-/, '');
  const [int, frac] = body.split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + withSep + (frac !== undefined ? '.' + frac : '');
}

/**
 * Currency formatting: 1234.5 → "$1,234.50".
 * @param {any} value
 * @param {string|{symbol?:string,decimals?:number}} [symbol='$']
 * @param {number} [decimals=2]
 */
export function currency(value, symbol = '$', decimals = 2) {
  let sym = symbol, dec = decimals;
  if (symbol && typeof symbol === 'object') { sym = symbol.symbol ?? '$'; dec = symbol.decimals ?? 2; }
  if (sym == null) sym = '$';
  const n = num(value);
  if (Number.isNaN(n)) return '';
  const body = number(Math.abs(n), dec);
  return (n < 0 ? '-' : '') + sym + body;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];

function chunkWords(n) {
  // 0 < n < 1000
  const parts = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' hundred'); n %= 100; }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); }
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

/**
 * Integer → English words. 1234 → "one thousand two hundred thirty-four".
 * Non-integers use the integer part (use `dollars` for currency wording).
 * @param {any} value
 */
export function words(value) {
  const n = num(value);
  if (Number.isNaN(n)) return '';
  let i = Math.trunc(Math.abs(n));
  if (i === 0) return 'zero';
  const parts = [];
  let scale = 0;
  while (i > 0 && scale < SCALES.length) {
    const c = i % 1000;
    if (c) parts.unshift(chunkWords(c) + (SCALES[scale] ? ' ' + SCALES[scale] : ''));
    i = Math.floor(i / 1000);
    scale++;
  }
  return (n < 0 ? 'minus ' : '') + parts.join(' ');
}

function splitMoney(value) {
  const n = num(value);
  if (Number.isNaN(n)) return null;
  const abs = Math.abs(n);
  let whole = Math.floor(abs + 1e-9);
  let cents = Math.round((abs - whole) * 100);
  if (cents === 100) { whole += 1; cents = 0; }
  return { n, whole, cents };
}

/**
 * Currency in words, legal style: 1234.56 → "One Thousand Two Hundred Thirty-Four and 56/100 Dollars".
 * @param {any} value
 * @param {string} [unit='Dollars']
 */
export function dollars(value, unit = 'Dollars') {
  const m = splitMoney(value);
  if (!m) return '';
  return `${m.n < 0 ? 'Minus ' : ''}${title(words(m.whole))} and ${pad2(m.cents)}/100 ${unit || 'Dollars'}`;
}

/**
 * Currency in words: 1234.56 → "One Thousand Two Hundred Thirty-Four Dollars and 56/100".
 * @param {any} value
 * @param {string} [unit='Dollars']
 */
export function dollarsWords(value, unit = 'Dollars') {
  const m = splitMoney(value);
  if (!m) return '';
  const u = unit || 'Dollars';
  const unitWord = m.whole === 1 && u.endsWith('s') ? u.slice(0, -1) : u;
  return `${m.n < 0 ? 'Minus ' : ''}${title(words(m.whole))} ${unitWord} and ${pad2(m.cents)}/100`;
}

/**
 * Words plus figures: 10000 → "Ten Thousand Dollars ($10,000.00)"; 9.12 → "Nine Dollars and Twelve Cents ($9.12)".
 * @param {any} value
 * @param {string} [symbol='$']
 */
export function dollarsFull(value, symbol = '$') {
  const m = splitMoney(value);
  if (!m) return '';
  return `${dollarsAndCents(value)} (${currency(value, symbol)})`;
}

/**
 * "Nine Dollars and Twelve Cents"; whole amounts omit cents: "Ten Thousand Dollars".
 * @param {any} value
 * @param {string} [unit='Dollars']
 */
export function dollarsAndCents(value, unit = 'Dollars') {
  const m = splitMoney(value);
  if (!m) return '';
  const u = unit || 'Dollars';
  const unitWord = m.whole === 1 && u.endsWith('s') ? u.slice(0, -1) : u;
  const centsWord = m.cents === 1 ? 'Cent' : 'Cents';
  const head = `${m.n < 0 ? 'Minus ' : ''}${title(words(m.whole))} ${unitWord}`;
  return m.cents ? `${head} and ${title(words(m.cents))} ${centsWord}` : head;
}

/** Cents portion of an amount as an integer 0–99. */
export function cents(value) { const m = splitMoney(value); return m ? m.cents : ''; }

/**
 * 1 → "1st", 22 → "22nd".
 */
export function ordinal(value) {
  const n = num(value);
  if (Number.isNaN(n)) return '';
  const i = Math.trunc(n);
  const mod100 = Math.abs(i) % 100;
  const suf = mod100 >= 11 && mod100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][Math.abs(i) % 10] || 'th';
  return i + suf;
}

const ORD_ONES = { one: 'first', two: 'second', three: 'third', four: 'fourth', five: 'fifth', six: 'sixth', seven: 'seventh', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
/**
 * 1 → "first", 22 → "twenty-second", 100 → "one hundredth".
 */
export function ordinalwords(value) {
  const w = words(value);
  if (!w) return '';
  const toks = w.split(/([ -])/);
  const last = toks[toks.length - 1];
  let ord;
  if (ORD_ONES[last]) ord = ORD_ONES[last];
  else if (last.endsWith('y')) ord = last.slice(0, -1) + 'ieth';
  else ord = last + 'th';
  toks[toks.length - 1] = ord;
  return toks.join('');
}

/**
 * Round to n decimals.
 */
export function round(value, decimals = 0) {
  const n = num(value);
  if (Number.isNaN(n)) return '';
  const f = Math.pow(10, Number(decimals) || 0);
  return Math.round((n + Number.EPSILON) * f) / f;
}
export function abs(value) { const n = num(value); return Number.isNaN(n) ? '' : Math.abs(n); }
export function min(...args) { const ns = flat(args).map(num).filter((n) => !Number.isNaN(n)); return ns.length ? Math.min(...ns) : ''; }
export function max(...args) { const ns = flat(args).map(num).filter((n) => !Number.isNaN(n)); return ns.length ? Math.max(...ns) : ''; }
function flat(args) { return args.flatMap((a) => (Array.isArray(a) ? a : [a])); }

/**
 * Infer a number formatter from an example such as "9,999.00", "$9,999.00", "9,999.99%",
 * "nine", "Nine", "NINE", "3rd", "third", "Third", "Nine Dollars and Twelve Cents",
 * "Nine Dollars and 9/100", "nine dollars and 9/100".
 * @param {string} ex
 * @returns {((n:number)=>string)|null}
 */
export function inferNumberFormat(ex) {
  const s = String(ex).trim();
  let m;
  if ((m = /^([$€£¥]?)([#9,0]+)(\.([#90]+))?(%?)$/.exec(s))) {
    const sym = m[1], sep = m[2].includes(','), dec = m[4] ? m[4].length : 0, pct = !!m[5];
    return (n) => {
      const v = pct ? n * 100 : n;
      const body = sep ? number(Math.abs(v), dec) : Math.abs(v).toFixed(dec);
      return (v < 0 ? '-' : '') + sym + body + (pct ? '%' : '');
    };
  }
  const caseOf = (w) => (w === w.toUpperCase() ? 'upper' : w[0] === w[0].toUpperCase() ? 'title' : 'lower');
  const applyCase = (text, c) => (c === 'upper' ? text.toUpperCase() : c === 'title' ? title(text) : text.toLowerCase());
  if ((m = /^(nine|one|zero|ten)$/i.exec(s))) { const c = caseOf(s); return (n) => applyCase(words(n), c); }
  if (/^\d+(st|nd|rd|th)$/i.test(s)) return (n) => ordinal(n);
  if ((m = /^(first|third|ninth|tenth)$/i.exec(s))) { const c = caseOf(s); return (n) => applyCase(ordinalwords(n), c); }
  const keepTitle = (text, c) => (c === 'title' ? text : applyCase(text, c));
  if ((m = /^(\w+) dollars? and (\w+) cents?$/i.exec(s))) { const c = caseOf(m[1]); return (n) => keepTitle(dollarsAndCents(n), c); }
  if ((m = /^(\w+) dollars? and \d+\/100$/i.exec(s))) { const c = caseOf(m[1]); return (n) => keepTitle(dollarsWords(n), c); }
  if ((m = /^(\w+) and \d+\/100 dollars?$/i.exec(s))) { const c = caseOf(m[1]); return (n) => keepTitle(dollars(n), c); }
  return null;
}

/**
 * Generic format. Dispatches on the value:
 *  - dates → date tokens / presets / date example ("June 3, 1990")
 *  - numbers → number pattern ("0.00", "#,##0.00") or example ("$9,999.00", "Nine", "3rd", "Nine Dollars and 9/100")
 *  - text → case example ("LIKE THIS", "Like This", "like this")
 * @param {any} value
 * @param {string} pattern
 */
export function format(value, pattern, alt) {
  if (isBlank(value)) return '';
  if (typeof value === 'boolean') return value ? str(pattern ?? 'Yes') : str(alt ?? (pattern == null ? 'No' : ''));
  if (value instanceof Date || isDateLike(value)) return formatDate(value, pattern);
  const n = num(value);
  if (!Number.isNaN(n) && typeof value !== 'boolean') {
    const f = typeof pattern === 'string' ? inferNumberFormat(pattern) : null;
    if (f) return f(n);
    return String(value);
  }
  const text = str(value);
  if (typeof pattern === 'string' && /[A-Za-z]/.test(pattern)) {
    const p = pattern.trim();
    if (p === p.toUpperCase() && p !== p.toLowerCase()) return text.toUpperCase();
    if (p === p.toLowerCase()) return text.toLowerCase();
    if (p === title(p)) return title(text);
  }
  return text;
}

// ---------------------------------------------------------------- text

export function upper(v) { return str(v).toUpperCase(); }
export function lower(v) { return str(v).toLowerCase(); }
/** Title Case Every Word. */
export function title(v) { return str(v).toLowerCase().replace(/(^|[\s\-("'/])([a-z])/g, (m, pre, c) => pre + c.toUpperCase()); }
/** Capitalize only the first character. */
export function capitalize(v) { const s = str(v); return s ? s[0].toUpperCase() + s.slice(1) : ''; }
export function trim(v) { return str(v).trim(); }
export function len(v) { if (v == null) return 0; if (Array.isArray(v) || typeof v === 'string') return v.length; if (typeof v === 'object') return Object.keys(v).length; return String(v).length; }
export const length = len;
export function contains(hay, needle) {
  if (hay == null) return false;
  if (Array.isArray(hay)) return hay.some((x) => x === needle || str(x) === str(needle));
  return str(hay).toLowerCase().includes(str(needle).toLowerCase());
}
export function startswith(s, prefix) { return str(s).toLowerCase().startsWith(str(prefix).toLowerCase()); }
export function endswith(s, suffix) { return str(s).toLowerCase().endsWith(str(suffix).toLowerCase()); }
export function replace(s, find, rep = '') { const src = str(s); if (isBlank(find)) return src; return src.split(str(find)).join(str(rep)); }
/** initials("Ann Lee") → "AL"; initials(name, ".") → "A.L."; initials(name, " ") → "A. L.". */
export function initials(name, sep = '') {
  const parts = str(name).split(/[\s\-]+/).filter(Boolean).map((w) => w[0].toUpperCase());
  const s = str(sep);
  if (s === '') return parts.join('');
  if (s === '.') return parts.map((c) => c + '.').join('');
  return parts.map((c) => c + '.').join(s);
}
export function nbsp() { return ' '; }
export function blank() { return ''; }
/** "James" → "James'", "Mary" → "Mary's". */
export function possessive(name) { const s = str(name); if (!s) return ''; return s.endsWith('s') || s.endsWith('S') ? s + "'" : s + "'s"; }

const PRONOUNS = {
  male: { subject: 'he', object: 'him', possessive: 'his', possessiveadj: 'his', reflexive: 'himself' },
  female: { subject: 'she', object: 'her', possessive: 'hers', possessiveadj: 'her', reflexive: 'herself' },
  neutral: { subject: 'they', object: 'them', possessive: 'theirs', possessiveadj: 'their', reflexive: 'themselves' },
};
/**
 * pronoun("female", "subject") → "she". Gender accepts male/female/neutral (m/f/n, man/woman, he/she/they).
 * Forms: subject | object | possessive | possessiveadj | reflexive.
 */
export function pronoun(gender, form = 'subject') {
  const g = str(gender).toLowerCase().trim();
  const key = /^(m|male|man|he|him|his)$/.test(g) ? 'male' : /^(f|female|woman|she|her|hers)$/.test(g) ? 'female' : 'neutral';
  const f = str(form).toLowerCase().replace(/[^a-z]/g, '');
  const table = PRONOUNS[key];
  return table[f] || table[{ subj: 'subject', obj: 'object', poss: 'possessive', possadj: 'possessiveadj', adj: 'possessiveadj', refl: 'reflexive' }[f]] || table.subject;
}

/**
 * pluralize(count, singular, plural?) → "1 child" / "3 children". Pass `bare=true` to omit the number.
 */
export function pluralize(count, singular = '', plural, bare = false) {
  const n = Array.isArray(count) ? count.length : num(count);
  const c = Number.isNaN(n) ? 0 : n;
  const pl = plural == null || plural === '' ? pluralOf(singular) : plural;
  const word = c === 1 ? singular : pl;
  return bare === true || bare === 'bare' ? str(word) : `${number(c)} ${word}`.trim();
}
function pluralOf(s) { return plural(s); }

/**
 * join(["A","B","C"]) → "A, B, and C"; join(list, "or"); join(list, "and", false) → "A, B and C".
 * Non-string items are stringified. Blank items are skipped.
 */
export function join(list, conjunction = 'and', oxford = true) {
  const items = asList(list).map(str).filter((s) => s !== '');
  if (conjunction === false || conjunction === null) conjunction = '';
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  const conj = str(conjunction).trim();
  if (conj === '' || conj === ',') return items.join(', ');
  if (items.length === 2) return `${items[0]} ${conj} ${items[1]}`;
  const ox = oxford === false || oxford === 'false' ? '' : ',';
  return `${items.slice(0, -1).join(', ')}${ox} ${conj} ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------- logic / defaults

/** Return `fallback` when value is blank (null/undefined/""). */
export function dflt(value, fallback = '') { return isBlank(value) ? fallback : value; }
export { dflt as default_ };
export function coalesce(...args) { return args.find((a) => !isBlank(a)) ?? ''; }
export function isEmpty(v) { return !truthy(v); }
export function iff(cond, a, b = '') { return truthy(cond) ? a : b; }

// ---------------------------------------------------------------- lists

export function list(...items) { return items; }
export function count(v, field) {
  const arr = asList(v);
  if (isBlank(field)) return arr.length;
  return arr.filter((it) => truthy(getField(it, field))).length;
}
export function sum(v, field) { return asList(v).reduce((s, it) => { const n = num(isBlank(field) ? it : getField(it, field)); return s + (Number.isNaN(n) ? 0 : n); }, 0); }
export function any(v, field) { const arr = asList(v); return arr.some((it) => truthy(isBlank(field) ? it : getField(it, field))); }
export function all(v, field) { const arr = asList(v); return arr.length > 0 && arr.every((it) => truthy(isBlank(field) ? it : getField(it, field))); }
export function first(v, field) { const arr = asList(v); return arr.length ? (isBlank(field) ? arr[0] : getField(arr[0], field)) : undefined; }
export function last(v, field) { const arr = asList(v); return arr.length ? (isBlank(field) ? arr[arr.length - 1] : getField(arr[arr.length - 1], field)) : undefined; }
/** sort(list, field?, "desc"?) — stable sort; dates and numbers compare naturally. */
export function sort(v, field, dir) {
  const arr = asList(v).slice();
  const key = (it) => (isBlank(field) ? it : getField(it, field));
  arr.sort((a, b) => cmp(key(a), key(b)));
  if (dir && String(dir).toLowerCase().startsWith('desc')) arr.reverse();
  return arr;
}
function cmp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (isDateLike(a) && isDateLike(b)) return parseDate(a) - parseDate(b);
  const na = num(a), nb = num(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return str(a).localeCompare(str(b));
}
/** filter(list, fieldName, value?) — keep items where field == value (or is truthy when value omitted). */
export function filter(v, field, value) {
  const arr = asList(v);
  if (isBlank(field)) return arr.filter(truthy);
  if (value === undefined) return arr.filter((it) => truthy(getField(it, field)));
  return arr.filter((it) => { const f = getField(it, field); return f === value || str(f).toLowerCase() === str(value).toLowerCase(); });
}
/** map(list, field) → list of field values. */
export function pluck(v, field) { return asList(v).map((it) => getField(it, field)); }
export function reverse(v) { return asList(v).slice().reverse(); }
export function unique(v) { return [...new Set(asList(v))]; }

// ---------------------------------------------------------------- date math

export function today() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function now() { return new Date(); }
export function addDays(date, n) { const d = parseDate(date); if (!d) return ''; d.setDate(d.getDate() + (Number(n) || 0)); return d; }
export function addMonths(date, n) {
  const d = parseDate(date); if (!d) return '';
  const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + (Number(n) || 0));
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}
export function addYears(date, n) { return addMonths(date, 12 * (Number(n) || 0)); }
/** Whole years between a and b (b defaults to today). Age calc: yearsBetween(DOB). */
export function yearsBetween(a, b) {
  const da = parseDate(a), db = b == null || b === '' ? today() : parseDate(b);
  if (!da || !db) return '';
  const [lo, hi] = da <= db ? [da, db] : [db, da];
  let y = hi.getFullYear() - lo.getFullYear();
  if (hi.getMonth() < lo.getMonth() || (hi.getMonth() === lo.getMonth() && hi.getDate() < lo.getDate())) y--;
  return da <= db ? y : -y;
}
export const age = yearsBetween;
export function dateDiffDays(a, b) {
  const da = parseDate(a), db = b == null || b === '' ? today() : parseDate(b);
  if (!da || !db) return '';
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}
export function year(d) { const x = parseDate(d); return x ? x.getFullYear() : ''; }
export function month(d) { const x = parseDate(d); return x ? x.getMonth() + 1 : ''; }
export function day(d) { const x = parseDate(d); return x ? x.getDate() : ''; }
export function monthName(d) { const x = parseDate(d); return x ? MONTHS[x.getMonth()] : ''; }
export function weekday(d) { const x = parseDate(d); return x ? DAYS[x.getDay()] : ''; }
export function date(v) { return parseDate(v) || ''; }

// ---------------------------------------------------------------- grammar helpers

const countOf = (v) => (Array.isArray(v) ? v.length : typeof v === 'boolean' ? (v ? 2 : 1) : num(v));
const singular = (v) => { const c = countOf(v); return !Number.isNaN(c) && c === 1; };
/** isAre(count|list) → "is" / "are". */
export function isAre(v) { return singular(v) ? 'is' : 'are'; }
export function hasHave(v) { return singular(v) ? 'has' : 'have'; }
export function doesDo(v) { return singular(v) ? 'does' : 'do'; }
export function wasWere(v) { return singular(v) ? 'was' : 'were'; }
/** article("apple") → "an"; article("house") → "a". */
export function article(word) {
  const w = str(word).trim();
  if (!w) return '';
  const lw = w.toLowerCase();
  // Initialisms are read letter by letter: "an LLC", "an FBI agent", "an MBA"; numbers by sound: "an 8", "an 11".
  if (/^[A-Z]{2,}\b/.test(w) && w !== w.toLowerCase()) return /^[AEFHILMNORSX]/.test(w) ? 'an' : 'a';
  if (/^\d/.test(w)) return /^(8|11|18|8\d)(\D|$)/.test(w) ? 'an' : 'a';
  if (/^(hour|honest|honor|heir)/.test(lw)) return 'an';
  if (/^(uni|use|user|utah|one|eu|euro)/.test(lw)) return 'a';
  return /^[aeiou]/.test(lw) ? 'an' : 'a';
}
const IRREGULAR_PLURALS = { child: 'children', person: 'people', man: 'men', woman: 'women', foot: 'feet', tooth: 'teeth', mouse: 'mice', goose: 'geese', ox: 'oxen', trustee: 'trustees', attorney: 'attorneys', deer: 'deer', sheep: 'sheep', series: 'series', species: 'species', heir: 'heirs', beneficiary: 'beneficiaries', spouse: 'spouses', life: 'lives', wife: 'wives', knife: 'knives', half: 'halves', self: 'selves', alumnus: 'alumni', datum: 'data', criterion: 'criteria', index: 'indices', matrix: 'matrices' };
/**
 * plural("child") → "children"; plural("entity", 1) → "entity"; plural("box", 3) → "boxes".
 * @param {string} word
 * @param {number|any[]} [count] when 1 (or a one-item list), returns the singular
 */
export function plural(word, count) {
  const w = str(word).trim();
  if (!w) return '';
  if (count !== undefined && singular(count)) return w;
  const lw = w.toLowerCase();
  const matchCase = (out) => (w === w.toUpperCase() && w.length > 1 ? out.toUpperCase() : w[0] === w[0].toUpperCase() ? out[0].toUpperCase() + out.slice(1) : out);
  if (IRREGULAR_PLURALS[lw]) return matchCase(IRREGULAR_PLURALS[lw]);
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + 'es';
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
  if (/[^f]fe?$/i.test(w) && !/(roof|belief|chief|proof|safe)$/i.test(w)) return w.replace(/fe?$/i, 'ves');
  return w + 's';
}
/** quantity(3, "heir") → "3 heirs"; quantity(1, "child") → "1 child". */
export function quantity(count, noun) {
  const c = countOf(count);
  const n = Number.isNaN(c) ? 0 : c;
  return `${number(n)} ${plural(noun, n)}`.trim();
}
/** salutation("female") → "Ms."; male → "Mr."; otherwise "Mx.". */
export function salutation(gender) {
  const g = str(gender).toLowerCase().trim();
  if (/^(f|female|woman|she|her|ms|mrs|miss)/.test(g)) return g.startsWith('mrs') ? 'Mrs.' : g === 'miss' ? 'Miss' : 'Ms.';
  if (/^(m|male|man|he|him|his|mr)/.test(g)) return 'Mr.';
  return 'Mx.';
}
/** roman(4) → "IV". */
export function roman(value) {
  let n = Math.trunc(num(value));
  if (Number.isNaN(n) || n <= 0 || n >= 4000) return '';
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, r] of table) while (n >= v) { out += r; n -= v; }
  return out;
}
/** alpha(1) → "a", alpha(27) → "aa" (spreadsheet-style, bijective base 26). alpha(n, true) → upper. */
export function alpha(value, upper = false) {
  let n = Math.trunc(num(value));
  if (Number.isNaN(n) || n <= 0) return '';
  let out = '';
  while (n > 0) { n--; out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); }
  return upper === true || upper === 'upper' ? out.toUpperCase() : out;
}


// ---------------------------------------------------------------- Knackly-compatible extras

/** initcap("jOHN") → "JOHN"; initcap("jOHN", true) → "John" (rest lowercased). */
export function initcap(v, restLower = false) {
  const s = str(v);
  if (!s) return '';
  const rest = restLower === true || restLower === 'true' ? s.slice(1).toLowerCase() : s.slice(1);
  return s[0].toUpperCase() + rest;
}
export const titlecaps = title;
/** cardinal(123) → "one hundred twenty-three" (alias of words). */
export const cardinal = words;
/** ordsuffix(22) → "nd". */
export function ordsuffix(v) { const o = ordinal(v); return o ? o.replace(/^-?\d+/, '') : ''; }
/** cardinaldec(12.35, 2) → "twelve point three five". */
export function cardinaldec(v, decimals) {
  const n = num(v);
  if (Number.isNaN(n)) return '';
  const fixed = decimals == null || decimals === '' ? String(Math.abs(n)) : Math.abs(n).toFixed(Number(decimals));
  const [int, frac] = fixed.split('.');
  let out = (n < 0 ? 'minus ' : '') + words(int);
  if (frac && frac.length) out += ' point ' + frac.split('').map((d) => ONES[+d]).join(' ');
  return out;
}
/** cardinalcur(50.10, "dollars", "cents") → "Fifty Dollars and Ten Cents". */
export function cardinalcur(v, unit = 'dollars', subunit = 'cents') {
  const m = splitMoney(v);
  if (!m) return '';
  const U = title(str(unit) || 'dollars'), S = title(str(subunit) || 'cents');
  const sing = (w) => (w.endsWith('s') ? w.slice(0, -1) : w);
  const head = `${m.n < 0 ? 'Minus ' : ''}${title(words(m.whole))} ${m.whole === 1 ? sing(U) : U}`;
  return m.cents ? `${head} and ${title(words(m.cents))} ${m.cents === 1 ? sing(S) : S}` : head;
}
export const ordinalword = ordinalwords;

/**
 * Parse a Knackly punctuation example such as "1, 2, and 3", "1, 2 and 3", "1 and 2",
 * "1; 2; or 3", "1, 2, and 3." (trailing "." kept as suffix).
 * @param {string} ex
 * @returns {{sep:string,lastSep:string,twoSep:string,suffix:string}}
 */
export function parsePuncExample(ex) {
  const s = str(ex);
  const m = /^\s*1(.*?)2(?:(.*?)3)?(.*)$/s.exec(s);
  if (!m) return { sep: ', ', lastSep: ', and ', twoSep: ' and ', suffix: '' };
  if (m[2] === undefined) {
    const two = m[1];
    const lastSep = /^\s*(and|or)\b/i.test(two.trim()) || two.trim() === '' ? two : two;
    return { sep: ', ', lastSep: lastSep.includes(',') ? lastSep : ', ' + lastSep.replace(/^\s+/, ''), twoSep: two, suffix: m[3] || '' };
  }
  const sep = m[1], lastSep = m[2];
  const twoSep = lastSep.replace(/^\s*[,;]\s*/, ' ');
  return { sep, lastSep, twoSep: twoSep.startsWith(' ') ? twoSep : ' ' + twoSep, suffix: m[3] || '' };
}
/**
 * The separator to print after item i (0-based) of n, for a parsed punc spec.
 */
export function puncFor(spec, i, n) {
  if (i === n - 1) return spec.suffix || '';
  if (n === 2) return spec.twoSep;
  if (i === n - 2) return spec.lastSep;
  return spec.sep;
}
/** punc(list, "1, 2, and 3") → "A, B, and C" — list joining by example. */
export function punc(list, example, oxford) {
  const items = asList(list).map(str).filter((x) => x !== '');
  if (example == null || example === '' || !/1/.test(str(example))) return join(list, example == null || example === '' ? 'and' : example, oxford);
  const spec = parsePuncExample(example);
  return items.map((it, i) => it + puncFor(spec, i, items.length)).join('');
}

// ---------------------------------------------------------------- value methods (Knackly dot-methods)

const firstN = (v, n) => (Array.isArray(v) ? v.slice(0, n == null ? 1 : Number(n)) : str(v).slice(0, n == null ? 1 : Number(n)));
const lastN = (v, n) => { const k = n == null ? 1 : Number(n); return Array.isArray(v) ? v.slice(Math.max(0, v.length - k)) : str(v).slice(Math.max(0, str(v).length - k)); };
/**
 * Methods callable with dot syntax on values: `Name.toUpperCase()`, `Children.first()`, `Fee.toInt()`.
 * Each receives the receiver as first argument.
 */
export const methods = Object.assign(Object.create(null), {
  toUpperCase: upper, toLowerCase: lower, toupper: upper, tolower: lower, upper, lower, trim, title, capitalize, initcap,
  length: len, len, count,
  includes: contains, contains, startsWith: startswith, startswith, endsWith: endswith, endswith, replace,
  split: (v, sep = ',') => str(v).split(str(sep)),
  slice: (v, a, b) => (Array.isArray(v) ? v.slice(a, b) : str(v).slice(a, b)),
  substring: (v, a, b) => str(v).substring(a, b),
  indexOf: (v, x) => (Array.isArray(v) ? v.indexOf(x) : str(v).indexOf(str(x))),
  indexof: (v, x) => (Array.isArray(v) ? v.indexOf(x) : str(v).indexOf(str(x))),
  join: (v, sep = ', ') => asList(v).map(str).join(str(sep)),
  padStart: (v, n, c = ' ') => str(v).padStart(Number(n), str(c)), padstart: (v, n, c = ' ') => str(v).padStart(Number(n), str(c)),
  padEnd: (v, n, c = ' ') => str(v).padEnd(Number(n), str(c)), padend: (v, n, c = ' ') => str(v).padEnd(Number(n), str(c)),
  toInt: (v) => { const n = parseInt(str(v).replace(/[$,\s]/g, ''), 10); return Number.isNaN(n) ? '' : n; },
  toint: (v) => { const n = parseInt(str(v).replace(/[$,\s]/g, ''), 10); return Number.isNaN(n) ? '' : n; },
  toFloat: (v) => { const n = num(v); return Number.isNaN(n) ? '' : n; },
  toNumber: (v) => { const n = num(v); return Number.isNaN(n) ? '' : n; },
  toString: str, tostring: str,
  first: (v, n) => (n == null && Array.isArray(v) ? v[0] : firstN(v, n)),
  last: (v, n) => (n == null && Array.isArray(v) ? v[v.length - 1] : lastN(v, n)),
  reverse, unique, sort, filter, where: filter, map: pluck, any, all, every: all, some: any, sum, min, max,
  format, year, month, day, weekday, monthName, addDays, addMonths, addYears, age: yearsBetween,
  toFixed: (v, d = 0) => { const n = num(v); return Number.isNaN(n) ? '' : n.toFixed(Number(d)); },
  round, abs, words, ordinal, ordinalwords, currency, number, dollars, isEmpty, punc, plural, possessive, initials,
});

// ---------------------------------------------------------------- namespaces (date.*, math.*, finance.*)

function dateNew(y, m, d) { const dt = mk(Number(y), Number(m), Number(d)); return dt || ''; }
function subDays(d, n) { return addDays(d, -(Number(n) || 0)); }
function addWeeks(d, n) { return addDays(d, 7 * (Number(n) || 0)); }
function monthsBetween(a, b) {
  const da = parseDate(a), db = b == null || b === '' ? today() : parseDate(b);
  if (!da || !db) return '';
  let m = (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth());
  if (db.getDate() < da.getDate()) m--;
  return m;
}
const dateNs = {
  today, now, parse: parseDate, new: dateNew, create: dateNew,
  addDays, addWeeks, addMonths, addYears,
  subDays, subWeeks: (d, n) => addWeeks(d, -(Number(n) || 0)), subMonths: (d, n) => addMonths(d, -(Number(n) || 0)), subYears: (d, n) => addYears(d, -(Number(n) || 0)),
  age: yearsBetween, dayOf: day, monthOf: month, yearOf: year, dayOfWeek: (d) => { const x = parseDate(d); return x ? x.getDay() : ''; }, dayOfWeekName: weekday, weekday,
  daysBetween: dateDiffDays, monthsBetween, yearsBetween, format: formatDate, iso: toISODate,
  isDate: (v) => !!parseDate(v),
};

// Excel-semantics finance functions. rate per period; nper periods; pmt payment; pv; fv; type 0=end,1=begin.
function PMT(rate, nper, pv, fv = 0, type = 0) {
  rate = num(rate); nper = num(nper); pv = num(pv); fv = num(fv) || 0; type = num(type) || 0;
  if ([rate, nper, pv].some(Number.isNaN)) return '';
  if (rate === 0) return -(pv + fv) / nper;
  const f = Math.pow(1 + rate, nper);
  return -(rate * (pv * f + fv)) / ((1 + rate * type) * (f - 1));
}
function FV(rate, nper, pmt, pv = 0, type = 0) {
  rate = num(rate); nper = num(nper); pmt = num(pmt); pv = num(pv) || 0; type = num(type) || 0;
  if ([rate, nper, pmt].some(Number.isNaN)) return '';
  if (rate === 0) return -(pv + pmt * nper);
  const f = Math.pow(1 + rate, nper);
  return -(pv * f + (pmt * (1 + rate * type) * (f - 1)) / rate);
}
function PV(rate, nper, pmt, fv = 0, type = 0) {
  rate = num(rate); nper = num(nper); pmt = num(pmt); fv = num(fv) || 0; type = num(type) || 0;
  if ([rate, nper, pmt].some(Number.isNaN)) return '';
  if (rate === 0) return -(fv + pmt * nper);
  const f = Math.pow(1 + rate, nper);
  return -(fv + (pmt * (1 + rate * type) * (f - 1)) / rate) / f;
}
function NPER(rate, pmt, pv, fv = 0, type = 0) {
  rate = num(rate); pmt = num(pmt); pv = num(pv); fv = num(fv) || 0; type = num(type) || 0;
  if ([rate, pmt, pv].some(Number.isNaN)) return '';
  if (rate === 0) return -(pv + fv) / pmt;
  const a = pmt * (1 + rate * type);
  return Math.log((a - fv * rate) / (a + pv * rate)) / Math.log(1 + rate);
}
function RATE(nper, pmt, pv, fv = 0, type = 0, guess = 0.1) {
  nper = num(nper); pmt = num(pmt); pv = num(pv); fv = num(fv) || 0; type = num(type) || 0; guess = num(guess) || 0.1;
  if ([nper, pmt, pv].some(Number.isNaN)) return '';
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = Math.pow(1 + rate, nper);
    const y = pv * f + pmt * (1 + rate * type) * (f - 1) / rate + fv;
    const df = pv * nper * Math.pow(1 + rate, nper - 1) + pmt * (1 + rate * type) * (nper * Math.pow(1 + rate, nper - 1) * rate - (f - 1)) / (rate * rate) + pmt * type * (f - 1) / rate;
    const next = rate - y / df;
    if (!Number.isFinite(next)) return '';
    if (Math.abs(next - rate) < 1e-10) return next;
    rate = next;
  }
  return rate;
}
const financeNs = { PMT, PV, FV, NPER, RATE, pmt: PMT, pv: PV, fv: FV, nper: NPER, rate: RATE };
const mathNs = Object.fromEntries(Object.getOwnPropertyNames(Math).map((k) => [k, typeof Math[k] === 'function' ? (...a) => Math[k](...a.map(num)) : Math[k]]));

/** Namespaced helpers: `date.today()`, `math.floor(x)`, `finance.PMT(rate, nper, pv)`. */
export const namespaces = Object.assign(Object.create(null), { date: dateNs, math: mathNs, finance: financeNs });
export { PMT, PV, FV, NPER, RATE, monthsBetween, addWeeks, subDays };

// ---------------------------------------------------------------- registry

/**
 * Function/filter registry: name → fn. Names are matched case-insensitively by the evaluator
 * (lower-case keys are canonical).
 * @type {Object<string, Function>}
 */
export const functions = Object.assign(Object.create(null), {
  upper, lower, title, titlecase: title, capitalize, trim, currency, number, words, dollars, dollarswords: dollarsWords, dollarsWords, dollarsfull: dollarsFull, dollarsFull, dollarsandcents: dollarsAndCents, dollarsAndCents, cents,
  isare: isAre, isAre, hashave: hasHave, hasHave, doesdo: doesDo, doesDo, waswere: wasWere, wasWere, article, plural, quantity, salutation, punc, roman, alpha,
  ordinal, ordinalwords, ordinalWords: ordinalwords, format, formatdate: formatDate, formatDate, default: dflt, pluralize, join, possessive, pronoun, initials,
  count, sum, any, all, first, last, len, length, contains, startswith, startsWith: startswith, endswith, endsWith: endswith, replace,
  today, now, adddays: addDays, addDays, addmonths: addMonths, addMonths, addyears: addYears, addYears,
  yearsbetween: yearsBetween, yearsBetween, age, datediffdays: dateDiffDays, dateDiffDays, year, month, day, monthname: monthName, monthName, weekday, date,
  min, max, round, abs, if: iff, coalesce, isempty: isEmpty, isEmpty, list, sort, sortby: sort, filter, where: filter, map: pluck, pluck, reverse, unique,
  blank, nbsp, str: str, string: str, parsedate: parseDate, parseDate, isodate: toISODate, toISODate,
  else: dflt, initcap, titlecaps, cardinal, ordsuffix, cardinaldec, cardinalcur, ordinalword, find: (l, f, v) => filter(l, f, v)[0], every: all, some: any,
  group: (l, f) => { const g = new Map(); asList(l).forEach((it) => { const k = getField(it, f); if (!g.has(k)) g.set(k, { _key: k, _values: [] }); g.get(k)._values.push(it); }); return [...g.values()]; },
  pmt: PMT, pv: PV, fv: FV, nper: NPER, monthsbetween: monthsBetween, monthsBetween, addweeks: addWeeks, addWeeks, subdays: subDays, subDays,
});

/**
 * Register a custom function/filter (also usable as `{[value|name]}`).
 * @param {string} name
 * @param {Function} fn
 */
export function registerFunction(name, fn) {
  if (typeof fn !== 'function') throw new TypeError('registerFunction expects a function');
  if (/^(__proto__|constructor|prototype)$/i.test(name)) throw new TypeError(`Cannot register a function named "${name}"`);
  functions[name] = fn;
  functions[name.toLowerCase()] = fn;
}

export { str as toText, truthy, getField };
