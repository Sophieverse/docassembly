import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { analyze, relevantVariables, questionnaire, dependencyMap, humanize } from '../engine/analyze.js';

const A = (src) => analyze(parse(src));
const V = (src, path) => A(src).variables.get(path);

test('discovers variables, parents, names, and usage sites', () => {
  const a = A('Dear {[Client.FullName]},\n{[if Client.IsMarried]}{[Client.Spouse.Name]}{[end if]}');
  assert.deepEqual([...a.variables.keys()], ['Client.FullName', 'Client', 'Client.IsMarried', 'Client.Spouse.Name', 'Client.Spouse']);
  const fn = a.variables.get('Client.FullName');
  assert.equal(fn.name, 'FullName');
  assert.equal(fn.parent, 'Client');
  assert.deepEqual(fn.usedIn, [{ line: 1, col: 6, context: 'field' }]);
  assert.equal(a.variables.get('Client').inferredType, 'object');
  assert.equal(a.variables.get('Client.Spouse').inferredType, 'object');
  assert.equal(a.variables.get('Client.IsMarried').inferredType, 'boolean');
  assert.deepEqual(a.variables.get('Client.IsMarried').usedIn[0].context, 'condition');
  assert.deepEqual(a.variables.get('Client.Spouse.Name').gatedBy, ['Client.IsMarried']);
  assert.deepEqual(fn.gatedBy, []);
});

test('type inference: conditions, filters, name hints, comparisons', () => {
  assert.equal(V('{[if Flag]}x{[end if]}', 'Flag').inferredType, 'boolean');
  assert.equal(V('{[if not Flag]}x{[end if]}', 'Flag').inferredType, 'boolean');
  assert.equal(V('{[if !Flag]}x{[end if]}', 'Flag').inferredType, 'boolean');
  assert.equal(V('{[if Client.Flag and Other]}x{[end if]}', 'Client.Flag').inferredType, 'text'); // compound → not bare
  assert.equal(V('{[HasKids]}', 'HasKids').inferredType, 'boolean');
  assert.equal(V('{[IsMarried]}', 'IsMarried').inferredType, 'boolean');
  assert.equal(V('{[Fee|currency]}', 'Fee').inferredType, 'currency');
  assert.equal(V('{[currency(Fee)]}', 'Fee').inferredType, 'currency');
  assert.equal(V('{[Amount|dollars]}', 'Amount').inferredType, 'currency');
  assert.equal(V('{[RetainerAmount]}', 'RetainerAmount').inferredType, 'currency');
  assert.equal(V('{[PurchasePrice]}', 'PurchasePrice').inferredType, 'currency');
  assert.equal(V('{[Qty|number]}', 'Qty').inferredType, 'number');
  assert.equal(V('{[ChildCount]}', 'ChildCount').inferredType, 'number');
  assert.equal(V('{[N|ordinal]}', 'N').inferredType, 'number');
  assert.equal(V('{[N|words]}', 'N').inferredType, 'number');
  assert.equal(V('{[if Age >= 18]}x{[end if]}', 'Age').inferredType, 'number');
  assert.equal(V('{[if Score > 3.5]}x{[end if]}', 'Score').inferredType, 'number');
  assert.equal(V('{[SigningDate|format:"long"]}', 'SigningDate').inferredType, 'date');
  assert.equal(V('{[When|format:"MMMM d, yyyy"]}', 'When').inferredType, 'date');
  assert.equal(V('{[Started]}', 'Started').inferredType, 'text');
  assert.equal(V('{[StartDate]}', 'StartDate').inferredType, 'date');
  assert.equal(V('{[Client.DOB]}', 'Client.DOB').inferredType, 'date');
  assert.equal(V('{[yearsBetween(Birthday, today())]}', 'Birthday').inferredType, 'date');
  assert.equal(V('{[addDays(Effective, 30)]}', 'Effective').inferredType, 'date');
  assert.equal(V('{[if Deadline < "2026-01-01"]}x{[end if]}', 'Deadline').inferredType, 'date');
  assert.equal(V('{[Pct|format:"0.00"]}', 'Pct').inferredType, 'number');
  assert.equal(V('{[Pct|format:"9,999.00"]}', 'Pct').inferredType, 'number');
  assert.equal(V('{[list Children]}{[Name]}{[end list]}', 'Children').inferredType, 'list');
  assert.equal(V('{[count(Children)]}', 'Children').inferredType, 'list');
  assert.equal(V('{[Children|join]}', 'Children').inferredType, 'list');
  assert.equal(V('{[sum(Items, "Amount")]}', 'Items').inferredType, 'list');
  assert.equal(V('{[Client.Name]}', 'Client').inferredType, 'object');
  assert.equal(V('{[pronoun(Client.Gender, "subject")]}', 'Client.Gender').inferredType, 'selection');
  assert.deepEqual(V('{[Client.Gender|pronoun:"object"]}', 'Client.Gender').options, ['male', 'female', 'neutral']);
  assert.equal(V('{[Gender]}', 'Gender').inferredType, 'selection');
  const sel = V('{[if State = "CA"]}a{[else if State = "NY"]}b{[end if]}', 'State');
  assert.equal(sel.inferredType, 'selection');
  assert.deepEqual(sel.options, ['CA', 'NY']);
  assert.equal(V('{[Notes]}', 'Notes').inferredType, 'longtext');
  assert.equal(V('{[Description]}', 'Description').inferredType, 'longtext');
  assert.equal(V('{[Email]}', 'Email').inferredType, 'email');
  assert.equal(V('{[Name]}', 'Name').inferredType, 'text');
  // explicit filter evidence beats a name hint
  assert.equal(V('{[if FeeDate]}x{[end if]}{[FeeDate|currency]}', 'FeeDate').inferredType, 'currency');
  // filters recorded
  assert.deepEqual(V('{[Fee|currency|upper]}', 'Fee').filters, ['currency', 'upper']);
});

