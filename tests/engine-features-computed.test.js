import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDerived } from '../engine/model.js';
import { parse } from '../engine/parser.js';
import { analyze } from '../engine/analyze.js';
import { createModel } from '../engine/model.js';

const cv = (path, formula, extra = {}) => {
  const isItem = path.includes('[]');
  return { path, type: 'computed', formula, isListItemField: isItem, listPath: isItem ? path.slice(0, path.lastIndexOf('[]')) : undefined, ...extra };
};
const modelOf = (defs) => ({ order: defs.map((d) => d.path), variables: Object.fromEntries(defs.map((d) => [d.path, d])) });

test('per-item computed field is evaluated once per item with item fields in scope', () => {
  const m = modelOf([cv('Children[].IsMinor', 'yearsBetween(DOB, "2026-06-01") < 18'), cv('Children[].Label', 'Name + " (" + _index + ")"')]);
  const { data, errors } = computeDerived(m, { Children: [{ Name: 'Kim', DOB: '2012-03-14' }, { Name: 'Lee', DOB: '2000-11-02' }] });
  assert.deepEqual(errors, []);
  assert.equal(data.Children[0].IsMinor, true);
  assert.equal(data.Children[1].IsMinor, false);
  assert.equal(data.Children[0].Label, 'Kim (1)');
  assert.equal(data.Children[1].Label, 'Lee (2)');
  // source data untouched
  assert.equal(data.Children[0].Name, 'Kim');
});

test('item scope shadows outer scope; outer values remain reachable', () => {
  const m = modelOf([cv('Items[].Total', 'Qty * Price * (1 + TaxRate)')]);
  const { data } = computeDerived(m, { TaxRate: 0.1, Price: 999, Items: [{ Qty: 2, Price: 10 }, { Qty: 1 }] });
  assert.equal(data.Items[0].Total, 22);
  // item has no Price → falls through to outer Price
  assert.equal(data.Items[1].Total, 999 * 1.1);
});

test('top-level computed depending on per-item computed runs after it (topological order across kinds)', () => {
  const m = modelOf([
    cv('MinorCount', 'count(Children|filter: IsMinor)'),
    cv('HasMinor', 'MinorCount > 0'),
    cv('Children[].IsMinor', 'yearsBetween(DOB, "2026-06-01") < 18'),
    cv('MinorNames', 'Children|filter: IsMinor|map: Name|join'),
  ]);
  const { data, errors } = computeDerived(m, { Children: [{ Name: 'Kim', DOB: '2012-03-14' }, { Name: 'Lee', DOB: '2000-11-02' }, { Name: 'Max', DOB: '2020-01-01' }] });
  assert.deepEqual(errors, []);
  assert.equal(data.MinorCount, 2);
  assert.equal(data.HasMinor, true);
  assert.equal(data.MinorNames, 'Kim and Max');
});

test('per-item computed may depend on another per-item computed in the same list, and on top-level computed', () => {
  const m = modelOf([
    cv('Items[].Tax', 'Sub * Rate'),
    cv('Items[].Sub', 'Qty * Price'),
    cv('Rate', 'BaseRate * 2'),
    cv('Grand', 'sum(Items, Sub + Tax)'),
  ]);
  const { data, errors } = computeDerived(m, { BaseRate: 0.05, Items: [{ Qty: 2, Price: 10 }, { Qty: 3, Price: 5 }] });
  assert.deepEqual(errors, []);
  assert.equal(data.Rate, 0.1);
  assert.equal(data.Items[0].Sub, 20);
  assert.equal(data.Items[0].Tax, 2);
  assert.equal(data.Items[1].Tax, 1.5);
  assert.equal(data.Grand, 38.5);
});

test('cycles across per-item and top-level computed are reported, never crash', () => {
  const m = modelOf([cv('Total', 'sum(Items, Share)'), cv('Items[].Share', 'Amount / Total')]);
  const { data, errors } = computeDerived(m, { Items: [{ Amount: 1 }] });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Circular formula/);
  assert.match(errors[0].message, /Items\[\]\.Share/);
  assert.ok(data.Items);
  // self-referencing item field
  const m2 = modelOf([cv('Items[].X', 'X + 1')]);
  const r2 = computeDerived(m2, { Items: [{ X: 1 }] });
  assert.deepEqual(r2.errors, []); // bare X is the item's own stored X, not the computed → no cycle
  assert.equal(r2.data.Items[0].X, 2);
});

test('nested lists: Trusts[].Beneficiaries[].Share computed per inner item with both parents in scope', () => {
  const m = modelOf([cv('Trusts[].Beneficiaries[].Amount', 'Corpus * Percent / 100'), cv('Trusts[].Paid', 'sum(Beneficiaries, Amount)')]);
  const { data, errors } = computeDerived(m, { Trusts: [{ Corpus: 1000, Beneficiaries: [{ Percent: 25 }, { Percent: 75 }] }, { Corpus: 10, Beneficiaries: [{ Percent: 50 }] }] });
  assert.deepEqual(errors, []);
  assert.equal(data.Trusts[0].Beneficiaries[0].Amount, 250);
  assert.equal(data.Trusts[0].Beneficiaries[1].Amount, 750);
  assert.equal(data.Trusts[1].Beneficiaries[0].Amount, 5);
  assert.equal(data.Trusts[0].Paid, 1000);
});

test('missing or non-list data, bad item formula and orphaned computed are tolerated', () => {
  const m = modelOf([cv('Children[].IsMinor', 'age(DOB) < 18'), cv('Children[].Bad', '1 +'), cv('Old', 'Fee * 2', { orphaned: true })]);
  let r = computeDerived(m, {});
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /Bad formula/);
  assert.deepEqual(r.data, {});
  r = computeDerived(m, { Children: 'not a list', Fee: 5 });
  assert.equal(r.data.Children, 'not a list');
  assert.equal(r.data.Old, undefined);
});

test('computed from a template model: today()-based age flag via model edits', () => {
  const model = createModel(analyze(parse('{[list Children]}{[Name]} {[DOB|format:"long"]}{[end list]} {[count(Children|filter: IsMinor)]}')));
  model.variables['Children[].IsMinor'] = cv('Children[].IsMinor', 'yearsBetween(DOB, today()) < 18');
  model.order.push('Children[].IsMinor');
  const { data, errors } = computeDerived(model, { Children: [{ Name: 'Baby', DOB: '2025-01-01' }, { Name: 'Elder', DOB: '1950-01-01' }] });
  assert.deepEqual(errors, []);
  assert.equal(data.Children[0].IsMinor, true);
  assert.equal(data.Children[1].IsMinor, false);
});
