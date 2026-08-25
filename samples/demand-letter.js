/**
 * Demand letter — claim-type fact variants, itemized damages with sum,
 * computed deadline via addDays(today(), DeadlineDays), statute citation, tone.
 */
export const id = 'demand-letter';
export const name = 'Demand Letter';
export const description = 'Pre-suit demand letter with fact paragraphs that vary by ClaimType, an itemized damages table totaled with sum(), a response deadline computed from today(), optional statutory citations, and Firm vs Cordial tone.';
export const category = 'Litigation';

export const text = `{[# ============================================================
   DEMAND LETTER
   Key branches:
     ClaimType  -> "Unpaid Invoice" | "Security Deposit" | "Breach of Contract" | "Personal Injury"
                   (fact paragraph + statute block vary)
     Tone       -> "Firm" | "Cordial" (opening, closing, and threat language)
     IncludeStatute -> statutory citation block
     Damages list  -> table + sum(Damages, "Amount") + |dollars
     Deadline   -> addDays(today(), DeadlineDays)|format:"long"
     Days since move-out -> dateDiffDays(MoveOutDate, today()) (computed, not asked)
     SentViaCertifiedMail -> delivery line
   The letter is dated today() at assembly time.
   Layout convention: optional blocks begin with a blank line INSIDE the {[if]}.
   ============================================================ ]}
>right {[Sender.Name]}
>right {[Sender.Address.Street]}
>right {[Sender.Address.City]}, {[Sender.Address.State]} {[Sender.Address.Zip]}
>right {[Sender.Email]}

{[today()|format:"long"]}

{[if SentViaCertifiedMail]}
**VIA CERTIFIED MAIL, RETURN RECEIPT REQUESTED{[if Recipient.Email]}, AND EMAIL ({[Recipient.Email]}){[end if]}**
{[else]}
**VIA {[DeliveryMethod|default:"FIRST-CLASS MAIL"|upper]}{[if Recipient.Email]} AND EMAIL ({[Recipient.Email]}){[end if]}**
{[end if]}

{[Recipient.Name]}
{[if Recipient.Attention]}Attn: {[Recipient.Attention]}
{[end if]}{[Recipient.Address.Street]}
{[Recipient.Address.City]}, {[Recipient.Address.State]} {[Recipient.Address.Zip]}

**Re: {[if ClaimType = "Unpaid Invoice"]}Demand for Payment — {[count(Damages)|pluralize:"Invoice","Invoices",true]} {[InvoiceNumbers]}{[else if ClaimType = "Security Deposit"]}Demand for Return of Security Deposit — {[PropertyAddress]}{[else if ClaimType = "Breach of Contract"]}Notice of Breach and Demand — {[ContractName]}{[else if ClaimType = "Personal Injury"]}Claim for Damages — Incident of {[IncidentDate|format:"long"]}{[else]}Demand for Payment{[end if]}**
{[if ClaimType = "Personal Injury" and ClaimNumber]}
**Your Claim No.: {[ClaimNumber]}**
{[end if]}

{[if Tone = "Cordial"]}
Dear {[Recipient.Salutation|default:Recipient.Name]},

I hope this letter finds you well. I am writing{[if OnBehalfOfClient]} on behalf of my client, {[ClientName]},{[end if]} to resolve an outstanding matter before it becomes necessary to involve the courts. I would much prefer to reach an amicable resolution, and I am confident we can.
{[else if Tone = "Firm"]}
{[Recipient.Salutation|default:Recipient.Name]}:

{[if OnBehalfOfClient]}This firm represents {[ClientName]} in connection with the matter described below. Please direct all further communications regarding this matter to the undersigned.{[else]}This letter is a formal demand regarding the matter described below.{[end if]}
{[else]}
[DRAFTER: Tone must be Firm or Cordial.]
{[end if]}

# Background

{[# --- Fact paragraph varies by ClaimType --- ]}
{[if ClaimType = "Unpaid Invoice"]}
{[if OnBehalfOfClient]}{[ClientName]}{[else]}I{[end if]} provided {[ServicesDescription]} to {[Recipient.Name]} pursuant to {[if ContractName]}the {[ContractName]}{[else]}your order{[end if]}. {[count(Damages)|pluralize:"An invoice was","Invoices were",true]} issued in the ordinary course, with payment due within {[PaymentTermsDays|default:"30"]} days. As of the date of this letter, the {[count(Damages)|pluralize:"invoice remains","invoices remain",true]} unpaid despite {[PriorAttempts|default:"repeated"]} reminders. No dispute regarding the quality or delivery of the goods or services has been raised.
{[else if ClaimType = "Security Deposit"]}
{[if OnBehalfOfClient]}{[ClientName]}{[else]}I{[end if]} rented the premises at {[PropertyAddress]} from you under a lease beginning {[LeaseStart|format:"long"]} and vacated on {[MoveOutDate|format:"long"]}, leaving the premises in clean condition, reasonable wear and tear excepted, and providing a forwarding address. A security deposit of {[DepositAmount|currency]} was paid at the start of the tenancy. It has now been {[dateDiffDays(MoveOutDate, today())]} days since move-out. {[if ReceivedItemization]}The itemized statement you provided does not justify the deductions taken, as detailed below.{[else]}No itemized statement of deductions and no refund has been received, in violation of the statutory deadline.{[end if]}
{[else if ClaimType = "Breach of Contract"]}
On {[ContractDate|format:"long"]}, {[if OnBehalfOfClient]}{[ClientName]}{[else]}I{[end if]} and {[Recipient.Name]} entered into the {[ContractName]} (the "Agreement"). Under the Agreement, {[Recipient.Name]} was obligated to {[RecipientObligation]}. {[Recipient.Name]} has failed to perform: {[BreachDescription]} {[if OnBehalfOfClient]}{[ClientName]} has{[else]}I have{[end if]} fully performed all obligations under the Agreement{[if NoticeOfBreachDate]} and provided written notice of the breach on {[NoticeOfBreachDate|format:"long"]}, which went unremedied within the cure period{[end if]}.
{[else if ClaimType = "Personal Injury"]}
On {[IncidentDate|format:"long"]}, at {[IncidentLocation]}, {[if OnBehalfOfClient]}{[ClientName]}{[else]}I{[end if]} sustained injuries when {[IncidentDescription]} The incident was caused by {[if OnBehalfOfClient]}{[Recipient.Name|possessive]}{[else]}your{[end if]} negligence, including {[NegligenceDescription]}. Injuries sustained include {[InjuryDescription]}, requiring medical treatment{[if TreatmentOngoing]} that is ongoing{[end if]}.
{[else]}
[DRAFTER: ClaimType "{[ClaimType]}" not recognized.]
{[end if]}

# Amount Demanded

The following amounts are due:

|#|Description|Amount|
|---|---|---|
{[list Damages]}
|{[_index]}|{[Description]}|{[Amount|currency]}|
{[end list]}
|**Total**||**{[sum(Damages, "Amount")|currency]}**|

**Total demanded: {[sum(Damages, "Amount")|currency]} ({[sum(Damages, "Amount")|dollars]}).**
{[if InterestRate > 0]}

Interest continues to accrue at {[InterestRate]}% per annum{[if InterestFromDate]} from {[InterestFromDate|format:"long"]}{[end if]} until paid in full.
{[end if]}
{[if IncludeStatute]}

# Applicable Law

{[# Statute block; the citation set follows ClaimType. Verify current statute text for the jurisdiction. ]}
{[if ClaimType = "Security Deposit"]}
Under {[Statute.Citation|default:"the applicable state security deposit statute"]}, a landlord must return the security deposit, together with an itemized statement of any lawful deductions, within {[Statute.DeadlineDays|default:"30"]} days after the tenant vacates. A landlord who fails to comply in bad faith {[if Statute.MultiplierText]}is liable for {[Statute.MultiplierText]}{[else]}is liable for statutory penalties{[end if]}, plus attorney's fees and costs.
{[else if ClaimType = "Unpaid Invoice"]}
Under {[Statute.Citation|default:"the applicable state prompt-payment and interest statutes"]}, unpaid amounts accrue prejudgment interest{[if Statute.InterestRateText]} at {[Statute.InterestRateText]}{[end if]}, and {[if Statute.FeesAvailable]}the prevailing party is entitled to reasonable attorney's fees{[else]}court costs are recoverable{[end if]} in an action to collect on an account.
{[else if ClaimType = "Breach of Contract"]}
{[if OnBehalfOfClient]}{[ClientName]} is{[else]}I am{[end if]} entitled to recover all damages that are the natural and proximate result of the breach, including consequential damages within the parties' contemplation at contracting.{[if Statute.Citation]} See {[Statute.Citation]}.{[end if]}{[if Statute.FeesAvailable]} The Agreement provides for recovery of attorney's fees by the prevailing party.{[end if]}
{[else if ClaimType = "Personal Injury"]}
Under {[Statute.Citation|default:"applicable state negligence law"]}, a party who breaches a duty of care is liable for the resulting medical expenses, lost earnings, and pain and suffering.{[if Statute.LimitationsYears > 0]} The applicable limitations period is {[Statute.LimitationsYears|words]} ({[Statute.LimitationsYears]}) {[Statute.LimitationsYears|pluralize:"year","years",true]} from the date of injury.{[end if]}
{[end if]}
{[end if]}

# Demand

{[# Deadline is computed from today's date at assembly time. ]}
{[if Tone = "Cordial"]}
I ask that you {[if ClaimType = "Security Deposit"]}return the amount above{[else]}remit payment of {[sum(Damages, "Amount")|currency]}{[end if]} no later than **{[addDays(today(), DeadlineDays)|format:"long"]}** ({[DeadlineDays|words]} days from the date of this letter). Payment may be made by {[PaymentInstructions|default:"check payable as indicated above"]}. If you believe any part of this demand is mistaken, please contact me before that date so we can discuss it; I am open to a reasonable payment arrangement.

If I do not hear from you by that date, I will have no choice but to pursue the remedies available to {[if OnBehalfOfClient]}my client{[else]}me{[end if]}, including filing suit, which would add court costs{[if Statute.FeesAvailable]} and attorney's fees{[end if]} to the amount owed. I sincerely hope that will not be necessary.

Thank you for your prompt attention to this matter.

Kind regards,
{[else]}
Demand is hereby made that you {[if ClaimType = "Security Deposit"]}return the full amount above{[else]}pay {[sum(Damages, "Amount")|currency]}{[end if]} on or before **{[addDays(today(), DeadlineDays)|format:"long"]}** ({[DeadlineDays|words]} days from the date of this letter). Payment shall be made by {[PaymentInstructions|default:"certified funds delivered to the address above"]}.

If payment in full is not received by that date, {[if OnBehalfOfClient]}{[ClientName]} will{[else]}I will{[end if]} file suit without further notice and seek all available relief, including the principal amount, prejudgment interest, {[if Statute.MultiplierText]}statutory penalties, {[end if]}court costs{[if Statute.FeesAvailable]}, and attorney's fees{[end if]}.{[if ClaimType = "Personal Injury"]} Please forward this letter to your liability insurance carrier immediately.{[end if]} You are further notified to preserve all documents, communications, and electronically stored information relating to this matter.

This letter is written for settlement purposes and without waiver of any rights or remedies, all of which are expressly reserved.
{[end if]}

______________________________
{[Sender.Name]}
{[if Sender.Title]}{[Sender.Title]}
{[end if]}{[if Sender.Firm]}{[Sender.Firm]}
{[end if]}{[Sender.Phone]}
{[if OnBehalfOfClient]}
cc: {[ClientName]}
{[end if]}
`;

