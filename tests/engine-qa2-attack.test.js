// QA round 2: attorney-style attacks on relevance/order, annotations, validation, computed fields and
// mergeModel precedence. Each test states the behaviour it locks in (see docs/engine-additions.md §7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { analyze, relevantVariables, questionnaire, collectAnnotations, parseAnnotationLine } from '../engine/analyze.js';
import { createModel, mergeModel, validate, computeDerived } from '../engine/model.js';

const A = (t) => analyze(parse(t));
const M = (t) => { const ast = parse(t); const model = createModel(analyze(ast)); return { ast, model }; };
const paths = (tpl, data, model) => questionnaire(parse(tpl), data, model).map((q) => q.path);
const rel = (tpl, data) => relevantVariables(parse(tpl), data);
const pick = (m, p, fields) => Object.fromEntries(fields.map((f) => [f, m.variables[p][f]]));

// ---------------------------------------------------------------- 1. relevance / questionnaire

test('elseif chain: a variable in 2 of 3 branches is NOT pre-asked; one in all 3 is', () => {
  const r = rel('{[if A]}{[X]}{[elseif B]}{[X]}{[else]}{[Y]}{[end if]}', {});
  assert.deepEqual(r.relevant, ['A']);
  assert.ok(r.blockedBy.has('X') && r.blockedBy.has('Y') && r.blockedBy.has('B'));
  const r2 = rel('{[if A]}{[X]}{[elseif B]}{[X]}{[else]}{[X]}{[end if]}', {});
  assert.deepEqual(r2.relevant, ['A', 'X']);
});

test('gate answered false: branch variables leave the questionnaire and their stale answers are ignored by validate()', () => {
  const { ast, model } = M('{[if HasSpouse]}{[SpouseName]}{[end if]}{[Name]}');
  const data = { HasSpouse: false, Name: 'x', SpouseName: '' };
  const r = relevantVariables(ast, data);
  assert.deepEqual(r.relevant, ['HasSpouse', 'Name']);
  assert.deepEqual(validate(model, data, { relevant: r.relevant }), []);
  assert.deepEqual(validate(model, { HasSpouse: true, Name: 'x' }, { relevant: relevantVariables(ast, { HasSpouse: true, Name: 'x' }).relevant }).map((e) => e.path), ['SpouseName']);
});

test('selection gate: FeeType is asked first; HourlyRate only after FeeType = "Hourly"', () => {
  const t = '{[if FeeType = "Hourly"]}{[HourlyRate|currency]}{[elseif FeeType = "Flat"]}{[FlatFee|currency]}{[end if]}';
  assert.deepEqual(paths(t, {}), ['FeeType']);
  assert.deepEqual(paths(t, { FeeType: 'Hourly' }), ['FeeType', 'HourlyRate']);
  assert.deepEqual(paths(t, { FeeType: 'Flat' }), ['FeeType', 'FlatFee']);
  assert.deepEqual(paths(t, { FeeType: 'Contingency' }), ['FeeType']);
  const q = questionnaire(parse(t), {});
  assert.equal(q[0].type, 'selection');
  assert.deepEqual(q[0].options, ['Hourly', 'Flat']);
});

test('gates nested 4 deep open one level at a time; deeper levels are blocked by the innermost undecided gate', () => {
  const t = '{[if A]}{[if B]}{[if C]}{[if D]}{[X]}{[end if]}{[end if]}{[end if]}{[end if]}';
  assert.deepEqual(paths(t, {}), ['A']);
  assert.deepEqual(paths(t, { A: true }), ['A', 'B']);
  assert.deepEqual(paths(t, { A: true, B: true, C: true }), ['A', 'B', 'C', 'D']);
  assert.deepEqual(paths(t, { A: true, B: true, C: true, D: true }), ['A', 'B', 'C', 'D', 'X']);
  const r = rel(t, { A: true, B: true });
  assert.deepEqual(r.blockedBy.get('D'), ['C']);
  assert.deepEqual(r.blockedBy.get('X'), ['C']);
  assert.deepEqual(paths(t, { A: false }), ['A']);
});

test('a variable that is both a gate and printed is asked once, at its first (gate) position', () => {
  const t = '{[Intro]}{[if State = "CA"]}California{[end if]} State: {[State]}';
  assert.deepEqual(paths(t, {}), ['Intro', 'State']);
  assert.deepEqual(paths(t, { State: 'NY' }), ['Intro', 'State']);
  const q = questionnaire(parse(t), {}).find((x) => x.path === 'State');
  assert.equal(q.type, 'text');
  assert.deepEqual(q.suggestions, ['CA']);
});

