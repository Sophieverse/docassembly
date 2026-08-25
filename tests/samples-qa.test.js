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
import { compile, assemble, questionnaire, analyze } from '../engine/index.js';

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

function render(s, data, pname) {
  const c = compile(s.text);
  assert.deepEqual(c.errors, [], `${s.id}: compile errors`);
  const { text, warnings } = assemble(s.text, data);
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
