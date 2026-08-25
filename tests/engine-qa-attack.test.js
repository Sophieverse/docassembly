// Regression tests from the engine QA attack pass: whitespace handling, nesting,
// expression parsing, function edge cases, analysis/relevance, coercion, and the
// engine items from docs/code-review-1.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assemble, compile, parse, analyze, questionnaire, render, formatValue,
  functions as F, formatDate, parseDate, toISODate, parseExpr, evalExpr, createTrace, createScope,
  createModel, mergeModel, coerce, validate, setPath, getPath, registerFunction, tokenize,
} from '../engine/index.js';

const R = (tpl, data = {}, opts) => assemble(tpl, data, opts);
const ev = (src, data = {}) => evalExpr(parseExpr(src), data);
const qpaths = (tpl, data = {}, model) => questionnaire(parse(tpl), data, model).map((q) => q.path);

// ---------------------------------------------------------------- whitespace / standalone tags

test('adjacent structural tags on one line count as a standalone line', () => {
  assert.equal(R('A\n{[if X]}\nB\n{[endif]}{[if Y]}\nC\n{[endif]}\nD', { X: true, Y: true }).text, 'A\nB\nC\nD');
  assert.equal(R('A\n{[if X]}\nB\n{[endif]}{[if Y]}\nC\n{[endif]}\nD', { X: false, Y: false }).text, 'A\nD');
  assert.equal(R('{[if X]}{[if Y]}\nB\n{[endif]}{[endif]}\nC', { X: true, Y: true }).text, 'B\nC');
  assert.equal(R('{[if X]}{[if Y]}\nB\n{[endif]}{[endif]}\nC', { X: false, Y: true }).text, 'C');
  // whitespace between the grouped tags is fine too
  assert.equal(R('A\n{[end if]} \t{[if Y]}\nC\n{[endif]}\nD'.replace('{[end if]}', '{[if X]}\nB\n{[end if]}'), { X: true, Y: true }).text, 'A\nB\nC\nD');
  // a value field on the same line keeps the line
  assert.equal(R('Name: {[N]} {[if X]}\nB\n{[endif]}\nC', { N: 'n', X: true }).text, 'Name: n \nB\nC');
});

test('CRLF templates (Word) strip standalone tag lines cleanly', () => {
  assert.equal(R('A\r\n{[if X]}\r\nB\r\n{[endif]}\r\nC', { X: true }).text, 'A\r\nB\r\nC');
  assert.equal(R('A\r\n{[if X]}\r\nB\r\n{[endif]}\r\nC', { X: false }).text, 'A\r\nC');
  assert.equal(R('A\r\n{[list L]}\r\n- {[Name]}\r\n{[endlist]}\r\nC', { L: [{ Name: 'a' }, { Name: 'b' }] }).text, 'A\r\n- a\r\n- b\r\nC');
});

test('tags with trailing spaces/tabs, at file start and end, inside a numbered item', () => {
  assert.equal(R('A\n{[if X]}   \nB\n{[endif]}\t\nC', { X: false }).text, 'A\nC');
  assert.equal(R('{[if X]}\nB\n{[endif]}\nC', { X: false }).text, 'C');
  assert.equal(R('A\n{[if X]}\nB\n{[endif]}', { X: false }).text, 'A\n');
  assert.equal(R('1. {[if A]}text{[endif]}\n2. other', { A: true }).text, '1. text\n2. other');
  assert.equal(R('1. {[if A]}text{[endif]}\n2. other', { A: false }).text, '1. \n2. other');
});

test('comments may mention tags: {[# use {[if X]} here ]}', () => {
  assert.deepEqual(compile('{[# wrap it in {[if IsMarried]} … {[end if]} ]}\nHello {[Name]}').errors, []);
  assert.equal(R('{[# see {[list Kids]} ]}\nHi {[Name]}', { Name: 'A' }).text, 'Hi A');
  assert.equal(R('{[# start with {[if X]} then {[end if]} — nothing here prints ]}\nHi', {}).text, 'Hi');
  // the typo check still fires outside comments
  assert.equal(compile('a {[Name} b {[Other]}').errors.length, 1);
  assert.throws(() => tokenize('{[Name'), /Unterminated field/);
});

// ---------------------------------------------------------------- nesting

