/**
 * LLC Operating Agreement — single vs multi-member, member- vs manager-managed,
 * tax classification, capital table, transfer restrictions / ROFR, entity
 * members get a By/Name/Title signature block.
 */
export const id = 'llc-operating-agreement';
export const name = 'LLC Operating Agreement';
export const description = 'Operating agreement that collapses to a single-member form when count(Members) = 1, swaps Member-managed vs Manager-managed language, renders a capital contribution table, and toggles transfer restrictions.';
export const category = 'Business Formation';

export const text = `{[# ============================================================
   LLC OPERATING AGREEMENT
   Key branches:
     count(Members) = 1   -> single-member form: "Member" defined term (singular),
                             NO voting / transfer / buy-sell articles
     ManagementType       -> "Member-managed" | "Manager-managed"; the phrase
                             "the Manager(s)" vs "the Members" in decision language
     TaxClassification    -> Disregarded | Partnership | S-Corporation | C-Corporation
     RestrictTransfers    -> Article on transfer restrictions incl. ROFR
     Members[].IsEntity   -> By/Name/Title signature block for entity members
   Drafter warnings print when the answers are inconsistent (percentages not
   100%, Disregarded with several members, Partnership with one member).
   Layout convention: optional blocks begin with a blank line INSIDE the {[if]}.
   ============================================================ ]}
>title OPERATING AGREEMENT
>title OF
>title {[Company.Name|upper]}
>center A {[Company.State]} Limited Liability Company

This Operating Agreement (this "Agreement") of **{[Company.Name]}** (the "Company") is entered into effective as of {[EffectiveDate|format:"long"]} by {[if count(Members) = 1]}{[list Members]}{[FullName]}{[end list]}, as the sole member (the "Member"){[else]}the persons listed on Schedule A (each a "Member" and collectively the "Members"){[end if]}.
{[if TaxClassification = "Disregarded" and count(Members) > 1]}

[DRAFTER WARNING: A Disregarded entity must have exactly one Member; this Company has {[count(Members)]}.]
{[end if]}
{[if TaxClassification = "Partnership" and count(Members) = 1]}

[DRAFTER WARNING: A single-member LLC cannot be taxed as a Partnership.]
{[end if]}
{[if ManagementType = "Manager-managed" and count(Managers) = 0]}

[DRAFTER WARNING: The Company is Manager-managed but no Managers are listed.]
{[end if]}

# ARTICLE 1 — FORMATION

**1.1 Formation.** The Company was formed as a limited liability company under the {[Company.State]} {[Company.StatuteName|default:"Limited Liability Company Act"]} (the "Act") by the filing of {[Company.FormationDocument|default:"Articles of Organization"]} with the {[Company.State]} Secretary of State on {[Company.FormationDate|format:"long"]}.

**1.2 Name.** The name of the Company is {[Company.Name]}. The Company may conduct business under that name or any other name {[if ManagementType = "Manager-managed"]}the Manager{[else]}the Member{[if count(Members) > 1]}s{[end if]}{[end if]} may select.

**1.3 Principal Office.** The principal office of the Company is {[Company.Address.Street]}, {[Company.Address.City]}, {[Company.Address.State]} {[Company.Address.Zip]}, or such other place as may be designated from time to time.

**1.4 Purpose.** The purpose of the Company is {[Company.Purpose|default:"to engage in any lawful business for which limited liability companies may be organized under the Act"]}.

**1.5 Term.** The Company shall continue until dissolved in accordance with this Agreement.

# ARTICLE 2 — {[if count(Members) = 1]}MEMBER{[else]}MEMBERS{[end if]} AND CAPITAL

{[if count(Members) = 1]}
**2.1 Sole Member.** {[list Members]}{[FullName]}, of {[Address]}, is the sole Member of the Company and holds one hundred percent (100%) of the membership interests. The Member has contributed {[Contribution|currency]} ({[Contribution|dollars]}) to the capital of the Company.{[end list]}
{[else]}
**2.1 Members and Contributions.** The Members, their addresses, initial capital contributions, and percentage interests ("Percentage Interests") are set forth below and on Schedule A:

|Member|Address|Initial Contribution|Percentage Interest|
|---|---|---|---|
{[list Members]}
|{[FullName]}|{[Address]}|{[Contribution|currency]}|{[Percent]}%|
{[end list]}
|**Total**||**{[sum(Members, "Contribution")|currency]}**|**{[sum(Members, "Percent")]}%**|
{[if sum(Members, "Percent") != 100]}

[DRAFTER WARNING: Percentage Interests total {[sum(Members, "Percent")]}%, not 100%.]
{[end if]}
{[end if]}

**2.2 Additional Contributions.** No {[if count(Members) = 1]}additional contribution is required of the Member{[else]}Member shall be required to make any additional capital contribution{[end if]}.{[if count(Members) > 1]} Additional contributions may be made only with the consent of {[if ManagementType = "Manager-managed"]}the Manager and {[end if]}Members holding at least {[SupermajorityPercent|default:"66.67"]}% of the Percentage Interests, and shall be made pro rata unless the Members agree otherwise.{[end if]}

**2.3 No Interest; No Withdrawal.** No interest shall be paid on capital contributions, and no {[if count(Members) = 1]}withdrawal of capital is permitted{[else]}Member may withdraw any part of its capital contribution{[end if]} except as provided in this Agreement.
{[if count(Members) > 1]}

**2.4 Capital Accounts.** A separate capital account shall be maintained for each Member in accordance with Treasury Regulation § 1.704-1(b)(2)(iv).
{[end if]}

# ARTICLE 3 — ALLOCATIONS AND DISTRIBUTIONS

{[if count(Members) = 1]}
**3.1 Allocations and Distributions.** All profits, losses, and distributions of the Company shall be allocated and distributed to the Member. Distributions shall be made at such times and in such amounts as the {[if ManagementType = "Manager-managed"]}Manager{[else]}Member{[end if]} determines, provided that no distribution shall be made if it would render the Company insolvent or violate the Act.
{[else]}
**3.1 Allocations.** Profits and losses shall be allocated among the Members in proportion to their Percentage Interests{[if TaxClassification = "Partnership"]}, subject to any regulatory allocations required by Section 704(b) of the Internal Revenue Code{[end if]}.

**3.2 Distributions.** Distributions shall be made to the Members in proportion to their Percentage Interests at such times and in such amounts as {[if ManagementType = "Manager-managed"]}the Manager{[else]}Members holding a majority of the Percentage Interests{[end if]} may determine, provided that no distribution shall be made if it would render the Company insolvent or violate the Act.
{[if TaxDistributions]}

**3.3 Tax Distributions.** To the extent cash is available, the Company shall distribute to each Member, no later than April 10 of each year, an amount sufficient to cover the Member's estimated federal and state income tax liability attributable to the Company's income allocated to that Member, computed at an assumed combined rate of {[AssumedTaxRatePercent|default:"40"]}%.
{[end if]}
{[end if]}

# ARTICLE 4 — TAX CLASSIFICATION

{[# One paragraph per TaxClassification option. ]}
{[if TaxClassification = "Disregarded"]}
The Company shall be treated as an entity disregarded as separate from the Member for federal income tax purposes under Treasury Regulation § 301.7701-3. The Member shall report the Company's income and expenses on the Member's own return.
{[else if TaxClassification = "Partnership"]}
The Company shall be treated as a partnership for federal and applicable state income tax purposes. **{[TaxPartnershipRepresentative|default:"The Manager"]}** is designated the "partnership representative" under Section 6223 of the Internal Revenue Code, and shall keep the Members informed of all tax proceedings. Nothing in this Article shall be construed as making the Company a partnership for any other purpose.
{[else if TaxClassification = "S-Corporation"]}
The Company has elected, or shall elect by timely filing IRS Form 2553 (and IRS Form 8832 if required), to be classified as an association taxable as a corporation and to be taxed as an S corporation under Subchapter S of the Internal Revenue Code.{[if count(Members) > 1]} No Member shall take any action, including a Transfer to an ineligible shareholder, that would terminate the S election.{[end if]} Notwithstanding Article 3, distributions shall be made strictly pro rata in accordance with Percentage Interests as required to maintain a single class of stock.
{[else if TaxClassification = "C-Corporation"]}
The Company has elected, or shall elect by timely filing IRS Form 8832, to be classified as an association taxable as a C corporation for federal income tax purposes.
{[else]}
[DRAFTER: Select a TaxClassification — Disregarded, Partnership, S-Corporation, or C-Corporation.]
{[end if]}

# ARTICLE 5 — MANAGEMENT

{[if ManagementType = "Manager-managed"]}
**5.1 Manager-Managed.** The Company is manager-managed. The business and affairs of the Company shall be managed exclusively by {[if count(Managers) = 1]}one Manager (the "Manager"){[else]}{[count(Managers)|words]} Managers acting by majority (individually and collectively, the "Manager"){[end if]}. The initial Manager{[if count(Managers) > 1]}s are{[else]} is{[end if]}: {[list Managers]}{[FullName]}{[_punc]}{[end list]}.

**5.2 Authority.** Except for Major Decisions, the Manager has full authority to bind the Company and to make all decisions concerning its business, including opening bank accounts, hiring employees, entering into contracts, and incurring indebtedness in the ordinary course.

**5.3 Major Decisions.** The following require the approval of {[if count(Members) = 1]}the Member{[else]}Members holding at least {[SupermajorityPercent|default:"66.67"]}% of the Percentage Interests{[end if]}: (a) sale of all or substantially all assets; (b) merger, conversion, or dissolution; (c) admission of a new Member; (d) incurring debt in excess of {[MajorDecisionDebtThreshold|currency|default:"$50,000.00"]}; (e) amendment of this Agreement; and (f) any transaction between the Company and a Manager or Member.

**5.4 Removal and Replacement.** A Manager may be removed, with or without cause, and a replacement appointed, by {[if count(Members) = 1]}the Member{[else]}Members holding a majority of the Percentage Interests{[end if]}.

**5.5 Officers.** The Manager may appoint officers with such titles and duties as the Manager determines.
{[else if ManagementType = "Member-managed"]}
**5.1 Member-Managed.** The Company is member-managed. {[if count(Members) = 1]}The Member has full and exclusive authority to manage the business and affairs of the Company and to bind the Company.{[else]}The business and affairs of the Company shall be managed by the Members. Each Member is an agent of the Company for the purpose of its business in the ordinary course.{[end if]}
{[if count(Members) > 1]}

**5.2 Voting.** Each Member votes in proportion to its Percentage Interest. Except as otherwise provided, decisions require the approval of Members holding a majority of the Percentage Interests.

**5.3 Major Decisions.** The following require the approval of Members holding at least {[SupermajorityPercent|default:"66.67"]}% of the Percentage Interests: (a) sale of all or substantially all assets; (b) merger, conversion, or dissolution; (c) admission of a new Member; (d) incurring debt in excess of {[MajorDecisionDebtThreshold|currency|default:"$50,000.00"]}; (e) amendment of this Agreement; and (f) any transaction between the Company and a Member.

**5.4 Meetings.** Meetings may be called by any Member on five (5) days' notice. Action may be taken without a meeting by written consent of Members holding the Percentage Interests required to approve the action.
{[else]}

**5.2 Officers.** The Member may appoint officers with such titles and duties as the Member determines.
{[end if]}
{[else]}
[DRAFTER: ManagementType must be "Member-managed" or "Manager-managed".]
{[end if]}

**{[if ManagementType = "Manager-managed"]}5.6{[else if count(Members) > 1]}5.5{[else]}5.3{[end if]} Limitation of Liability; Indemnification.** No {[if ManagementType = "Manager-managed"]}Manager or {[end if]}Member shall be liable to the Company or any Member for any act or omission performed in good faith, except for willful misconduct, gross negligence, or knowing violation of law. The Company shall indemnify each {[if ManagementType = "Manager-managed"]}Manager and {[end if]}Member to the fullest extent permitted by the Act.
{[if count(Members) > 1]}

# ARTICLE 6 — TRANSFERS OF MEMBERSHIP INTERESTS

{[# Multi-member only. RestrictTransfers adds ROFR mechanics. ]}
{[if RestrictTransfers]}
**6.1 Restriction.** No Member may sell, assign, pledge, or otherwise transfer (a "Transfer") all or any part of its membership interest without the prior written consent of {[if ManagementType = "Manager-managed"]}the Manager and {[end if]}Members holding at least {[SupermajorityPercent|default:"66.67"]}% of the Percentage Interests held by the other Members, except as provided in Sections 6.2 and 6.3. Any attempted Transfer in violation of this Article is void.

**6.2 Right of First Refusal.** If a Member (the "Selling Member") receives a bona fide written offer from a third party to purchase all or part of its interest that it wishes to accept, the Selling Member shall first deliver written notice to the Company and the other Members stating the price and terms. The other Members shall have {[ROFRDays|default:"30"]} days to elect, pro rata according to their Percentage Interests, to purchase the offered interest on the same terms. If the other Members do not elect to purchase all of the offered interest, the Selling Member may Transfer it to the third party within sixty (60) days thereafter, on terms no more favorable than those stated in the notice, and the transferee shall be admitted as a Member only upon signing a joinder to this Agreement.

**6.3 Permitted Transfers.** A Member may Transfer its interest without consent to a trust for the benefit of the Member or the Member's immediate family, provided the Member retains voting control and the transferee signs a joinder.
{[else]}
**6.1 Transfers.** A Member may sell, assign, or otherwise transfer (a "Transfer") all or any part of its membership interest upon written notice to the other Members. A transferee shall be admitted as a Member upon signing a joinder to this Agreement.
{[end if]}

# ARTICLE 7 — WITHDRAWAL; BUY-SELL

**7.1 Triggering Events.** Upon the death, bankruptcy, incapacity, or withdrawal of a Member (a "Triggering Event"), the Company and then the remaining Members shall have the option, exercisable within ninety (90) days, to purchase the affected Member's interest.

**7.2 Purchase Price.** The purchase price shall be the fair market value of the interest as agreed by the parties or, failing agreement within thirty (30) days, as determined by an independent appraiser selected by the remaining Members{[if BuyoutDiscount > 0]}, less a {[BuyoutDiscount]}% discount for lack of marketability{[end if]}.

**7.3 Payment.** The purchase price shall be paid {[if BuyoutInstallmentYears > 0]}in equal monthly installments over {[BuyoutInstallmentYears|words]} ({[BuyoutInstallmentYears]}) {[BuyoutInstallmentYears|pluralize:"year","years",true]}, with interest at the applicable federal rate, evidenced by a promissory note{[else]}in cash at closing{[end if]}.
{[end if]}

# ARTICLE {[if count(Members) > 1]}8{[else]}6{[end if]} — DISSOLUTION

The Company shall be dissolved upon (a) the {[if count(Members) = 1]}decision of the Member{[else]}approval of Members holding at least {[SupermajorityPercent|default:"66.67"]}% of the Percentage Interests{[end if]}; (b) the sale of all or substantially all of its assets; or (c) entry of a decree of judicial dissolution. Upon dissolution, the Company's affairs shall be wound up, its assets applied first to creditors and then {[if count(Members) = 1]}to the Member{[else]}to the Members in accordance with their positive capital account balances{[end if]}.

# ARTICLE {[if count(Members) > 1]}9{[else]}7{[end if]} — GENERAL PROVISIONS

**Governing Law.** This Agreement is governed by the laws of the State of {[Company.State]}.

**Entire Agreement; Amendment.** This Agreement is the entire agreement concerning its subject matter and may be amended only by a writing signed by {[if count(Members) = 1]}the Member{[else]}Members holding at least {[SupermajorityPercent|default:"66.67"]}% of the Percentage Interests{[end if]}.

**Separate Entity.** The Company is a separate legal entity. {[if count(Members) = 1]}The Member's{[else]}No Member's{[end if]} liability for the debts of the Company {[if count(Members) = 1]}is limited to the Member's capital contribution{[else]}shall exceed that Member's capital contribution{[end if]}, and the Member{[if count(Members) > 1]}s{[end if]} shall observe formalities sufficient to maintain the separateness of the Company.

**Counterparts.** This Agreement may be signed in counterparts, each of which is an original.

IN WITNESS WHEREOF, the undersigned ha{[if count(Members) = 1]}s{[else]}ve{[end if]} executed this Agreement effective as of the date first written above.
{[list Members]}

**MEMBER:**
{[if IsEntity]}

**{[FullName|upper]}**

By: ______________________________
Name: {[SignerName|default:"______________________"]}
Title: {[SignerTitle|default:"______________________"]}
{[else]}

______________________________
{[FullName]}
{[end if]}
{[if count(Members) > 1]}
Percentage Interest: {[Percent]}%
{[end if]}
{[end list]}
{[if ManagementType = "Manager-managed"]}
{[list Managers]}

**MANAGER:**

______________________________
{[FullName]}
{[end list]}
{[end if]}
{[if count(Members) > 1]}

---

>center **SCHEDULE A — MEMBERS**

>center As of {[EffectiveDate|format:"long"]}

|#|Member|Address|Initial Contribution|Percentage Interest|
|---|---|---|---|---|
{[list Members]}
|{[_index]}|{[FullName]}|{[Address]}|{[Contribution|currency]}|{[Percent]}%|
{[end list]}
{[end if]}
`;

