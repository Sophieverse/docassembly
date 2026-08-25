import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { analyze, relevantVariables, questionnaire, questionOrder } from '../engine/analyze.js';
import { createModel, mergeModel, validate, computeDerived } from '../engine/model.js';
import { render } from '../engine/evaluate.js';
import * as EL from '../samples/engagement-letter.js';

const paths = (tpl, data, model) => questionnaire(parse(tpl), data, model).map((q) => q.path);

// ---------- 2. variables used on every branch of an unanswered gate ----------

test('a variable referenced in every branch (incl. else) of an unanswered if is relevant now, right after the gate', () => {
  const tpl = '{[Intro]} {[if Client.IsEntity]}{[Client.FullName]} c/o {[Client.ContactName]}{[else]}{[Client.FullName]}{[end if]} {[Outro]}';
  const ast = parse(tpl);
  const rel = relevantVariables(ast, {});
  assert.deepEqual(rel.relevant, ['Intro', 'Client.IsEntity', 'Client.FullName', 'Outro']);
  assert.deepEqual(rel.unanswered, ['Intro', 'Client.IsEntity', 'Client.FullName', 'Outro']);
  assert.ok(!rel.blockedBy.has('Client.FullName'), 'not blocked');
  assert.deepEqual(rel.blockedBy.get('Client.ContactName'), ['Client.IsEntity']);
  // answered → no longer unanswered, order unchanged
  const rel2 = relevantVariables(ast, { Client: { FullName: 'Acme' } });
  assert.deepEqual(rel2.relevant, ['Intro', 'Client.IsEntity', 'Client.FullName', 'Outro']);
  assert.ok(!rel2.unanswered.includes('Client.FullName'));
});

test('all-branch rule: elseif chains, no else, nested ifs, and lists inside the branch', () => {
  // three-way chain with an else: X on every path, Y only on some
  const r1 = relevantVariables(parse('{[if A]}{[X]}{[Y]}{[elseif B]}{[X]}{[else]}{[X]}{[end if]}'), {});
  assert.deepEqual(r1.relevant, ['A', 'X']);
  assert.ok(r1.blockedBy.has('Y') && r1.blockedBy.has('B'));
  // no else: nothing is certain
  const r2 = relevantVariables(parse('{[if A]}{[X]}{[elseif B]}{[X]}{[end if]}'), {});
  assert.deepEqual(r2.relevant, ['A']);
  // nested: X is only certain when it is on every path of the inner if too
  const r3 = relevantVariables(parse('{[if A]}{[if B]}{[X]}{[end if]}{[else]}{[X]}{[end if]}'), {});
  assert.deepEqual(r3.relevant, ['A']);
  const r4 = relevantVariables(parse('{[if A]}{[if B]}{[X]}{[else]}{[X]}{[end if]}{[else]}{[X]}{[end if]}'), {});
  assert.deepEqual(r4.relevant, ['A', 'X']);
  // the inner gate's subject is certain on the A-true path only, so it stays blocked
  assert.ok(r4.blockedBy.has('B'));
  // a list body is never certain (may be empty); the list itself is
  const r5 = relevantVariables(parse('{[if A]}{[list Kids]}{[Name]}{[end list]}{[else]}{[list Kids]}{[Name]}{[end list]}{[end if]}'), {});
  assert.deepEqual(r5.relevant, ['A', 'Kids']);
  assert.ok(!r5.relevant.includes('Kids[].Name'));
  // the second branch of a chain is the blocked one: only the remaining paths count
  const r6 = relevantVariables(parse('{[if A]}{[P]}{[elseif B]}{[X]}{[else]}{[X]}{[end if]}'), { A: false });
  assert.deepEqual(r6.relevant, ['A', 'B', 'X']);
});

test('all-branch rule inside a list item scope reports concrete unanswered paths', () => {
  const tpl = '{[list Kids]}{[if Minor]}{[Name]} (minor){[else]}{[Name]}{[end if]}{[end list]}';
  const rel = relevantVariables(parse(tpl), { Kids: [{}, { Name: 'Lee' }] });
  assert.ok(rel.relevant.includes('Kids[].Name'));
  assert.deepEqual(rel.unanswered.filter((p) => p.endsWith('Name')), ['Kids[0].Name']);
});