test('list-gated section: {[if count(Children) > 0]} asks for the list, then the item fields as items are added', () => {
  const t = '{[if count(Children) > 0]}{[list Children]}{[Name]}{[end list]}{[end if]}';
  assert.deepEqual(paths(t, {}), ['Children']);
  const q0 = questionnaire(parse(t), {});
  assert.equal(q0[0].answered, false);
  assert.deepEqual(paths(t, { Children: [] }), ['Children']);
  assert.equal(questionnaire(parse(t), { Children: [] })[0].answered, true);
  assert.deepEqual(paths(t, { Children: [{}] }), ['Children', 'Children[].Name']);
  assert.deepEqual(relevantVariables(parse(t), { Children: [{}, { Name: 'b' }] }).unanswered, ['Children[0].Name']);
});

test('computed per-item gate ({[if Children|any: IsMinor]}) resolves as children are entered, after computeDerived', () => {
  const t = '{[# @formula Children[].IsMinor: yearsBetween(DOB, today()) < 18]}{[list Children]}{[Name]} {[DOB|formatDate]}{[end list]}{[if Children|any: IsMinor]}{[Guardian]}{[end if]}';
  const { ast, model } = M(t);
  assert.equal(model.variables['Children[].IsMinor'].type, 'computed');
  const ask = (data) => questionnaire(ast, computeDerived(model, data).data, model).map((q) => q.path);
  assert.deepEqual(ask({ Children: [] }), ['Children']);
  assert.deepEqual(ask({ Children: [{ Name: 'a', DOB: '1980-01-01' }] }), ['Children', 'Children[].Name', 'Children[].DOB']);
  assert.deepEqual(ask({ Children: [{ Name: 'a', DOB: '1980-01-01' }, { Name: 'b', DOB: '2020-01-01' }] }), ['Children', 'Children[].Name', 'Children[].DOB', 'Guardian']);
  // the computed field itself is never a question
  assert.ok(!ask({ Children: [{ Name: 'a' }] }).includes('Children[].IsMinor'));
});

function bigTemplate() {
  let rnd = 424242;
  const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
  const vars = Array.from({ length: 100 }, (_, i) => `V${i}`);
  let tpl = '';
  for (let g = 0; g < 50; g++) tpl += `{[if ${vars[g]}]}{[${vars[50 + g]}]} {[${vars[(g * 7) % 100]}]}{[else]}{[${vars[(g * 7) % 100]}]}{[end if]}\n`;
  for (let i = 0; i < 100; i += 3) tpl += `{[${vars[i]}]} `;
  return { tpl, vars, rand };
}

test('property: over 200 random partial answer sets the relative order of shared questions never changes', () => {
  const { tpl, vars, rand } = bigTemplate();
  const ast = parse(tpl);
  const base = questionnaire(ast, {}).map((q) => q.path);
  let prev = base;
  for (let k = 0; k < 200; k++) {
    const data = {};
    for (const v of vars) if (rand() < 0.5) data[v] = rand() < 0.5 ? true : rand() < 0.5 ? false : 'x';
    const q = questionnaire(ast, data).map((x) => x.path);
    assert.deepEqual(new Set(q).size, q.length, 'no duplicate questions');
    for (const other of [base, prev]) {
      assert.deepEqual(q.filter((p) => other.includes(p)), other.filter((p) => q.includes(p)), `order of shared questions, run ${k}`);
    }
    prev = q;
  }
});

test('performance: 100 variables / 50 gates, questionnaire() under 50 ms per call', () => {
  const { tpl, vars, rand } = bigTemplate();
  const ast = parse(tpl);
  const data = {};
  for (const v of vars) if (rand() < 0.5) data[v] = rand() < 0.5;
  questionnaire(ast, data); // warm up
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) questionnaire(ast, data);
  const per = (performance.now() - t0) / 20;
  assert.ok(per < 50, `questionnaire() took ${per.toFixed(1)} ms`);
});

// ---------------------------------------------------------------- 2. annotations

const ann = (t) => { const a = A(t); return { a: Object.fromEntries(a.annotations), e: a.annotationErrors }; };

