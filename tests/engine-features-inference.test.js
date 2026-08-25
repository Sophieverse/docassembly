import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { analyze, questionnaire, humanize } from '../engine/analyze.js';
import { createModel, mergeModel } from '../engine/model.js';
import { render } from '../engine/evaluate.js';

const T = (tpl, path) => analyze(parse(tpl)).variables.get(path).inferredType;

test('bare {[if X]} on a variable that is also printed / filtered / compared is a has-value check (text), not boolean', () => {
  assert.equal(T('{[if Court]} in the {[Court]}{[end if]}', 'Court'), 'text');
  assert.equal(T('{[if Court]} in the {[Court|upper]}{[end if]}', 'Court'), 'text');
  assert.equal(T('{[if Court]}{[upper(Court)]}{[end if]}', 'Court'), 'text');
  assert.equal(T('{[if Notes]}{[Notes]}{[end if]}', 'Notes'), 'longtext'); // name hint still applies after demotion
  assert.equal(T('{[if Fee]}{[Fee|currency]}{[end if]}', 'Fee'), 'currency');
  assert.equal(T('{[if State]}x{[end if]}{[if State = "CA"]}a{[else if State = "NY"]}b{[end if]}', 'State'), 'selection');
  assert.equal(T('{[if Deadline]}by {[Deadline|format:"long"]}{[end if]}', 'Deadline'), 'date');
  // sole evidence is bare / not condition usage → boolean
  assert.equal(T('{[if Court]}x{[end if]}', 'Court'), 'boolean');
  assert.equal(T('{[if not Court]}x{[end if]}', 'Court'), 'boolean');
  assert.equal(T('{[if Court]}x{[else]}y{[end if]}{[if not Court]}z{[end if]}', 'Court'), 'boolean');
  // name hints Is*/Has* force boolean even when printed
  assert.equal(T('{[if IsMarried]}{[IsMarried]}{[end if]}', 'IsMarried'), 'boolean');
  assert.equal(T('{[if HasKids]}{[HasKids|format:"yes":"no"]}{[end if]}', 'HasKids'), 'boolean');
  // a boolean-typing filter on the printed use keeps boolean
  assert.equal(T('{[if Flag]}x{[end if]} {[Flag|format:"on":"off"]}', 'Flag'), 'boolean');
  // inside list bodies too
  assert.equal(T('{[list Kids]}{[if Nickname]}aka {[Nickname]}{[end if]}{[end list]}', 'Kids[].Nickname'), 'text');
});

test('selection needs at least two distinct literals; one literal → text with the literal as a suggestion', () => {
  const one = analyze(parse('{[if State = "CA"]}a{[else]}b{[end if]}')).variables.get('State');
  assert.equal(one.inferredType, 'text');
  assert.deepEqual(one.options, ['CA']);
  assert.equal(T('{[State = "CA" ? "cal" : "other"]}', 'State'), 'text');
  assert.equal(T('{[if State != "CA"]}a{[end if]}', 'State'), 'text');
  // the same literal twice is still one option
  assert.equal(T('{[if State = "CA"]}a{[end if]}{[if State = "CA"]}b{[end if]}', 'State'), 'text');
  const two = analyze(parse('{[if State = "CA"]}a{[else if State = "NY"]}b{[end if]}')).variables.get('State');
  assert.equal(two.inferredType, 'selection');
  assert.deepEqual(two.options, ['CA', 'NY']);
  // pronoun/salutation still give a gender selection
  assert.equal(T('{[pronoun(Gender, "subject")]}', 'Gender'), 'selection');
  // model: one-literal variable has inferredOptions (suggestions) but no options
  const m = createModel(analyze(parse('{[if State = "CA"]}a{[else]}b{[end if]}')));
  assert.equal(m.variables['State'].type, 'text');
  assert.equal(m.variables['State'].options, undefined);
  assert.deepEqual(m.variables['State'].inferredOptions, ['CA']);
  const q = questionnaire(parse('{[if State = "CA"]}a{[else]}b{[end if]}'), {}, m);
  assert.equal(q[0].options, undefined);
  assert.deepEqual(q[0].suggestions, ['CA']);
});

test('filter-chain inference scans the whole chain, not just the first filter', () => {
  assert.equal(T('{[Day|default:"1"|ordinal]}', 'Day'), 'number');
  assert.equal(T('{[Fee|default:0|currency]}', 'Fee'), 'currency');
  assert.equal(T('{[Fee|default:0|dollars|upper]}', 'Fee'), 'currency');
  assert.equal(T('{[Total|round|words]}', 'Total'), 'number');
  assert.equal(T('{[Start|default:"2026-01-01"|format:"long"]}', 'Start'), 'date');
  assert.equal(T('{[Start|trim|format:"MMMM d, yyyy"]}', 'Start'), 'date');
  assert.equal(T('{[Flag|default:false|format:"yes":"no"]}', 'Flag'), 'boolean');
  assert.equal(T('{[Gender|lower|pronoun:"subject"]}', 'Gender'), 'selection');
  assert.equal(T('{[Qty|default:1|format:"9,999"]}', 'Qty'), 'number');
  // function form
  assert.equal(T('{[ordinal(default(Day, "1"))]}', 'Day'), 'number');
  // a list reducer in the chain types the result, not the list
  assert.equal(T('{[Kids|count|ordinal]}', 'Kids'), 'list');
  assert.equal(T('{[Names|join|upper]}', 'Names'), 'list');
  assert.equal(T('{[Items|sum:Price|currency]}', 'Items'), 'list');
});