test('engagement letter: Client.FullName is asked before the entity gate is answered, and an empty Address {} changes nothing', () => {
  const ast = parse(EL.text);
  const empty = questionnaire(ast, {}).map((q) => q.path);
  assert.ok(empty.includes('Client.FullName'));
  assert.equal(empty.indexOf('Client.FullName'), empty.indexOf('Client.IsEntity') + 1);
  assert.ok(!empty.includes('Client.ContactName'), 'entity-only field waits for the gate');
  const scaffolded = questionnaire(ast, { Client: { Address: {} }, Firm: { Address: {} } }).map((q) => q.path);
  assert.deepEqual(scaffolded, empty);
  const rel = relevantVariables(ast, { Client: { Address: {} } });
  assert.ok(rel.unanswered.includes('Client.Address.Street'));
});

test('an empty object answers like undefined for relevance: {[if Client.Address]} stays unanswered / not taken', () => {
  const tpl = '{[if Client.Address]}{[Client.Address.Street]}{[else]}no address{[end if]}';
  const ast = parse(tpl);
  const a = relevantVariables(ast, {});
  const b = relevantVariables(ast, { Client: { Address: {} } });
  assert.deepEqual(b.relevant, a.relevant);
  assert.deepEqual(b.unanswered, a.unanswered);
  const c = relevantVariables(ast, { Client: { Address: { Street: '1 Main' } } });
  assert.ok(c.relevant.includes('Client.Address.Street') && !c.unanswered.includes('Client.Address.Street'));
  // and it is traced as missing by the evaluator
  assert.ok(render(parse('{[Client.Address]}'), { Client: { Address: {} } }).trace.missing.has('Client.Address'));
});

// ---------- 3. has-value variables are optional ----------

test('a has-value check ({[if X]}…{[X]}) infers required:false; validate does not block on a blank', () => {
  const ast = parse('{[if Relationship]}({[Relationship]}){[end if]} {[Name]}');
  const an = analyze(ast);
  assert.equal(an.variables.get('Relationship').hasValueCheck, true);
  assert.equal(an.variables.get('Name').hasValueCheck, undefined);
  const m = createModel(an);
  assert.equal(m.variables.Relationship.type, 'text');
  assert.equal(m.variables.Relationship.required, false);
  assert.equal(m.variables.Name.required, true);
  assert.deepEqual(validate(m, { Relationship: '', Name: 'x' }), []);
  assert.deepEqual(validate(m, { Relationship: '', Name: '' }).map((e) => e.path), ['Name']);
  assert.equal(questionnaire(ast, {}, m).find((q) => q.path === 'Relationship').required, false);
  // filtered / compared has-value checks too; a boolean-named one stays a required-false boolean anyway
  assert.equal(createModel(analyze(parse('{[if Court]} in the {[Court|upper]}{[end if]}'))).variables.Court.required, false);
  assert.equal(createModel(analyze(parse('{[if Fee]}{[Fee|currency]}{[end if]}'))).variables.Fee.required, false);
});

test('mergeModel keeps the inferred required:false unless the user or an annotation sets it', () => {
  const tpl = '{[if Relationship]}({[Relationship]}){[end if]} {[Name]}';
  const an = analyze(parse(tpl));
  const m1 = mergeModel(createModel(an), an);
  assert.equal(m1.variables.Relationship.required, false);
  // legacy stored model that had it required:true from before the fix (no inferredRequired) → inference now wins
  const legacy = createModel(an);
  legacy.variables.Relationship.required = true; delete legacy.variables.Relationship.inferredRequired;
  assert.equal(mergeModel(legacy, an).variables.Relationship.required, false);
  // explicit user edit is kept
  const edited = createModel(an);
  edited.variables.Relationship.required = true; edited.variables.Relationship.custom = { required: true };
  assert.equal(mergeModel(edited, an).variables.Relationship.required, true);
  // annotation wins over inference
  const an2 = analyze(parse('{[# @required Relationship]}' + tpl));
  assert.equal(createModel(an2).variables.Relationship.required, true);
  assert.equal(mergeModel(createModel(an), an2).variables.Relationship.required, true);
  // once the annotation goes away the field reverts to inference
  assert.equal(mergeModel(createModel(an2), an).variables.Relationship.required, false);
});

// ---------- 4. question order ----------

