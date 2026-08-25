import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { analyze } from '../engine/analyze.js';
import { createModel, validate } from '../engine/model.js';

const model = (tpl, edits = {}) => {
  const m = createModel(analyze(parse(tpl)));
  for (const [path, patch] of Object.entries(edits)) Object.assign(m.variables[path], patch);
  return m;
};
const msgs = (errs) => Object.fromEntries(errs.map((e) => [e.path, e.message]));

test('min / max on numbers and currency, with default messages', () => {
  const m = model('{[Count|number]} {[Fee|currency]}', { Count: { min: 1, max: 10 }, Fee: { min: 0 } });
  assert.deepEqual(validate(m, { Count: 5, Fee: 100 }), []);
  let e = msgs(validate(m, { Count: 0, Fee: -5 }));
  assert.equal(e['Count'], 'Count must be at least 1');
  assert.equal(e['Fee'], 'Fee must be at least 0');
  e = msgs(validate(m, { Count: 11, Fee: 1 }));
  assert.equal(e['Count'], 'Count must be at most 10');
  // boundary values are allowed (inclusive)
  assert.deepEqual(validate(m, { Count: 1, Fee: 0 }), []);
  assert.deepEqual(validate(m, { Count: 10, Fee: 0 }), []);
  // numeric strings (uncoerced UI input) are compared numerically
  assert.match(msgs(validate(m, { Count: '0', Fee: '$1,000' }))['Count'], /at least 1/);
  // a non-number is reported as a type error, not also as a range error
  const bad = validate(m, { Count: 'abc', Fee: 1 });
  assert.equal(bad.length, 1);
  assert.match(bad[0].message, /must be a number/);
});

test('min / max on dates (ISO bounds)', () => {
  const m = model('{[Start|format:"long"]} {[End|format:"long"]}', { Start: { min: '2020-01-01' }, End: { max: '2030-12-31' } });
  assert.deepEqual(validate(m, { Start: '2020-01-01', End: '2030-12-31' }), []);
  const e = msgs(validate(m, { Start: '2019-12-31', End: '2031-01-01' }));
  assert.equal(e['Start'], 'Start must be on or after 2020-01-01');
  assert.equal(e['End'], 'End must be on or before 2030-12-31');
  // human date input still compares as a date
  assert.match(msgs(validate(m, { Start: '3/5/2019', End: '2030-01-01' }))['Start'], /after 2020-01-01/);
  // a numeric min on a date-typed variable is ignored rather than crashing
  m.variables['Start'].min = 5;
  assert.deepEqual(validate(m, { Start: '2020-01-01', End: '2030-01-01' }), []);
});

test('minLength / maxLength on text and on lists', () => {
  const m = model('{[Name]} {[Zip]} {[list Members]}{[Name]}{[end list]}', { Name: { minLength: 2 }, Zip: { minLength: 5, maxLength: 5 }, Members: { minLength: 1, maxLength: 2 } });
  assert.deepEqual(validate(m, { Name: 'Al', Zip: '94110', Members: [{ Name: 'x' }] }), []);
  let e = msgs(validate(m, { Name: 'A', Zip: '941', Members: [{ Name: 'x' }] }));
  assert.equal(e['Name'], 'Name must have at least 2 characters');
  assert.equal(e['Zip'], 'Zip must have at least 5 characters');
  e = msgs(validate(m, { Name: 'Al', Zip: '941100', Members: [{ Name: 'a' }, { Name: 'b' }, { Name: 'c' }] }));
  assert.equal(e['Zip'], 'Zip must have at most 5 characters');
  assert.equal(e['Members'], 'Members must have at most 2 items');
  // empty list → required check only (list vars are not required by default), never the length rule
  m.variables['Members'].required = true;
  assert.equal(msgs(validate(m, { Name: 'Al', Zip: '94110', Members: [] }))['Members'], 'Members is required');
  assert.equal(msgs(validate(m, { Name: 'Al', Zip: '94110', Members: [] }, { relevant: ['Members'] }))['Members'], 'Members is required');
  // singular unit
  m.variables['Name'].minLength = 1; m.variables['Name'].required = false;
  assert.deepEqual(validate(m, { Name: '', Zip: '94110', Members: [{}] }), []);
});

