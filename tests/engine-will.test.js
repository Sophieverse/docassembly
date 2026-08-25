import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, assemble, questionnaire, createModel, validate, relevantVariables } from '../engine/index.js';

const WILL = `LAST WILL AND TESTAMENT OF {[Testator.FullName|upper]}

I, {[Testator.FullName]}, of {[Testator.City]}, {[Testator.State]}, being of sound mind, declare this to be my Last Will and Testament, and revoke all prior wills and codicils.

ARTICLE I — FAMILY
{[if Testator.IsMarried]}
I am married to {[Spouse.FullName]} ("my {[if Spouse.Gender = "female"]}wife{[else if Spouse.Gender = "male"]}husband{[else]}spouse{[end if]}"). All references in this Will to my spouse are to {[Spouse.Gender|pronoun:"object"]}.
{[else]}
I am not married.
{[end if]}
{[if count(Children) > 0]}
I have {[count(Children)|pluralize:"child","children"]}, namely {[list Children]}{[Name]}, born {[DOB|format:"long"]}{[_punc]}{[end list]}. References to "my children" include any children born to or adopted by me after the date of this Will.
{[else]}
I have no children, living or deceased.
{[end if]}

ARTICLE II — RESIDUARY ESTATE
{[if Testator.IsMarried]}
I give all of my residuary estate to my spouse, {[Spouse.FullName]}, if {[Spouse.Gender|pronoun:"subject"]} survives me by thirty (30) days.
{[if count(Children) > 0]}
If my spouse does not so survive me, I give my residuary estate to my children who survive me, in equal shares.
{[end if]}
{[else if count(Children) > 0]}
I give all of my residuary estate to my children who survive me, in equal shares{[if count(Children) > 1]}, per stirpes{[end if]}.
{[else]}
I give all of my residuary estate to {[AlternateBeneficiary.Name]} of {[AlternateBeneficiary.City]}.
{[end if]}
{[if any(Children, yearsBetween(DOB, SigningDate) < 18)]}
ARTICLE III — GUARDIAN
I appoint {[Guardian.Name]} as guardian of the person and estate of my minor children.
{[end if]}

ARTICLE IV — EXECUTOR
I appoint {[Executor.Name]} as Executor of this Will{[if Executor.Bond = false]}, to serve without bond{[end if]}.
{[# The specific bequests section is optional.]}
{[if Bequests]}
ARTICLE V — SPECIFIC BEQUESTS
{[list Bequests as b]}
{[_index]}. I give {[b.Description]}{[if b.Amount]} in the amount of {[b.Amount|currency]} ({[b.Amount|dollars]}){[end if]} to {[b.Beneficiary]}.
{[end list]}
{[end if]}

Signed on {[SigningDate|format:"legal"]}.

______________________________
{[Testator.FullName]}
`;

const base = {
  Testator: { FullName: 'Jane Q. Public', City: 'Berkeley', State: 'California', IsMarried: false },
  Executor: { Name: 'Sam Executor', Bond: false },
  SigningDate: '2026-03-05',
  Children: [],
};

test('will compiles with no errors and sensible analysis', () => {
  const { errors, analysis } = compile(WILL);
  assert.deepEqual(errors, []);
  const v = analysis.variables;
  assert.equal(v.get('Testator.IsMarried').inferredType, 'boolean');
  assert.equal(v.get('Spouse.Gender').inferredType, 'selection');
  assert.deepEqual(v.get('Spouse.Gender').options.sort(), ['female', 'male', 'neutral']);
  assert.equal(v.get('Children').inferredType, 'list');
  assert.equal(v.get('Children[].DOB').inferredType, 'date');
  assert.equal(v.get('Bequests[].Amount').inferredType, 'currency');
  assert.equal(v.get('Bequests[].Description').inferredType, 'longtext');
  assert.equal(v.get('SigningDate').inferredType, 'date');
  assert.equal(v.get('Executor.Bond').inferredType, 'boolean');
  assert.ok(v.get('Spouse.FullName').gatedBy.includes('Testator.IsMarried'));
  assert.ok(v.get('Guardian.Name').gatedBy[0].startsWith('any(Children'));
});

test('unmarried, no children', () => {
  const { text, warnings } = assemble(WILL, base);
  assert.deepEqual(warnings, ['Missing value: AlternateBeneficiary.Name', 'Missing value: AlternateBeneficiary.City']);
  assert.match(text, /^LAST WILL AND TESTAMENT OF JANE Q\. PUBLIC\n/);
  assert.ok(text.includes('I am not married.'));
  assert.ok(text.includes('I have no children, living or deceased.'));
  assert.ok(!text.includes('ARTICLE III'));
  assert.ok(!text.includes('ARTICLE V'));
  assert.ok(text.includes('as Executor of this Will, to serve without bond.'));
  assert.ok(text.includes('Signed on the 5th day of March, 2026.'));
  assert.ok(!/\n{3,}/.test(text.replace(/\n\n(ARTICLE|Signed|_)/g, '$1')), 'no stray blank lines from removed blocks');
  const r2 = assemble(WILL, { ...base, AlternateBeneficiary: { Name: 'Charity X', City: 'Oakland' } });
  assert.deepEqual(r2.warnings, []);
  assert.ok(r2.text.includes('residuary estate to Charity X of Oakland.'));
});