export const sampleAnswers = {
  Sender: {
    Name: 'Rachel Nguyen',
    Title: 'Attorney at Law',
    Firm: 'Nguyen Legal PLLC',
    Address: { Street: '350 Fifth Avenue, Suite 2210', City: 'New York', State: 'NY', Zip: '10118' },
    Email: 'rnguyen@nguyenlegal.example',
    Phone: '(212) 555-0177',
  },
  Recipient: {
    Name: 'Crestline Property Management, Inc.',
    Attention: 'Deposits Department',
    Salutation: 'Dear Sir or Madam',
    Address: { Street: '900 Court Street', City: 'Brooklyn', State: 'NY', Zip: '11231' },
    Email: 'deposits@crestlinepm.example',
  },
  SentViaCertifiedMail: true,
  DeliveryMethod: 'First-Class Mail',
  OnBehalfOfClient: true,
  ClientName: 'Priya Desai',
  ClaimType: 'Security Deposit',
  Tone: 'Firm',
  PropertyAddress: '145 Carroll Street, Apt. 4R, Brooklyn, NY 11231',
  LeaseStart: '2024-07-01',
  MoveOutDate: '2026-06-30',
  DepositAmount: 3200,
  ReceivedItemization: false,
  InvoiceNumbers: '',
  ServicesDescription: '',
  ContractName: '',
  ContractDate: '',
  RecipientObligation: '',
  BreachDescription: '',
  NoticeOfBreachDate: '',
  PaymentTermsDays: 30,
  PriorAttempts: 'three written',
  IncidentDate: '',
  IncidentLocation: '',
  IncidentDescription: '',
  NegligenceDescription: '',
  InjuryDescription: '',
  TreatmentOngoing: false,
  ClaimNumber: '',
  Damages: [
    { Description: 'Security deposit wrongfully withheld', Amount: 3200 },
    { Description: 'Statutory interest on deposit (2 years at 1%)', Amount: 64 },
  ],
  InterestRate: 9,
  InterestFromDate: '2026-07-14',
  IncludeStatute: true,
  Statute: {
    Citation: 'N.Y. Gen. Oblig. Law § 7-108(1-a)',
    DeadlineDays: 14,
    MultiplierText: 'damages of up to twice the amount of the deposit',
    InterestRateText: '',
    FeesAvailable: false,
    LimitationsYears: 0,
  },
  DeadlineDays: 14,
  PaymentInstructions: 'check payable to "Nguyen Legal PLLC, as attorney for Priya Desai" delivered to the address above',
};