test('annotation keys are case-insensitive; values keep colons and pipes; quotes and trailing whitespace are trimmed', () => {
  assert.deepEqual(ann('{[# @LABEL X: Hi]}{[X]}').a, { X: { label: 'Hi' } });
  assert.deepEqual(ann('{[# @help X: Use format: MM/DD]}{[X]}').a, { X: { help: 'Use format: MM/DD' } });
  assert.deepEqual(ann('{[# @options X: A | B | C]}{[X]}').a, { X: { options: ['A', 'B', 'C'] } });
  assert.deepEqual(ann('{[# @help X: A | B]}{[X]}').a, { X: { help: 'A | B' } });
  assert.deepEqual(ann('{[# @label X: "Client\'s name"   ]}{[X]}').a, { X: { label: "Client's name" } });
  assert.deepEqual(ann("{[# @label X: 'Quoted']}{[X]}").a, { X: { label: 'Quoted' } });
  assert.deepEqual(ann('{[# @label X: "unbalanced]}{[X]}').a, { X: { label: '"unbalanced' } });
  assert.deepEqual(ann('{[# @options X: "A" | \'B\' ]}{[X]}').a, { X: { options: ['A', 'B'] } });
  assert.deepEqual(ann('{[# @label X: Hi\r\n@help X: There\r\n@options X: A | B |\r\n@required X: \r\n]}{[X]}').a, { X: { label: 'Hi', help: 'There', options: ['A', 'B'], required: true } });
  assert.deepEqual(ann('{[# @label X: Hi\r\n@help X: There]}{[X]}').e, []);
});

test('parseAnnotationLine: spaces before the colon, no space after, concrete index normalised to []', () => {
  assert.deepEqual(parseAnnotationLine('@max X : 5'), { key: 'max', path: 'X', value: '5' });
  assert.deepEqual(parseAnnotationLine('@label X:hi'), { key: 'label', path: 'X', value: 'hi' });
  assert.deepEqual(parseAnnotationLine('@label Children[0].Name: hi'), { key: 'label', path: 'Children[].Name', value: 'hi' });
  assert.deepEqual(parseAnnotationLine('@min X: 3/5/2026'), { key: 'min', path: 'X', value: '3/5/2026' });
  assert.equal(parseAnnotationLine('just a note'), null);
  assert.match(parseAnnotationLine('@label: bar').error, /expected @key Path: value/);
});

test('unknown key and missing path are errors with the line; every entry carries a severity', () => {
  const { e } = ann('{[# note\n@foo X: bar\n@label : x]}{[X]}');
  assert.equal(e.length, 2);
  assert.deepEqual(e.map((x) => [x.line, x.severity]), [[2, 'error'], [3, 'error']]);
  assert.match(e[0].message, /^Unknown annotation @foo/);
});

test('an annotation for a variable the template never uses is a warning and does not create a variable; @formula does create one', () => {
  const { ast, model } = M('{[# @label Ghost: Boo\n@formula Total: Fee * 2]}{[Fee|currency]}');
  const a = analyze(ast);
  assert.deepEqual(a.annotationErrors.map((x) => [x.line, x.severity]), [[1, 'warning']]);
  assert.match(a.annotationErrors[0].message, /@label Ghost: the template does not use "Ghost"/);
  assert.deepEqual(Object.keys(model.variables), ['Fee', 'Total']);
  assert.equal(model.variables.Total.type, 'computed');
  assert.deepEqual(computeDerived(model, { Fee: 3 }).data, { Fee: 3, Total: 6 });
  assert.deepEqual(questionnaire(ast, {}, model).map((q) => q.path), ['Fee']);
  // standalone collectAnnotations (no variables) cannot know what is unused → no warning
  assert.deepEqual(collectAnnotations(parse('{[# @label Ghost: Boo]}')).annotationErrors, []);
});

test('the same key twice for one path: last wins, with a warning pointing at the overridden line', () => {
  const r1 = ann('{[# @label X: One\n@label X: Two]}{[X]}');
  assert.equal(r1.a.X.label, 'Two');
  assert.deepEqual(r1.e.map((x) => [x.line, x.severity]), [[2, 'warning']]);
  assert.match(r1.e[0].message, /@label X: overrides the @label on line 1/);
  const r2 = ann('{[# @required X]}\n{[# @optional X]}{[X]}');
  assert.equal(r2.a.X.required, false);
  assert.match(r2.e[0].message, /@optional X: overrides the @required on line 1/);
  // different keys never warn
  assert.deepEqual(ann('{[# @label X: a\n@help X: b\n@min X: 1\n@max X: 2]}{[X]}').e, []);
});

test('inside a list body a bare item-field path resolves to the list item field', () => {
  const t = '{[list Children]}{[# @label DOB: Date of birth]}{[# @required Nick]}{[Nick]} {[DOB|formatDate]}{[end list]}{[# @label Name: Top]}{[Name]}';
  const { model } = M(t);
  assert.equal(model.variables['Children[].DOB'].label, 'Date of birth');
  assert.equal(model.variables['Children[].Nick'].fromTemplate.required, true);
  assert.equal(model.variables['Name'].label, 'Top');
  assert.deepEqual(analyze(parse(t)).annotationErrors, []);
  // item alias: {[list Children as Kid]} @label Kid.DOB
  const { model: m2 } = M('{[list Children as Kid]}{[# @label Kid.DOB: Birth]}{[Kid.DOB|formatDate]}{[end list]}');
  assert.equal(m2.variables['Children[].DOB'].label, 'Birth');
  // a bare path inside the list that is a top-level variable (not an item field) stays top-level
  const { model: m3 } = M('{[Court]}{[list Children]}{[# @label Court: The court]}{[Name]}{[end list]}');
  assert.equal(m3.variables.Court.label, 'The court');
});

