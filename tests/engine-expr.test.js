import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExpr, evalExpr, evaluate, collectIdentifiers, collectFunctions, createScope, createTrace, truthy, listIdentity } from '../engine/expr.js';
import { TemplateError } from '../engine/lexer.js';

const ev = (src, data = {}, trace) => evalExpr(parseExpr(src), data, trace);

test('literals', () => {
  assert.equal(ev('42'), 42);
  assert.equal(ev('3.5'), 3.5);
  assert.equal(ev('"hi"'), 'hi');
  assert.equal(ev("'hi'"), 'hi');
  assert.equal(ev('"a\\"b"'), 'a"b');
  assert.equal(ev('true'), true);
  assert.equal(ev('FALSE'), false);
  assert.equal(ev('null'), null);
});

test('arithmetic precedence and unary minus', () => {
  assert.equal(ev('1 + 2 * 3'), 7);
  assert.equal(ev('(1 + 2) * 3'), 9);
  assert.equal(ev('10 - 4 - 3'), 3);
  assert.equal(ev('-2 * 3'), -6);
  assert.equal(ev('-(2 + 3)'), -5);
  assert.equal(ev('7 % 3'), 1);
  assert.equal(ev('8 / 2'), 4);
  assert.equal(ev('1 / 0'), undefined);
  assert.equal(ev('2 * 3 + 4 * 5'), 26);
});

test('comparison and logic precedence', () => {
  assert.equal(ev('1 + 1 = 2'), true);
  assert.equal(ev('1 < 2 and 2 < 3'), true);
  assert.equal(ev('1 < 2 and 2 > 3'), false);
  assert.equal(ev('1 > 2 or 2 < 3'), true);
  assert.equal(ev('not 1 > 2'), true);
  assert.equal(ev('not true or true'), true); // (not true) or true
  assert.equal(ev('not (true or true)'), false);
  assert.equal(ev('true or false and false'), true); // and binds tighter
  assert.equal(ev('A = 1 or B = 2', { A: 0, B: 2 }), true);
  assert.equal(ev('1 == 1'), true);
  assert.equal(ev('1 != 2'), true);
  assert.equal(ev('1 <> 1'), false);
  assert.equal(ev('2 >= 2 and 2 <= 2'), true);
});

test('Knackly operators: && || ! ternary ==', () => {
  assert.equal(ev('true && false'), false);
  assert.equal(ev('true || false'), true);
  assert.equal(ev('!false'), true);
  assert.equal(ev('!X', { X: '' }), true);
  assert.equal(ev('A == 1 && B == 2', { A: 1, B: 2 }), true);
  assert.equal(ev('X ? "y" : "n"', { X: true }), 'y');
  assert.equal(ev('X ? "y" : "n"', { X: false }), 'n');
  assert.equal(ev('A ? "a" : B ? "b" : "c"', { A: false, B: true }), 'b');
  assert.equal(ev('A ? B ? "ab" : "a" : "n"', { A: true, B: false }), 'a');
  assert.equal(ev('X > 1 ? "big" : "small" | upper', { X: 5 }), 'BIG'); // pipe binds lowest
  assert.equal(ev('!A && B', { A: false, B: true }), true);
  assert.equal(ev('2 + 3 * 4 == 14'), true);
});

test('string comparison and concatenation', () => {
  assert.equal(ev('"apple" < "banana"'), true);
  assert.equal(ev('"a" + "b"'), 'ab');
  assert.equal(ev('"Total: " + 5'), 'Total: 5');
  assert.equal(ev('Name = "Ann"', { Name: 'Ann' }), true);
  assert.equal(ev('Name = "ann"', { Name: 'Ann' }), false);
  assert.equal(ev('Flag = "yes"', { Flag: true }), false);
  assert.equal(ev('Flag = true', { Flag: 'true' }), true);
});

test('date comparison (ISO strings and Date objects)', () => {
  assert.equal(ev('"2026-01-05" < "2026-02-01"'), true);
  assert.equal(ev('A > B', { A: '2026-03-01', B: '2025-12-31' }), true);
  assert.equal(ev('A = B', { A: new Date(2026, 0, 5), B: '2026-01-05' }), true);
  assert.equal(ev('A < "1/1/2027"', { A: '2026-06-01' }), true);
  assert.equal(ev('A - B', { A: '2026-01-11', B: '2026-01-01' }), 10);
  assert.equal(ev('(A + 10)|format:"iso"', { A: '2026-01-01' }), '2026-01-11');
});

test('numeric strings compare numerically', () => {
  assert.equal(ev('"10" > "9"'), true);
  assert.equal(ev('X + 1', { X: '4' }), 5);
});