/** Questionnaire overrides (model.variables shape). */
export const model = {
  variables: {
    'Sender.Name': { label: 'Sender name', type: 'text' },
    'Sender.Title': { label: 'Sender title (optional)', type: 'text', required: false },
    'Sender.Firm': { label: 'Firm name (optional)', type: 'text', required: false },
    'Sender.Address.Street': { label: 'Sender street address', type: 'text' },
    'Sender.Address.City': { label: 'Sender city', type: 'text' },
    'Sender.Address.State': { label: 'Sender state', type: 'text' },
    'Sender.Address.Zip': { label: 'Sender ZIP code', type: 'text' },
    'Sender.Email': { label: 'Sender email', type: 'email' },
    'Sender.Phone': { label: 'Sender telephone', type: 'phone' },
    'Recipient.Name': { label: 'Recipient name', type: 'text' },
    'Recipient.Attention': { label: 'Attention line (optional)', type: 'text', required: false },
    'Recipient.Salutation': { label: 'Salutation (e.g., Dear Mr. Smith)', type: 'text', required: false },
    'Recipient.Address.Street': { label: 'Recipient street address', type: 'text' },
    'Recipient.Address.City': { label: 'Recipient city', type: 'text' },
    'Recipient.Address.State': { label: 'Recipient state', type: 'text' },
    'Recipient.Address.Zip': { label: 'Recipient ZIP code', type: 'text' },
    'Recipient.Email': { label: 'Recipient email (optional)', type: 'email', required: false },
    SentViaCertifiedMail: { label: 'Send via certified mail?', type: 'boolean' },
    DeliveryMethod: { label: 'Delivery method (optional)', type: 'text', required: false },
    OnBehalfOfClient: { label: 'Is this letter sent on behalf of a client?', type: 'boolean' },
    ClientName: { label: 'Client name', type: 'text' },
    ClaimType: { label: 'Type of claim', type: 'selection', options: ['Unpaid Invoice', 'Security Deposit', 'Breach of Contract', 'Personal Injury'] },
    Tone: { label: 'Tone', type: 'selection', options: ['Firm', 'Cordial'] },
    PropertyAddress: { label: 'Rental property address', type: 'longtext' },
    LeaseStart: { label: 'Lease start date', type: 'date' },
    MoveOutDate: { label: 'Move-out date', type: 'date' },
    DepositAmount: { label: 'Security deposit paid', type: 'currency' },
    ReceivedItemization: { label: 'Did the tenant receive an itemized statement?', type: 'boolean' },
    InvoiceNumbers: { label: 'Invoice number(s)', type: 'text' },
    ServicesDescription: { label: 'Goods or services provided', type: 'longtext' },
    ContractName: { label: 'Name of the contract', type: 'text' },
    ContractDate: { label: 'Contract date', type: 'date' },
    RecipientObligation: { label: "Recipient's obligation under the contract", type: 'longtext' },
    BreachDescription: { label: 'Description of the breach (a full sentence)', type: 'longtext' },
    NoticeOfBreachDate: { label: 'Date written notice of breach was given (optional)', type: 'date', required: false },
    PaymentTermsDays: { label: 'Payment terms (days)', type: 'number' },
    PriorAttempts: { label: 'Prior reminders (e.g., "three written")', type: 'text', required: false },
    IncidentDate: { label: 'Date of incident', type: 'date' },
    IncidentLocation: { label: 'Location of incident', type: 'text' },
    IncidentDescription: { label: 'How the injury occurred (a full sentence ending with a period)', type: 'longtext' },
    NegligenceDescription: { label: 'Negligent acts or omissions', type: 'longtext' },
    InjuryDescription: { label: 'Injuries sustained', type: 'longtext' },
    TreatmentOngoing: { label: 'Is medical treatment ongoing?', type: 'boolean' },
    ClaimNumber: { label: "Insurer's claim number (optional)", type: 'text', required: false },
    Damages: { label: 'Itemized damages', type: 'list' },
    'Damages[].Description': { label: 'Item description', type: 'text' },
    'Damages[].Amount': { label: 'Amount', type: 'currency' },
    InterestRate: { label: 'Interest rate, % per annum (0 for none)', type: 'number' },
    InterestFromDate: { label: 'Interest accrues from (optional)', type: 'date', required: false },
    IncludeStatute: { label: 'Include an "Applicable Law" section?', type: 'boolean' },
    'Statute.Citation': { label: 'Statute or authority citation (optional)', type: 'text', required: false },
    'Statute.DeadlineDays': { label: 'Statutory deadline to return deposit (days)', type: 'number' },
    'Statute.MultiplierText': { label: 'Statutory penalty description (optional)', type: 'text', required: false },
    'Statute.InterestRateText': { label: 'Statutory interest rate text (optional)', type: 'text', required: false },
    'Statute.FeesAvailable': { label: 'Are attorney\'s fees recoverable?', type: 'boolean' },
    'Statute.LimitationsYears': { label: 'Limitations period (years; 0 to omit)', type: 'number' },
    DeadlineDays: { label: 'Days to respond', type: 'number' },
    PaymentInstructions: { label: 'Payment instructions (optional)', type: 'text', required: false },
  },
};

export default { id, name, description, category, text, sampleAnswers, model };
