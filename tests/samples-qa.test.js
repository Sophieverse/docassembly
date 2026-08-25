/**
 * Sample QA: every bundled sample is rendered under several answer permutations
 * (sample answers, all booleans false + empty lists, all booleans true + single
 * item lists, optional values missing, numbers zeroed) and the rendered text is
 * scanned for drafting artifacts; the generated questionnaire is checked for
 * gating, labels, types and options with the sample's `model` overrides applied.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samples, getSample } from '../samples/index.js';
import { compile, assemble, questionnaire, analyze, relevantVariables, createModel, mergeModel, computeDerived, validate } from '../engine/index.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

function mapValues(obj, fn) {
  if (Array.isArray(obj)) return fn(obj, 'list');
  if (obj && typeof obj === 'object') { const o = {}; for (const [k, v] of Object.entries(obj)) o[k] = mapValues(v, fn); return o; }
  return fn(obj, typeof obj);
}
/** Lists a document cannot exist without; other lists are emptied by allFalseEmpty. */
const REQUIRED_LISTS = new Set(['Tenants', 'Members', 'Managers', 'Witnesses']);
function allFalseEmpty(d) {
  const out = mapValues(clone(d), (v, t) => (t === 'boolean' ? false : t === 'list' ? [] : v));
  for (const k of REQUIRED_LISTS) if (Array.isArray(d[k]) && d[k].length) out[k] = [mapValues(clone(d[k][0]), (v, t) => (t === 'boolean' ? false : v))];
  return out;
}
const allTrueSingle = (d) => mapValues(clone(d), (v, t) => (t === 'boolean' ? true : t === 'list' ? v.slice(0, 1).map((x) => mapValues(x, (y, ty) => (ty === 'boolean' ? true : y))) : v));
const missingOptional = (d) => mapValues(clone(d), (v, t) => ((v === '' || v === 0 || (t === 'list' && v.length === 0)) ? undefined : v));
const zeroNumbers = (d) => mapValues(clone(d), (v, t) => (t === 'number' ? 0 : v));

/** Permutations that must render cleanly (data is complete; only branches differ). */
function permutations(s) {
  return {
    sample: s.sampleAnswers,
    allFalseEmpty: allFalseEmpty(s.sampleAnswers),
    allTrueSingle: allTrueSingle(s.sampleAnswers),
    missingOptional: missingOptional(s.sampleAnswers),
    zeroNumbers: zeroNumbers(s.sampleAnswers),
  };
}

