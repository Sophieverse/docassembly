/**
 * Non-Disclosure Agreement — mutual vs one-way defined terms, term/survival,
 * governing state, optional non-solicit, DTSA immunity notice for employees.
 */
export const id = 'nda';
export const name = 'Non-Disclosure Agreement';
export const description = 'Mutual or one-way NDA: generic Disclosing/Receiving Party definitions vs named roles, term and survival periods, optional non-solicitation, and the DTSA whistleblower notice when the recipient is an employee.';
export const category = 'Commercial';

export const text = `{[# ============================================================
   NON-DISCLOSURE AGREEMENT
   Key branches:
     IsMutual          -> both parties are "Disclosing Party"/"Receiving Party"
                          depending on context (generic definitions); otherwise
                          Party1 = Disclosing Party, Party2 = Receiving Party by name
     IsEmployee        -> DTSA whistleblower immunity notice (18 U.S.C. § 1833(b))
                          — required to preserve exemplary damages / fees
     IncludeNonSolicit -> non-solicitation section, with SurvivalYears
     TermYears = 0     -> indefinite term
   Section numbers after 7 are computed.
   Layout convention: optional blocks begin with a blank line INSIDE the {[if]}.
   ============================================================ ]}
>title {[if IsMutual]}MUTUAL {[end if]}NON-DISCLOSURE AGREEMENT

This {[if IsMutual]}Mutual {[end if]}Non-Disclosure Agreement (this "Agreement") is entered into as of **{[EffectiveDate|format:"long"]}** (the "Effective Date") between:

**{[Party1.Name]}**, {[if Party1.EntityType]}{[Party1.EntityType|article]} {[Party1.EntityType]} with its principal place of business{[else]}an individual with an address{[end if]} at {[Party1.Address]}{[if IsMutual]} ("{[Party1.ShortName]}"){[else]} (the "Disclosing Party"){[end if]}; and

**{[Party2.Name]}**, {[if Party2.EntityType]}{[Party2.EntityType|article]} {[Party2.EntityType]} with its principal place of business{[else]}an individual with an address{[end if]} at {[Party2.Address]}{[if IsMutual]} ("{[Party2.ShortName]}"){[else]} (the "Receiving Party"){[end if]}.

{[if IsMutual]}
{[Party1.ShortName]} and {[Party2.ShortName]} are each a "Party" and together the "Parties." With respect to any particular item of Confidential Information, the Party disclosing it is the "Disclosing Party" and the Party receiving it is the "Receiving Party."
{[else]}
The Disclosing Party and the Receiving Party are each a "Party" and together the "Parties."
{[end if]}

# 1. Purpose

The Parties wish to {[if IsMutual]}exchange{[else]}have the Disclosing Party share{[end if]} certain confidential information in connection with {[Purpose]} (the "Purpose").{[if IsEmployee]} The Receiving Party is {[if EmploymentStatus = "Prospective"]}a candidate for employment with{[else if EmploymentStatus = "Current"]}employed by{[else]}[DRAFTER: EmploymentStatus must be Prospective or Current]{[end if]} the Disclosing Party, and this Agreement is a condition of {[if EmploymentStatus = "Prospective"]}consideration for{[else]}continued{[end if]} employment.{[end if]}

# 2. Definition of Confidential Information

"Confidential Information" means all non-public information disclosed by {[if IsMutual]}a{[else]}the{[end if]} Disclosing Party to the Receiving Party, whether orally, in writing, or by inspection, that is designated as confidential or that a reasonable person would understand to be confidential given the nature of the information and the circumstances of disclosure, including without limitation: business plans, financial information, customer and supplier lists, pricing, product roadmaps, source code, inventions, trade secrets, and know-how.{[if IncludeAgreementConfidential]} The existence and terms of this Agreement and the fact that the Parties are discussing the Purpose are themselves Confidential Information.{[end if]}

Confidential Information does not include information that the Receiving Party can demonstrate: (a) was publicly available at the time of disclosure or later became publicly available through no fault of the Receiving Party; (b) was rightfully known to the Receiving Party before disclosure without restriction; (c) was rightfully received from a third party without restriction; or (d) was independently developed without use of or reference to the Confidential Information.

# 3. Obligations of the Receiving Party

The Receiving Party shall: (a) use Confidential Information solely for the Purpose; (b) not disclose Confidential Information to any third party except to {[if IsEmployee]}co-workers{[else]}the Receiving Party's employees, officers, advisors, and contractors{[end if]} who need to know it for the Purpose and are bound by confidentiality obligations at least as protective as this Agreement ("Representatives"); (c) protect Confidential Information using at least the same degree of care {[if IsEmployee]}a reasonable person would use{[else]}it uses for its own confidential information{[end if]}, and no less than reasonable care; and (d) promptly notify the Disclosing Party of any unauthorized use or disclosure. The Receiving Party is responsible for any breach by its Representatives.

# 4. Compelled Disclosure

If the Receiving Party is required by law, regulation, or court order to disclose Confidential Information, it shall (to the extent legally permitted) give the Disclosing Party prompt written notice so the Disclosing Party may seek a protective order, and shall disclose only the portion of Confidential Information that is legally required.

# 5. Term

{[if TermYears > 0]}
This Agreement governs disclosures made during the period of {[TermYears|words]} ({[TermYears]}) {[TermYears|pluralize:"year","years",true]} from the Effective Date, unless terminated earlier by either Party on thirty (30) days' written notice.
{[else]}
This Agreement governs disclosures made from the Effective Date until terminated by either Party on thirty (30) days' written notice.
{[end if]}
{[if SurvivalYears > 0]}
The Receiving Party's obligations with respect to Confidential Information survive for {[SurvivalYears|words]} ({[SurvivalYears]}) {[SurvivalYears|pluralize:"year","years",true]} after the expiration or termination of this Agreement; provided that obligations with respect to trade secrets survive for as long as the information remains a trade secret under applicable law.
{[else]}
The Receiving Party's obligations with respect to Confidential Information survive expiration or termination of this Agreement indefinitely, for as long as the information remains confidential.
{[end if]}

# 6. Return or Destruction

Upon the Disclosing Party's written request or upon termination, the Receiving Party shall promptly return or destroy all Confidential Information and certify the same in writing, except that the Receiving Party may retain one archival copy solely for compliance purposes and copies in routine backup systems, which remain subject to this Agreement.

# 7. No License; No Warranty

No license under any patent, copyright, trade secret, or other intellectual property right is granted by this Agreement. Confidential Information is provided "AS IS," without warranty of any kind.
{[if IncludeNonSolicit]}

# 8. Non-Solicitation

{[# Check state enforceability — e.g., California generally voids employee non-solicits. ]}
During the term of this Agreement and for {[NonSolicitMonths|default:"12"]} months thereafter, {[if IsMutual]}neither Party{[else]}the Receiving Party{[end if]} shall, directly or indirectly, solicit for employment or hire any employee of the {[if IsMutual]}other{[else]}Disclosing{[end if]} Party with whom it had contact in connection with the Purpose, without prior written consent. General solicitations not targeted at such employees, and hiring of persons who respond to them, do not violate this section.
{[end if]}
{[if IsEmployee]}

# {[8 + (IncludeNonSolicit ? 1 : 0)]}. Notice of Immunity Under the Defend Trade Secrets Act

{[# 18 U.S.C. § 1833(b)(3): employer must give this notice to recover exemplary damages or attorney's fees from an employee. ]}
Pursuant to 18 U.S.C. § 1833(b), the Receiving Party is hereby notified that an individual shall not be held criminally or civilly liable under any federal or state trade secret law for the disclosure of a trade secret that (a) is made in confidence to a federal, state, or local government official, either directly or indirectly, or to an attorney, solely for the purpose of reporting or investigating a suspected violation of law; or (b) is made in a complaint or other document filed in a lawsuit or other proceeding, if such filing is made under seal. An individual who files a lawsuit for retaliation by an employer for reporting a suspected violation of law may disclose the trade secret to the individual's attorney and use the trade secret information in the court proceeding, if the individual files any document containing the trade secret under seal and does not disclose the trade secret except pursuant to court order.

Nothing in this Agreement prohibits the Receiving Party from reporting possible violations of law to any governmental agency or from making other disclosures protected under whistleblower provisions of applicable law.
{[end if]}

# {[8 + (IncludeNonSolicit ? 1 : 0) + (IsEmployee ? 1 : 0)]}. Remedies

The Receiving Party acknowledges that unauthorized use or disclosure of Confidential Information would cause irreparable harm for which money damages would be inadequate. The Disclosing Party is entitled to seek injunctive relief, without posting bond, in addition to any other remedy.{[if PrevailingPartyFees]} The prevailing Party in any action to enforce this Agreement is entitled to recover its reasonable attorney's fees and costs.{[end if]}

# {[9 + (IncludeNonSolicit ? 1 : 0) + (IsEmployee ? 1 : 0)]}. General

**Governing Law; Venue.** This Agreement is governed by the laws of the State of {[GoverningState]}, without regard to its conflict-of-laws rules. The Parties consent to the exclusive jurisdiction of the state and federal courts located in {[VenueCounty]} County, {[GoverningState]}.

**Entire Agreement.** This Agreement is the entire agreement between the Parties concerning its subject matter and supersedes all prior discussions. It may be amended only in a writing signed by both Parties.

**Assignment.** Neither Party may assign this Agreement without the other Party's written consent, except to a successor in a merger or acquisition of substantially all of its assets.

**Counterparts; Electronic Signatures.** This Agreement may be executed in counterparts and by electronic signature, each of which is deemed an original.

IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.

|**{[Party1.Name|upper]}**|**{[Party2.Name|upper]}**|
|---|---|
|By: ______________________|By: ______________________|
|Name: {[Party1.SignerName|default:Party1.Name]}|Name: {[Party2.SignerName|default:Party2.Name]}|
|{[if Party1.EntityType]}Title: {[Party1.SignerTitle]}{[end if]}|{[if Party2.EntityType]}Title: {[Party2.SignerTitle]}{[end if]}|
|Date: ____________|Date: ____________|
`;