test('truthiness rules', () => {
  for (const f of ['', null, undefined, 0, false, [], NaN, '  ']) assert.equal(truthy(f), false, String(f));
  for (const t of ['a', 1, true, [1], {}, -1]) assert.equal(truthy(t), true);
  assert.deepEqual(ev('X', { X: [] }), []); // array value passes through
  assert.equal(ev('not X', { X: [] }), true);
  assert.equal(ev('X and true', { X: 0 }), false);
});

test('dotted paths, indexing and scope chain', () => {
  const data = { Client: { Spouse: { Name: 'Bob' } }, Children: [{ Name: 'A' }, { Name: 'B' }] };
  assert.equal(ev('Client.Spouse.Name', data), 'Bob');
  assert.equal(ev('Children[1].Name', data), 'B');
  assert.equal(ev('Children[0].Name', data), 'A');
  assert.equal(ev('Children.length', data), 2);
  const outer = createScope({ X: 1, Y: 'outer' });
  const inner = createScope({ Y: 'inner' }, outer);
  assert.equal(evalExpr(parseExpr('Y'), inner), 'inner');
  assert.equal(evalExpr(parseExpr('X'), inner), 1);
  assert.equal(evalExpr(parseExpr('Y'), outer), 'outer');
});

test('case-insensitive fallback for variable lookup', () => {
  assert.equal(ev('client.fullname', { Client: { FullName: 'Ann' } }), 'Ann');
  assert.equal(ev('CLIENT.FullName', { Client: { FullName: 'Ann' } }), 'Ann');
});

test('missing variables → undefined and traced', () => {
  const trace = createTrace();
  assert.equal(ev('Client.Missing', { Client: {} }, trace), undefined);
  assert.equal(ev('Nope', {}, trace), undefined);
  assert.ok(trace.referenced.has('Client'));
  assert.ok(trace.referenced.has('Client.Missing'));
  assert.ok(trace.missing.has('Client.Missing'));
  assert.ok(trace.missing.has('Nope'));
  assert.ok(!trace.missing.has('Client'));
  assert.equal(ev('Nope.Deeper.Still'), undefined);
  assert.equal(ev('Nope + 1'), 1);
  assert.equal(ev('Nope = ""'), true);
});

test('list-item prefix tracing', () => {
  const trace = createTrace();
  const scope = createScope({ Name: 'A' }, createScope({ Client: { Name: 'C' } }), 'Children[]');
  evalExpr(parseExpr('Name'), scope, trace);
  evalExpr(parseExpr('Client.Name'), scope, trace);
  evalExpr(parseExpr('Age'), scope, trace);
  assert.ok(trace.referenced.has('Children[].Name'));
  assert.ok(trace.referenced.has('Client.Name'));
  assert.ok(trace.missing.has('Children[].Age'));
  evalExpr(parseExpr('_index'), createScope({ _index: 1 }, null, 'Children[]'), trace);
  assert.ok(!trace.referenced.has('Children[]._index'));
});

test('function calls and filters are equivalent', () => {
  assert.equal(ev('upper("abc")'), 'ABC');
  assert.equal(ev('"abc"|upper'), 'ABC');
  assert.equal(ev('Fee|currency', { Fee: 1234.5 }), '$1,234.50');
  assert.equal(ev('currency(Fee)', { Fee: 1234.5 }), '$1,234.50');
  assert.equal(ev('Fee|currency:"€",0', { Fee: 1234.5 }), '€1,235');
  assert.equal(ev('Fee|currency:"€":0', { Fee: 1234.5 }), '€1,235');
  assert.equal(ev('Name|trim|upper', { Name: '  x ' }), 'X');
  assert.equal(ev('Name|default:"N/A"', {}), 'N/A');
  assert.equal(ev('Name|else:"N/A"', {}), 'N/A');
  assert.equal(ev('(Name|default:"n/a")|upper', {}), 'N/A');
  assert.equal(ev('UPPER("x")'), 'X'); // function names case-insensitive
});

test('string methods via dot syntax', () => {
  const d = { Name: 'john smith', Tags: ['a', 'b', 'c'], Fee: '1,200' };
  assert.equal(ev('Name.toUpperCase()', d), 'JOHN SMITH');
  assert.equal(ev('Name.length', d), 10);
  assert.equal(ev('Name.includes("smith")', d), true);
  assert.equal(ev('Name.startsWith("john")', d), true);
  assert.equal(ev('Name.replace("john", "jane")', d), 'jane smith');
  assert.equal(ev('Name.split(" ").length', d), 2);
  assert.equal(ev('Name.slice(0, 4)', d), 'john');
  assert.equal(ev('Name.first(1).toUpperCase()', d), 'J');
  assert.equal(ev('Tags.join("/")', d), 'a/b/c');
  assert.equal(ev('Tags.first()', d), 'a');
  assert.equal(ev('Tags.last()', d), 'c');
  assert.equal(ev('Tags.last(2).join("")', d), 'bc');
  assert.equal(ev('Fee.toInt()', d), 1200);
  assert.equal(ev('Name.padStart(12, "*")', d), '**john smith');
  assert.equal(ev('Name.indexOf("s")', d), 5);
  assert.equal(ev('Name.substring(5)', d), 'smith');
  assert.equal(ev('Missing.toUpperCase()', d), '');
});