test('pattern on text / phone / email with default and custom messages', () => {
  const m = model('{[Client.Phone]} {[Client.Email]} {[Code]}', {
    'Client.Phone': { pattern: '^\\d{3}-\\d{3}-\\d{4}$' },
    'Client.Email': { pattern: '@example\\.com$', message: 'Use the firm email domain' },
    Code: { pattern: '^[A-Z]{2}-\\d+$' },
  });
  assert.deepEqual(validate(m, { Client: { Phone: '415-555-1212', Email: 'a@example.com' }, Code: 'CA-12' }), []);
  const e = msgs(validate(m, { Client: { Phone: '4155551212', Email: 'a@example.org' }, Code: 'ca-12' }));
  assert.equal(e['Client.Phone'], 'Client — Phone must match pattern ^\\d{3}-\\d{3}-\\d{4}$');
  assert.equal(e['Client.Email'], 'Use the firm email domain');
  assert.match(e['Code'], /must match pattern/);
  // email type check runs first: a non-email never reaches the pattern rule
  const bad = validate(m, { Client: { Phone: '415-555-1212', Email: 'nope' }, Code: 'CA-1' });
  assert.equal(bad.length, 1);
  assert.match(bad[0].message, /email address/);
  // an invalid pattern is reported, not thrown
  m.variables['Code'].pattern = '(';
  assert.match(msgs(validate(m, { Client: { Phone: '415-555-1212', Email: 'a@example.com' }, Code: 'CA-1' }))['Code'], /invalid pattern/);
});

test('validate expression: `value`/`this`, whole data in scope, custom message', () => {
  const m = model('{[Client.DOB|format:"long"]} {[SigningDate|format:"long"]} {[Retainer|currency]} {[Hours|number]}', {
    SigningDate: { validate: 'value > Client.DOB', message: 'Signing date must be after the date of birth' },
    Retainer: { validate: 'this >= Hours * 100' },
    Hours: { validate: 'value = round(value)' },
  });
  const ok = { Client: { DOB: '1980-05-01' }, SigningDate: '2026-03-05', Retainer: 1000, Hours: 10 };
  assert.deepEqual(validate(m, ok), []);
  const e = msgs(validate(m, { ...ok, SigningDate: '1970-01-01', Retainer: 999, Hours: 10.5 }));
  assert.equal(e['SigningDate'], 'Signing date must be after the date of birth');
  assert.equal(e['Retainer'], 'Retainer is not valid (rule: this >= Hours * 100)');
  assert.match(e['Hours'], /is not valid/);
  // a rule that references an unanswered variable evaluates against empty, never throws
  assert.doesNotThrow(() => validate(m, { SigningDate: '2026-03-05', Retainer: 1, Hours: 1 }));
  // a broken rule is reported as an error on the field
  m.variables['Hours'].validate = '1 +';
  assert.match(msgs(validate(m, ok))['Hours'], /bad validation rule/);
  // rule errors are skipped when only required answers are wanted
  m.variables['Hours'].validate = 'value = round(value)';
  assert.deepEqual(validate(m, { ...ok, Hours: 10.5 }, { requiredOnly: true }), []);
});

test('list-level rule on the list variable, and item-field rules with concrete paths', () => {
  const m = model('{[list Members]}{[Name]} {[Percent|number]}{[end list]}', {
    Members: { validate: 'sum(Members, "Percent") = 100', message: 'Member percentages must total 100' },
    'Members[].Percent': { min: 0, max: 100 },
    'Members[].Name': { minLength: 2 },
  });
  assert.deepEqual(validate(m, { Members: [{ Name: 'Ann', Percent: 60 }, { Name: 'Bo', Percent: 40 }] }), []);
  const errs = validate(m, { Members: [{ Name: 'Ann', Percent: 60 }, { Name: 'B', Percent: 140 }, { Name: 'Cy', Percent: -5 }] });
  const e = msgs(errs);
  assert.equal(e['Members'], 'Member percentages must total 100');
  assert.equal(e['Members[1].Percent'], 'Members — Percent must be at most 100');
  assert.equal(e['Members[2].Percent'], 'Members — Percent must be at least 0');
  assert.equal(e['Members[1].Name'], 'Members — Name must have at least 2 characters');
  assert.equal(errs.length, 4);
  // the list rule can use `value` for the list itself
  m.variables['Members'].validate = 'count(value) >= 2';
  m.variables['Members'].message = undefined;
  assert.equal(msgs(validate(m, { Members: [{ Name: 'Ann', Percent: 100 }] }))['Members'], 'Members is not valid (rule: count(value) >= 2)');
});