test('list item fields are recorded under List[].Field; outer vars inside lists stay global', () => {
  const a = A('{[Client.Name]}{[list Children]}{[Name]} {[DOB|format:"long"]} {[Client.Name]} {[_index]}{[end list]}');
  assert.ok(a.variables.has('Children[].Name'));
  assert.ok(a.variables.has('Children[].DOB'));
  assert.ok(!a.variables.has('Children[].Client.Name'));
  assert.ok(!a.variables.has('_index'));
  assert.ok(!a.variables.has('Children[]._index'));
  const n = a.variables.get('Children[].Name');
  assert.equal(n.isListItemField, true);
  assert.equal(n.listPath, 'Children');
  assert.equal(n.parent, 'Children');
  assert.equal(a.variables.get('Children[].DOB').inferredType, 'date');
  assert.equal(a.variables.get('Children').inferredType, 'list');
  // alias
  const b = A('{[list Children as kid]}{[kid.Name]}{[kid]}{[end list]}');
  assert.ok(b.variables.has('Children[].Name'));
  assert.ok(!b.variables.has('kid.Name'));
  // nested lists
  const c = A('{[list Trusts]}{[Name]}{[list Beneficiaries]}{[Share]}{[end list]}{[end list]}');
  assert.ok(c.variables.has('Trusts[].Name'));
  assert.ok(c.variables.has('Trusts[].Beneficiaries'));
  assert.equal(c.variables.get('Trusts[].Beneficiaries').inferredType, 'list');
  assert.ok(c.variables.has('Trusts[].Beneficiaries[].Share'));
  assert.equal(c.variables.get('Trusts[].Beneficiaries[].Share').listPath, 'Trusts[].Beneficiaries');
  // dotted list expression
  const d = A('{[list Client.Children]}{[Name]}{[end list]}');
  assert.ok(d.variables.has('Client.Children[].Name'));
  assert.equal(d.variables.get('Client.Children').inferredType, 'list');
  // filter-arg identifiers are item fields
  const e = A('{[Children|filter: Age < 18|map: Name|join]}{[list Children|filter: Age < 18]}{[Name]}{[end list]}');
  assert.ok(e.variables.has('Children[].Age'));
  assert.equal(e.variables.get('Children[].Age').inferredType, 'number');
  assert.ok(e.variables.has('Children[].Name'));
  assert.equal(e.variables.get('Children').inferredType, 'list');
  // a known top-level variable referenced inside a list is not an item field
  const f = A('{[if Firm.Name]}{[end if]}{[list Kids]}{[Firm.Name]}{[end list]}');
  assert.ok(f.variables.has('Firm.Name'));
  assert.ok(!f.variables.has('Kids[].Firm.Name'));
});