test('@type list on a printed scalar makes a list of plain values; @type object on a leaf is an error, not a vanished question', () => {
  const { ast, model } = M('{[# @type Names: list]}{[Names|join]}');
  assert.equal(model.variables.Names.type, 'list');
  assert.equal(model.variables.Names.itemType, 'text');
  assert.deepEqual(questionnaire(ast, {}, model).map((q) => [q.path, q.type, q.itemType]), [['Names', 'list', 'text']]);
  const { ast: ast2, model: m2 } = M('{[# @type X: object]}{[X]}');
  assert.equal(m2.variables.X.type, 'text');
  assert.equal(m2.annotationErrors.length, 1);
  assert.match(m2.annotationErrors[0].message, /@type X: object needs child variables/);
  assert.equal(m2.annotationErrors[0].line, 1);
  assert.deepEqual(questionnaire(ast2, {}, m2).map((q) => q.path), ['X']);
  // object with children is fine
  const { model: m3 } = M('{[# @type Client: object]}{[Client.Name]}');
  assert.equal(m3.variables.Client.type, 'object');
  assert.deepEqual(m3.annotationErrors, []);
});

test('@default is checked against the type: booleans, dates, numbers, selections; lists/objects/computed cannot have one', () => {
  const dflt = (ty, v, extra = '') => { const m = createModel(A(`{[# @type X: ${ty}\n@default X: ${v}${extra}]}{[X]}`)); return [m.variables.X.default, m.annotationErrors.map((e) => e.message)]; };
  assert.deepEqual(dflt('boolean', 'Yes'), [true, []]);
  assert.deepEqual(dflt('boolean', 'true'), [true, []]);
  assert.deepEqual(dflt('boolean', 'no'), [false, []]);
  assert.deepEqual(dflt('boolean', 'maybe'), [undefined, ['@default X: expected yes/no or true/false, got "maybe"']]);
  assert.deepEqual(dflt('date', '3/5/2026'), ['2026-03-05', []]);
  assert.deepEqual(dflt('date', 'March 5, 2026'), ['2026-03-05', []]);
  assert.deepEqual(dflt('date', 'junk'), [undefined, ['@default X: expected a date, got "junk"']]);
  assert.match(dflt('date', 'today')[1][0], /"today" is not supported/);
  assert.deepEqual(dflt('number', '1,500'), [1500, []]);
  assert.deepEqual(dflt('currency', '$2,500.50'), [2500.5, []]);
  assert.deepEqual(dflt('number', 'abc'), [undefined, ['@default X: expected a number, got "abc"']]);
  assert.deepEqual(dflt('list', 'a | b'), [undefined, ['@default X: a list variable cannot have a default']]);
  assert.deepEqual(dflt('multiselect', 'a | b'), [['a', 'b'], []]);
  assert.deepEqual(dflt('multiselect', 'a | z', '\n@options X: a | b'), [undefined, ['@default X: "z" is not one of the options']]);
  assert.deepEqual(dflt('selection', 'Flat', '\n@options X: Hourly | Flat'), ['Flat', []]);
  assert.deepEqual(dflt('selection', 'Weekly', '\n@options X: Hourly | Flat'), [undefined, ['@default X: "Weekly" is not one of the options']]);
  const m = createModel(A('{[# @formula T: 1 + 1\n@default T: 5]}{[T]}'));
  assert.deepEqual(m.annotationErrors.map((e) => e.message), ['@default T: a computed variable cannot have a default']);
  // the error carries the annotation's line
  const m2 = createModel(A('{[# @type X: number\n@label X: n\n@default X: abc]}{[X]}'));
  assert.deepEqual(m2.annotationErrors.map((e) => [e.path, e.line, e.severity]), [['X', 3, 'error']]);
});

test('@validate: the message separator is the last `::` outside quotes; @validate may reference a computed variable', () => {
  const r = ann('{[# @validate X: value != "a::b" :: Cannot be a::b]}{[X]}');
  assert.deepEqual(r.a.X, { validate: 'value != "a::b"', message: 'Cannot be a::b' });
  assert.deepEqual(ann("{[# @validate X: value != 'x' :: Use format: HH::MM]}{[X]}").a.X, { validate: "value != 'x'", message: 'Use format: HH::MM' });
  assert.deepEqual(ann('{[# @validate X: value != "a::b"]}{[X]}').a.X, { validate: 'value != "a::b"' });
  const { model } = M('{[# @formula Total: Fee * 2]}{[# @validate Fee: Total < 1000 :: too much]}{[Fee|currency]}');
  const d = computeDerived(model, { Fee: 600 }).data;
  assert.deepEqual(validate(model, d), [{ path: 'Fee', message: 'too much' }]);
  assert.deepEqual(validate(model, computeDerived(model, { Fee: 100 }).data), []);
});