test('questionOrder: condition subjects before what they gate; object groups contiguous at first appearance', () => {
  const tpl = '{[Testator.FullName]} {[Beneficiary]} {[if Testator.Gender = "Male"]}he{[elseif Testator.Gender = "Female"]}she{[end if]} {[Testator.County]} {[Witness]}';
  assert.deepEqual(paths(tpl, {}), ['Testator.FullName', 'Testator.Gender', 'Testator.County', 'Beneficiary', 'Witness']);
  // a gate referenced deep in the document still comes before what it gates, and before the gated section's other fields
  const tpl2 = '{[A]} {[B]} {[if HasSpouse]}{[Spouse.Name]}{[end if]} {[C]}';
  assert.deepEqual(paths(tpl2, {}), ['A', 'B', 'HasSpouse', 'C']);
  assert.deepEqual(paths(tpl2, { HasSpouse: true }), ['A', 'B', 'HasSpouse', 'Spouse.Name', 'C']);
  // list item fields group with their list
  assert.deepEqual(questionOrder(['Kids', 'X', 'Kids[].Name', 'Y', 'Kids[].DOB']), ['Kids', 'Kids[].Name', 'Kids[].DOB', 'X', 'Y']);
  // nested objects stay within the root group in document order
  assert.deepEqual(questionOrder(['Client.Name', 'Firm.Name', 'Client.Address.City', 'Firm.Phone', 'Client.Phone']), ['Client.Name', 'Client.Address.City', 'Client.Phone', 'Firm.Name', 'Firm.Phone']);
});

test('questionnaire order is stable across answer changes (answering only inserts, never reorders)', () => {
  const ast = parse(EL.text);
  const before = questionnaire(ast, {}).map((q) => q.path);
  const after = questionnaire(ast, { Client: { IsEntity: true }, FeeType: 'Hourly', IsLitigation: true }).map((q) => q.path);
  const kept = after.filter((p) => before.includes(p));
  assert.deepEqual(kept, before, 'relative order of existing questions is unchanged');
  assert.ok(after.includes('Client.ContactName') && after.indexOf('Client.ContactName') > after.indexOf('Client.IsEntity'));
  // and the fully answered questionnaire agrees with the sample's expected ordering: Client.* contiguous
  const full = questionnaire(ast, EL.sampleAnswers).map((q) => q.path);
  const clientIdx = full.map((p, i) => (p.startsWith('Client.') ? i : -1)).filter((i) => i >= 0);
  assert.equal(clientIdx[clientIdx.length - 1] - clientIdx[0] + 1, clientIdx.length, 'Client.* is one contiguous block');
});

// ---------- coordinator item: list-item-ness derived from the path ----------

test('computeDerived / validate treat a "Kids[].Age" definition as per-item even without isListItemField/listPath', () => {
  const model = {
    order: ['Kids', 'Kids[].DOB', 'Kids[].Age', 'Adults'],
    variables: {
      Kids: { path: 'Kids', type: 'list' },
      'Kids[].DOB': { path: 'Kids[].DOB', type: 'date', required: true },
      'Kids[].Age': { path: 'Kids[].Age', type: 'computed', formula: 'yearsBetween(DOB, "2026-01-01")' },
      Adults: { path: 'Adults', type: 'computed', formula: 'count(Kids|filter: Age >= 18)' },
    },
  };
  const { data, errors } = computeDerived(model, { Kids: [{ DOB: '2000-06-01' }, { DOB: '2020-06-01' }] });
  assert.deepEqual(errors, []);
  assert.equal(data.Kids[0].Age, 25);
  assert.equal(data.Kids[1].Age, 5);
  assert.equal(data.Adults, 1);
  assert.ok(!('Kids[]' in data) && !('Kids[].Age' in data), 'nothing written to a literal "Kids[]" key');
  assert.deepEqual(validate(model, { Kids: [{ DOB: '2000-06-01' }, {}] }).map((e) => e.path), ['Kids[1].DOB']);
  // an explicit isListItemField:false with no listPath is respected (top-level variable that merely contains "[]")
  const m2 = { order: ['Odd[].Name'], variables: { 'Odd[].Name': { path: 'Odd[].Name', type: 'text', required: true, isListItemField: false } } };
  assert.deepEqual(validate(m2, {}).map((e) => e.path), ['Odd[].Name']);
});