test('namespaces: date.*, math.*, finance.*', () => {
  assert.equal(ev('date.yearOf("2026-03-05")'), 2026);
  assert.equal(ev('date.new(2026, 3, 5)|format:"iso"'), '2026-03-05');
  assert.equal(ev('date.addDays("2026-03-05", 30)|format:"short"'), '4/4/2026');
  assert.equal(ev('date.subDays("2026-03-05", 5)|format:"iso"'), '2026-02-28');
  assert.equal(ev('date.addWeeks("2026-03-05", 1)|format:"iso"'), '2026-03-12');
  assert.equal(ev('date.daysBetween("2026-01-01", "2026-01-31")'), 30);
  assert.equal(ev('date.monthsBetween("2026-01-15", "2026-04-14")'), 2);
  assert.equal(ev('date.yearsBetween("2000-06-15", "2026-06-14")'), 25);
  assert.equal(ev('date.dayOfWeek("2026-03-05")'), 4);
  assert.equal(ev('date.parse("March 5, 2026")|format:"iso"'), '2026-03-05');
  assert.ok(ev('date.today()') instanceof Date);
  assert.equal(ev('math.floor(2.7)'), 2);
  assert.equal(ev('math.max(1, 5, 3)'), 5);
  assert.equal(ev('math.round(2.5)'), 3);
  assert.equal(Math.round(ev('finance.PMT(0.05/12, 360, 200000)') * 100) / 100, -1073.64);
  assert.equal(Math.round(ev('finance.FV(0.05/12, 120, -100)') * 100) / 100, 15528.23);
  assert.ok(Math.abs(ev('finance.PV(0.05/12, 360, -1073.64)') - 200000) < 1);
  assert.equal(Math.round(ev('finance.NPER(0.05/12, -1073.64, 200000)')), 360);
  assert.equal(Math.round(ev('finance.RATE(360, -1073.64, 200000)') * 12 * 1000) / 1000, 0.05);
  // data variable named "date" wins over namespace
  assert.equal(ev('date.year', { date: { year: 1999 } }), 1999);
});

test('lazy list filters with per-item expressions', () => {
  const d = { Children: [{ Name: 'A', Age: 5, Role: 'x' }, { Name: 'B', Age: 20, Role: 'Executor' }, { Name: 'C', Age: 17, Role: 'x' }] };
  assert.deepEqual(ev('Children|filter: Age < 18|map: Name', d), ['A', 'C']);
  assert.deepEqual(ev('Children|find: Role == "Executor"|map: Name', d), ['B']); // find returns one item; map wraps it
  assert.equal(ev('(Children|find: Role == "Executor").Name', d), 'B');
  assert.equal(ev('Children|any: Age >= 18', d), true);
  assert.equal(ev('Children|every: Age >= 18', d), false);
  assert.equal(ev('Children|all: Age > 0', d), true);
  assert.deepEqual(ev('Children|sort: -Age|map: Name', d), ['B', 'C', 'A']);
  assert.deepEqual(ev('Children|sort: +Role : -Age|map: Name', d), ['B', 'C', 'A']);
  assert.equal(ev('Children|reduce: _result + Age : 0', d), 42);
  assert.equal(ev('Children|sum: Age', d), 42);
  assert.equal(ev('Children|count: Age < 18', d), 2);
  const groups = ev('Children|group: Role', d);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]._key, 'x');
  assert.equal(groups[0]._values.length, 2);
  assert.deepEqual(ev('Children|group: Age >= 18|map: _key', d), [false, true]);
  assert.equal(ev('Children|filter: this.Age > 10|count', d), 2);
  assert.equal(ev('Children|map: Name + " (" + Age + ")"|join', d), 'A (5), B (20), and C (17)');
  assert.equal(ev('Children|map: _index|join', d), '1, 2, and 3');
  // function-call form
  assert.deepEqual(ev('map(filter(Children, Age > 10), Name)', d), ['B', 'C']);
  assert.equal(ev('sum(Children, Age * 2)', d), 84);
  assert.equal(ev('Children.filter(Age < 18).length', d), 2);
  // eager string-literal field forms still work
  assert.deepEqual(ev('Children|filter:"Role","Executor"|map:"Name"', d), ['B']);
  assert.equal(ev('sum(Children, "Age")', d), 42);
  // lazy traces record item-field paths
  const trace = createTrace();
  ev('Children|filter: Age < 18', d, trace);
  assert.ok(trace.referenced.has('Children[].Age'));
});