test('@formula on a variable that is also @type-d keeps the computed type; annotations in nested comments across branches', () => {
  const { model } = M('{[if A]}{[# @label X: In branch]}{[X]}{[else]}{[# @help X: elsewhere]}{[X]}{[end if]}');
  assert.equal(model.variables.X.label, 'In branch');
  assert.equal(model.variables.X.help, 'elsewhere');
  const { model: m2 } = M('{[# @type T: number\n@formula T: 1 + 1]}{[T]}');
  assert.equal(m2.variables.T.type, 'computed');
  assert.equal(m2.variables.T.formula, '1 + 1');
});

// ---------------------------------------------------------------- 3. validation

test('invalid pattern reports a message and never throws; date min/max accept ISO and US forms; a number bound on a date is ignored', () => {
  const { model } = M('{[Code]}{[Start|formatDate]}');
  model.variables.Code.pattern = '(';
  assert.deepEqual(validate(model, { Code: 'x', Start: '2020-01-01' }), [{ path: 'Code', message: 'Code: invalid pattern /(/' }]);
  delete model.variables.Code.pattern;
  const s = model.variables.Start;
  s.min = '2020-01-01';
  assert.deepEqual(validate(model, { Code: 'x', Start: '2019-05-05' }).map((e) => e.message), ['Start must be on or after 2020-01-01']);
  assert.deepEqual(validate(model, { Code: 'x', Start: '5/5/2020' }), []);
  s.min = '3/5/2026'; s.max = '12/31/2026';
  assert.deepEqual(validate(model, { Code: 'x', Start: 'March 4, 2026' }).map((e) => e.message), ['Start must be on or after 2026-03-05']);
  assert.deepEqual(validate(model, { Code: 'x', Start: '2027-01-01' }).map((e) => e.message), ['Start must be on or before 2026-12-31']);
  assert.deepEqual(validate(model, { Code: 'x', Start: '2026-06-01' }), []);
  s.min = 5; delete s.max;
  assert.deepEqual(validate(model, { Code: 'x', Start: '2019-05-05' }), []);
});

test('a validate expression that fails at runtime or does not parse is reported on that field', () => {
  const { model } = M('{[Hours|number]}');
  model.variables.Hours.validate = 'foo(value) > 1';
  assert.deepEqual(validate(model, { Hours: 3 }), [{ path: 'Hours', message: 'Hours: validation rule error: Unknown function "foo"' }]);
  model.variables.Hours.validate = 'value >';
  assert.match(validate(model, { Hours: 3 })[0].message, /^Hours: bad validation rule: /);
  model.variables.Hours.validate = 'value.x.y.z > 1';
  assert.deepEqual(validate(model, { Hours: 3 }).map((e) => e.message), ['Hours is not valid (rule: value.x.y.z > 1)']);
  // a custom message does not hide the fact that the rule itself is broken
  model.variables.Hours.validate = 'foo(value)'; model.variables.Hours.message = 'Custom';
  assert.match(validate(model, { Hours: 3 })[0].message, /validation rule error/);
});

test('list minLength/maxLength count items; nested item paths; relevant with concrete nested paths', () => {
  const { model } = M('{[list Members]}{[Name]}{[list Owners]}{[Name]}{[Share|number]}{[end list]}{[end list]}');
  model.variables.Members.minLength = 1; model.variables.Members.maxLength = 2;
  model.variables['Members[].Owners[].Share'].max = 100;
  assert.deepEqual(validate(model, { Members: [] }).map((e) => e.message), ['Members must have at least 1 item']);
  const data = { Members: [{ Name: 'a', Owners: [{ Name: 'o', Share: 50 }, { Name: '', Share: 150 }] }, { Name: 'b', Owners: [] }, { Name: 'c' }] };
  assert.deepEqual(validate(model, data).map((e) => e.path + ': ' + e.message), [
    'Members: Members must have at most 2 items',
    'Members[0].Owners[1].Name: Members — Owners — Name is required',
    'Members[0].Owners[1].Share: Members — Owners — Share must be at most 100',
  ]);
  assert.deepEqual(validate(model, data, { relevant: ['Members[0].Owners[1].Share'] }).map((e) => e.path), ['Members[0].Owners[1].Share']);
  assert.deepEqual(validate(model, data, { relevant: ['Members[0].Owners[0].Name', 'Members[1].Owners[0].Name'] }), []);
  const r = relevantVariables(parse('{[list Members]}{[Name]}{[list Owners]}{[Name]}{[Share|number]}{[end list]}{[end list]}'), data);
  assert.deepEqual(validate(model, data, { relevant: r.unanswered }).map((e) => e.path), ['Members[0].Owners[1].Name']);
});