test('deep nesting, if-inside-list-inside-if, nested lists with _punc and _index', () => {
  assert.equal(R('{[if A]}1{[if B]}2{[if C]}3{[if D]}4{[if E]}5{[endif]}{[endif]}{[endif]}{[endif]}{[endif]}', { A: 1, B: 1, C: 1, D: 1, E: 1 }).text, '12345');
  assert.equal(R('{[if A]}{[list L]}{[if Ok]}{[N]}{[_punc]}{[endif]}{[endlist]}{[endif]}', { A: true, L: [{ N: 'x', Ok: true }, { N: 'y', Ok: false }, { N: 'z', Ok: true }] }).text, 'x, z');
  const nested = { T: [{ Name: 'T1', B: [{ Name: 'a' }, { Name: 'b' }, { Name: 'c' }] }, { Name: 'T2', B: [{ Name: 'd' }] }] };
  assert.equal(R('{[list T]}{[Name]}: {[list B]}{[Name]}{[_punc]}{[endlist]}; {[endlist]}', nested).text, 'T1: a, b, and c; T2: d; ');
  assert.equal(R('{[list T]}{[_index]}.{[list B]}{[_index]}{[endlist]} {[endlist]}', { T: [{ B: [1, 2] }, { B: [3] }] }).text, '1.12 2.1 ');
});

test('list over empty / null / undefined / scalar values', () => {
  for (const L of [[], null, undefined]) assert.equal(R('[{[list L]}{[_item]}{[endlist]}]', { L }).text, '[]');
  assert.equal(R('[{[list L]}{[_item]}{[endlist]}]', { L: 'abc' }).text, '[abc]');
  assert.equal(R('[{[list L]}{[_item]}{[endlist]}]', { L: 5 }).text, '[5]');
  assert.equal(R('{[list L]}{[_index]}/{[_count]}{[_punc]}{[endlist]}', { L: ['a', 'b'] }).text, '1/2 and 2/2');
});

// ---------------------------------------------------------------- expressions

test('a filter chain may be followed by a comparison or logical operator', () => {
  assert.equal(R('{[if Children|count > 2]}many{[else]}few{[endif]}', { Children: [1, 2, 3] }).text, 'many');
  assert.equal(R('{[if Children|count > 2]}many{[else]}few{[endif]}', { Children: [1] }).text, 'few');
  assert.equal(ev('Name|trim = ""', { Name: '   ' }), true);
  assert.equal(ev('Flag|default:false and X', { X: true }), false);
  assert.equal(ev('Flag|default:true and X', { X: true }), true);
  assert.equal(ev('A|upper ? 1 : 2', { A: 'x' }), 1);
  assert.equal(ev('Kids|filter: Age < 18|count >= 1', { Kids: [{ Age: 3 }, { Age: 30 }] }), true);
  assert.equal(ev('Fee|round + 1', { Fee: 2.6 }), 4);
  // inside a ternary branch, parenthesise a filter (":" would read as a filter argument)
  assert.equal(ev('A ? (B|upper) : "no"', { A: 1, B: 'x' }), 'X');
  // untouched: filter args are still full expressions
  assert.equal(ev('X|default: Y ? "a" : "b"', { Y: true }), 'a');
  assert.equal(ev('Fee|currency:"€",0', { Fee: 5 }), '€5');
});

test('list(...) and if(...) written as function calls are fields, not block tags', () => {
  assert.equal(R('{[list("a","b","c")|join:"or"]}').text, 'a, b, or c');
  assert.equal(R('{[if(A, "yes", "no")]}', { A: 0 }).text, 'no');
  assert.equal(R('{[if(A, "yes", "no")|upper]}', { A: 1 }).text, 'YES');
  // parenthesised conditions are still conditions
  assert.equal(R('{[if (A and B)]}y{[else]}n{[endif]}', { A: 1, B: 1 }).text, 'y');
  assert.equal(R('{[if(A and B)]}y{[else]}n{[endif]}', { A: 1, B: 0 }).text, 'n');
  assert.equal(R('{[list (Kids)]}{[N]}{[end list]}', { Kids: [{ N: 'k' }] }).text, 'k');
});