test('questionnaire attaches options only to selection/multiselect; mergeModel drops options when the user switches to text', () => {
  const tpl = '{[if State = "CA"]}a{[else if State = "NY"]}b{[end if]} {[Tags|join]}';
  const ast = parse(tpl);
  const m = createModel(analyze(ast));
  assert.deepEqual(questionnaire(ast, {}, m)[0].options, ['CA', 'NY']);
  m.variables['State'].type = 'text';
  const q = questionnaire(ast, {}, m)[0];
  assert.equal(q.type, 'text');
  assert.equal(q.options, undefined);
  assert.deepEqual(q.suggestions, ['CA', 'NY']);
  // after merge the options are gone from the definition but inferredOptions stay as suggestions
  const m2 = mergeModel(m, analyze(ast));
  assert.equal(m2.variables['State'].type, 'text');
  assert.equal(m2.variables['State'].options, undefined);
  assert.deepEqual(m2.variables['State'].inferredOptions, ['CA', 'NY']);
  // switching back to selection restores the inferred options
  m2.variables['State'].type = 'selection';
  const m3 = mergeModel(m2, analyze(ast));
  assert.deepEqual(m3.variables['State'].options, ['CA', 'NY']);
  // user-typed options on a text variable are not thrown away unless the type was changed
  m3.variables['Tags'].type = 'multiselect';
  m3.variables['Tags'].options = ['x', 'y'];
  assert.deepEqual(mergeModel(m3, analyze(ast)).variables['Tags'].options, ['x', 'y']);
});

test('humanize: digit boundaries, all-caps acronyms, and "?" for boolean labels', () => {
  assert.equal(humanize('BuiltBefore1978'), 'Built before 1978');
  assert.equal(humanize('Address2'), 'Address 2');
  assert.equal(humanize('ROFRDays'), 'ROFR days');
  assert.equal(humanize('HOA.MonthlyFee'), 'HOA — Monthly fee');
  assert.equal(humanize('Client.DOB'), 'Client — DOB');
  assert.equal(humanize('Client.IsMarried'), 'Client — Is married?');
  assert.equal(humanize('Court', 'boolean'), 'Court?');
  assert.equal(humanize('Client.IsMarried', 'boolean'), 'Client — Is married?');
  assert.equal(humanize('Court', 'text'), 'Court');
  assert.equal(humanize('SigningDate'), 'Signing date');
  // model + questionnaire labels use the type-aware form
  const ast = parse('{[if Court]}x{[end if]} {[Name]}');
  const m = createModel(analyze(ast));
  assert.equal(m.variables['Court'].label, 'Court?');
  assert.equal(m.variables['Name'].label, 'Name');
  assert.equal(questionnaire(ast, {})[0].label, 'Court?');
  // a "?" label that came from the type is not treated as a user edit when the type changes
  const m2 = mergeModel(m, analyze(parse('{[if Court]} in the {[Court]}{[end if]}')));
  assert.equal(m2.variables['Court'].type, 'text');
  assert.equal(m2.variables['Court'].label, 'Court');
});

test('a list of plain values ({[X|join]}, {[list X]}{[_item]}{[end list]}) is a list with itemType text', () => {
  const a = analyze(parse('{[Names|join]} {[list Tags]}{[_item]}{[_punc]}{[end list]} {[list Kids]}{[Name]}{[end list]} {[count(Pets)]}'));
  assert.equal(a.variables.get('Names').inferredType, 'list');
  assert.equal(a.variables.get('Names').itemType, 'text');
  assert.equal(a.variables.get('Tags').itemType, 'text');
  assert.equal(a.variables.get('Kids').itemType, undefined);
  assert.equal(a.variables.get('Pets').itemType, 'text');
  const ast = parse('{[Names|join]} {[list Kids]}{[Name]}{[end list]}');
  const m = createModel(analyze(ast));
  assert.equal(m.variables['Names'].itemType, 'text');
  assert.equal(m.variables['Kids'].itemType, undefined);
  const qs = questionnaire(ast, {}, m);
  const names = qs.find((q) => q.path === 'Names');
  assert.equal(names.type, 'list');
  assert.equal(names.itemType, 'text');
  assert.equal(qs.find((q) => q.path === 'Kids').itemType, undefined);
  // without a model the analysis flag is used
  assert.equal(questionnaire(ast, {}).find((q) => q.path === 'Names').itemType, 'text');
});

test('{[N|blank]} never produces a "Missing value" warning', () => {
  const r = render(parse('a{[N|blank]}b {[blank(N)]} {[M]}'), {});
  assert.equal(r.text, 'ab  ');
  assert.deepEqual(r.warnings, ['Missing value: M']);
  assert.deepEqual(render(parse('{[N|trim|blank]}'), {}).warnings, []);
  // still traced as referenced (relevance), just not warned
  assert.ok(r.trace.referenced.has('N'));
});

test('annotation keys are case-insensitive and errors echo the canonical camelCase name', () => {
  const a = analyze(parse('{[# @MINLENGTH X: 2\n@MaxLength X: many\n@Label X: Ex]}{[X]}'));
  assert.deepEqual(a.annotations.get('X'), { minLength: 2, label: 'Ex' });
  assert.equal(a.annotationErrors.length, 1);
  assert.match(a.annotationErrors[0].message, /^@maxLength X: expected a whole number/);
});