test('message override: one custom message per field however many rules fail; required/type messages untouched', () => {
  const { model } = M('{[Zip]}');
  Object.assign(model.variables.Zip, { minLength: 5, pattern: '^\\d+$', validate: 'value != "00000"', message: 'Bad zip' });
  assert.deepEqual(validate(model, { Zip: 'ab' }), [{ path: 'Zip', message: 'Bad zip' }]);
  assert.deepEqual(validate(model, { Zip: '00000' }), [{ path: 'Zip', message: 'Bad zip' }]);
  assert.deepEqual(validate(model, { Zip: '12345' }), []);
  assert.deepEqual(validate(model, { Zip: '' }), [{ path: 'Zip', message: 'Zip is required' }]);
  // without a message, each rule still reports separately
  delete model.variables.Zip.message;
  assert.equal(validate(model, { Zip: 'ab' }).length, 2);
});

// ---------------------------------------------------------------- 4. computed

test('per-item computed chains, top-level over an empty/missing list, format output usable in a condition, input untouched', () => {
  const { model } = M('{[list Kids]}{[Age|number]}{[end list]}');
  const cv = (path, formula) => { model.variables[path] = { path, type: 'computed', formula }; model.order.push(path); };
  cv('AnyMinor', 'MinorCount > 0');
  cv('Fmt', 'MinorCount|format:"0"');
  cv('MinorCount', 'count(Kids|filter: IsMinor)');
  cv('Kids[].Label', 'IsMinor ? "minor" : "adult"');
  cv('Kids[].IsMinor', 'Age < 18');
  const input = { Kids: [{ Age: 5 }, { Age: 30 }], When: new Date(2020, 0, 1), Tags: ['a'] };
  const snap = JSON.stringify(input);
  const r = computeDerived(model, input);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.data.Kids, [{ Age: 5, IsMinor: true, Label: 'minor' }, { Age: 30, IsMinor: false, Label: 'adult' }]);
  assert.equal(r.data.MinorCount, 1); assert.equal(r.data.AnyMinor, true); assert.equal(r.data.Fmt, '1');
  assert.equal(JSON.stringify(input), snap, 'input data not mutated');
  assert.ok(r.data.When instanceof Date && r.data.When !== input.When && r.data.Tags !== input.Tags, 'deep clone');
  assert.deepEqual(computeDerived(model, { Kids: [] }).data, { Kids: [], MinorCount: 0, AnyMinor: false, Fmt: '0' });
  assert.deepEqual(computeDerived(model, {}).data, { MinorCount: 0, AnyMinor: false, Fmt: '0' });
  assert.deepEqual(relevantVariables(parse('{[if Fmt = "1"]}{[G]}{[end if]}'), r.data).relevant, ['Fmt', 'G']);
});

