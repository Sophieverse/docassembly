/**
 * Last Will and Testament — pronouns by gender, spouse survivorship, minor-child
 * guardianship (computed via yearsBetween), per stirpes vs per capita residuary,
 * specific gifts, executor chain, no-contest, pet trust, self-proving affidavit.
 */
export const id = 'last-will';
export const name = 'Last Will and Testament';
export const description = 'Simple will with spouse/survivorship provisions, guardianship only when a child is a minor, per stirpes vs per capita residuary, specific gifts, pet trust, and self-proving affidavit.';
export const category = 'Estate Planning';

export const text = `{[# ============================================================
   LAST WILL AND TESTAMENT
   Key branches:
     Testator.Gender (Male | Female | Nonbinary) -> pronouns via |pronoun
     IsMarried                    -> spouse article + 30-day survivorship
     any(Children, "IsMinor")     -> guardianship article  (IsMinor is computed
                                     from DOB: yearsBetween(DOB, today()) < 18)
     DistributionMethod           -> "Per Stirpes" | "Per Capita" residuary variants
     count(SpecificGifts) > 0     -> specific gifts article
     NoContest, PetTrust          -> optional articles
   Article numbering adapts to which articles are included.
   ============================================================ ]}
>title LAST WILL AND TESTAMENT
>title OF
>title {[Testator.FullName|upper]}

I, **{[Testator.FullName]}**, a resident of {[Testator.County]} County, {[Testator.State]}, being of sound mind and memory and not acting under duress, fraud, or undue influence, declare this to be my Last Will and Testament. I revoke all wills and codicils previously made by me.

# ARTICLE I — FAMILY

{[if IsMarried]}
I am married to **{[Spouse.FullName]}** (my "spouse"), and all references in this Will to my spouse are to {[Spouse.Gender|pronoun:"object"]}.
{[else]}
I am not currently married.
{[end if]}
{[if count(Children) > 0]}
I have {[count(Children)|words]} {[count(Children)|pluralize:"child","children",true]} now living: {[list Children]}{[FullName]}, born {[DOB|format:"long"]}{[_punc]}{[end list]}. All references in this Will to my "children" are to the children named above and any children hereafter born to or adopted by me.
{[else]}
I have no children, living or deceased.
{[end if]}

# ARTICLE II — PAYMENT OF DEBTS AND EXPENSES

I direct my Executor to pay from my residuary estate all of my legally enforceable debts, the expenses of my last illness and funeral, and the costs of administering my estate, as soon after my death as is practicable. My Executor may, in {[Executor.Gender|pronoun:"possessiveadj"]} discretion, continue paying any debt secured by real property in installments rather than accelerating it.

{[if count(SpecificGifts) > 0]}
# ARTICLE III — SPECIFIC GIFTS

I make the following specific gifts. If a named beneficiary does not survive me{[if IsMarried]} by thirty (30) days{[end if]}, the gift shall lapse and become part of my residuary estate unless otherwise stated.
{[list SpecificGifts]}
{[_index]}. To **{[Beneficiary]}**{[if Relationship]}, my {[Relationship]},{[end if]} {[Description]}{[if Alternate]}; if {[Beneficiary]} does not survive me, then to {[Alternate]}{[end if]}.
{[end list]}
{[end if]}

{[if PetTrust]}
# ARTICLE {[if count(SpecificGifts) > 0]}IV{[else]}III{[end if]} — PET TRUST

{[# Pet trust article. Most states now authorize these by statute (e.g., UPC § 2-907). ]}
If any pet animal of mine is living at my death, I give such animal{[if PetCaretaker]} to **{[PetCaretaker]}**, whom I request to care for the animal for the remainder of its life{[end if]}, together with the sum of {[PetTrustAmount|currency]} to be held in trust for the care of such animal. The trustee shall apply the trust funds to the animal's food, shelter, veterinary care, and comfort. Upon the death of the last surviving animal, any remaining funds shall pass to my residuary estate. If {[PetCaretaker|default:"the named caretaker"]} is unable or unwilling to serve, my Executor shall select a suitable caretaker.
{[end if]}

# ARTICLE {[if count(SpecificGifts) > 0 and PetTrust]}V{[else if count(SpecificGifts) > 0 or PetTrust]}IV{[else]}III{[end if]} — RESIDUARY ESTATE

I give all the rest, residue, and remainder of my estate, real and personal, wherever situated, including any lapsed or failed gifts (my "residuary estate"), as follows:

{[if IsMarried]}
**A. To my spouse.** If my spouse, {[Spouse.FullName]}, survives me by thirty (30) days, I give my entire residuary estate to {[Spouse.Gender|pronoun:"object"]}, outright and free of trust.

**B. If my spouse does not survive me.** If my spouse does not survive me by thirty (30) days, then I give my residuary estate
{[else]}
**A. Disposition.** I give my residuary estate
{[end if]}
{[# --- Distribution method variants --- ]}
{[if DistributionMethod = "Per Stirpes"]}
to my descendants who survive me, **per stirpes**. Under this method, my estate is divided into as many equal shares as there are children of mine who survive me and children of mine who predecease me leaving descendants who survive me; the share of a deceased child passes to that child's descendants by right of representation.
{[else if DistributionMethod = "Per Capita"]}
to my descendants who survive me, **per capita at each generation**. Under this method, my estate is divided into equal shares among the members of the nearest generation with a surviving member; the shares of deceased members of that generation are combined and divided equally among the surviving members of the next generation, so that persons of the same degree of kinship always take equally.
{[else]}
in equal shares to {[list ResiduaryBeneficiaries]}{[FullName]}{[_punc]}{[end list]}. If any of them does not survive me, that beneficiary's share shall pass to the others in equal shares.
{[end if]}

{[if count(Children) = 0 and DistributionMethod != "Named Beneficiaries"]}
If no descendant of mine survives me, my residuary estate shall pass to my heirs at law determined under the laws of {[Testator.State]} as if I had died intestate at that time.
{[end if]}

{[if any(Children, "IsMinor")]}
# ARTICLE {[if count(SpecificGifts) > 0 and PetTrust]}VI{[else if count(SpecificGifts) > 0 or PetTrust]}V{[else]}IV{[end if]} — GUARDIAN OF MINOR CHILDREN

{[# Rendered only when at least one child is under 18 today. ]}
If at my death any child of mine is a minor{[if IsMarried]} and my spouse does not survive me or is unable to act{[end if]}, I nominate **{[Guardian.FullName]}**{[if Guardian.Relationship]}, my {[Guardian.Relationship]},{[end if]} as guardian of the person and estate of each such minor child. If {[Guardian.FullName]} is unable or unwilling to serve, I nominate **{[AlternateGuardian.FullName]}** to serve instead. No bond shall be required of any guardian named in this Will.

Minor children as of the date of this Will: {[list Children|filter: IsMinor]}{[FullName]} (age {[yearsBetween(DOB, today())]}){[_punc]}{[end list]}.

**Property of minors.** Any property passing under this Will to a person under the age of {[TrustAgeOfDistribution|default:"21"]} shall be held by my Executor, as custodian under the {[Testator.State]} Uniform Transfers to Minors Act, until that person reaches such age.
{[end if]}

# ARTICLE {[if count(SpecificGifts) > 0 and PetTrust and any(Children, "IsMinor")]}VII{[else if (count(SpecificGifts) > 0 and PetTrust) or (count(SpecificGifts) > 0 and any(Children, "IsMinor")) or (PetTrust and any(Children, "IsMinor"))]}VI{[else if count(SpecificGifts) > 0 or PetTrust or any(Children, "IsMinor")]}V{[else]}IV{[end if]} — EXECUTOR

I nominate **{[Executor.FullName]}**{[if Executor.Relationship]}, my {[Executor.Relationship]},{[end if]} as Executor of this Will. If {[Executor.Gender|pronoun:"subject"]} is unable or unwilling to serve, or ceases to serve, I nominate the following, in the order listed, to serve as successor Executor: {[list AlternateExecutors]}{[FullName]}{[_punc]}{[end list]}.

No Executor named in this Will shall be required to post bond or other security in any jurisdiction. My Executor shall have all powers granted to executors under the laws of {[Testator.State]}, including the power to sell, lease, or encumber real and personal property without court order{[if IndependentAdministration]}, and I request that my estate be administered with as little court supervision as the law permits{[end if]}.

{[if NoContest]}
# NO-CONTEST CLAUSE

{[# Enforceability varies by state; Florida and Indiana do not enforce these. ]}
If any beneficiary under this Will, directly or indirectly, contests or attacks this Will or any of its provisions without probable cause, any share or interest given to that beneficiary is revoked and shall be disposed of as if that beneficiary had predeceased me without descendants.
{[end if]}

# GENERAL PROVISIONS

**Survivorship.** Except as otherwise provided, a beneficiary must survive me by thirty (30) days to take under this Will.

**Definitions.** The terms "child," "children," and "descendants" include persons adopted before age eighteen. The masculine, feminine, and neuter genders each include the others, and the singular includes the plural.

**Severability.** If any provision of this Will is held invalid, the remaining provisions shall continue in full force.

IN WITNESS WHEREOF, I have signed this Will on {[SigningDate|format:"long"]}, at {[SigningCity]}, {[Testator.State]}.

______________________________
{[Testator.FullName]}, Testator

# ATTESTATION

The foregoing instrument, consisting of this and the preceding pages, was on the date above signed and declared by {[Testator.FullName]} to be {[Testator.Gender|pronoun:"possessiveadj"]} Last Will and Testament, in our presence, and we, at {[Testator.Gender|pronoun:"possessiveadj"]} request and in {[Testator.Gender|pronoun:"possessiveadj"]} presence and in the presence of each other, have signed our names as witnesses. Each of us is over eighteen years of age and is not a beneficiary under this Will.
{[list Witnesses]}

______________________________
{[FullName]}, Witness
residing at {[Address]}
{[end list]}

---

>center **SELF-PROVING AFFIDAVIT**

STATE OF {[Testator.State|upper]}
COUNTY OF {[Testator.County|upper]}

We, {[Testator.FullName]}, {[list Witnesses]}{[FullName]}{[_punc]}{[end list]}, the testator and the witnesses, respectively, whose names are signed to the attached instrument, being first duly sworn, declare to the undersigned officer that the testator signed the instrument as {[Testator.Gender|pronoun:"possessiveadj"]} will, that {[Testator.Gender|pronoun:"subject"]} signed willingly, that {[Testator.Gender|pronoun:"subject"]} executed it as {[Testator.Gender|pronoun:"possessiveadj"]} free and voluntary act for the purposes therein expressed, and that each of the witnesses, in the presence and at the request of the testator, signed the will as witness, and that to the best of their knowledge the testator was at that time eighteen years of age or older, of sound mind, and under no constraint or undue influence.

______________________________
{[Testator.FullName]}, Testator
{[list Witnesses]}

______________________________
{[FullName]}, Witness
{[end list]}

Subscribed and sworn to before me by {[Testator.FullName]}, the testator, and by {[list Witnesses]}{[FullName]}{[_punc]}{[end list]}, the witnesses, on {[SigningDate|format:"long"]}.

______________________________
Notary Public, State of {[Testator.State]}
My commission expires: ____________
`;

