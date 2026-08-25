import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { analyze } from '../engine/analyze.js';
import { createModel, mergeModel, coerce, validate, computeDerived, emptyData, emptyItem, setPath, humanize } from '../engine/model.js';

const T1 = '{[Client.Name]} {[Fee|currency]} {[if Client.IsMarried]}{[Spouse.Name]}{[end if]}{[list Children]}{[Name]}{[end list]}';

test('createModel from analysis', () => {
  const m = createModel(analyze(parse(T1)));
  assert.deepEqual(m.order, ['Client.Name', 'Client', 'Fee', 'Client.IsMarried', 'Spouse.Name', 'Spouse', 'Children', 'Children[].Name']);
  const fee = m.variables['Fee'];
  assert.equal(fee.type, 'currency');
  assert.equal(fee.inferredType, 'currency');
  assert.equal(fee.label, 'Fee');
  assert.equal(fee.required, true);
  assert.equal(fee.orphaned, false);
  assert.equal(m.variables['Client'].required, false);
  assert.equal(m.variables['Client.IsMarried'].required, false);
  assert.equal(m.variables['Children[].Name'].isListItemField, true);
  assert.equal(m.variables['Children[].Name'].listPath, 'Children');
  assert.equal(m.variables['Client.IsMarried'].label, humanize('Client.IsMarried'));
});

test('mergeModel keeps user edits, adds new vars, orphans removed ones, re-adopts returning ones', () => {
  const m1 = createModel(analyze(parse(T1)));
  m1.variables['Fee'].label = 'Retainer fee (USD)';
  m1.variables['Fee'].help = 'Ask accounting';
  m1.variables['Client.Name'].type = 'longtext';
  m1.variables['Client.Name'].required = false;
  m1.variables['Spouse.Name'].options = ['a', 'b'];
  m1.variables['Total'] = { path: 'Total', name: 'Total', parent: null, label: 'Total', type: 'computed', inferredType: 'computed', formula: 'Fee * 2', required: false, orphaned: false };
  m1.order.push('Total');
  const T2 = '{[Client.Name]} {[Fee|currency]} {[NewVar]} {[if Client.IsMarried]}x{[end if]}';
  const m2 = mergeModel(m1, analyze(parse(T2)));
  assert.equal(m2.variables['Fee'].label, 'Retainer fee (USD)');
  assert.equal(m2.variables['Fee'].help, 'Ask accounting');
  assert.equal(m2.variables['Client.Name'].type, 'longtext');
  assert.equal(m2.variables['Client.Name'].required, false);
  assert.equal(m2.variables['NewVar'].type, 'text');
  assert.equal(m2.variables['NewVar'].orphaned, false);
  assert.equal(m2.variables['Spouse.Name'].orphaned, true);
  assert.deepEqual(m2.variables['Spouse.Name'].options, ['a', 'b']);
  assert.equal(m2.variables['Children'].orphaned, true);
  assert.equal(m2.variables['Total'].type, 'computed');
  assert.equal(m2.variables['Total'].orphaned, false);
  assert.equal(m2.variables['Total'].formula, 'Fee * 2');
  assert.ok(m2.order.includes('Spouse.Name'));
  // unchanged inferred type follows the template when the template changes
  const T3 = '{[Client.Name]} {[Fee|number]}';
  const m3 = mergeModel(m2, analyze(parse(T3)));
  assert.equal(m3.variables['Fee'].type, 'number');
  assert.equal(m3.variables['Fee'].label, 'Retainer fee (USD)');
  // returning variable is un-orphaned
  const m4 = mergeModel(m3, analyze(parse(T1)));
  assert.equal(m4.variables['Spouse.Name'].orphaned, false);
  assert.deepEqual(m4.variables['Spouse.Name'].options, ['a', 'b']);
  // a user-changed type is preserved even when inference changes
  assert.equal(m4.variables['Client.Name'].type, 'longtext');
});