test('a top-level computed referenced inside a list filter is evaluated first, whatever the declaration order', () => {
  const { model } = M('{[list Kids]}{[Age|number]}{[end list]}');
  model.variables.MinorCount = { path: 'MinorCount', type: 'computed', formula: 'count(Kids|filter: Age < Threshold)' };
  model.variables.Threshold = { path: 'Threshold', type: 'computed', formula: 'Base + 8' };
  model.variables['Kids[].Flag'] = { path: 'Kids[].Flag', type: 'computed', formula: 'Age < Threshold' };
  model.order.push('MinorCount', 'Kids[].Flag', 'Threshold');
  const r = computeDerived(model, { Base: 10, Kids: [{ Age: 5 }, { Age: 30 }] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.data.Threshold, 18);
  assert.equal(r.data.MinorCount, 1);
  assert.deepEqual(r.data.Kids.map((k) => k.Flag), [true, false]);
});

test('a formula that names its own variable (via a list filter or bare) reads the stored value and never throws', () => {
  const { model } = M('{[list Kids]}{[Age|number]}{[end list]}');
  model.variables.Self = { path: 'Self', type: 'computed', formula: 'count(Kids|filter: Self)' };
  model.variables['Kids[].Self2'] = { path: 'Kids[].Self2', type: 'computed', formula: 'Self2 + 1' };
  model.order.push('Self', 'Kids[].Self2');
  const r = computeDerived(model, { Kids: [{ Age: 1, Self2: 1 }, { Age: 2 }] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.data.Self, 0);
  assert.equal(r.data.Kids[0].Self2, 2);
  // a genuine two-variable cycle through a list filter is still reported
  model.variables.Self.formula = 'count(Kids|filter: Age > Other)';
  model.variables.Other = { path: 'Other', type: 'computed', formula: 'Self + 1' }; model.order.push('Other');
  const r2 = computeDerived(model, { Kids: [{ Age: 1 }] });
  assert.equal(r2.errors.length, 1);
  assert.match(r2.errors[0].message, /^Circular formula: /);
});

// ---------------------------------------------------------------- 5. mergeModel precedence matrix

const BASE = '{[if FeeType = "Hourly"]}a{[elseif FeeType = "Flat"]}b{[end if]}{[Retainer|currency]}{[Name]}';
const FIELDS = ['label', 'type', 'options', 'help', 'required', 'default', 'min', 'validate', 'message'];

test('inference → annotation added → annotation changed → annotation removed: every field reverts to inference', () => {
  let m = createModel(A(BASE));
  const inferred = pick(m, 'Name', FIELDS);
  assert.deepEqual(inferred, { label: 'Name', type: 'text', options: undefined, help: '', required: true, default: undefined, min: undefined, validate: undefined, message: undefined });
  m = mergeModel(m, A('{[# @label Name: Full name\n@help Name: legal\n@required Name: false\n@default Name: Bob\n@min Name: 2\n@validate Name: len(value) > 1 :: too short\n@options FeeType: Hourly | Flat | Contingency\n@type Retainer: number]}' + BASE));
  assert.deepEqual(pick(m, 'Name', FIELDS), { label: 'Full name', type: 'text', options: undefined, help: 'legal', required: false, default: 'Bob', min: 2, validate: 'len(value) > 1', message: 'too short' });
  assert.deepEqual(m.variables.Name.fromTemplate, { required: false, label: 'Full name', help: 'legal', min: 2, validate: 'len(value) > 1', message: 'too short', default: 'Bob' });
  assert.deepEqual(pick(m, 'FeeType', ['type', 'options']), { type: 'selection', options: ['Hourly', 'Flat', 'Contingency'] });
  assert.equal(m.variables.Retainer.type, 'number');
  m = mergeModel(m, A('{[# @label Name: Other\n@min Name: 3]}' + BASE));
  assert.deepEqual(pick(m, 'Name', FIELDS), { ...inferred, label: 'Other', min: 3 });
  assert.deepEqual(m.variables.Name.fromTemplate, { label: 'Other', min: 3 });
  assert.deepEqual(pick(m, 'FeeType', ['type', 'options']), { type: 'selection', options: ['Hourly', 'Flat'] }); // back to inference
  assert.equal(m.variables.Retainer.type, 'currency');
  m = mergeModel(m, A(BASE));
  assert.deepEqual(pick(m, 'Name', FIELDS), inferred);
  assert.equal(m.variables.Name.fromTemplate, undefined);
});

test('user edits (with or without custom flags) beat annotations and survive template edits and annotation removal', () => {
  let m = createModel(A(BASE));
  Object.assign(m.variables.Name, { label: 'User label', help: 'user help', required: false, default: 'U', min: 3, validate: 'value != ""', message: 'user msg' });
  m.variables.FeeType.options = ['Hourly', 'Flat', 'Contingency'];
  m.variables.Retainer.type = 'number';
  const user = pick(m, 'Name', FIELDS);
  const ANN = '{[# @label Name: Ann\n@help Name: ann help\n@required Name\n@default Name: A\n@min Name: 9\n@validate Name: 1 = 1 :: ann msg\n@options FeeType: Hourly | Flat\n@type Retainer: date\n@default Retainer: 5]}';
  m = mergeModel(m, A(ANN + BASE + '{[Extra]}'));
  assert.deepEqual(pick(m, 'Name', FIELDS), user);
  assert.equal(m.variables.Name.fromTemplate, undefined);
  assert.deepEqual(pick(m, 'FeeType', ['type', 'options']), { type: 'selection', options: ['Hourly', 'Flat', 'Contingency'] });
  assert.equal(m.variables.Retainer.type, 'number');
  assert.equal(m.variables.Retainer.default, 5); // untouched field: annotation applies, coerced to the user's type
  assert.ok(m.variables.Extra);
  m = mergeModel(m, A(BASE));
  assert.deepEqual(pick(m, 'Name', FIELDS), user);
  assert.deepEqual(pick(m, 'FeeType', ['type', 'options']), { type: 'selection', options: ['Hourly', 'Flat', 'Contingency'] });
  assert.deepEqual(pick(m, 'Retainer', ['type', 'default']), { type: 'number', default: undefined });
  assert.equal(m.variables.Extra.orphaned, true);
});

test('user edit of an annotated field, then the annotation changes: the user value stays (flagged or not); a flag keeps a value equal to inference', () => {
  let m = createModel(A('{[# @label Name: Ann1]}' + BASE));
  m.variables.Name.label = 'User'; m.variables.Name.custom = { label: true };
  m = mergeModel(m, A('{[# @label Name: Ann2]}' + BASE));
  assert.deepEqual(pick(m, 'Name', ['label', 'fromTemplate', 'custom']), { label: 'User', fromTemplate: undefined, custom: { label: true } });
  m = createModel(A('{[# @label Name: Ann1]}' + BASE));
  m.variables.Name.label = 'User';
  m = mergeModel(m, A('{[# @label Name: Ann2]}' + BASE));
  assert.equal(m.variables.Name.label, 'User');
  // flagged edit equal to the inferred value beats the annotation
  m = createModel(A('{[# @label Name: Ann]}' + BASE)); m.variables.Name.label = 'Name'; m.variables.Name.custom = { label: true };
  m = mergeModel(m, A('{[# @label Name: Ann]}' + BASE));
  assert.equal(m.variables.Name.label, 'Name');
  // unflagged edit equal to the *annotation* value is re-applied from the template (documented)
  m = createModel(A('{[# @help Name: h]}' + BASE)); m.variables.Name.help = '';
  m = mergeModel(m, A('{[# @help Name: h]}' + BASE));
  assert.equal(m.variables.Name.help, 'h');
  m = createModel(A('{[# @help Name: h]}' + BASE)); m.variables.Name.help = ''; m.variables.Name.custom = { help: true };
  m = mergeModel(m, A('{[# @help Name: h]}' + BASE));
  assert.equal(m.variables.Name.help, '');
  // user toggled required back on (flag) over @optional, annotation then removed
  m = createModel(A('{[# @optional Name]}' + BASE)); m.variables.Name.required = true; m.variables.Name.custom = { required: true };
  m = mergeModel(m, A(BASE));
  assert.equal(m.variables.Name.required, true);
  // legacy custom: true freezes everything, including against annotations
  m = createModel(A(BASE)); m.variables.Name.custom = true;
  m = mergeModel(m, A('{[# @label Name: Ann]}' + BASE));
  assert.equal(m.variables.Name.label, 'Name');
});

test('formula precedence: user computed vs @formula; @formula removed orphans only template-created variables', () => {
  let m = createModel(A(BASE));
  m.variables.Total = { path: 'Total', name: 'Total', parent: null, label: 'Total', type: 'computed', inferredType: 'computed', required: false, formula: 'Retainer*3', help: '', orphaned: false, usedIn: [], gatedBy: [], filters: [] };
  m.order.push('Total');
  m = mergeModel(m, A('{[# @formula Total: Retainer * 2]}' + BASE));
  assert.deepEqual(pick(m, 'Total', ['formula', 'orphaned']), { formula: 'Retainer*3', orphaned: false });
  m = mergeModel(m, A(BASE));
  assert.deepEqual(pick(m, 'Total', ['formula', 'orphaned']), { formula: 'Retainer*3', orphaned: false });
  m = createModel(A('{[# @formula Total: Retainer * 2]}' + BASE));
  m = mergeModel(m, A('{[# @formula Total: Retainer * 4]}' + BASE));
  assert.equal(m.variables.Total.formula, 'Retainer * 4');
  m = mergeModel(m, A(BASE));
  assert.deepEqual(pick(m, 'Total', ['type', 'formula', 'orphaned']), { type: 'computed', formula: 'Retainer * 4', orphaned: true });
  // a printed variable given a @formula, annotation removed → back to an ordinary input
  m = createModel(A('{[# @formula Total: Retainer * 2]}{[Total|currency]}' + BASE));
  assert.equal(m.variables.Total.type, 'computed');
  m = mergeModel(m, A('{[Total|currency]}' + BASE));
  assert.deepEqual(pick(m, 'Total', ['type', 'formula', 'orphaned']), { type: 'currency', formula: undefined, orphaned: false });
});

test('mergeModel reports type-aware annotation problems too, and re-merging is idempotent', () => {
  const an = A('{[# @type X: number\n@default X: abc]}{[X]}');
  let m = createModel(an);
  assert.deepEqual(m.annotationErrors.map((e) => e.message), ['@default X: expected a number, got "abc"']);
  m = mergeModel(m, an);
  assert.deepEqual(m.annotationErrors.map((e) => e.message), ['@default X: expected a number, got "abc"']);
  assert.equal(m.variables.X.default, undefined);
  const again = mergeModel(m, an);
  assert.deepEqual(again.variables, m.variables);
});