test('unicode identifiers', () => {
  assert.equal(R('{[Nöm]} {[名前]} {[list Kinder as kind]}{[kind.Name]}{[endlist]}', { Nöm: 'x', 名前: 'y', Kinder: [{ Name: 'z' }] }).text, 'x y z');
  assert.deepEqual(compile('{[Ärger]}').errors, []);
});

test('bad expressions produce errors or warnings, never crashes', () => {
  for (const tpl of ['{[if X = "CA]}a{[endif]}', 'a {[ ]} b', '{[if]}a{[endif]}', 'a {[end if]}', 'a {[else]} b', '{[A B]}', '{[5.]}']) {
    const r = compile(tpl);
    assert.equal(r.errors.length, 1, tpl);
    assert.ok(typeof r.errors[0].line === 'number', tpl);
  }
  assert.deepEqual(compile('{[if X]}a{[endif]}{[if Y]}b{[end if]}{[if Z]}c{[end]}').errors, []);
  const r = R('{[Name|frobnicate]} {[A / 0]} {[frob(Name)]}', { Name: 'n', A: 1 });
  assert.equal(r.text, '  ');
  assert.ok(r.warnings.some((w) => /Unknown function "frobnicate"/.test(w)));
  assert.ok(r.warnings.some((w) => /Unknown function "frob"/.test(w)));
  assert.equal(R('{[' + '('.repeat(200) + '1' + ')'.repeat(200) + ']}').text, '1');
});

test('smart quotes, string/number/date comparisons, precedence', () => {
  assert.equal(R('{[if X = “CA”]}ca{[endif]} {[Name|format:‘Like This’]}', { X: 'CA', Name: 'ann lee' }).text, 'ca Ann Lee');
  assert.equal(ev('"10" > 9'), true);
  assert.equal(ev('X > 9', { X: '10' }), true);
  assert.equal(ev('D < "2026-01-01"', { D: 'March 5, 2025' }), true);
  assert.equal(ev('A or B and C', { A: false, B: true, C: false }), false);
  assert.equal(ev('not A = B', { A: 1, B: 2 }), true);
  assert.equal(ev('A ? "a" : B ? "b" : "c"', { A: false, B: true }), 'b');
});

test('numeric-string equality is exact ("01234" != "1234"); numbers still compare loosely to numeric text', () => {
  assert.equal(ev('"01234" = "1234"'), false);
  assert.equal(ev('"10" = "10.0"'), false);
  assert.equal(ev('X = "1"', { X: 1 }), true);
  assert.equal(ev('X = 1', { X: '1' }), true);
  assert.equal(ev('D = "2026-03-05"', { D: '3/5/2026' }), true);
  assert.equal(ev('Zip = "01234"', { Zip: '01234' }), true);
});

test('prototype names never resolve to inherited members', () => {
  for (const src of ['constructor', 'valueOf', 'toString', '__proto__', 'Name.constructor', 'constructor.name', 'prototype', 'Name.__proto__']) {
    const r = R(`{[${src}]}`, { Name: 'x' });
    assert.equal(r.text, '', src);
  }
  assert.equal(R('{[Name.constructor()]}', { Name: 'x' }).text, '');
  assert.equal(R('{[constructor("x")]}').text, '');
  assert.throws(() => registerFunction('__proto__', () => 1));
  assert.throws(() => registerFunction('constructor', () => 1));
});

test('Children[0].Name is traced (relevance can ask for it) and analysed as an item field', () => {
  const trace = createTrace();
  evalExpr(parseExpr('Children[0].Name'), createScope({ Children: [{}] }), trace);
  assert.ok(trace.referenced.has('Children[0].Name'));
  assert.ok(trace.missing.has('Children[0].Name'));
  const a = analyze(parse('{[if count(Children) > 0]}{[Children[0].Name]}{[endif]}'));
  assert.deepEqual([...a.variables.keys()].sort(), ['Children', 'Children[].Name']);
  assert.equal(a.variables.get('Children').inferredType, 'list');
  assert.deepEqual(qpaths('{[if count(Children) > 0]}{[Children[0].Name]}{[endif]}', { Children: [{}] }), ['Children', 'Children[].Name']);
});

// ---------------------------------------------------------------- functions