test('structure summary lists blocks in order', () => {
  const a = A('{[if A]}x{[else if B]}y{[end if]}{[list L]}z{[end list]}');
  assert.equal(a.structure[0].type, 'if');
  assert.equal(a.structure[0].branches.length, 2);
  assert.equal(a.structure[1].type, 'list');
  assert.equal(a.structure[1].path, 'L');
});

test('humanize', () => {
  assert.equal(humanize('Client.IsMarried'), 'Client — Is married?');
  assert.equal(humanize('SigningDate'), 'Signing date');
  assert.equal(humanize('Client.FullName'), 'Client — Full name');
  assert.equal(humanize('Children[].DOB'), 'Children — DOB');
  assert.equal(humanize('HasChildren'), 'Has children?');
  assert.equal(humanize('client_email_address'), 'Client email address');
  assert.equal(humanize('LLCName'), 'LLC name');
  assert.equal(humanize('Fee'), 'Fee');
});

const WILL = `
I, {[Testator.Name]}, declare this my Will.
{[if Testator.IsMarried]}
I am married to {[Spouse.Name]}.
{[if Spouse.IsAlsoTestator]}
We sign jointly.
{[end if]}
{[else]}
I am not married.
{[end if]}
{[if HasChildren]}
My children are: {[list Children]}{[Name]} born {[DOB|format:"long"]}{[_punc]}{[end list]}.
{[end if]}
Executor: {[Executor.Name]}.
`;

test('relevantVariables: nothing answered → only ungated + condition vars', () => {
  const r = relevantVariables(parse(WILL), {});
  assert.deepEqual(r.relevant, ['Testator.Name', 'Testator.IsMarried', 'HasChildren', 'Executor.Name']);
  assert.deepEqual(r.unanswered, ['Testator.Name', 'Testator.IsMarried', 'HasChildren', 'Executor.Name']);
  assert.deepEqual(r.blockedBy.get('Spouse.Name'), ['Testator.IsMarried']);
  assert.deepEqual(r.blockedBy.get('Spouse.IsAlsoTestator'), ['Testator.IsMarried']);
  assert.deepEqual(r.blockedBy.get('Children'), ['HasChildren']);
  assert.deepEqual(r.blockedBy.get('Children[].Name'), ['HasChildren']);
  assert.ok(!r.relevant.includes('Spouse.Name'));
});

test('relevantVariables: IsMarried=true reveals spouse fields; false hides them', () => {
  const t = relevantVariables(parse(WILL), { Testator: { IsMarried: true } });
  assert.ok(t.relevant.includes('Spouse.Name'));
  assert.ok(t.relevant.includes('Spouse.IsAlsoTestator'));
  assert.ok(t.unanswered.includes('Spouse.Name'));
  assert.equal(t.relevant.indexOf('Testator.IsMarried') < t.relevant.indexOf('Spouse.Name'), true);
  const f = relevantVariables(parse(WILL), { Testator: { IsMarried: false } });
  assert.ok(!f.relevant.includes('Spouse.Name'));
  assert.ok(!f.unanswered.includes('Spouse.Name'));
  assert.ok(!f.blockedBy.has('Spouse.Name'));
  // condition with a false answer is answered, not "unanswered"
  assert.ok(!f.unanswered.includes('Testator.IsMarried'));
});

test('relevantVariables: lists — item fields relevant per item', () => {
  const none = relevantVariables(parse(WILL), { HasChildren: true });
  assert.ok(none.relevant.includes('Children'));
  assert.ok(none.unanswered.includes('Children'));
  assert.deepEqual(none.blockedBy.get('Children[].Name'), ['Children']);
  const empty = relevantVariables(parse(WILL), { HasChildren: true, Children: [] });
  assert.ok(!empty.unanswered.includes('Children'));
  assert.ok(!empty.relevant.includes('Children[].Name'));
  const two = relevantVariables(parse(WILL), { HasChildren: true, Children: [{ Name: 'A', DOB: '2010-01-01' }, { Name: 'B' }] });
  assert.ok(two.relevant.includes('Children[].Name'));
  assert.ok(two.relevant.includes('Children[].DOB'));
  assert.deepEqual(two.unanswered.filter((u) => u.startsWith('Children')), ['Children[1].DOB']);
});

