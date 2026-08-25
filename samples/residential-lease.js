/**
 * Residential Lease — tenants list, currency + dollars, pets, utilities
 * multiselect, guarantor exhibit, lead paint disclosure, late fees.
 */
export const id = 'residential-lease';
export const name = 'Residential Lease Agreement';
export const description = 'Lease with multiple tenants, rent in figures and words, pet clause + deposit, utilities multiselect, late-fee rules, lead-paint disclosure for pre-1978 housing, and a guaranty exhibit after a page break.';
export const category = 'Real Estate';

export const text = `{[# ============================================================
   RESIDENTIAL LEASE
   Key branches:
     count(Tenants) > 1     -> "Tenant" vs "Tenants", joint and several liability
     PetsAllowed            -> pet clause + PetDeposit
     UtilitiesIncluded      -> multiselect; joined with |join:"and"
     LateFeeType            -> "Flat" | "Percent" | "None"
     BuiltBefore1978        -> federal lead-based paint disclosure
     HasGuarantor           -> Exhibit A guaranty after page break
   Section numbers after the lead-paint disclosure are computed.
   Layout convention: optional blocks begin with a blank line INSIDE the {[if]}.
   ============================================================ ]}
>title RESIDENTIAL LEASE AGREEMENT

This Residential Lease Agreement (this "Lease") is made on {[LeaseDate|format:"long"]} between **{[Landlord.FullName]}** ("Landlord"), whose address for notices is {[Landlord.Address]}, and {[list Tenants]}**{[FullName]}**{[_punc]}{[end list]} ({[if count(Tenants) > 1]}collectively and individually, "Tenant"{[else]}"Tenant"{[end if]}).

# 1. Premises

Landlord leases to Tenant the residential premises located at **{[Premises.Street]}{[if Premises.Unit]}, Unit {[Premises.Unit]}{[end if]}, {[Premises.City]}, {[Premises.State]} {[Premises.Zip]}** (the "Premises"){[if Premises.IncludesParking]}, together with {[Premises.ParkingDescription|default:"one assigned parking space"]}{[end if]}. The Premises shall be used solely as a private residence for Tenant{[if count(Occupants) > 0]} and the following additional {[count(Occupants)|pluralize:"occupant","occupants",true]}: {[list Occupants]}{[FullName]}{[_punc]}{[end list]}{[end if]}.

# 2. Term

{[if IsMonthToMonth]}
This Lease begins on {[LeaseStart|format:"long"]} and continues month-to-month until terminated by either party on at least {[NoticeDays|default:"30"]} days' written notice.
{[else]}
This Lease is for a fixed term beginning on **{[LeaseStart|format:"long"]}** and ending on **{[LeaseEnd|format:"long"]}** (the "Term"). {[if AutoRenew]}Unless either party gives written notice of non-renewal at least {[NoticeDays|default:"30"]} days before the end of the Term, this Lease shall continue month-to-month on the same terms.{[else]}If Tenant remains in possession after the Term with Landlord's consent, the tenancy becomes month-to-month at a rent of {[if HoldoverRent > 0]}{[HoldoverRent|currency]}{[else]}{[MonthlyRent|currency]}{[end if]} per month.{[end if]}
{[end if]}

# 3. Rent

Tenant shall pay Landlord monthly rent of **{[MonthlyRent|currency]}** ({[MonthlyRent|dollars]}), in advance, on or before the {[RentDueDay|ordinal|default:"1st"]} day of each month.{[if ProratedFirstMonth > 0]} Rent for the first partial month is prorated to {[ProratedFirstMonth|currency]}.{[end if]} Rent shall be paid by {[PaymentMethod|default:"check, electronic transfer, or such other method as Landlord designates in writing"]}.
{[if count(Tenants) > 1]}

**Joint and several liability.** Each Tenant is jointly and severally liable for the full amount of rent and for all other obligations under this Lease.
{[end if]}

# 4. Late Charges and Returned Payments

{[if LateFeeType = "Flat"]}
If rent is not received within {[LateGraceDays|default:"5"]} days after the due date, Tenant shall pay a late charge of {[LateFeeAmount|currency]}.{[if LateFeeDaily > 0]} An additional {[LateFeeDaily|currency]} accrues for each further day rent remains unpaid, up to a maximum of {[LateFeeMax|currency]}.{[end if]} Late charges are liquidated damages for Landlord's administrative costs and are not a penalty.
{[else if LateFeeType = "Percent"]}
If rent is not received within {[LateGraceDays|default:"5"]} days after the due date, Tenant shall pay a late charge equal to {[LateFeePercent]}% of the monthly rent ({[MonthlyRent * LateFeePercent / 100|currency]}). Late charges are liquidated damages for Landlord's administrative costs and are not a penalty.
{[else if LateFeeType = "None"]}
Landlord does not charge a late fee, but nothing in this section waives Landlord's right to pursue any remedy for unpaid rent.
{[else]}
[DRAFTER: LateFeeType must be Flat, Percent, or None.]
{[end if]}
Tenant shall pay {[ReturnedPaymentFee|currency|default:"$35.00"]} for each returned or dishonored payment.

# 5. Security Deposit

On signing this Lease, Tenant shall deposit **{[SecurityDeposit|currency]}** ({[SecurityDeposit|dollars]}) with Landlord as security for Tenant's performance.{[if DepositInterestBearing]} The deposit will be held in an interest-bearing account and interest paid to Tenant annually as required by law.{[end if]} Within {[DepositReturnDays|default:"30"]} days after Tenant vacates, Landlord shall return the deposit less lawful deductions, with an itemized statement of any deductions. The deposit may not be applied by Tenant as the last month's rent.

# 6. Utilities and Services

{[if count(UtilitiesIncluded) > 0]}
Landlord shall pay for {[UtilitiesIncluded|join:"and"|lower]}. Tenant shall arrange and pay for all other utilities and services{[if count(UtilitiesTenantPays) > 0]}, including {[UtilitiesTenantPays|join:"and"|lower]}{[end if]}.
{[else]}
Tenant shall arrange and pay for all utilities and services to the Premises, including electricity, gas, water, sewer, trash, internet, and cable.
{[end if]}

# 7. Pets

{[if PetsAllowed]}
{[# Pet clause is included only when PetsAllowed. ]}
Tenant may keep {[if count(Pets) > 0]}the following {[count(Pets)|pluralize:"pet","pets",true]} at the Premises: {[list Pets]}{[Description]}{[_punc]}{[end list]}.{[else]}at the Premises only such pets as Landlord approves in writing.{[end if]} No other animals are permitted without Landlord's prior written consent. Tenant shall pay an additional pet deposit of **{[PetDeposit|currency]}**{[if PetRent > 0]} and monthly pet rent of {[PetRent|currency]}{[end if]}. Tenant is responsible for all damage caused by any animal and shall comply with all local licensing and leash laws. Nothing in this section restricts assistance animals to the extent required by fair housing law.
{[else]}
No animals of any kind are permitted at the Premises without Landlord's prior written consent, which may be conditioned on an additional deposit. This restriction does not apply to assistance animals to the extent required by fair housing law.
{[end if]}

# 8. Maintenance and Repairs

Tenant shall keep the Premises clean and sanitary and promptly notify Landlord of any needed repairs. Landlord shall maintain the Premises in habitable condition and make repairs within a reasonable time after notice. Tenant shall pay for repairs required because of the negligence or misuse of Tenant, Tenant's guests, or any animal.{[if TenantMaintainsYard]} Tenant is responsible for routine yard maintenance, including mowing and watering.{[end if]}

# 9. Entry by Landlord

Landlord may enter the Premises upon at least {[EntryNoticeHours|default:"24"]} hours' notice to inspect, make repairs, or show the Premises to prospective tenants or buyers, and without notice in an emergency.

# 10. Assignment and Subletting

Tenant shall not assign this Lease or sublet any part of the Premises{[if ShortTermRentalsBanned]}, including through any short-term rental platform,{[end if]} without Landlord's prior written consent.

# 11. Default

If Tenant fails to pay rent when due or otherwise breaches this Lease, Landlord may terminate this Lease and recover possession as provided by the laws of {[Premises.State]}, in addition to any other remedy. Tenant shall pay Landlord's reasonable attorney's fees and costs in any action to enforce this Lease{[if MutualFees]}, and Landlord shall likewise pay Tenant's reasonable attorney's fees and costs if Tenant prevails{[end if]}.
{[if BuiltBefore1978]}

# 12. Disclosure of Information on Lead-Based Paint and Lead-Based Paint Hazards

{[# Required by 42 U.S.C. § 4852d for housing built before 1978. ]}
**Lead Warning Statement.** Housing built before 1978 may contain lead-based paint. Lead from paint, paint chips, and dust can pose health hazards if not managed properly. Lead exposure is especially harmful to young children and pregnant women. Before renting pre-1978 housing, lessors must disclose the presence of known lead-based paint and/or lead-based paint hazards in the dwelling. Lessees must also receive a federally approved pamphlet on lead poisoning prevention.

**Lessor's Disclosure.** {[if LeadPaintKnown]}Landlord has knowledge of lead-based paint and/or lead-based paint hazards in the Premises: {[LeadPaintDescription|default:"[describe]"]}.{[else]}Landlord has no knowledge of lead-based paint and/or lead-based paint hazards in the Premises.{[end if]} {[if LeadPaintRecords]}Landlord has provided Tenant with all available records and reports pertaining to lead-based paint in the Premises.{[else]}Landlord has no reports or records pertaining to lead-based paint in the Premises.{[end if]}

**Lessee's Acknowledgment.** Tenant has received copies of all information listed above and has received the pamphlet *Protect Your Family From Lead in Your Home*.

Landlord initials: ______{[list Tenants]}   {[FullName|initials]} initials: ______{[end list]}
{[end if]}

# {[12 + (BuiltBefore1978 ? 1 : 0)]}. Additional Terms

{[AdditionalTerms|default:"None."]}

# {[13 + (BuiltBefore1978 ? 1 : 0)]}. Entire Agreement

This Lease{[if HasGuarantor]}, together with Exhibit A,{[end if]} is the entire agreement between the parties. It may be modified only in a writing signed by both parties. This Lease is governed by the laws of the State of {[Premises.State]}.

**LANDLORD:**

______________________________
{[Landlord.FullName]}
Date: ____________
{[list Tenants]}

**TENANT:**

______________________________
{[FullName]}
Date: ____________
{[end list]}
{[if HasGuarantor]}

---

>center **EXHIBIT A — GUARANTY OF LEASE**

{[# Guaranty exhibit rendered only when HasGuarantor. ]}
In consideration of Landlord entering into the foregoing Lease dated {[LeaseDate|format:"long"]} with {[list Tenants]}{[FullName]}{[_punc]}{[end list]} for the Premises at {[Premises.Street]}, {[Premises.City]}, {[Premises.State]}, the undersigned **{[Guarantor.FullName]}** ("Guarantor"), of {[Guarantor.Address]}{[if Guarantor.Relationship]}, being the {[Guarantor.Relationship]} of {[Tenants[0].FullName]}{[end if]}, unconditionally guarantees to Landlord the full and prompt payment of rent and all other sums due under the Lease, and the performance of all of Tenant's obligations, {[if Guarantor.CapAmount > 0]}up to a maximum aggregate liability of {[Guarantor.CapAmount|currency]} ({[Guarantor.CapAmount|dollars]}){[else]}without limitation as to amount{[end if]}.

This is a guaranty of payment and performance, not of collection. Landlord may proceed against Guarantor without first proceeding against Tenant. Guarantor waives notice of acceptance, presentment, demand, and notice of default, and consents to any extension, renewal, or modification of the Lease{[if IsMonthToMonth or AutoRenew]}, including any month-to-month continuation{[end if]}. This Guaranty is governed by the laws of the State of {[Premises.State]}.

**GUARANTOR:**

______________________________
{[Guarantor.FullName]}
Address: {[Guarantor.Address]}
Date: ____________
{[end if]}
`;