test('pluralize / quantity use irregular plurals', () => {
  assert.equal(F.pluralize(3, 'child'), '3 children');
  assert.equal(F.pluralize(0, 'child'), '0 children');
  assert.equal(F.pluralize(1, 'child'), '1 child');
  assert.equal(F.pluralize(2, 'person'), '2 people');
  assert.equal(F.pluralize(2, 'beneficiary'), '2 beneficiaries');
  assert.equal(F.pluralize(3, 'child', 'kids'), '3 kids');
  assert.equal(F.quantity(2, 'person'), '2 people');
  assert.deepEqual(['attorney', 'child', 'person', 'spouse', 'beneficiary', 'trust', 'party', 'Child'].map((w) => F.plural(w)), ['attorneys', 'children', 'people', 'spouses', 'beneficiaries', 'trusts', 'parties', 'Children']);
});

test('date formats keep literal words without brackets', () => {
  assert.equal(formatDate('2026-03-05', 'Dated MMMM d, yyyy'), 'Dated March 5, 2026');
  assert.equal(formatDate('2026-03-05', 'the Do day of MMMM, yyyy'), 'the 5th day of March, 2026');
  assert.equal(formatDate('2026-03-05', 'Do [day of] MMMM, yyyy'), '5th day of March, 2026');
  assert.equal(formatDate('2026-03-05', 'legal'), 'the 5th day of March, 2026');
  assert.equal(formatDate('2026-03-05', 'MM/DD/YYYY'), '03/05/2026');
  assert.equal(formatDate('2026-03-05', 'yyyyMMdd'), '20260305');
  assert.equal(formatDate('2026-03-05', 'EEE, MMM d, yy'), 'Thu, Mar 5, 26');
  assert.equal(formatDate('2026-03-05', 'Mon, Jun 3, 1990'), 'Thu, Mar 5, 2026');
  assert.equal(formatDate('1999-07-04', 'M/d/yy'), '7/4/99');
});

test('legal ordinals, Feb 29, invalid dates, addMonths clamping, yearsBetween around birthdays', () => {
  const legal = (d) => formatDate(`2026-01-${String(d).padStart(2, '0')}`, 'legal');
  assert.equal(legal(1), 'the 1st day of January, 2026');
  assert.equal(legal(2), 'the 2nd day of January, 2026');
  assert.equal(legal(3), 'the 3rd day of January, 2026');
  assert.equal(legal(11), 'the 11th day of January, 2026');
  assert.equal(legal(12), 'the 12th day of January, 2026');
  assert.equal(legal(13), 'the 13th day of January, 2026');
  assert.equal(legal(21), 'the 21st day of January, 2026');
  assert.equal(legal(22), 'the 22nd day of January, 2026');
  assert.equal(legal(23), 'the 23rd day of January, 2026');
  assert.deepEqual([101, 111, 112, 113].map(F.ordinal), ['101st', '111th', '112th', '113th']);
  assert.equal(formatDate('2024-02-29', 'long'), 'February 29, 2024');
  assert.equal(formatDate('2023-02-29', 'long'), '');
  assert.equal(formatDate('2026-13-45', 'long'), '');
  assert.equal(formatDate('tomorrow', 'long'), '');
  assert.equal(toISODate(F.addMonths('2026-01-31', 1)), '2026-02-28');
  assert.equal(toISODate(F.addMonths('2024-01-31', 1)), '2024-02-29');
  assert.equal(toISODate(F.addYears('2024-02-29', 1)), '2025-02-28');
  assert.equal(F.yearsBetween('2000-06-15', '2026-06-14'), 25);
  assert.equal(F.yearsBetween('2000-06-15', '2026-06-15'), 26);
  assert.equal(F.yearsBetween('2004-02-29', '2026-02-28'), 21);
  assert.equal(F.yearsBetween('2004-02-29', '2026-03-01'), 22);
});

test('parseDate tolerates ordinals, weekday prefixes, slashes and dashes', () => {
  assert.equal(toISODate('March 5th, 2026'), '2026-03-05');
  assert.equal(toISODate('5th March 2026'), '2026-03-05');
  assert.equal(toISODate('Tuesday, March 5, 2026'), '2026-03-05');
  assert.equal(toISODate('2026/03/05'), '2026-03-05');
  assert.equal(toISODate('03-05-2026'), '2026-03-05');
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('13/5/2026'), null);
  assert.equal(coerce('March 5th, 2026', 'date'), '2026-03-05');
});

