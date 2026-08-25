/**
 * Sample-template tests: every bundled sample compiles without errors and
 * assembles under 2-3 answer permutations, with key phrases appearing or
 * disappearing as conditions flip.
 *
 * Imports compile/assemble from engine/index.js when present; otherwise builds
 * equivalents from parser.js + evaluate.js so the suite runs before the
 * engine facade lands.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { samples, getSample } from '../samples/index.js';

let compile, assemble;
try {
  ({ compile, assemble } = await import('../engine/index.js'));
} catch {
  const { parse } = await import('../engine/parser.js');
  const { render } = await import('../engine/evaluate.js');
  compile = (text) => {
    try { return { ast: parse(text), analysis: null, errors: [] }; }
    catch (e) { return { ast: null, analysis: null, errors: [{ message: e.message, line: e.line, col: e.col }] }; }
  };
  assemble = (text, data) => {
    const { text: out, warnings } = render(parse(text), data);
    return { text: out, warnings };
  };
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Assemble; fail loudly on compile errors or expression-error warnings. */
function run(sample, data) {
  const c = compile(sample.text);
  assert.deepEqual(c.errors, [], `${sample.id}: compile errors`);
  const { text, warnings } = assemble(sample.text, data);
  const hard = (warnings || []).filter((w) => /Error in|Unknown function|Unknown filter/i.test(w));
  assert.deepEqual(hard, [], `${sample.id}: expression errors`);
  assert.ok(!/\{\[/.test(text), `${sample.id}: unrendered field left in output`);
  assert.ok(!/DRAFTER/.test(text), `${sample.id}: drafter warning surfaced in output`);
  return text;
}

const has = (text, s) => assert.ok(text.includes(s), `expected to find: ${s}`);
const lacks = (text, s) => assert.ok(!text.includes(s), `expected NOT to find: ${s}`);

test('index exports seven samples with the required shape', () => {
  assert.equal(samples.length, 7);
  for (const s of samples) {
    for (const k of ['id', 'name', 'description', 'category', 'text', 'sampleAnswers']) assert.ok(s[k], `${s.id} missing ${k}`);
    assert.equal(typeof s.text, 'string');
  }
  assert.equal(getSample('nda').id, 'nda');
});

test('every sample compiles and assembles with its sampleAnswers', () => {
  for (const s of samples) run(s, s.sampleAnswers);
});

test('no sample leaves blank-line runs longer than two from removed blocks', () => {
  for (const s of samples) {
    const text = run(s, s.sampleAnswers);
    assert.ok(!/\n{4,}/.test(text), `${s.id}: 3+ consecutive blank lines`);
  }
});

// ---------------------------------------------------------------- tutorial
test('tutorial: branches and list punctuation', () => {
  const s = getSample('tutorial');
  const a = run(s, s.sampleAnswers);
  has(a, 'Maya Rivera (age');
  has(a, ' and Leo Rivera');
  has(a, 'is an individual who is married');
  has(a, 'JORDAN RIVERA');
  has(a, '$1,250.50');
  has(a, 'Alex Chen');
  has(a, 'their own copy');

  const d = clone(s.sampleAnswers);
  d.Client.IsEntity = true; d.Client.EntityType = 'Delaware corporation'; d.Children = [];
  const b = run(s, d);
  has(b, 'is a Delaware corporation');
  lacks(b, 'married');
  lacks(b, 'one for each child');
});

// ---------------------------------------------------------------- engagement letter
test('engagement-letter: hourly + litigation + joint clients + California', () => {
  const s = getSample('engagement-letter');
  const t = run(s, s.sampleAnswers);
  has(t, 'Hourly fees');
  has(t, '$525.00');
  has(t, 'Litigation costs and experts');
  has(t, 'Joint Representation and Conflict Waiver');
  has(t, 'Advance deposit');
  has(t, 'IOLTA');
  has(t, 'Business and Professions Code');
  has(t, '# 6. Termination');
  has(t, 'Attn: Daniel Foss');
  lacks(t, 'Flat fee');
  lacks(t, 'Contingency fee');
  lacks(t, 'professional liability insurance');
});

test('engagement-letter: contingency, no retainer, single individual client, New York', () => {
  const s = getSample('engagement-letter');
  const d = clone(s.sampleAnswers);
  d.FeeType = 'Contingency'; d.Retainer = 0; d.AdditionalClients = [];
  d.Client = { FullName: 'Maria Lopez', IsEntity: false, Salutation: 'Ms. Lopez', Address: d.Client.Address };
  d.Firm.State = 'New York'; d.Firm.HasMalpracticeInsurance = false;
  const t = run(s, d);
  has(t, 'Contingency fee');
  has(t, '33% (thirty-three percent)');
  has(t, 'increasing to 40%');
  has(t, 'you will not receive monthly fee invoices');
  has(t, 'Dear Ms. Lopez:');
  has(t, '# 5. Termination');
  has(t, 'Judiciary Law');
  lacks(t, 'Advance deposit');
  lacks(t, 'Joint Representation');
  lacks(t, 'Hourly fees');
  lacks(t, 'professional liability insurance'); // CA-only notice
});

test('engagement-letter: flat fee, non-litigation, other state', () => {
  const s = getSample('engagement-letter');
  const d = clone(s.sampleAnswers);
  d.FeeType = 'Flat'; d.IsLitigation = false; d.Firm.State = 'Ohio'; d.FlatFeeEarnedOnReceipt = true;
  const t = run(s, d);
  has(t, 'flat fee of $7,500.00 (Seven Thousand Five Hundred');
  has(t, 'earned upon receipt');
  has(t, 'laws and rules of professional conduct of the State of Ohio');
  lacks(t, 'Litigation costs and experts');
  lacks(t, 'does **not** include any appeal');
});

// ---------------------------------------------------------------- last will
test('last-will: married, minor child, per stirpes, gifts, pet trust, no-contest', () => {
  const s = getSample('last-will');
  const t = run(s, s.sampleAnswers);
  has(t, 'I am married to **Thomas Reid Vance**');
  has(t, 'all references in this Will to my spouse are to him');
  has(t, 'ARTICLE III — SPECIFIC GIFTS');
  has(t, 'ARTICLE IV — PET TRUST');
  has(t, 'ARTICLE V — RESIDUARY ESTATE');
  has(t, '**per stirpes**');
  has(t, 'ARTICLE VI — GUARDIAN OF MINOR CHILDREN');
  has(t, 'Owen Vance (age');
  has(t, 'ARTICLE VII — EXECUTOR');
  has(t, 'NO-CONTEST CLAUSE');
  has(t, 'declared by Eleanor Marie Vance to be her Last Will');
  has(t, 'that she signed willingly');
  has(t, 'two children now living');
  lacks(t, 'per capita');
});

test('last-will: unmarried, adult children only, per capita, no extras', () => {
  const s = getSample('last-will');
  const d = clone(s.sampleAnswers);
  d.IsMarried = false; d.Testator.Gender = 'Male';
  d.Children = [{ FullName: 'Clara Vance', DOB: '2000-01-01', IsMinor: false }];
  d.DistributionMethod = 'Per Capita'; d.SpecificGifts = []; d.PetTrust = false; d.NoContest = false;
  const t = run(s, d);
  has(t, 'I am not currently married');
  has(t, 'ARTICLE III — RESIDUARY ESTATE');
  has(t, 'ARTICLE IV — EXECUTOR');
  has(t, '**per capita at each generation**');
  has(t, 'to be his Last Will');
  has(t, 'one child now living');
  lacks(t, 'SPECIFIC GIFTS');
  lacks(t, 'PET TRUST');
  lacks(t, 'GUARDIAN OF MINOR');
  lacks(t, 'NO-CONTEST');
  lacks(t, 'thirty (30) days, I give my entire residuary estate');
});

test('last-will: nonbinary testator, no children, named beneficiaries', () => {
  const s = getSample('last-will');
  const d = clone(s.sampleAnswers);
  d.Testator.Gender = 'Nonbinary'; d.IsMarried = false; d.Children = [];
  d.DistributionMethod = 'Named Beneficiaries';
  d.ResiduaryBeneficiaries = [{ FullName: 'Margaret Lin' }, { FullName: 'Robert Vance' }];
  const t = run(s, d);
  has(t, 'I have no children');
  has(t, 'in equal shares to Margaret Lin and Robert Vance');
  has(t, 'to be their Last Will');
  lacks(t, 'heirs at law');
  lacks(t, 'GUARDIAN');
});

// ---------------------------------------------------------------- LLC
test('llc: multi-member, manager-managed, partnership, ROFR', () => {
  const s = getSample('llc-operating-agreement');
  const t = run(s, s.sampleAnswers);
  has(t, 'collectively the "Members"');
  has(t, 'ARTICLE 2 — MEMBERS AND CAPITAL');
  has(t, '|Aisha Rahman|14 Elm Court, Wilmington, DE 19806|$60,000.00|60%|');
  has(t, '**$100,000.00**');
  has(t, '**100%**');
  has(t, 'Manager-Managed');
  has(t, 'The initial Manager is: Aisha Rahman');
  has(t, 'partnership representative');
  has(t, 'Tax Distributions');
  has(t, 'ARTICLE 6 — TRANSFERS');
  has(t, 'Right of First Refusal');
  has(t, 'ARTICLE 7 — WITHDRAWAL; BUY-SELL');
  has(t, 'ARTICLE 8 — DISSOLUTION');
  has(t, 'SCHEDULE A — MEMBERS');
  has(t, '**MANAGER:**');
  has(t, 'the undersigned have executed');
  lacks(t, 'Sole Member');
  lacks(t, 'WARNING');
});

test('llc: single member, member-managed, disregarded entity', () => {
  const s = getSample('llc-operating-agreement');
  const d = clone(s.sampleAnswers);
  d.Members = [d.Members[0]]; d.Members[0].Percent = 100;
  d.ManagementType = 'Member-managed'; d.Managers = []; d.TaxClassification = 'Disregarded';
  const t = run(s, d);
  has(t, 'as the sole member (the "Member")');
  has(t, 'ARTICLE 2 — MEMBER AND CAPITAL');
  has(t, 'Sole Member');
  has(t, 'entity disregarded as separate from the Member');
  has(t, 'Member-Managed');
  has(t, 'The Member has full and exclusive authority');
  has(t, 'ARTICLE 6 — DISSOLUTION');
  has(t, 'the undersigned has executed');
  lacks(t, 'TRANSFERS OF MEMBERSHIP');
  lacks(t, 'BUY-SELL');
  lacks(t, 'SCHEDULE A');
  lacks(t, 'Voting');
  lacks(t, '**MANAGER:**');
  lacks(t, '|Member|Address|');
});

test('llc: multi-member member-managed, S-corp, no transfer restrictions, bad percentages flagged', () => {
  const s = getSample('llc-operating-agreement');
  const d = clone(s.sampleAnswers);
  d.ManagementType = 'Member-managed'; d.TaxClassification = 'S-Corporation'; d.RestrictTransfers = false;
  d.Members[2].Percent = 5; // totals 95
  const c = compile(s.text);
  assert.deepEqual(c.errors, []);
  const { text: t } = assemble(s.text, d);
  has(t, 'DRAFTER WARNING: Percentage Interests total 95%');
  has(t, 'Subchapter S');
  has(t, '**5.2 Voting.**');
  has(t, 'upon written notice to the other Members');
  lacks(t, 'Right of First Refusal');
  lacks(t, 'Manager-Managed');
});

// ---------------------------------------------------------------- lease
test('residential-lease: two tenants, pets, pre-1978, guarantor, flat late fee', () => {
  const s = getSample('residential-lease');
  const t = run(s, s.sampleAnswers);
  has(t, '**Nadia Petrov** and **Cole Whitaker**');
  has(t, 'collectively and individually, "Tenant"');
  has(t, 'Joint and several liability');
  has(t, '**$2,450.00** (Two Thousand Four Hundred Fifty');
  has(t, 'late charge of $75.00');
  has(t, 'water, sewer, and trash');
  has(t, 'Biscuit');
  has(t, 'pet deposit of **$400.00**');
  has(t, 'Lead-Based Paint');
  has(t, '# 13. Additional Terms');
  has(t, 'EXHIBIT A — GUARANTY OF LEASE');
  has(t, 'being the mother of Nadia Petrov');
  has(t, 'maximum aggregate liability of $14,700.00');
  has(t, 'Unit 3B');
  has(t, '1st day of each month');
  lacks(t, 'No animals of any kind');
});

test('residential-lease: single tenant, no pets, post-1978, no guarantor, percent late fee, month-to-month', () => {
  const s = getSample('residential-lease');
  const d = clone(s.sampleAnswers);
  d.Tenants = [{ FullName: 'Nadia Petrov' }]; d.Occupants = []; d.PetsAllowed = false; d.BuiltBefore1978 = false;
  d.HasGuarantor = false; d.LateFeeType = 'Percent'; d.IsMonthToMonth = true; d.UtilitiesIncluded = []; d.Premises.Unit = '';
  const t = run(s, d);
  has(t, 'month-to-month until terminated');
  has(t, 'No animals of any kind');
  has(t, 'late charge equal to 5% of the monthly rent ($122.50)');
  has(t, 'Tenant shall arrange and pay for all utilities');
  has(t, '# 12. Additional Terms');
  lacks(t, 'Joint and several');
  lacks(t, 'Lead');
  lacks(t, 'EXHIBIT A');
  lacks(t, 'Unit ');
  lacks(t, 'collectively');
});

test('residential-lease: no late fee variant', () => {
  const s = getSample('residential-lease');
  const d = clone(s.sampleAnswers);
  d.LateFeeType = 'None';
  const t = run(s, d);
  has(t, 'Landlord does not charge a late fee');
  lacks(t, 'late charge of');
});

// ---------------------------------------------------------------- NDA
test('nda: mutual, non-solicit, not employee', () => {
  const s = getSample('nda');
  const t = run(s, s.sampleAnswers);
  has(t, '>title MUTUAL NON-DISCLOSURE AGREEMENT');
  has(t, '("Northwind")');
  has(t, 'the Party disclosing it is the "Disclosing Party"');
  has(t, 'two (2) years from the Effective Date');
  has(t, 'three (3) years after');
  has(t, '# 8. Non-Solicitation');
  has(t, 'neither Party shall');
  has(t, '# 9. Remedies');
  has(t, 'State of Texas');
  lacks(t, 'Defend Trade Secrets');
  lacks(t, '(the "Receiving Party")');
});

test('nda: one-way employee NDA with DTSA notice, indefinite term, no non-solicit', () => {
  const s = getSample('nda');
  const d = clone(s.sampleAnswers);
  d.IsMutual = false; d.IsEmployee = true; d.EmploymentStatus = 'Prospective'; d.IncludeNonSolicit = false;
  d.TermYears = 0; d.SurvivalYears = 0;
  d.Party2 = { Name: 'Jamie Okoro', EntityType: '', Address: '12 Oak Lane, Round Rock, Texas 78664' };
  const t = run(s, d);
  has(t, '>title NON-DISCLOSURE AGREEMENT');
  lacks(t, 'MUTUAL');
  has(t, '(the "Disclosing Party")');
  has(t, '**Jamie Okoro**, an individual with an address at');
  has(t, 'a candidate for employment');
  has(t, 'until terminated by either Party');
  has(t, 'survive expiration or termination of this Agreement indefinitely');
  has(t, '# 8. Notice of Immunity Under the Defend Trade Secrets Act');
  has(t, '18 U.S.C. § 1833(b)');
  has(t, '# 9. Remedies');
  lacks(t, 'Non-Solicitation');
  has(t, 'Name: Jamie Okoro'); // default: falls back to Party2.Name
});

test('nda: one-year term uses singular "year"', () => {
  const s = getSample('nda');
  const d = clone(s.sampleAnswers);
  d.TermYears = 1; d.SurvivalYears = 1;
  const t = run(s, d);
  has(t, 'one (1) year from the Effective Date');
  has(t, 'one (1) year after');
  lacks(t, '(1) years');
});

// ---------------------------------------------------------------- demand letter
test('demand-letter: security deposit, firm tone, statute, computed deadline', () => {
  const s = getSample('demand-letter');
  const t = run(s, s.sampleAnswers);
  has(t, 'VIA CERTIFIED MAIL');
  has(t, 'Demand for Return of Security Deposit');
  has(t, 'This firm represents Priya Desai');
  has(t, 'No itemized statement of deductions');
  has(t, '**$3,264.00**');
  has(t, 'Three Thousand Two Hundred Sixty-Four');
  has(t, 'N.Y. Gen. Obl');
  has(t, 'twice the amount of the deposit');
  has(t, 'fourteen days from the date of this letter');
  has(t, 'preserve all documents');
  has(t, 'cc: Priya Desai');
  lacks(t, 'I hope this letter finds you well');
  lacks(t, 'Kind regards');
  // deadline = today + 14, formatted long
  const dl = new Date(); dl.setDate(dl.getDate() + 14);
  const month = dl.toLocaleString('en-US', { month: 'long' });
  has(t, `**${month} ${dl.getDate()}, ${dl.getFullYear()}**`);
});

test('demand-letter: unpaid invoice, cordial tone, no statute, self-represented', () => {
  const s = getSample('demand-letter');
  const d = clone(s.sampleAnswers);
  d.ClaimType = 'Unpaid Invoice'; d.Tone = 'Cordial'; d.IncludeStatute = false; d.OnBehalfOfClient = false;
  d.SentViaCertifiedMail = false; d.InvoiceNumbers = '1042 and 1057'; d.ServicesDescription = 'web design services';
  d.Damages = [{ Description: 'Invoice 1042', Amount: 1800 }, { Description: 'Invoice 1057', Amount: 950.5 }];
  d.DeadlineDays = 30; d.InterestRate = 0;
  const t = run(s, d);
  has(t, 'VIA FIRST-CLASS MAIL');
  has(t, 'Demand for Payment — Invoices 1042 and 1057');
  has(t, 'I hope this letter finds you well');
  has(t, 'I provided web design services');
  has(t, 'Invoices were issued');
  has(t, '**$2,750.50**');
  has(t, 'thirty days from the date of this letter');
  has(t, 'Kind regards');
  lacks(t, 'Applicable Law');
  lacks(t, 'This firm represents');
  lacks(t, 'cc:');
  lacks(t, 'Interest continues to accrue');
});

test('demand-letter: personal injury and breach of contract variants', () => {
  const s = getSample('demand-letter');
  const pi = clone(s.sampleAnswers);
  pi.ClaimType = 'Personal Injury'; pi.IncidentDate = '2026-03-02'; pi.IncidentLocation = 'the Crestline lobby';
  pi.IncidentDescription = 'she slipped on an unmarked wet floor.'; pi.NegligenceDescription = 'failure to place warning signage';
  pi.InjuryDescription = 'a fractured wrist'; pi.TreatmentOngoing = true; pi.ClaimNumber = 'CL-88213';
  pi.Statute = { Citation: 'N.Y. common law', LimitationsYears: 3, FeesAvailable: false, MultiplierText: '' };
  const a = run(s, pi);
  has(a, 'Claim for Damages — Incident of March 2, 2026');
  has(a, '**Your Claim No.: CL-88213**');
  has(a, 'that is ongoing');
  has(a, 'three (3) years from the date of injury');
  has(a, 'liability insurance carrier');

  const bc = clone(s.sampleAnswers);
  bc.ClaimType = 'Breach of Contract'; bc.ContractName = 'Master Services Agreement'; bc.ContractDate = '2025-11-10';
  bc.RecipientObligation = 'deliver the completed software by June 1, 2026'; bc.BreachDescription = 'No deliverable has been provided.';
  bc.NoticeOfBreachDate = '2026-06-15'; bc.Statute.FeesAvailable = true;
  const b = run(s, bc);
  has(b, 'Notice of Breach and Demand — Master Services Agreement');
  has(b, 'went unremedied within the cure period');
  has(b, 'and attorney\'s fees');
  lacks(b, 'liability insurance carrier');
});