test('item-field validate expression sees item fields (shadowing outer data), _index and outer data', () => {
  const m = model('{[Cutoff|format:"long"]} {[list Children]}{[Name]} {[DOB|format:"long"]} {[Share|number]}{[end list]}', {
    'Children[].DOB': { validate: 'value < Cutoff', message: 'Child must be born before the cutoff' },
    'Children[].Share': { validate: 'value >= _index' },
    'Children[].Name': { validate: 'Kind = "child" and this = Name' }, // Kind exists at root and on the item: item wins
  });
  const errs = validate(m, { Cutoff: '2020-01-01', Kind: 'root', Children: [{ Name: 'A', DOB: '2010-01-01', Share: 1, Kind: 'child' }, { Name: 'B', DOB: '2021-01-01', Share: 1 }] });
  const e = msgs(errs);
  assert.equal(e['Children[1].DOB'], 'Child must be born before the cutoff');
  assert.equal(e['Children[0].DOB'], undefined);
  assert.equal(e['Children[1].Share'], 'Children — Share is not valid (rule: value >= _index)');
  assert.equal(e['Children[0].Share'], undefined);
  assert.equal(e['Children[0].Name'], undefined, 'item Kind shadows root Kind');
  assert.match(e['Children[1].Name'], /is not valid/); // no item Kind → falls through to root "root" → rule fails
});

test('nested list item fields validate with fully concrete paths', () => {
  const m = model('{[list Trusts]}{[Name]}{[list Beneficiaries]}{[Name]} {[Share|number]}{[end list]}{[end list]}', {
    'Trusts[].Beneficiaries[].Share': { min: 1, max: 100 },
    'Trusts[].Beneficiaries': { validate: 'sum(value, "Share") = 100', message: 'Shares must total 100' },
  });
  const data = { Trusts: [{ Name: 'A', Beneficiaries: [{ Name: 'x', Share: 50 }, { Name: 'y', Share: 50 }] }, { Name: 'B', Beneficiaries: [{ Name: 'z', Share: 0 }] }] };
  const e = msgs(validate(m, data));
  assert.equal(e['Trusts[1].Beneficiaries[0].Share'], 'Trusts — Beneficiaries — Share must be at least 1');
  assert.equal(e['Trusts[1].Beneficiaries'], 'Shares must total 100');
  assert.equal(e['Trusts[0].Beneficiaries'], undefined);
});

test('relevant: generic item paths check every item, concrete ones only those items; omitted checks all', () => {
  const m = model('{[list Members]}{[Percent|number]}{[end list]}', { 'Members[].Percent': { max: 100 } });
  const data = { Members: [{ Percent: 200 }, { Percent: 300 }, { Percent: 400 }] };
  assert.deepEqual(validate(m, data).map((x) => x.path), ['Members[0].Percent', 'Members[1].Percent', 'Members[2].Percent']);
  assert.deepEqual(validate(m, data, { relevant: ['Members[].Percent'] }).map((x) => x.path), ['Members[0].Percent', 'Members[1].Percent', 'Members[2].Percent']);
  assert.deepEqual(validate(m, data, { relevant: ['Members[1].Percent'] }).map((x) => x.path), ['Members[1].Percent']);
  assert.deepEqual(validate(m, data, { relevant: ['Members[0].Percent', 'Members[2].Percent'] }).map((x) => x.path), ['Members[0].Percent', 'Members[2].Percent']);
  assert.deepEqual(validate(m, data, { relevant: ['Members'] }), []);
  assert.deepEqual(validate(m, data, { relevant: [] }), []);
  // required item fields also respect concrete relevance
  const m2 = model('{[list Members]}{[Name]}{[end list]}');
  assert.deepEqual(validate(m2, { Members: [{}, {}] }, { relevant: ['Members[1].Name'] }).map((x) => x.path), ['Members[1].Name']);
});

test('several failing rules on one value each report; custom message replaces all of them', () => {
  const m = model('{[Code]}', { Code: { minLength: 3, pattern: '^[A-Z]+$' } });
  const errs = validate(m, { Code: 'ab' });
  assert.equal(errs.length, 2);
  m.variables['Code'].message = 'Code must be 3+ capital letters';
  assert.deepEqual(validate(m, { Code: 'ab' }).map((x) => x.message), ['Code must be 3+ capital letters']); // QA2: one message per field, not one per rule
  // custom message does not replace the required message
  assert.equal(validate(m, { Code: '' })[0].message, 'Code is required');
});