test('money in words: 0, 0.5, 1, 1e9, 1234567.89, negative, rounding', () => {
  assert.equal(F.dollars(0), 'Zero and 00/100 Dollars');
  assert.equal(F.dollars(0.5), 'Zero and 50/100 Dollars');
  assert.equal(F.dollars(1), 'One and 00/100 Dollars');
  assert.equal(F.dollars(1e9), 'One Billion and 00/100 Dollars');
  assert.equal(F.dollars(1234567.89), 'One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven and 89/100 Dollars');
  assert.equal(F.dollars(-5.25), 'Minus Five and 25/100 Dollars');
  assert.equal(F.dollars(0.999), 'One and 00/100 Dollars');
  assert.equal(F.dollarsAndCents(1.01), 'One Dollar and One Cent');
  assert.equal(F.words(0), 'zero');
  assert.equal(F.words(1000000), 'one million');
  assert.equal(F.words(-42), 'minus forty-two');
  assert.equal(F.words('1,234'), 'one thousand two hundred thirty-four');
  assert.equal(F.currency(-5), '-$5.00');
  assert.equal(F.currency('1,234.50'), '$1,234.50');
  assert.equal(F.currency('$500'), '$500.00');
  assert.equal(F.currency(NaN), '');
  assert.equal(F.currency('abc'), '');
});

test('initials separators, article for initialisms/numbers, pronoun fallbacks, join edge cases, possessive, title', () => {
  assert.equal(F.initials('Ann Lee'), 'AL');
  assert.equal(F.initials('Ann Lee', '.'), 'A.L.');
  assert.equal(F.initials('Ann Lee', ' '), 'A. L.');
  assert.deepEqual(['LLC', 'FBI', 'MBA', 'SUV', 'UCLA', 'hour', 'unicorn', 'apple', 'house', '8', '11', '5'].map(F.article), ['an', 'an', 'an', 'an', 'a', 'an', 'a', 'an', 'a', 'an', 'an', 'a']);
  assert.deepEqual([F.pronoun('unknown'), F.pronoun(''), F.pronoun(null, 'object'), F.pronoun('X', 'possessive')], ['they', 'they', 'them', 'theirs']);
  assert.deepEqual([F.join([]), F.join(['a']), F.join(['a', 'b']), F.join(['a', 'b', 'c']), F.join([1, 2, 3]), F.join([null, 'a', '', 'b'])], ['', 'a', 'a and b', 'a, b, and c', '1, 2, and 3', 'a and b']);
  assert.deepEqual(['Chris', 'James', 'Ms. Jones', 'Mary'].map(F.possessive), ["Chris'", "James'", "Ms. Jones'", "Mary's"]);
  assert.equal(F.title("o'neil mcdonald-smith"), "O'Neil Mcdonald-Smith");
});

// ---------------------------------------------------------------- analysis / relevance

test('both variables of an `and` condition are asked while the first is unanswered', () => {
  assert.deepEqual(qpaths('{[if IsMarried and HasKids]}x{[endif]}'), ['IsMarried', 'HasKids']);
  assert.deepEqual(qpaths('{[if IsMarried and HasKids]}x{[endif]}', { IsMarried: false }), ['IsMarried']);
  assert.deepEqual(qpaths('{[if IsMarried and HasKids]}{[Spouse]}{[endif]}', { IsMarried: true }), ['IsMarried', 'HasKids']);
  assert.deepEqual(qpaths('{[if IsMarried and HasKids]}{[Spouse]}{[endif]}', { IsMarried: true, HasKids: true }), ['IsMarried', 'HasKids', 'Spouse']);
  // render tracing is unaffected: a false left side still short-circuits
  assert.ok(!render(parse('{[if A and B]}x{[endif]}'), {}).trace.referenced.has('B'));
});