export const sampleAnswers = {
  IsMutual: true,
  EffectiveDate: '2026-09-01',
  Party1: {
    Name: 'Northwind Robotics, Inc.',
    ShortName: 'Northwind',
    EntityType: 'Delaware corporation',
    Address: '400 Innovation Way, Austin, Texas 78701',
    SignerName: 'Grace Halvorsen',
    SignerTitle: 'Chief Operating Officer',
  },
  Party2: {
    Name: 'Sable Vision Labs LLC',
    ShortName: 'Sable',
    EntityType: 'Oregon limited liability company',
    Address: '1600 Pearl Street, Suite 210, Portland, Oregon 97205',
    SignerName: 'Omar Haddad',
    SignerTitle: 'Managing Member',
  },
  Purpose: 'evaluating a potential technology licensing and joint development relationship for warehouse perception systems',
  IsEmployee: false,
  EmploymentStatus: '',
  IncludeAgreementConfidential: true,
  TermYears: 2,
  SurvivalYears: 3,
  IncludeNonSolicit: true,
  NonSolicitMonths: 12,
  PrevailingPartyFees: true,
  GoverningState: 'Texas',
  VenueCounty: 'Travis',
};

/** Questionnaire overrides (model.variables shape). */
export const model = {
  variables: {
    IsMutual: { label: 'Is this a mutual NDA (both sides disclose)?', type: 'boolean' },
    EffectiveDate: { label: 'Effective date', type: 'date' },
    'Party1.Name': { label: 'First party (Disclosing Party if one-way) — legal name', type: 'text' },
    'Party1.EntityType': { label: 'First party entity type (blank if an individual)', type: 'text', required: false, help: 'e.g., "Delaware corporation"' },
    'Party1.Address': { label: 'First party address', type: 'longtext' },
    'Party1.ShortName': { label: 'First party short name (defined term)', type: 'text' },
    'Party1.SignerName': { label: 'First party signer name', type: 'text', required: false },
    'Party1.SignerTitle': { label: 'First party signer title', type: 'text' },
    'Party2.Name': { label: 'Second party (Receiving Party if one-way) — legal name', type: 'text' },
    'Party2.EntityType': { label: 'Second party entity type (blank if an individual)', type: 'text', required: false },
    'Party2.Address': { label: 'Second party address', type: 'longtext' },
    'Party2.ShortName': { label: 'Second party short name (defined term)', type: 'text' },
    'Party2.SignerName': { label: 'Second party signer name', type: 'text', required: false },
    'Party2.SignerTitle': { label: 'Second party signer title', type: 'text' },
    Purpose: { label: 'Purpose of the disclosures', type: 'longtext' },
    IsEmployee: { label: 'Is the Receiving Party an employee or job candidate?', type: 'boolean' },
    EmploymentStatus: { label: 'Employment status', type: 'selection', options: ['Prospective', 'Current'] },
    IncludeAgreementConfidential: { label: 'Treat the existence of this Agreement as confidential?', type: 'boolean' },
    TermYears: { label: 'Term (years; 0 for indefinite)', type: 'number' },
    SurvivalYears: { label: 'Survival period after termination (years; 0 for indefinite)', type: 'number' },
    IncludeNonSolicit: { label: 'Include a non-solicitation clause?', type: 'boolean' },
    NonSolicitMonths: { label: 'Non-solicitation tail (months)', type: 'number' },
    PrevailingPartyFees: { label: 'Include a prevailing-party fee clause?', type: 'boolean' },
    GoverningState: { label: 'Governing law state (full name)', type: 'text' },
    VenueCounty: { label: 'Venue county', type: 'text' },
  },
};

export default { id, name, description, category, text, sampleAnswers, model };