export const sampleAnswers = {
  Company: {
    Name: 'Bluebird Analytics LLC',
    State: 'Delaware',
    StatuteName: 'Limited Liability Company Act',
    FormationDocument: 'Certificate of Formation',
    FormationDate: '2026-06-01',
    Address: { Street: '2711 Centerville Road, Suite 400', City: 'Wilmington', State: 'DE', Zip: '19808' },
    Purpose: 'to develop and license data analytics software and to engage in any lawful business related thereto',
  },
  EffectiveDate: '2026-06-15',
  Members: [
    { FullName: 'Aisha Rahman', Address: '14 Elm Court, Wilmington, DE 19806', Contribution: 60000, Percent: 60, IsEntity: false, SignerName: '', SignerTitle: '' },
    { FullName: 'Marcus Delgado', Address: '88 Harbor View, Philadelphia, PA 19106', Contribution: 30000, Percent: 30, IsEntity: false, SignerName: '', SignerTitle: '' },
    { FullName: 'Tanaka Holdings LLC', Address: '502 Pine Street, Newark, DE 19711', Contribution: 10000, Percent: 10, IsEntity: true, SignerName: 'Yuki Tanaka', SignerTitle: 'Managing Member' },
  ],
  ManagementType: 'Manager-managed',
  Managers: [{ FullName: 'Aisha Rahman' }],
  TaxClassification: 'Partnership',
  TaxPartnershipRepresentative: 'Aisha Rahman',
  TaxDistributions: true,
  AssumedTaxRatePercent: 40,
  SupermajorityPercent: 66.67,
  MajorDecisionDebtThreshold: 50000,
  RestrictTransfers: true,
  ROFRDays: 30,
  BuyoutDiscount: 15,
  BuyoutInstallmentYears: 3,
};