test('gating: gated variable hidden until gate answered; else branch; {[if not X]} inference', () => {
  assert.deepEqual(qpaths('{[if Client.IsMarried]}{[Spouse.FullName]}{[endif]}'), ['Client.IsMarried']);
  assert.deepEqual(qpaths('{[if Client.IsMarried]}{[Spouse.FullName]}{[endif]}', { Client: { IsMarried: true } }), ['Client.IsMarried', 'Spouse.FullName']);
  assert.deepEqual(qpaths('{[if Client.IsMarried]}{[Spouse.FullName]}{[else]}{[Single]}{[endif]}', { Client: { IsMarried: false } }), ['Client.IsMarried', 'Single']);
  for (const tpl of ['{[if not IsMarried]}x{[endif]}', '{[if !IsMarried]}x{[endif]}', '{[if IsMarried = true]}x{[endif]}']) {
    assert.equal(analyze(parse(tpl)).variables.get('IsMarried').inferredType, 'boolean', tpl);
  }
});

test('selection options are inferred from every string comparison, including ternaries and != ', () => {
  const a = analyze(parse('{[if State = "CA"]}a{[elseif State = "NY"]}b{[elseif State == "TX"]}c{[endif]} {[State]}'));
  assert.equal(a.variables.get('State').inferredType, 'selection');
  assert.deepEqual(a.variables.get('State').options, ['CA', 'NY', 'TX']);
  const t = analyze(parse('{[State = "CA" ? "cal" : "other"]}')).variables.get('State');
  assert.equal(t.inferredType, 'text'); // one literal is a suggestion, not a choice list
  assert.deepEqual(t.options, ['CA']);
  assert.deepEqual(analyze(parse('{[if State != "CA"]}a{[endif]}')).variables.get('State').options, ['CA']);
  const inList = analyze(parse('{[list Kids]}{[if Role = "Executor"]}x{[elseif Role = "Trustee"]}y{[endif]}{[endlist]}')).variables.get('Kids[].Role');
  assert.deepEqual(inList.options, ['Executor', 'Trustee']);
  const q = questionnaire(parse('{[if State = "CA"]}a{[elseif State = "NY"]}b{[endif]}'), {});
  assert.deepEqual(q[0].options, ['CA', 'NY']);
});

test('{[if Notes]}{[Notes]}{[end if]} is a has-value check, not a Yes/No question', () => {
  assert.equal(analyze(parse('{[if Notes]}{[Notes]}{[endif]}')).variables.get('Notes').inferredType, 'longtext');
  assert.equal(analyze(parse('{[if Spouse]}{[Spouse]}{[endif]}')).variables.get('Spouse').inferredType, 'text');
  assert.equal(analyze(parse('{[if HasKids]}{[HasKids]}{[endif]}')).variables.get('HasKids').inferredType, 'boolean');
  assert.equal(analyze(parse('{[if IsMarried]}x{[endif]}')).variables.get('IsMarried').inferredType, 'boolean');
  assert.equal(analyze(parse('{[if Flag]}x{[endif]} {[Flag|format:"on":"off"]}')).variables.get('Flag').inferredType, 'boolean');
});

test('questionnaire order is stable across answer changes and fast on a 2000-line template', () => {
  const tpl = '{[A]} {[if B]}{[C]}{[endif]} {[D]}';
  assert.deepEqual(qpaths(tpl, {}), ['A', 'B', 'D']);
  assert.deepEqual(qpaths(tpl, { B: true, A: 'x' }), ['A', 'B', 'C', 'D']);
  assert.deepEqual(qpaths(tpl, { B: true, A: 'x', D: 'y', C: 'z' }), ['A', 'B', 'C', 'D']);
  let big = '';
  for (let i = 0; i < 400; i++) big += `Para ${i} {[Var${i}]}\n{[if Flag${i % 20}]}\nText {[Client.Name]} {[Fee${i % 7}|currency]}\n{[list Children]}{[Name]}{[_punc]}{[endlist]}\n{[endif]}\n`;
  const ast = parse(big);
  const data = { Children: [{ Name: 'a' }, { Name: 'b' }] };
  for (let i = 0; i < 20; i++) data['Flag' + i] = true;
  questionnaire(ast, data); // warm up
  const t0 = performance.now();
  questionnaire(ast, data);
  assert.ok(performance.now() - t0 < 100, 'questionnaire() on 2000 lines should take < 100ms');
});

// ---------------------------------------------------------------- model / coercion / code-review items