export const sampleAnswers = {
  Testator: { FullName: 'Eleanor Marie Vance', Gender: 'Female', County: 'Travis', State: 'Texas' },
  IsMarried: true,
  Spouse: { FullName: 'Thomas Reid Vance', Gender: 'Male' },
  Children: [
    { FullName: 'Clara Vance', DOB: '2004-05-19', IsMinor: false },
    { FullName: 'Owen Vance', DOB: '2013-09-02', IsMinor: true },
  ],
  DistributionMethod: 'Per Stirpes',
  ResiduaryBeneficiaries: [],
  SpecificGifts: [
    { Beneficiary: 'Clara Vance', Relationship: 'daughter', Description: 'my grandmother\'s pearl necklace and all of my jewelry', Alternate: 'Owen Vance' },
    { Beneficiary: 'Austin Public Library Foundation', Relationship: '', Description: 'the sum of Five Thousand Dollars ($5,000)', Alternate: '' },
  ],
  PetTrust: true,
  PetCaretaker: 'Margaret Lin',
  PetTrustAmount: 8000,
  Guardian: { FullName: 'Margaret Lin', Relationship: 'sister' },
  AlternateGuardian: { FullName: 'Robert Vance' },
  TrustAgeOfDistribution: 21,
  Executor: { FullName: 'Thomas Reid Vance', Gender: 'Male', Relationship: 'spouse' },
  AlternateExecutors: [{ FullName: 'Margaret Lin' }, { FullName: 'Clara Vance' }],
  IndependentAdministration: true,
  NoContest: true,
  SigningDate: '2026-09-15',
  SigningCity: 'Austin',
  Witnesses: [
    { FullName: 'Samuel Ortiz', Address: '312 Pecan Drive, Austin, Texas 78701' },
    { FullName: 'Dana Whitfield', Address: '9 Barton Springs Road, Austin, Texas 78704' },
  ],
};

export default { id, name, description, category, text, sampleAnswers };