test('unknown function throws TemplateError; unknown variable does not', () => {
  assert.throws(() => ev('nosuchfn(1)'), TemplateError);
  assert.equal(ev('nosuch'), undefined);
});

test('parse errors', () => {
  assert.throws(() => parseExpr(''), TemplateError);
  assert.throws(() => parseExpr('1 +'), TemplateError);
  assert.throws(() => parseExpr('(1 + 2'), TemplateError);
  assert.throws(() => parseExpr('"unterminated'), TemplateError);
  assert.throws(() => parseExpr('a b'), TemplateError);
  assert.throws(() => parseExpr('a |'), TemplateError);
  assert.throws(() => parseExpr('a ? b'), TemplateError);
  assert.throws(() => parseExpr('#'), TemplateError);
});

test('collectIdentifiers finds dotted paths in args, filters, lazy filters', () => {
  assert.deepEqual(collectIdentifiers(parseExpr('Client.Spouse.Name')), ['Client.Spouse.Name']);
  assert.deepEqual(collectIdentifiers(parseExpr('a + b * c')), ['a', 'b', 'c']);
  assert.deepEqual(collectIdentifiers(parseExpr('count(Children) > Max and Fee|currency:Sym')), ['Children', 'Max', 'Fee', 'Sym']);
  assert.deepEqual(collectIdentifiers(parseExpr('X|default:Y|format:Z')), ['X', 'Y', 'Z']);
  assert.deepEqual(collectIdentifiers(parseExpr('Children|filter: Age < 18|map: Name')), ['Children', 'Children[].Age', 'Children[].Name']);
  assert.deepEqual(collectIdentifiers(parseExpr('sum(Children, Cost * Qty)')), ['Children', 'Children[].Cost', 'Children[].Qty']);
  assert.deepEqual(collectIdentifiers(parseExpr('Children.filter(Age < 18)')), ['Children', 'Children[].Age']);
  assert.deepEqual(collectIdentifiers(parseExpr('date.today() > Deadline')), ['Deadline']);
  assert.deepEqual(collectIdentifiers(parseExpr('Name.toUpperCase()')), ['Name']);
  assert.deepEqual(collectIdentifiers(parseExpr('A ? B : C')), ['A', 'B', 'C']);
  assert.deepEqual(collectIdentifiers(parseExpr('Children[0].Name')), ['Children[0].Name']);
  assert.deepEqual(collectIdentifiers(parseExpr('Children|reduce: _result + Cost : 0')), ['Children', 'Children[].Cost']);
  assert.deepEqual(collectIdentifiers(parseExpr('a + a')), ['a']);
});

test('collectFunctions and listIdentity', () => {
  assert.deepEqual(collectFunctions(parseExpr('Fee|currency|upper')).filters, ['currency', 'upper']);
  assert.deepEqual(collectFunctions(parseExpr('count(Children)')).calls, ['count']);
  assert.equal(listIdentity(parseExpr('Children|filter: Age < 18|sort: Name')), 'Children');
  assert.equal(listIdentity(parseExpr('sort(Children, "Name")')), 'Children');
  assert.equal(listIdentity(parseExpr('Client.Children')), 'Client.Children');
});

test('evaluate() convenience', () => {
  assert.equal(evaluate('a + 1', { a: 1 }), 2);
});

test('fuzz: random expressions never crash the evaluator (only TemplateError on parse)', () => {
  const atoms = ['1', '2.5', '"s"', 'true', 'null', 'X', 'Y.Z', 'L', '(', ')', '+', '-', '*', '/', '=', '<', 'and', 'or', 'not', '|upper', '|default:"d"', ',', '?', ':', '!', '&&', '||', 'count(L)', 'L|filter: A > 1'];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 500; i++) {
    const n = 1 + Math.floor(rnd() * 6);
    const src = Array.from({ length: n }, () => atoms[Math.floor(rnd() * atoms.length)]).join(' ');
    try {
      const ast = parseExpr(src);
      evalExpr(ast, { X: 1, Y: { Z: 'z' }, L: [{ A: 2 }] }, createTrace());
    } catch (e) {
      assert.ok(e instanceof TemplateError, `${src} threw ${e.constructor.name}: ${e.message}`);
    }
  }
});
