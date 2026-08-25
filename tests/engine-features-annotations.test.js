import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../engine/parser.js';
import { analyze, collectAnnotations, parseAnnotationLine } from '../engine/analyze.js';
import { createModel, mergeModel, applyAnnotations, validate, computeDerived } from '../engine/model.js';
import { compile, questionnaire } from '../engine/index.js';

const TPL = `{[# @label Client.FullName: Client's full legal name]}
{[# @help IsMarried: Legally married at signing]}
{[# @options FeeType: Hourly | Flat | Contingency]}
{[# @default Firm.State: California]}
{[# @required Children[].DOB]}
{[# @type Retainer: currency]}
{[# @min Retainer: 0]}
{[# @validate Members: sum(Members, "Percent") = 100 :: Member percentages must total 100]}
Dear {[Client.FullName]}, {[if IsMarried]}married{[end if]} {[FeeType]} {[Firm.State]} {[Retainer]}
{[list Children]}{[Name]} {[DOB]}{[end list]}
{[list Members]}{[Name]} {[Percent]}{[end list]}`;

test('parseAnnotationLine grammar', () => {
  assert.deepEqual(parseAnnotationLine('@label Client.FullName: Client\'s full legal name'), { key: 'label', path: 'Client.FullName', value: "Client's full legal name" });
  assert.deepEqual(parseAnnotationLine('  @required Children[].DOB  '), { key: 'required', path: 'Children[].DOB', value: '' });
  assert.deepEqual(parseAnnotationLine('@Min Retainer:0'), { key: 'min', path: 'Retainer', value: '0' });
  assert.equal(parseAnnotationLine('plain note to drafter'), null);
  assert.equal(parseAnnotationLine('email @ example.com'), null);
  assert.match(parseAnnotationLine('@bogus X: 1').error, /Unknown annotation @bogus/);
  assert.match(parseAnnotationLine('@label : no path').error, /Cannot read annotation/);
});

test('analysis.annotations collects typed values from every comment, including inside blocks', () => {
  const a = analyze(parse(TPL + '{[if IsMarried]}{[# @help Spouse.Name: Spouse legal name]}{[Spouse.Name]}{[end if]}'));
  const ann = a.annotations;
  assert.ok(ann instanceof Map);
  assert.deepEqual(ann.get('Client.FullName'), { label: "Client's full legal name" });
  assert.deepEqual(ann.get('IsMarried'), { help: 'Legally married at signing' });
  assert.deepEqual(ann.get('FeeType'), { options: ['Hourly', 'Flat', 'Contingency'] });
  assert.deepEqual(ann.get('Firm.State'), { default: 'California' });
  assert.deepEqual(ann.get('Children[].DOB'), { required: true });
  assert.deepEqual(ann.get('Retainer'), { type: 'currency', min: 0 });
  assert.deepEqual(ann.get('Members'), { validate: 'sum(Members, "Percent") = 100', message: 'Member percentages must total 100' });
  assert.deepEqual(ann.get('Spouse.Name'), { help: 'Spouse legal name' });
  assert.deepEqual(a.annotationErrors, []);
});

test('several annotations in one comment, separated by newlines; plain comment lines are ignored', () => {
  const t = `{[# Drafting notes — keep this section.
@label Fee: Retainer amount
@max Fee: 5000
@minLength Client.Name: 2
@maxLength Client.Name: 80
@pattern Client.Phone: ^\\d{3}-\\d{4}$
@optional Client.Phone
@min Start: 2020-01-01
@default IsMarried: yes
@default Tags: a | b
@type Tags: multiselect ]}{[Fee|currency]} {[Client.Name]} {[Client.Phone]} {[Start|format:"long"]} {[if IsMarried]}x{[end if]} {[Tags|join]}`;
  const a = analyze(parse(t));
  assert.deepEqual(a.annotations.get('Fee'), { label: 'Retainer amount', max: 5000 });
  assert.deepEqual(a.annotations.get('Client.Name'), { minLength: 2, maxLength: 80 });
  assert.deepEqual(a.annotations.get('Client.Phone'), { pattern: '^\\d{3}-\\d{4}$', required: false });
  assert.deepEqual(a.annotations.get('Start'), { min: '2020-01-01' });
  const m = createModel(a);
  assert.equal(m.variables['Fee'].label, 'Retainer amount');
  assert.equal(m.variables['Fee'].max, 5000);
  assert.equal(m.variables['Client.Name'].minLength, 2);
  assert.equal(m.variables['Client.Phone'].required, false);
  assert.equal(m.variables['Client.Phone'].pattern, '^\\d{3}-\\d{4}$');
  assert.equal(m.variables['IsMarried'].default, true); // @default coerced to the variable type
  assert.equal(m.variables['Tags'].type, 'multiselect');
  assert.deepEqual(m.variables['Tags'].default, ['a', 'b']);
});