/** Text artifacts that should never appear in a document rendered from complete data. */
const ARTIFACTS = [
  [/\{\[/, 'unrendered field'],
  [/\n{3,}/, 'two or more consecutive blank lines'],
  [/[^\n ]  +[^\n ]/, 'double space'],
  [/,\s*[.,;]/, 'orphan punctuation like ", ."'],
  [/\b(and|or)\s*[.;]/, 'orphan conjunction like "and ."'],
  [/[^\n]:\s*\.\s*$/m, 'colon followed by period (empty list)'],
  [/[^_\n] \./, 'space before period'],
  [/\(\s*\)/, 'empty parentheses'],
  [/\*\*\*\*/, 'empty bold'],
  [/\b[Aa] [aeiouAEIOU][a-z]/, '"a" before a vowel'],
  [/\b[Aa]n [^aeiouAEIOUh\W]/, '"an" before a consonant'],
  [/\b1 (children|years|days|months|invoices|members|tenants|items|pets|occupants)\b/, 'plural noun after 1'],
  [/\bhe\/she\b|\bhis\/her\b|\bhim\/her\b/i, 'he/she instead of pronoun filter'],
  [/^\s*[,.;]/m, 'line starting with punctuation'],
  [/\bof ,|\bat ,|\bto ,|\bfor ,|\bin ,/, 'preposition followed by comma'],
];
// Known-good strings the heuristics would otherwise flag.
const ALLOW = [
  /Landlord initials: ______(   [A-Z]+ initials: ______)+/, // intentional 3-space gaps between initial blanks
];

function scrub(text) {
  let t = text;
  for (const re of ALLOW) t = t.replace(new RegExp(re.source, 'g'), 'ALLOWED');
  return t;
}

/** The model the app uses for a sample: its shipped `model` merged with the template's analysis (annotations included). */
function modelOf(s) {
  const c = compile(s.text);
  return s.model ? mergeModel(clone(s.model), c.analysis) : createModel(c.analysis);
}

function render(s, data, pname) {
  const c = compile(s.text);
  assert.deepEqual(c.errors, [], `${s.id}: compile errors`);
  assert.deepEqual(c.analysis.annotationErrors || [], [], `${s.id}: annotation errors`);
  const derived = computeDerived(modelOf(s), clone(data || {}));
  assert.deepEqual(derived.errors, [], `${s.id}/${pname}: computed-field errors`);
  const { text, warnings } = assemble(s.text, derived.data);
  const hard = warnings.filter((w) => /Error in|Unknown function|Unknown filter/i.test(w));
  assert.deepEqual(hard, [], `${s.id}/${pname}: expression errors`);
  return text;
}

test('every sample renders cleanly under five answer permutations', () => {
  for (const s of samples) {
    for (const [pname, data] of Object.entries(permutations(s))) {
      const text = scrub(render(s, data, pname));
      for (const [re, label] of ARTIFACTS) {
        const m = re.exec(text);
        assert.ok(!m, `${s.id}/${pname}: ${label} near ${JSON.stringify(text.slice(Math.max(0, (m?.index ?? 0) - 60), (m?.index ?? 0) + 40))}`);
      }
      if (pname === 'sample') assert.ok(!/DRAFTER/.test(text), `${s.id}: drafter warning with sample answers`);
    }
  }
});

test('every sample renders with empty data without throwing or leaving fields', () => {
  for (const s of samples) {
    const text = render(s, {}, 'empty');
    assert.ok(!/\{\[/.test(text));
  }
});

/** Extract numbered headings ("# 3. Title" → 3, "# ARTICLE 2 — X" → 2, "# ARTICLE IV — X" → 4). */
const ROMAN = { I: 1, V: 5, X: 10 };
const fromRoman = (r) => [...r].reduce((acc, ch, i, a) => acc + (ROMAN[ch] < (ROMAN[a[i + 1]] || 0) ? -ROMAN[ch] : ROMAN[ch]), 0);
function headingNumbers(text) {
  const out = [];
  for (const line of text.split('\n')) {
    let m = /^# (\d+)\. /.exec(line);
    if (m) { out.push(+m[1]); continue; }
    m = /^# ARTICLE (\d+) /.exec(line);
    if (m) { out.push(+m[1]); continue; }
    m = /^# ARTICLE ([IVX]+) /.exec(line);
    if (m) out.push(fromRoman(m[1]));
  }
  return out;
}

test('section and article numbering stays consecutive when optional sections are removed', () => {
  for (const s of samples) {
    for (const [pname, data] of Object.entries(permutations(s))) {
      const nums = headingNumbers(render(s, data, pname));
      if (!nums.length) continue;
      nums.forEach((n, i) => assert.equal(n, i + 1, `${s.id}/${pname}: heading numbers ${nums.join(',')}`));
    }
  }
});

test('LLC article numbering also holds for single-member + member-managed', () => {
  const s = getSample('llc-operating-agreement');
  const d = clone(s.sampleAnswers);
  d.Members = [d.Members[0]]; d.Members[0].Percent = 100; d.ManagementType = 'Member-managed'; d.Managers = []; d.TaxClassification = 'Disregarded';
  const nums = headingNumbers(render(s, d, 'single'));
  assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7]);
});

test('lists read correctly at 1, 2 and 3+ items', () => {
  const s = getSample('last-will');
  const one = clone(s.sampleAnswers); one.AlternateExecutors = [{ FullName: 'A One' }];
  assert.ok(render(s, one, '1').includes('successor Executor: A One.'));
  const two = clone(s.sampleAnswers); two.AlternateExecutors = [{ FullName: 'A One' }, { FullName: 'B Two' }];
  assert.ok(render(s, two, '2').includes('successor Executor: A One and B Two.'));
  const three = clone(s.sampleAnswers); three.AlternateExecutors = [{ FullName: 'A One' }, { FullName: 'B Two' }, { FullName: 'C Three' }];
  assert.ok(render(s, three, '3').includes('successor Executor: A One, B Two, and C Three.'));
  const none = clone(s.sampleAnswers); none.AlternateExecutors = [];
  const t = render(s, none, '0');
  assert.ok(!t.includes('successor Executor'));
  assert.ok(t.includes('as Executor of this Will.\n'));
});

test('singular/plural agreement follows counts', () => {
  const nda = getSample('nda');
  const d = clone(nda.sampleAnswers); d.TermYears = 1; d.SurvivalYears = 1;
  const t = render(nda, d, 'one-year');
  assert.ok(t.includes('one (1) year from'));
  assert.ok(t.includes('one (1) year after'));
  const dl = getSample('demand-letter');
  const inv = clone(dl.sampleAnswers); inv.ClaimType = 'Unpaid Invoice'; inv.InvoiceNumbers = '1042'; inv.ServicesDescription = 'design work'; inv.Damages = [{ Description: 'Invoice 1042', Amount: 100 }];
  const u = render(dl, inv, 'one-invoice');
  assert.ok(u.includes('Demand for Payment — Invoice 1042'));
  assert.ok(u.includes('An invoice was issued'));
  assert.ok(u.includes('the invoice remains unpaid'));
  const will = getSample('last-will');
  const w1 = clone(will.sampleAnswers); w1.Children = [{ FullName: 'Only Child', DOB: '2010-01-01' }];
  assert.ok(render(will, w1, 'one-child').includes('one child now living'));
});

test('articles and pronouns are derived from answers, never hard-coded', () => {
  const nda = getSample('nda');
  const d = clone(nda.sampleAnswers); d.Party1.EntityType = 'Oregon limited liability company';
  assert.ok(render(nda, d, 'article').includes('an Oregon limited liability company'));
  const will = getSample('last-will');
  for (const [g, poss, subj] of [['Male', 'his', 'he'], ['Female', 'her', 'she'], ['Nonbinary', 'their', 'they']]) {
    const w = clone(will.sampleAnswers); w.Testator.Gender = g;
    const t = render(will, w, g);
    assert.ok(t.includes(`to be ${poss} Last Will`), g);
    assert.ok(t.includes(`that ${subj} signed willingly`), g);
  }
});

test('money is written in words and numerals where customary', () => {
  const lease = render(getSample('residential-lease'), getSample('residential-lease').sampleAnswers, 's');
  assert.ok(lease.includes('**$2,450.00** (Two Thousand Four Hundred Fifty and 00/100 Dollars)'));
  const will = render(getSample('last-will'), getSample('last-will').sampleAnswers, 's');
  assert.ok(will.includes('$8,000.00 (Eight Thousand and 00/100 Dollars)'));
  const eng = getSample('engagement-letter');
  const d = clone(eng.sampleAnswers); d.FeeType = 'Contingency';
  assert.ok(render(eng, d, 'c').includes('33% (thirty-three percent)'));
});

test('holdover rent falls back to monthly rent when 0 (default: does not treat 0 as empty)', () => {
  const s = getSample('residential-lease');
  const d = clone(s.sampleAnswers); d.AutoRenew = false; d.HoldoverRent = 0;
  const t = render(s, d, 'holdover');
  assert.ok(t.includes('month-to-month at a rent of $2,450.00 per month'));
  assert.ok(!t.includes('$0.00'));
});

test('will: guardianship article depends on a child being under 18 today, computed from DOB', () => {
  const s = getSample('last-will');
  const adults = clone(s.sampleAnswers); adults.Children = [{ FullName: 'Grown Up', DOB: '1990-01-01' }];
  assert.ok(!render(s, adults, 'adults').includes('GUARDIAN OF MINOR'));
  const minor = clone(s.sampleAnswers); minor.Children = [{ FullName: 'Little One', DOB: new Date().getFullYear() - 5 + '-01-01' }];
  const t = render(s, minor, 'minor');
  assert.ok(t.includes('GUARDIAN OF MINOR'));
  assert.ok(t.includes('Little One (age 5)'));
  // and the questionnaire never asks an "Is minor?" question
  const c = compile(s.text);
  assert.ok(!questionnaire(c.ast, s.sampleAnswers, s.model).some((q) => /IsMinor/.test(q.path)));
  assert.ok(!questionnaire(c.ast, s.sampleAnswers, modelOf(s)).some((q) => /IsMinor/.test(q.path)));
});

test('will: Children[].IsMinor is a per-item computed field in the model that drives guardianship', () => {
  const s = getSample('last-will');
  const def = s.model.variables['Children[].IsMinor'];
  assert.equal(def.type, 'computed');
  assert.match(def.formula, /yearsBetween\(DOB, today\(\)\) < 18/);
  // the template reads IsMinor rather than repeating the date arithmetic
  assert.ok(s.text.includes('{[if Children|any: IsMinor]}'));
  assert.ok(!/any: yearsBetween\(DOB/.test(s.text));
  const y = new Date().getFullYear();
  const d = clone(s.sampleAnswers);
  d.Children = [{ FullName: 'Adult Child', DOB: '1990-01-01' }, { FullName: 'Young Child', DOB: `${y - 3}-01-01` }];
  const { data, errors } = computeDerived(modelOf(s), clone(d));
  assert.deepEqual(errors, []);
  assert.equal(data.Children[0].IsMinor, false);
  assert.equal(data.Children[1].IsMinor, true);
  const t = assemble(s.text, data).text;
  assert.ok(t.includes('GUARDIAN OF MINOR'));
  assert.ok(t.includes('Minor children as of the date of this Will: Young Child (age 3).'));
  assert.ok(!t.includes('Adult Child (age'));
  // flip the computed value and the article goes away — nothing else in the data changes
  data.Children[1].IsMinor = false;
  assert.ok(!assemble(s.text, data).text.includes('GUARDIAN OF MINOR'));
  // a merged model still treats it as computed (never asked), and the sample's model wins over inference
  const m = modelOf(s);
  assert.equal(m.variables['Children[].IsMinor'].type, 'computed');
  assert.equal(m.variables['Children[].IsMinor'].formula, def.formula);
});

// ---------------------------------------------------------------- annotations + validation

/** Validation errors the interview would show: computed fields filled in, only relevant variables checked. */
function errorsFor(s, data) {
  const m = modelOf(s);
  const ast = compile(s.text).ast;
  const full = computeDerived(m, clone(data)).data;
  return validate(m, full, { relevant: relevantVariables(ast, full).relevant }).map((e) => `${e.path}: ${e.message}`);
}
const errorsOn = (s, data, path) => errorsFor(s, data).filter((e) => e.startsWith(path + ':') || e.startsWith(path + '.') || e.startsWith(path + '['));

test('no sample has annotation errors, and the sample answers pass every validation rule', () => {
  for (const s of samples) {
    const c = compile(s.text);
    assert.deepEqual(c.analysis.annotationErrors || [], [], `${s.id}: annotation errors`);
    assert.deepEqual(errorsFor(s, s.sampleAnswers), [], `${s.id}: sample answers must validate`);
  }
});

test('llc: membership percentages must total 100 and each lies in 0..100', () => {
  const s = getSample('llc-operating-agreement');
  const m = modelOf(s);
  assert.equal(m.variables['Members'].validate, 'sum(Members, "Percent") = 100');
  assert.equal(m.variables['Members'].message, 'Membership percentages must total 100%');
  assert.equal(m.variables['Members[].Percent'].min, 0);
  assert.equal(m.variables['Members[].Percent'].max, 100);
  assert.deepEqual(m.variables['Members'].fromTemplate, { validate: 'sum(Members, "Percent") = 100', message: 'Membership percentages must total 100%' });
  // the hand-written label survives the annotation merge (user model edits win; annotations only add rules)
  assert.equal(m.variables['Members[].Percent'].label, 'Percentage interest (%)');
  const two = (a, b) => { const d = clone(s.sampleAnswers); d.Members = d.Members.slice(0, 2); d.Members[0].Percent = a; d.Members[1].Percent = b; return d; };
  assert.deepEqual(errorsOn(s, two(60, 50), 'Members'), ['Members: Membership percentages must total 100%']);
  assert.deepEqual(errorsOn(s, two(50, 50), 'Members'), []);
  const errs = errorsOn(s, two(120, -20), 'Members');
  assert.ok(errs.some((e) => e.startsWith('Members[0].Percent:') && /at most 100/.test(e)), errs.join('\n'));
  assert.ok(errs.some((e) => e.startsWith('Members[1].Percent:') && /at least 0/.test(e)), errs.join('\n'));
  assert.ok(!errs.some((e) => e.startsWith('Members:')), 'sum is 100, so no list-level error');
});

test('lease: end date must be after start date', () => {
  const s = getSample('residential-lease');
  const d = clone(s.sampleAnswers); d.LeaseStart = '2027-01-01'; d.LeaseEnd = '2026-12-31';
  assert.deepEqual(errorsOn(s, d, 'LeaseEnd'), ['LeaseEnd: End date must be after start']);
  d.LeaseEnd = '2027-01-01';
  assert.deepEqual(errorsOn(s, d, 'LeaseEnd'), ['LeaseEnd: End date must be after start'], 'same day is not after');
  d.LeaseEnd = '2027-12-31';
  assert.deepEqual(errorsOn(s, d, 'LeaseEnd'), []);
});

test('engagement letter: hourly rate is non-negative and contingency percentage is at most 100', () => {
  const s = getSample('engagement-letter');
  const d = clone(s.sampleAnswers); d.HourlyRate = -5;
  assert.match(errorsOn(s, d, 'HourlyRate').join(), /at least 0/);
  const c = clone(s.sampleAnswers); c.FeeType = 'Contingency'; c.ContingencyPercent = 150;
  assert.match(errorsOn(s, c, 'ContingencyPercent').join(), /at most 100/);
  c.ContingencyPercent = 40;
  assert.deepEqual(errorsOn(s, c, 'ContingencyPercent'), []);
  assert.equal(modelOf(s).variables['HourlyRate'].label, 'Hourly rate of responsible attorney');
});

test('demand letter: at least one day to respond', () => {
  const s = getSample('demand-letter');
  const d = clone(s.sampleAnswers); d.DeadlineDays = 0;
  assert.deepEqual(errorsOn(s, d, 'DeadlineDays'), ['DeadlineDays: Give at least one day to respond']);
  d.DeadlineDays = 1;
  assert.deepEqual(errorsOn(s, d, 'DeadlineDays'), []);
});

test('tutorial: labels, help, options and rules all come from @annotations in the template', () => {
  const s = getSample('tutorial');
  const c = compile(s.text);
  const ann = c.analysis.annotations;
  assert.equal(ann.get('Client.FullName').label, "Client's full legal name");
  assert.deepEqual(ann.get('Client.Gender').options, ['Male', 'Female', 'Nonbinary']);
  assert.equal(ann.get('Client.EntityType').help, 'Leave blank to print "business entity".');
  const m = s.model;
  assert.equal(m.variables['Client.Gender'].type, 'selection');
  assert.deepEqual(m.variables['Client.Gender'].fromTemplate.options, ['Male', 'Female', 'Nonbinary']);
  assert.equal(m.variables['Client.EntityType'].required, false);
  assert.equal(m.variables['Fee'].type, 'currency');
  assert.equal(m.variables['Fee'].min, 0);
  assert.equal(m.variables['Children[].DOB'].fromTemplate.validate, 'value <= today()');
  // every shipped label is marked "set in template"
  for (const [p, def] of Object.entries(m.variables)) if (def.type !== 'object') assert.ok(def.fromTemplate && def.fromTemplate.label, `${p} label should come from an annotation`);
  // questionnaire carries them through
  const qs = questionnaire(c.ast, s.sampleAnswers, m);
  const gender = qs.find((q) => q.path === 'Client.Gender');
  assert.equal(gender.label, "Client's pronouns");
  assert.deepEqual(gender.options, ['Male', 'Female', 'Nonbinary']);
  const entity = clone(s.sampleAnswers); entity.Client.IsEntity = true;
  assert.equal(questionnaire(c.ast, entity, m).find((q) => q.path === 'Client.EntityType').help, 'Leave blank to print "business entity".');
  assert.equal(qs.find((q) => q.path === 'Fee').min, 0);
  assert.equal(qs.find((q) => q.path === 'Fee').fromTemplate.min, 0);
  // and the @validate rule fires
  const d = clone(s.sampleAnswers); d.Children[0].DOB = `${new Date().getFullYear() + 2}-01-01`;
  assert.deepEqual(errorsOn(s, d, 'Children[0].DOB'), ['Children[0].DOB: A date of birth cannot be in the future']);
  d.Children[0].DOB = '2012-03-14'; d.Fee = -1;
  assert.match(errorsOn(s, d, 'Fee').join(), /at least 0/);
});

test('annotations never conflict with a sample\'s hand-written model: merged fields agree with the shipped model', () => {
  for (const s of samples) {
    if (s.id === 'tutorial') continue;
    const m = modelOf(s);
    for (const [p, def] of Object.entries(s.model.variables)) {
      const v = m.variables[p];
      assert.ok(v, `${s.id}: ${p} in merged model`);
      assert.equal(v.label, def.label, `${s.id}: ${p} label`);
      assert.equal(v.type, def.type, `${s.id}: ${p} type`);
      if (def.options) assert.deepEqual([...v.options].sort(), [...def.options].sort(), `${s.id}: ${p} options`);
      if (def.help) assert.equal(v.help, def.help, `${s.id}: ${p} help`);
      if (def.required === false) assert.equal(v.required, false, `${s.id}: ${p} required`);
      if (def.formula) assert.equal(v.formula, def.formula, `${s.id}: ${p} formula`);
    }
    for (const [p, ann] of compile(s.text).analysis.annotations) {
      const shipped = s.model.variables[p] || {};
      for (const k of Object.keys(ann)) assert.ok(!(k in shipped), `${s.id}: ${p}.${k} is set both by @${k} and by the model`);
    }
  }
});

// ---------------------------------------------------------------- questionnaire

test('every sample ships a model with a label for every asked variable, and no stale paths', () => {
  for (const s of samples) {
    assert.ok(s.model && s.model.variables, `${s.id}: missing model`);
    const c = compile(s.text);
    const vars = analyze(c.ast).variables;
    const asked = [...vars.values()].filter((v) => v.inferredType !== 'object').map((v) => v.path);
    for (const p of asked) assert.ok(s.model.variables[p], `${s.id}: no model label for ${p}`);
    for (const p of Object.keys(s.model.variables)) assert.ok(vars.has(p), `${s.id}: model path ${p} not in template`);
    for (const [p, def] of Object.entries(s.model.variables)) {
      assert.ok(def.label && def.label.length > 2, `${s.id}: ${p} label`);
      if (def.type === 'selection' || def.type === 'multiselect') assert.ok(def.options && def.options.length >= 2, `${s.id}: ${p} needs options`);
    }
  }
});

test('questionnaire with model: text variables tested bare in {[if]} are not turned into Yes/No questions', () => {
  const expectText = {
    'engagement-letter': ['Court', 'ResponsibleAttorney.BarNumber', 'Client.Salutation'],
    'last-will': ['Executor.Relationship', 'Guardian.Relationship', 'PetCaretaker', 'SpecificGifts[].Relationship', 'SpecificGifts[].Alternate'],
    'residential-lease': ['Premises.Unit', 'Guarantor.Relationship'],
    nda: ['Party1.EntityType', 'Party2.EntityType'],
    'demand-letter': ['Recipient.Attention', 'Sender.Title', 'Sender.Firm', 'Statute.Citation', 'Statute.MultiplierText'],
  };
  for (const [id, paths] of Object.entries(expectText)) {
    const s = getSample(id);
    const qs = questionnaire(compile(s.text).ast, allTrueSingle(s.sampleAnswers), s.model);
    for (const p of paths) {
      const q = qs.find((x) => x.path === p);
      if (!q) continue; // not relevant under this permutation
      assert.notEqual(q.type, 'boolean', `${id}: ${p} should not be boolean`);
    }
  }
});

test('questionnaire gating: dependent questions appear only when their gate is answered Yes', () => {
  const cases = [
    ['last-will', 'IsMarried', ['Spouse.FullName', 'Spouse.Gender']],
    ['residential-lease', 'HasGuarantor', ['Guarantor.FullName', 'Guarantor.Address', 'Guarantor.CapAmount']],
    ['residential-lease', 'PetsAllowed', ['Pets', 'PetDeposit', 'PetRent']],
    ['residential-lease', 'BuiltBefore1978', ['LeadPaintKnown', 'LeadPaintRecords']],
    ['nda', 'IncludeNonSolicit', ['NonSolicitMonths']],
    ['nda', 'IsEmployee', ['EmploymentStatus']],
    ['engagement-letter', 'IsLitigation', ['LitigationRole', 'Court', 'CostApprovalThreshold']],
    ['demand-letter', 'IncludeStatute', ['Statute.Citation']],
    ['demand-letter', 'OnBehalfOfClient', ['ClientName']],
  ];
  for (const [id, gate, deps] of cases) {
    const s = getSample(id);
    const ast = compile(s.text).ast;
    const paths = (data) => questionnaire(ast, data, s.model).map((q) => q.path);
    const empty = paths({});
    assert.ok(empty.includes(gate), `${id}: gate ${gate} asked up front`);
    for (const d of deps) assert.ok(!empty.includes(d), `${id}: ${d} must wait for ${gate}`);
    const no = clone(s.sampleAnswers); setPath(no, gate, false);
    for (const d of deps) assert.ok(!paths(no).includes(d), `${id}: ${d} hidden when ${gate} = No`);
    const yes = clone(s.sampleAnswers); setPath(yes, gate, true);
    for (const d of deps) assert.ok(paths(yes).includes(d), `${id}: ${d} shown when ${gate} = Yes`);
  }
});

test('questionnaire gating: selection-driven sections', () => {
  const llc = getSample('llc-operating-agreement');
  const ast = compile(llc.text).ast;
  const mm = clone(llc.sampleAnswers); mm.ManagementType = 'Member-managed';
  assert.ok(!questionnaire(ast, mm, llc.model).some((q) => q.path.startsWith('Managers')));
  const single = clone(llc.sampleAnswers); single.Members = [single.Members[0]];
  const qs = questionnaire(ast, single, llc.model).map((q) => q.path);
  for (const p of ['RestrictTransfers', 'ROFRDays', 'BuyoutDiscount', 'BuyoutInstallmentYears', 'SupermajorityPercent']) assert.ok(!qs.includes(p), `${p} irrelevant for single member`);
  const eng = getSample('engagement-letter');
  const flat = clone(eng.sampleAnswers); flat.FeeType = 'Flat';
  const fq = questionnaire(compile(eng.text).ast, flat, eng.model).map((q) => q.path);
  assert.ok(fq.includes('FlatFee') && fq.includes('FlatFeeEarnedOnReceipt'));
  for (const p of ['HourlyRate', 'ParalegalRate', 'ContingencyPercent']) assert.ok(!fq.includes(p), `${p} irrelevant for flat fee`);
});

test('questionnaire order: gating questions come before the questions they gate', () => {
  for (const s of samples) {
    const qs = questionnaire(compile(s.text).ast, allTrueSingle(s.sampleAnswers), s.model).map((q) => q.path);
    const before = (a, b) => { const ia = qs.indexOf(a), ib = qs.indexOf(b); if (ia === -1 || ib === -1) return; assert.ok(ia < ib, `${s.id}: ${a} should precede ${b}`); };
    before('IsMarried', 'Spouse.FullName');
    before('HasGuarantor', 'Guarantor.FullName');
    before('PetsAllowed', 'PetDeposit');
    before('IsLitigation', 'LitigationRole');
    before('FeeType', 'HourlyRate');
    before('ClaimType', 'PropertyAddress');
    before('ManagementType', 'Managers');
    before('IsMutual', 'Party1.ShortName');
  }
});

test('questionnaire: selections carry every option the template branches on', () => {
  const expect = {
    'engagement-letter': { FeeType: ['Hourly', 'Flat', 'Contingency', 'Hybrid'], LitigationRole: ['Plaintiff', 'Defendant'] },
    'last-will': { DistributionMethod: ['Per Stirpes', 'Per Capita', 'Named Beneficiaries'] },
    'llc-operating-agreement': { ManagementType: ['Member-managed', 'Manager-managed'], TaxClassification: ['Disregarded', 'Partnership', 'S-Corporation', 'C-Corporation'] },
    'residential-lease': { LateFeeType: ['Flat', 'Percent', 'None'] },
    'demand-letter': { ClaimType: ['Unpaid Invoice', 'Security Deposit', 'Breach of Contract', 'Personal Injury'], Tone: ['Firm', 'Cordial'] },
    nda: { EmploymentStatus: ['Prospective', 'Current'] },
  };
  for (const [id, sels] of Object.entries(expect)) {
    const s = getSample(id);
    const qs = questionnaire(compile(s.text).ast, allTrueSingle(s.sampleAnswers), s.model);
    for (const [p, opts] of Object.entries(sels)) {
      const q = qs.find((x) => x.path === p);
      assert.ok(q, `${id}: ${p} asked`);
      assert.equal(q.type, 'selection');
      for (const o of opts) assert.ok(q.options.includes(o), `${id}: ${p} option ${o}`);
    }
  }
});

function setPath(obj, path, value) {
  const segs = path.split('.');
  let o = obj;
  for (const s of segs.slice(0, -1)) { if (o[s] == null || typeof o[s] !== 'object') o[s] = {}; o = o[s]; }
  o[segs[segs.length - 1]] = value;
}