export const sampleAnswers = {
  LeaseDate: '2026-08-20',
  Landlord: { FullName: 'Harbor Point Properties, LLC', Address: 'P.O. Box 1187, Portland, Oregon 97207' },
  Tenants: [
    { FullName: 'Nadia Petrov' },
    { FullName: 'Cole Whitaker' },
  ],
  Occupants: [{ FullName: 'Ivy Petrov (minor)' }],
  Premises: {
    Street: '2214 SE Hawthorne Boulevard',
    Unit: '3B',
    City: 'Portland',
    State: 'Oregon',
    Zip: '97214',
    IncludesParking: true,
    ParkingDescription: 'one assigned space (#7) in the rear lot',
  },
  IsMonthToMonth: false,
  LeaseStart: '2026-09-01',
  LeaseEnd: '2027-08-31',
  AutoRenew: true,
  NoticeDays: 30,
  HoldoverRent: 0,
  MonthlyRent: 2450,
  RentDueDay: 1,
  ProratedFirstMonth: 0,
  PaymentMethod: 'electronic transfer to the account designated by Landlord',
  LateFeeType: 'Flat',
  LateGraceDays: 4,
  LateFeeAmount: 75,
  LateFeeDaily: 10,
  LateFeeMax: 200,
  LateFeePercent: 5,
  ReturnedPaymentFee: 35,
  SecurityDeposit: 2450,
  DepositInterestBearing: false,
  DepositReturnDays: 31,
  UtilitiesIncluded: ['Water', 'Sewer', 'Trash'],
  UtilitiesTenantPays: ['Electricity', 'Gas', 'Internet'],
  PetsAllowed: true,
  Pets: [{ Description: 'one neutered male dog, "Biscuit", approx. 35 lbs' }],
  PetDeposit: 400,
  PetRent: 35,
  TenantMaintainsYard: false,
  EntryNoticeHours: 24,
  ShortTermRentalsBanned: true,
  MutualFees: true,
  BuiltBefore1978: true,
  LeadPaintKnown: false,
  LeadPaintDescription: '',
  LeadPaintRecords: false,
  AdditionalTerms: 'No smoking of any kind inside the Premises or within 10 feet of any entrance.',
  HasGuarantor: true,
  Guarantor: { FullName: 'Irina Petrov', Address: '77 Lakeshore Drive, Bend, Oregon 97701', Relationship: 'mother', CapAmount: 14700 },
};