test('annotation errors are reported with line numbers and never break compile', () => {
  const t = `line one
{[# @label X: fine
@bogus X: 1
@pattern X: (
@minLength X: many
@type X: widget
@validate X: ]}{[X]}`;
  const { analysis, errors } = compile(t);
  assert.deepEqual(errors, []);
  const msgs = analysis.annotationErrors.map((e) => `${e.line}: ${e.message}`);
  assert.equal(msgs.length, 5);
  assert.match(msgs[0], /^3: Unknown annotation @bogus/);
  assert.match(msgs[1], /^4: @pattern X: invalid regular expression/);
  assert.match(msgs[2], /^5: @minLength X: expected a whole number/);
  assert.match(msgs[3], /^6: @type X: unknown type "widget"/);
  assert.match(msgs[4], /^7: @validate X: missing expression/);
  assert.equal(analysis.variables.get('X').inferredType, 'text');
  assert.equal(createModel(analysis).variables['X'].label, 'fine');
});

test('createModel applies annotations over inference and records them in fromTemplate', () => {
  const m = createModel(analyze(parse(TPL)));
  const v = m.variables;
  assert.equal(v['Client.FullName'].label, "Client's full legal name");
  assert.deepEqual(v['Client.FullName'].fromTemplate, { label: "Client's full legal name" });
  assert.equal(v['IsMarried'].help, 'Legally married at signing');
  assert.deepEqual(v['FeeType'].options, ['Hourly', 'Flat', 'Contingency']);
  assert.equal(v['FeeType'].type, 'selection'); // options on a text variable make it a selection
  assert.equal(v['FeeType'].inferredType, 'text');
  assert.equal(v['Firm.State'].default, 'California');
  assert.equal(v['Children[].DOB'].required, true);
  assert.equal(v['Retainer'].type, 'currency');
  assert.equal(v['Retainer'].min, 0);
  assert.deepEqual(v['Retainer'].fromTemplate, { type: 'currency', min: 0 });
  assert.equal(v['Members'].validate, 'sum(Members, "Percent") = 100');
  assert.equal(v['Members'].message, 'Member percentages must total 100');
  assert.equal(v['Members'].type, 'list');
  assert.equal(v['Children[].Name'].fromTemplate, undefined);
  // the annotated rules actually validate
  const errs = validate(m, { Members: [{ Name: 'a', Percent: 10 }], Retainer: -1 }, { relevant: ['Members', 'Retainer'] });
  assert.deepEqual(errs.map((e) => e.message).sort(), ['Member percentages must total 100', 'Retainer must be at least 0']);
});

test('@type computed / @formula define computed variables, including per-item ones and ones the template never prints', () => {
  const t = `{[# @formula Children[].IsMinor: yearsBetween(DOB, "2026-06-01") < 18
@formula MinorCount: count(Children|filter: IsMinor)
@type Total: computed
@formula Total: Fee * 2 ]}{[Fee|currency]} {[MinorCount]} {[list Children]}{[Name]} {[DOB|format:"long"]}{[end list]}`;
  const m = createModel(analyze(parse(t)));
  assert.equal(m.variables['MinorCount'].type, 'computed');
  assert.equal(m.variables['MinorCount'].required, false);
  assert.equal(m.variables['Children[].IsMinor'].type, 'computed');
  assert.equal(m.variables['Children[].IsMinor'].isListItemField, true);
  assert.equal(m.variables['Children[].IsMinor'].listPath, 'Children');
  assert.ok(m.order.includes('Children[].IsMinor'));
  assert.equal(m.variables['Total'].type, 'computed');
  assert.equal(m.variables['Total'].formula, 'Fee * 2');
  const { data, errors } = computeDerived(m, { Fee: 10, Children: [{ Name: 'a', DOB: '2020-01-01' }, { Name: 'b', DOB: '1990-01-01' }] });
  assert.deepEqual(errors, []);
  assert.equal(data.MinorCount, 1);
  assert.equal(data.Total, 20);
  // computed variables are not asked
  const qs = questionnaire(parse(t), {}, m).map((q) => q.path);
  assert.ok(!qs.includes('MinorCount') && !qs.includes('Total') && !qs.includes('Children[].IsMinor'));
});

test('annotations for paths the template does not use are kept in analysis but do not create questions', () => {
  const a = analyze(parse('{[# @label Ghost: Boo]}{[Real]}'));
  assert.deepEqual(a.annotations.get('Ghost'), { label: 'Boo' });
  const m = createModel(a);
  assert.equal(m.variables['Ghost'], undefined);
  assert.deepEqual(m.order, ['Real']);
});