/** Questionnaire overrides (model.variables shape). */
export const model = {
  variables: {
    'Company.Name': { label: 'Company name (exactly as filed)', type: 'text' },
    'Company.State': { label: 'State of organization (full name)', type: 'text' },
    'Company.StatuteName': { label: 'Name of the LLC statute (optional)', type: 'text', required: false, help: 'Defaults to "Limited Liability Company Act".' },
    'Company.FormationDocument': { label: 'Formation document (optional)', type: 'text', required: false, help: 'Defaults to "Articles of Organization"; Delaware uses "Certificate of Formation".' },
    'Company.FormationDate': { label: 'Date of filing', type: 'date' },
    'Company.Address.Street': { label: 'Principal office street', type: 'text' },
    'Company.Address.City': { label: 'Principal office city', type: 'text' },
    'Company.Address.State': { label: 'Principal office state', type: 'text' },
    'Company.Address.Zip': { label: 'Principal office ZIP code', type: 'text' },
    'Company.Purpose': { label: 'Business purpose (optional)', type: 'longtext', required: false },
    EffectiveDate: { label: 'Effective date of this Agreement', type: 'date' },
    Members: { label: 'Members', type: 'list' },
    'Members[].FullName': { label: 'Member name', type: 'text' },
    'Members[].Address': { label: 'Member address', type: 'longtext' },
    'Members[].Contribution': { label: 'Initial capital contribution', type: 'currency' },
    'Members[].Percent': { label: 'Percentage interest (%)', type: 'number' },
    'Members[].IsEntity': { label: 'Is this member an entity (not an individual)?', type: 'boolean' },
    'Members[].SignerName': { label: 'Name of person signing for the entity', type: 'text' },
    'Members[].SignerTitle': { label: "Signer's title", type: 'text' },
    ManagementType: { label: 'Management structure', type: 'selection', options: ['Member-managed', 'Manager-managed'] },
    Managers: { label: 'Managers', type: 'list' },
    'Managers[].FullName': { label: 'Manager name', type: 'text' },
    TaxClassification: { label: 'Federal tax classification', type: 'selection', options: ['Disregarded', 'Partnership', 'S-Corporation', 'C-Corporation'] },
    TaxPartnershipRepresentative: { label: 'Partnership representative (optional)', type: 'text', required: false },
    TaxDistributions: { label: 'Include mandatory tax distributions?', type: 'boolean' },
    AssumedTaxRatePercent: { label: 'Assumed combined tax rate for tax distributions (%)', type: 'number' },
    SupermajorityPercent: { label: 'Supermajority threshold (%)', type: 'number' },
    MajorDecisionDebtThreshold: { label: 'Debt amount requiring member approval', type: 'currency' },
    RestrictTransfers: { label: 'Restrict transfers (consent + right of first refusal)?', type: 'boolean' },
    ROFRDays: { label: 'Right-of-first-refusal election period (days)', type: 'number' },
    BuyoutDiscount: { label: 'Buyout marketability discount (%; 0 for none)', type: 'number' },
    BuyoutInstallmentYears: { label: 'Buyout installment period (years; 0 for cash at closing)', type: 'number' },
  },
};

export default { id, name, description, category, text, sampleAnswers, model };