test('married, three children, one minor, bequests', () => {
  const data = {
    ...base,
    Testator: { ...base.Testator, IsMarried: true },
    Spouse: { FullName: 'John Public', Gender: 'male' },
    Children: [
      { Name: 'Ann Public', DOB: '2000-01-15' },
      { Name: 'Ben Public', DOB: '2004-07-04' },
      { Name: 'Cal Public', DOB: '2015-12-25' },
    ],
    Guardian: { Name: 'Grace Guardian' },
    Bequests: [
      { Description: 'my 1962 Fender Stratocaster', Beneficiary: 'Ben Public' },
      { Description: 'cash', Amount: 25000, Beneficiary: 'Berkeley Public Library' },
    ],
  };
  const { text, warnings } = assemble(WILL, data);
  assert.deepEqual(warnings, []);
  assert.ok(text.includes('I am married to John Public ("my husband"). All references in this Will to my spouse are to him.'));
  assert.ok(text.includes('I have 3 children, namely Ann Public, born January 15, 2000, Ben Public, born July 4, 2004, and Cal Public, born December 25, 2015. References'));
  assert.ok(text.includes('to my spouse, John Public, if he survives me'));
  assert.ok(text.includes('If my spouse does not so survive me'));
  assert.ok(text.includes('ARTICLE III — GUARDIAN\nI appoint Grace Guardian as guardian'));
  assert.ok(text.includes('ARTICLE V — SPECIFIC BEQUESTS\n1. I give my 1962 Fender Stratocaster to Ben Public.\n2. I give cash in the amount of $25,000.00 (Twenty-Five Thousand and 00/100 Dollars) to Berkeley Public Library.\n'));
  assert.equal((text.match(/ARTICLE III/g) || []).length, 1, 'guardian article appears once even with multiple minors');
});

test('unmarried with two adult children — per stirpes, no guardian', () => {
  const data = { ...base, Children: [{ Name: 'A', DOB: '1990-01-01' }, { Name: 'B', DOB: '1992-01-01' }], Spouse: { FullName: 'ignored' } };
  const { text, warnings } = assemble(WILL, data);
  assert.deepEqual(warnings, []);
  assert.ok(text.includes('I have 2 children, namely A, born January 1, 1990 and B, born January 1, 1992.'));
  assert.ok(text.includes('to my children who survive me, in equal shares, per stirpes.'));
  assert.ok(!text.includes('ARTICLE III'));
  assert.ok(!text.includes('ignored'));
});

test('questionnaire evolves as answers arrive', () => {
  const q0 = questionnaire(compile(WILL).ast, {}).map((q) => q.path);
  assert.ok(q0.includes('Testator.FullName'));
  assert.ok(q0.includes('Testator.IsMarried'));
  assert.ok(q0.includes('Children'));
  assert.ok(!q0.includes('Spouse.FullName'));
  assert.ok(!q0.includes('Guardian.Name'));
  assert.ok(!q0.includes('AlternateBeneficiary.Name'));
  const q1 = questionnaire(compile(WILL).ast, { Testator: { IsMarried: true }, Children: [] }).map((q) => q.path);
  assert.ok(q1.includes('Spouse.FullName'));
  assert.ok(q1.includes('Spouse.Gender'));
  assert.ok(!q1.includes('AlternateBeneficiary.Name'));
  assert.ok(q1.indexOf('Testator.IsMarried') < q1.indexOf('Spouse.FullName'));
  const q2 = questionnaire(compile(WILL).ast, { Testator: { IsMarried: false }, Children: [], SigningDate: '2026-01-01' }).map((q) => q.path);
  assert.ok(q2.includes('AlternateBeneficiary.Name'));
  assert.ok(!q2.includes('Spouse.FullName'));
  const q3 = questionnaire(compile(WILL).ast, { Testator: { IsMarried: false }, Children: [{ Name: 'Kid', DOB: '2020-01-01' }], SigningDate: '2026-01-01' }).map((q) => q.path);
  assert.ok(q3.includes('Guardian.Name'));
  assert.ok(q3.includes('Children[].Name'));
  const q3full = questionnaire(compile(WILL).ast, { Testator: { IsMarried: false }, Children: [{ Name: 'Kid', DOB: '2020-01-01' }], SigningDate: '2026-01-01' });
  assert.equal(q3full.find((q) => q.path === 'Spouse.Gender'), undefined);
  assert.equal(q3full.find((q) => q.path === 'Children[].DOB').type, 'date');
});

test('validation against the model reports only what is relevant', () => {
  const { ast, analysis } = compile(WILL);
  const model = createModel(analysis);
  const data = { Testator: { IsMarried: true }, Children: [] };
  const { relevant } = relevantVariables(ast, data);
  const errs = validate(model, data, { relevant });
  const paths = errs.map((e) => e.path);
  assert.ok(paths.includes('Testator.FullName'));
  assert.ok(paths.includes('Spouse.FullName'));
  assert.ok(!paths.includes('AlternateBeneficiary.Name'));
  assert.ok(!paths.includes('Guardian.Name'));
});