test('mergeModel: annotations win over inference but not over user UI edits', () => {
  const m1 = createModel(analyze(parse(TPL)));
  // user edits in the UI
  m1.variables['IsMarried'].help = 'User wrote this';
  m1.variables['Retainer'].min = 100;
  m1.variables['FeeType'].options = ['Hourly', 'Flat'];
  m1.variables['Firm.State'].custom = { default: true };
  m1.variables['Firm.State'].default = 'Nevada';
  // a template change that re-annotates
  const T2 = TPL.replace("@label Client.FullName: Client's full legal name", '@label Client.FullName: Full name of client')
    .replace('@help IsMarried: Legally married at signing', '@help IsMarried: Changed in template')
    .replace('@min Retainer: 0', '@min Retainer: 1')
    .replace('@default Firm.State: California', '@default Firm.State: Oregon');
  const m2 = mergeModel(m1, analyze(parse(T2)));
  const v = m2.variables;
  assert.equal(v['Client.FullName'].label, 'Full name of client'); // annotation-only value follows the template
  assert.equal(v['IsMarried'].help, 'User wrote this'); // user edit survives
  assert.equal(v['IsMarried'].fromTemplate, undefined);
  assert.equal(v['Retainer'].min, 100);
  assert.equal(v['Retainer'].type, 'currency'); // the other annotation on the same variable still applies
  assert.deepEqual(v['Retainer'].fromTemplate, { type: 'currency' });
  assert.deepEqual(v['FeeType'].options, ['Hourly', 'Flat']);
  assert.equal(v['Firm.State'].default, 'Nevada'); // explicit custom flag wins
  assert.deepEqual(v['Firm.State'].custom, { default: true });
  assert.equal(v['Members'].message, 'Member percentages must total 100');
});

test('mergeModel: removing an annotation from the template reverts to inference / empty', () => {
  const m1 = createModel(analyze(parse(TPL)));
  const T2 = TPL.split('\n').filter((l) => !/@label|@help|@min |@validate|@options/.test(l)).join('\n');
  const m2 = mergeModel(m1, analyze(parse(T2)));
  const v = m2.variables;
  assert.equal(v['Client.FullName'].label, 'Client — Full name');
  assert.equal(v['IsMarried'].help, '');
  assert.equal(v['Retainer'].min, undefined);
  assert.equal(v['Retainer'].type, 'currency'); // @type still there
  assert.equal(v['Members'].validate, undefined);
  assert.equal(v['Members'].message, undefined);
  assert.equal(v['FeeType'].type, 'text');
  assert.equal(v['FeeType'].options, undefined);
  assert.equal(v['Client.FullName'].fromTemplate, undefined);
});

test('mergeModel: a user edit that happens to equal the old annotation is treated as not customized', () => {
  const m1 = createModel(analyze(parse(TPL)));
  const T2 = TPL.replace("@label Client.FullName: Client's full legal name", '@label Client.FullName: Client name');
  const m2 = mergeModel(m1, analyze(parse(T2)));
  assert.equal(m2.variables['Client.FullName'].label, 'Client name');
  // and legacy `custom: true` freezes every field
  m2.variables['Client.FullName'].custom = true;
  m2.variables['Client.FullName'].label = 'Frozen';
  const m3 = mergeModel(m2, analyze(parse(TPL)));
  assert.equal(m3.variables['Client.FullName'].label, 'Frozen');
});

test('mergeModel: @formula computed variable is orphaned when its annotation goes away; user computed vars are kept', () => {
  const t1 = '{[# @formula Total: Fee * 2]}{[Fee|currency]}';
  const m1 = createModel(analyze(parse(t1)));
  m1.variables['Mine'] = { path: 'Mine', name: 'Mine', parent: null, label: 'Mine', type: 'computed', inferredType: 'computed', formula: 'Fee + 1', required: false, orphaned: false };
  m1.order.push('Mine');
  const m2 = mergeModel(m1, analyze(parse('{[Fee|currency]}')));
  assert.equal(m2.variables['Total'].orphaned, true);
  assert.equal(m2.variables['Mine'].orphaned, false);
  assert.equal(m2.variables['Mine'].formula, 'Fee + 1');
  // it comes back when the annotation returns
  const m3 = mergeModel(m2, analyze(parse(t1)));
  assert.equal(m3.variables['Total'].orphaned, false);
  assert.equal(m3.variables['Total'].formula, 'Fee * 2');
});

test('collectAnnotations / applyAnnotations are usable standalone', () => {
  const { annotations } = collectAnnotations(parse('{[# @help A: h]}{[A]}'));
  const m = { variables: { A: { path: 'A', label: 'A', type: 'text', inferredType: 'text', required: true, help: '' } }, order: ['A'] };
  applyAnnotations(m, annotations);
  assert.equal(m.variables.A.help, 'h');
  assert.deepEqual(m.variables.A.fromTemplate, { help: 'h' });
});

test('existing behaviour without annotations is unchanged (label/type/options/help merge rules)', () => {
  const T1 = '{[Client.Name]} {[Fee|currency]} {[if State = "CA"]}x{[end if]}';
  const m1 = createModel(analyze(parse(T1)));
  assert.equal(m1.variables['Fee'].fromTemplate, undefined);
  m1.variables['Fee'].label = 'Retainer';
  m1.variables['Fee'].required = false;
  m1.variables['Client.Name'].type = 'longtext';
  const m2 = mergeModel(m1, analyze(parse('{[Client.Name]} {[Fee|number]} {[if State = "CA" or State = "NY"]}x{[end if]}')));
  assert.equal(m2.variables['Fee'].label, 'Retainer');
  assert.equal(m2.variables['Fee'].required, false);
  assert.equal(m2.variables['Fee'].type, 'number');
  assert.equal(m2.variables['Client.Name'].type, 'longtext');
  assert.deepEqual(m2.variables['State'].options, ['CA', 'NY']);
});