test('coerce', () => {
  assert.equal(coerce('1,234.50', 'currency'), 1234.5);
  assert.equal(coerce('$1,234', 'number'), 1234);
  assert.equal(coerce('abc', 'number'), 'abc');
  assert.equal(coerce('', 'number'), '');
  assert.equal(coerce('3/5/2026', 'date'), '2026-03-05');
  assert.equal(coerce('March 5, 2026', 'date'), '2026-03-05');
  assert.equal(coerce('bad', 'date'), 'bad');
  assert.equal(coerce('yes', 'boolean'), true);
  assert.equal(coerce('No', 'boolean'), false);
  assert.equal(coerce(true, 'boolean'), true);
  assert.equal(coerce('maybe', 'boolean'), 'maybe');
  assert.deepEqual(coerce('a, b', 'multiselect'), ['a', 'b']);
  assert.deepEqual(coerce('', 'list'), []);
  assert.deepEqual(coerce(['x'], 'list'), ['x']);
  assert.equal(coerce(5, 'text'), '5');
  assert.equal(coerce(undefined, 'text'), undefined);
});

test('validate', () => {
  const m = createModel(analyze(parse('{[Name]} {[Fee|currency]} {[When|format:"long"]} {[if Flag]}x{[end if]} {[if State = "CA" or State = "NY"]}y{[end if]} {[Email]} {[list Kids]}{[Age|number]}{[end list]}')));
  const errs = validate(m, { Name: '', Fee: 'lots', When: 'yesterday', Flag: 'x', State: 'TX', Email: 'nope', Kids: [{ Age: 3 }, { Age: 'old' }, {}] });
  const byPath = Object.fromEntries(errs.map((e) => [e.path, e.message]));
  assert.match(byPath['Name'], /required/);
  assert.match(byPath['Fee'], /number/);
  assert.match(byPath['When'], /valid date/);
  assert.match(byPath['Flag'], /Yes or No/);
  assert.match(byPath['State'], /one of: CA, NY/);
  assert.match(byPath['Email'], /email/);
  assert.match(byPath['Kids[1].Age'], /number/);
  assert.match(byPath['Kids[2].Age'], /required/);
  assert.equal(errs.length, 8);
  assert.deepEqual(validate(m, { Name: 'x', Fee: 10, When: '2026-01-01', Flag: true, State: 'CA', Email: 'a@b.co', Kids: [] }), []);
  // restrict to relevant paths
  assert.deepEqual(validate(m, {}, { relevant: ['Name'] }).map((e) => e.path), ['Name']);
  // orphaned & computed & object skipped
  m.variables['Name'].orphaned = true;
  assert.ok(!validate(m, {}).some((e) => e.path === 'Name'));
});

test('computeDerived evaluates formulas topologically and reports cycles', () => {
  const m = { order: ['Fee', 'Tax', 'Total', 'Label', 'A', 'B'], variables: {
    Fee: { path: 'Fee', type: 'currency' },
    Total: { path: 'Total', type: 'computed', formula: 'Fee + Tax' },
    Tax: { path: 'Tax', type: 'computed', formula: 'Fee * 0.1' },
    Label: { path: 'Label', type: 'computed', formula: 'Total|currency' },
    A: { path: 'A', type: 'computed', formula: 'B + 1' },
    B: { path: 'B', type: 'computed', formula: 'A + 1' },
  } };
  const { data, errors } = computeDerived(m, { Fee: 100 });
  assert.equal(data.Tax, 10);
  assert.equal(data.Total, 110);
  assert.equal(data.Label, '$110.00');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Circular formula/);
  // nested target path and bad formula
  const m2 = { order: ['Client.Age', 'Bad'], variables: { 'Client.Age': { path: 'Client.Age', type: 'computed', formula: 'yearsBetween(Client.DOB, "2026-06-01")' }, Bad: { path: 'Bad', type: 'computed', formula: '1 +' } } };
  const r2 = computeDerived(m2, { Client: { DOB: '2000-06-02' } });
  assert.equal(r2.data.Client.Age, 25);
  assert.equal(r2.data.Client.DOB, '2000-06-02');
  assert.match(r2.errors[0].message, /Bad formula/);
});

test('emptyData / emptyItem / setPath', () => {
  const m = createModel(analyze(parse('{[Client.Name]}{[list Children]}{[Name]}{[list Pets]}{[Kind]}{[end list]}{[end list]}{[Tags|join]}')));
  assert.deepEqual(emptyData(m), { Client: {}, Children: [], Tags: [] });
  assert.deepEqual(emptyItem(m, 'Children'), { Pets: [] });
  assert.deepEqual(setPath({}, 'A.B.C', 1), { A: { B: { C: 1 } } });
  assert.equal(setPath({}, 'L[1].X', 1).L[1].X, 1);
});