test('coercion of typed answers', () => {
  assert.equal(coerce('1,250.50', 'currency'), 1250.5);
  assert.equal(coerce('$500', 'currency'), 500);
  assert.equal(coerce('€5', 'currency'), 5);
  assert.equal(coerce('(500)', 'currency'), -500);
  assert.equal(coerce('abc', 'currency'), 'abc');
  assert.equal(coerce('March 5, 2026', 'date'), '2026-03-05');
  assert.equal(coerce('tomorrow', 'date'), 'tomorrow');
  assert.deepEqual(['yes', 'true', 'No', ' Yes ', 'maybe'].map((v) => coerce(v, 'boolean')), [true, true, false, true, 'maybe']);
});

test('mergeModel keeps user default/custom fields and refreshes inferred selection options', () => {
  const m1 = createModel(analyze(parse('{[if State = "CA"]}x{[endif]} {[Fee|currency]}')));
  m1.variables.Fee.default = 1500;
  m1.variables.Fee.custom = { note: 'x' };
  m1.variables.Fee.label = 'Retainer';
  const m2 = mergeModel(m1, analyze(parse('{[if State = "CA"]}x{[elseif State = "NY"]}y{[endif]} {[Fee|currency]}')));
  assert.equal(m2.variables.Fee.default, 1500);
  assert.deepEqual(m2.variables.Fee.custom, { note: 'x' });
  assert.equal(m2.variables.Fee.label, 'Retainer');
  assert.deepEqual(m2.variables.State.options, ['CA', 'NY']);
  // user-edited options win
  m2.variables.State.options = ['CA', 'NY', 'Other'];
  const m3 = mergeModel(m2, analyze(parse('{[if State = "CA"]}x{[elseif State = "NY"]}y{[elseif State = "TX"]}z{[endif]}')));
  assert.deepEqual(m3.variables.State.options, ['CA', 'NY', 'Other']);
  // legacy model without inferredOptions: options that analysis still finds are treated as inferred
  const legacy = { variables: { State: { path: 'State', type: 'selection', inferredType: 'selection', label: 'State', options: ['CA'], required: true } }, order: ['State'] };
  assert.deepEqual(mergeModel(legacy, analyze(parse('{[if State = "CA"]}x{[elseif State = "NY"]}y{[endif]}'))).variables.State.options, ['CA', 'NY']);
});

test('setPath / getPath reject prototype-polluting segments', () => {
  assert.throws(() => setPath({}, '__proto__.polluted', 1));
  assert.throws(() => setPath({}, 'constructor.prototype.polluted', 1));
  assert.throws(() => setPath({}, 'Client.__proto__', 1));
  assert.equal({}.polluted, undefined);
  assert.equal(getPath({ a: 1 }, '__proto__'), undefined);
  assert.equal(getPath({ a: 1 }, 'constructor'), undefined);
  assert.equal(getPath({ Kids: [{ N: 'a' }] }, 'Kids[0].N'), 'a');
});

test('validate: requiredOnly skips format checks; required missing still reported', () => {
  const m = { order: ['Fee', 'D'], variables: { Fee: { path: 'Fee', type: 'currency', required: true, label: 'Fee' }, D: { path: 'D', type: 'date', required: true, label: 'D' } } };
  assert.deepEqual(validate(m, { Fee: 'abc', D: '' }).map((e) => e.message), ['Fee must be a number', 'D is required']);
  assert.deepEqual(validate(m, { Fee: 'abc', D: '' }, { requiredOnly: true }).map((e) => e.message), ['D is required']);
});

test('formatValue: invalid ISO-looking text prints as typed; model type controls auto date formatting', () => {
  assert.equal(formatValue('2026-13-45'), '2026-13-45');
  assert.equal(formatValue('2026-03-05'), 'March 5, 2026');
  assert.equal(formatValue('2026-03-05', { autoDates: false }), '2026-03-05');
  const ast = parse('{[Code]} {[When]}');
  const model = { variables: { Code: { path: 'Code', type: 'text' }, When: { path: 'When', type: 'date' } } };
  assert.equal(render(ast, { Code: '2026-03-05', When: '2026-03-05' }, { model }).text, '2026-03-05 March 5, 2026');
  assert.equal(render(ast, { Code: '2026-03-05', When: '2026-03-05' }).text, 'March 5, 2026 March 5, 2026');
});
