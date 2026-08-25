import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { analyze, questionnaire } from '../engine/analyze.js';
import { createModel } from '../engine/model.js';

const T = `{[# @label Retainer: Retainer amount
@help Retainer: Initial deposit
@type Retainer: currency
@min Retainer: 0
@max Retainer: 50000
@default Retainer: 1500
@minLength Client.Name: 2
@maxLength Client.Name: 80
@pattern Client.Phone: ^\\d{3}-\\d{3}-\\d{4}$
@default Firm.State: California
@options FeeType: Hourly | Flat ]}
{[Client.Name]} {[Client.Phone]} {[Retainer]} {[Firm.State]} {[FeeType]}
{[list Members]}{[Name]} {[Percent|number]}{[end list]}`;

test('questionnaire carries min/max/minLength/maxLength/pattern/help/default from the model', () => {
  const ast = parse(T);
  const model = createModel(analyze(ast));
  model.variables['Members[].Percent'].min = 0;
  model.variables['Members[].Percent'].max = 100;
  const qs = questionnaire(ast, { Members: [{}] }, model);
  const by = Object.fromEntries(qs.map((q) => [q.path, q]));
  assert.equal(by['Retainer'].label, 'Retainer amount');
  assert.equal(by['Retainer'].type, 'currency');
  assert.equal(by['Retainer'].help, 'Initial deposit');
  assert.equal(by['Retainer'].min, 0);
  assert.equal(by['Retainer'].max, 50000);
  assert.equal(by['Retainer'].default, 1500);
  assert.deepEqual(by['Retainer'].fromTemplate, { label: 'Retainer amount', help: 'Initial deposit', type: 'currency', min: 0, max: 50000, default: 1500 });
  assert.equal(by['Client.Name'].minLength, 2);
  assert.equal(by['Client.Name'].maxLength, 80);
  assert.equal(by['Client.Phone'].pattern, '^\\d{3}-\\d{3}-\\d{4}$');
  assert.equal(by['Firm.State'].default, 'California');
  assert.deepEqual(by['FeeType'].options, ['Hourly', 'Flat']);
  assert.equal(by['FeeType'].type, 'selection');
  assert.equal(by['Members[].Percent'].min, 0);
  assert.equal(by['Members[].Percent'].max, 100);
  assert.equal(by['Members[].Percent'].listPath, 'Members');
  // unset attributes are absent, not null
  assert.ok(!('min' in by['Client.Name']));
  assert.ok(!('pattern' in by['Client.Name']));
  assert.ok(!('default' in by['Client.Name']));
  assert.ok(!('fromTemplate' in by['Members[].Name']));
});

test('questionnaire without a model, or with a model lacking rules, keeps its old shape', () => {
  const ast = parse('{[Name]} {[Fee|currency]}');
  const qs = questionnaire(ast, {});
  assert.deepEqual(Object.keys(qs[0]).sort(), ['answered', 'label', 'path', 'required', 'type']);
  const model = createModel(analyze(ast));
  const qs2 = questionnaire(ast, {}, model);
  assert.deepEqual(Object.keys(qs2[1]).sort(), ['answered', 'label', 'path', 'required', 'type']);
  // an empty-string min (cleared in the UI) is treated as unset
  model.variables['Fee'].min = '';
  model.variables['Fee'].max = null;
  assert.ok(!('min' in questionnaire(ast, {}, model)[1]) && !('max' in questionnaire(ast, {}, model)[1]));
});

test('questionnaire: a default of 0 / false is still passed through', () => {
  const ast = parse('{[Count|number]} {[if Flag]}x{[end if]}');
  const model = createModel(analyze(ast));
  model.variables['Count'].default = 0;
  model.variables['Flag'].default = false;
  const by = Object.fromEntries(questionnaire(ast, {}, model).map((q) => [q.path, q]));
  assert.equal(by['Count'].default, 0);
  assert.equal(by['Flag'].default, false);
});