test('relevantVariables: condition inside list item uses item data', () => {
  const src = '{[list Kids]}{[if IsMinor]}{[Guardian]}{[end if]}{[end list]}';
  const r = relevantVariables(parse(src), { Kids: [{ IsMinor: true }, { IsMinor: false }, {}] });
  assert.ok(r.relevant.includes('Kids[].Guardian'));
  assert.deepEqual(r.unanswered, ['Kids[0].Guardian', 'Kids[2].IsMinor']);
  assert.ok(!r.blockedBy.has('Kids[].Guardian')); // relevant for item 0, so not blocked overall
  const r0 = relevantVariables(parse(src), { Kids: [{}] });
  assert.ok(!r0.relevant.includes('Kids[].Guardian'));
  assert.deepEqual(r0.blockedBy.get('Kids[].Guardian'), ['IsMinor']);
  assert.deepEqual(r0.unanswered, ['Kids[0].IsMinor']);
});

test('relevantVariables: else-if chain — later conditions relevant only if earlier ones false', () => {
  const src = '{[if A]}{[X]}{[else if B]}{[Y]}{[else]}{[Z]}{[end if]}';
  const r1 = relevantVariables(parse(src), {});
  assert.deepEqual(r1.relevant, ['A']);
  assert.deepEqual(r1.blockedBy.get('B'), ['A']);
  const r2 = relevantVariables(parse(src), { A: false });
  assert.deepEqual(r2.relevant, ['A', 'B']);
  const r3 = relevantVariables(parse(src), { A: false, B: false });
  assert.deepEqual(r3.relevant, ['A', 'B', 'Z']);
  const r4 = relevantVariables(parse(src), { A: true });
  assert.deepEqual(r4.relevant, ['A', 'X']);
});

test('questionnaire: ordered, labeled, typed, gated', () => {
  const q0 = questionnaire(parse(WILL), {});
  assert.deepEqual(q0.map((q) => q.path), ['Testator.Name', 'Testator.IsMarried', 'HasChildren', 'Executor.Name']);
  assert.equal(q0[1].label, 'Testator — Is married?');
  assert.equal(q0[1].type, 'boolean');
  assert.equal(q0[0].type, 'text');
  assert.equal(q0[0].answered, false);
  const q1 = questionnaire(parse(WILL), { Testator: { Name: 'Ann', IsMarried: true }, HasChildren: true, Children: [{ Name: 'Kid' }] });
  assert.deepEqual(q1.map((q) => q.path), ['Testator.Name', 'Testator.IsMarried', 'Spouse.Name', 'Spouse.IsAlsoTestator', 'HasChildren', 'Children', 'Children[].Name', 'Children[].DOB', 'Executor.Name']);
  assert.equal(q1[0].answered, true);
  assert.equal(q1.find((q) => q.path === 'Children').type, 'list');
  assert.equal(q1.find((q) => q.path === 'Children[].DOB').type, 'date');
  assert.equal(q1.find((q) => q.path === 'Children[].DOB').listPath, 'Children');
  assert.equal(q1.find((q) => q.path === 'Children[].DOB').answered, false);
  // model overrides labels/types/options
  const model = { variables: { 'Testator.Name': { label: 'Full legal name of testator', type: 'text', required: true, help: 'As on ID' }, 'Executor.Name': { orphaned: true } } };
  const q2 = questionnaire(parse(WILL), {}, model);
  assert.equal(q2[0].label, 'Full legal name of testator');
  assert.equal(q2[0].help, 'As on ID');
  assert.ok(!q2.some((q) => q.path === 'Executor.Name'));
});

test('dependencyMap: which conditions each variable gates', () => {
  const m = dependencyMap(parse(WILL));
  const married = m.get('Testator.IsMarried');
  assert.equal(married.length, 1);
  assert.equal(married[0].kind, 'if');
  assert.equal(married[0].condition, 'Testator.IsMarried');
  assert.equal(married[0].line, 3);
  assert.equal(married[0].endLine, 10);
  assert.ok(married[0].gates.includes('Spouse.Name'));
  assert.ok(married[0].gates.includes('Spouse.IsAlsoTestator'));
  const kids = m.get('HasChildren')[0];
  assert.ok(kids.gates.includes('Children'));
  assert.ok(kids.gates.includes('Children[].Name'));
  const list = m.get('Children')[0];
  assert.equal(list.kind, 'list');
  assert.deepEqual(list.gates.sort(), ['Children[].DOB', 'Children[].Name']);
  assert.ok(!m.has('Testator.Name'));
});