/** Questionnaire overrides (model.variables shape). */
export const model = {
  variables: {
    LeaseDate: { label: 'Date of Lease', type: 'date' },
    'Landlord.FullName': { label: 'Landlord name', type: 'text' },
    'Landlord.Address': { label: 'Landlord address for notices', type: 'longtext' },
    Tenants: { label: 'Tenants', type: 'list' },
    'Tenants[].FullName': { label: 'Tenant full name', type: 'text' },
    Occupants: { label: 'Additional occupants (non-signing)', type: 'list' },
    'Occupants[].FullName': { label: 'Occupant name', type: 'text' },
    'Premises.Street': { label: 'Street address', type: 'text' },
    'Premises.Unit': { label: 'Unit number (optional)', type: 'text', required: false },
    'Premises.City': { label: 'City', type: 'text' },
    'Premises.State': { label: 'State (full name)', type: 'text' },
    'Premises.Zip': { label: 'ZIP code', type: 'text' },
    'Premises.IncludesParking': { label: 'Is parking included?', type: 'boolean' },
    'Premises.ParkingDescription': { label: 'Parking description (optional)', type: 'text', required: false },
    IsMonthToMonth: { label: 'Is this a month-to-month tenancy?', type: 'boolean' },
    LeaseStart: { label: 'Lease start date', type: 'date' },
    LeaseEnd: { label: 'Lease end date', type: 'date' },
    AutoRenew: { label: 'Does the Lease renew month-to-month automatically?', type: 'boolean' },
    NoticeDays: { label: 'Notice period (days)', type: 'number' },
    HoldoverRent: { label: 'Holdover rent (0 = same as monthly rent)', type: 'currency' },
    MonthlyRent: { label: 'Monthly rent', type: 'currency' },
    RentDueDay: { label: 'Day of month rent is due', type: 'number' },
    ProratedFirstMonth: { label: 'Prorated first-month rent (0 if none)', type: 'currency' },
    PaymentMethod: { label: 'Payment method (optional)', type: 'text', required: false },
    LateFeeType: { label: 'Late fee', type: 'selection', options: ['Flat', 'Percent', 'None'] },
    LateGraceDays: { label: 'Grace period (days)', type: 'number' },
    LateFeeAmount: { label: 'Flat late charge', type: 'currency' },
    LateFeeDaily: { label: 'Additional daily late charge (0 if none)', type: 'currency' },
    LateFeeMax: { label: 'Maximum late charge', type: 'currency' },
    LateFeePercent: { label: 'Late charge (% of rent)', type: 'number' },
    ReturnedPaymentFee: { label: 'Returned payment fee', type: 'currency' },
    SecurityDeposit: { label: 'Security deposit', type: 'currency' },
    DepositInterestBearing: { label: 'Is the deposit held in an interest-bearing account?', type: 'boolean' },
    DepositReturnDays: { label: 'Days to return deposit after move-out', type: 'number' },
    UtilitiesIncluded: { label: 'Utilities paid by Landlord', type: 'multiselect', options: ['Water', 'Sewer', 'Trash', 'Gas', 'Electricity', 'Internet', 'Cable'] },
    UtilitiesTenantPays: { label: 'Utilities paid by Tenant', type: 'multiselect', options: ['Water', 'Sewer', 'Trash', 'Gas', 'Electricity', 'Internet', 'Cable'] },
    PetsAllowed: { label: 'Are pets allowed?', type: 'boolean' },
    Pets: { label: 'Approved pets', type: 'list' },
    'Pets[].Description': { label: 'Pet description (type, name, weight)', type: 'text' },
    PetDeposit: { label: 'Pet deposit', type: 'currency' },
    PetRent: { label: 'Monthly pet rent (0 if none)', type: 'currency' },
    TenantMaintainsYard: { label: 'Is Tenant responsible for yard maintenance?', type: 'boolean' },
    EntryNoticeHours: { label: 'Entry notice (hours)', type: 'number' },
    ShortTermRentalsBanned: { label: 'Expressly prohibit short-term rentals?', type: 'boolean' },
    MutualFees: { label: 'Make the attorney-fee clause mutual?', type: 'boolean' },
    BuiltBefore1978: { label: 'Was the building built before 1978?', type: 'boolean', help: 'Triggers the federal lead-based paint disclosure.' },
    LeadPaintKnown: { label: 'Does Landlord know of lead-based paint or hazards?', type: 'boolean' },
    LeadPaintDescription: { label: 'Describe the known lead-based paint or hazards', type: 'longtext' },
    LeadPaintRecords: { label: 'Does Landlord have lead-paint records or reports?', type: 'boolean' },
    AdditionalTerms: { label: 'Additional terms (optional)', type: 'longtext', required: false },
    HasGuarantor: { label: 'Is there a guarantor?', type: 'boolean' },
    'Guarantor.FullName': { label: 'Guarantor full name', type: 'text' },
    'Guarantor.Address': { label: 'Guarantor address', type: 'longtext' },
    'Guarantor.Relationship': { label: 'Relationship to first tenant (optional)', type: 'text', required: false },
    'Guarantor.CapAmount': { label: 'Guaranty cap (0 for unlimited)', type: 'currency' },
  },
};

export default { id, name, description, category, text, sampleAnswers, model };
