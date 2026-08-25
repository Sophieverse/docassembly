/**
 * Engagement letter — fee-type branching, multi-client joint representation,
 * trust deposit, litigation cost clause, state-specific notices.
 */
export const id = 'engagement-letter';
export const name = 'Attorney Engagement Letter';
export const description = 'Client engagement letter with Hourly / Flat / Contingency / Hybrid fee branches, retainer trust clause, joint-representation waiver, and litigation costs.';
export const category = 'Client Intake';

export const text = `{[# ============================================================
   ENGAGEMENT LETTER
   Key branches:
     FeeType (Hourly | Flat | Contingency | Hybrid)  -> fee paragraphs
     Retainer > 0                                     -> trust deposit clause
     count(AdditionalClients) > 0                     -> joint representation waiver
     IsLitigation                                     -> costs / experts clause
     Client.IsEntity                                  -> signature block & addressee
     Firm.State (California / New York / other)       -> state-specific notices
   ============================================================ ]}
>right {[Firm.Name]}
>right {[Firm.Address.Street]}
>right {[Firm.Address.City]}, {[Firm.Address.State]} {[Firm.Address.Zip]}
>right {[Firm.Phone]}

{[LetterDate|format:"long"]}

**CONFIDENTIAL — ATTORNEY-CLIENT PRIVILEGED**

{[if Client.IsEntity]}
{[Client.FullName]}
Attn: {[Client.ContactName]}, {[Client.ContactTitle|default:"Authorized Representative"]}
{[else]}
{[Client.FullName]}
{[end if]}
{[Client.Address.Street]}
{[Client.Address.City]}, {[Client.Address.State]} {[Client.Address.Zip]}

**Re: Engagement of {[Firm.Name]} — {[MatterName]}**

Dear {[if Client.IsEntity]}{[Client.ContactName]}{[else]}{[Client.Salutation|default:Client.FullName]}{[end if]}:

Thank you for selecting {[Firm.Name]} (the "Firm") to represent {[if Client.IsEntity]}{[Client.FullName]} (the "Client"){[else]}you (the "Client"){[end if]}{[if count(AdditionalClients) > 0]}, together with {[list AdditionalClients]}{[FullName]}{[_punc]}{[end list]} (collectively, the "Clients"){[end if]} in connection with the matter described below. This letter confirms the terms of our engagement. Please review it carefully; if it accurately reflects your understanding, sign and return a copy to us.

# 1. Scope of Engagement

The Firm will represent the Client in the following matter (the "Matter"): {[MatterDescription]}

{[if IsLitigation]}
The Matter involves {[if LitigationRole = "Plaintiff"]}prosecuting{[else]}defending{[end if]} litigation{[if Court]} in the {[Court]}{[end if]}. Our representation includes pre-suit investigation, pleadings, discovery, motion practice, and trial. Unless we agree otherwise in writing, the engagement does **not** include any appeal, post-judgment collection, or enforcement proceedings.
{[else]}
Our representation is limited to the Matter as described above. It does not include litigation, tax advice, or any other matter unless we agree in writing to expand the scope.
{[end if]}

# 2. Legal Fees

{[# --- Fee paragraphs: one branch per FeeType --- ]}
{[if FeeType = "Hourly"]}
**Hourly fees.** Our fees will be based on the time devoted to the Matter, billed in increments of one-tenth of an hour. The hourly rate of {[ResponsibleAttorney.Name]} is {[HourlyRate|currency]}. Other attorneys and paralegals may work on the Matter at their standard hourly rates{[if ParalegalRate > 0]}, currently {[ParalegalRate|currency]} per hour for paralegals{[end if]}. Rates are reviewed annually and may be adjusted upon thirty (30) days' written notice.
{[else if FeeType = "Flat"]}
**Flat fee.** The Firm will handle the Matter for a flat fee of {[FlatFee|currency]} ({[FlatFee|dollars]}). The flat fee covers the services described in Section 1 only; work outside that scope will be billed at our standard hourly rates after written agreement. {[if FlatFeeEarnedOnReceipt]}The flat fee is earned upon receipt and will be deposited into the Firm's operating account; however, if the engagement ends before the work is completed, you may be entitled to a refund of any unearned portion.{[else]}The flat fee will be held in the Firm's client trust account and withdrawn as earned at the milestones described in Schedule A.{[end if]}
{[else if FeeType = "Contingency"]}
**Contingency fee.** The Firm will receive {[ContingencyPercent]}% ({[ContingencyPercent|words]} percent) of any gross recovery obtained by settlement, judgment, or award{[if ContingencyPercentTrial > ContingencyPercent]}, increasing to {[ContingencyPercentTrial]}% if the Matter proceeds to trial or arbitration hearing{[end if]}. "Gross recovery" means the total amount recovered before deduction of costs. **If there is no recovery, you will owe no attorney's fees.** You will remain responsible for costs as described in Section 3.
{[else if FeeType = "Hybrid"]}
**Hybrid fee.** The Firm will bill at a reduced hourly rate of {[HourlyRate|currency]} per hour, plus a contingent fee equal to {[ContingencyPercent]}% of any gross recovery. The reduced hourly component is payable regardless of outcome; the contingent component is payable only upon recovery.
{[else]}
**Fees.** [DRAFTER: FeeType "{[FeeType]}" is not recognized. Choose Hourly, Flat, Contingency, or Hybrid.]
{[end if]}

{[if Retainer > 0]}
**Advance deposit.** As a condition of this engagement, the Client will deposit {[Retainer|currency]} ({[Retainer|dollars]}) with the Firm. This deposit will be held in the Firm's client trust account{[if Firm.State = "California"]} (an IOLTA account as required by California law){[end if]} and applied against fees and costs as they are billed. {[if ReplenishRetainer]}When the balance falls below {[RetainerFloor|currency]}, the Client agrees to replenish the deposit to the original amount within ten (10) days of request.{[else]}Once the deposit is exhausted, invoices are payable as described below.{[end if]} Any unused balance will be refunded at the conclusion of the Matter.
{[end if]}

# 3. Costs and Expenses

In addition to fees, the Client is responsible for costs incurred on the Client's behalf, including filing fees, service of process, court reporters, travel, and delivery charges. Routine photocopying and postage are billed at the Firm's standard rates.
{[if IsLitigation]}
**Litigation costs and experts.** Litigation frequently requires expert witnesses, deposition transcripts, e-discovery vendors, and mediators. These costs can be substantial. The Firm will not retain an expert or vendor expected to cost more than {[CostApprovalThreshold|currency|default:"$2,500"]} without the Client's prior approval. {[if FeeType = "Contingency"]}Costs will be advanced by the Firm and reimbursed from any recovery before the contingency fee is calculated; if there is no recovery, the Client {[if ClientOwesCostsIfNoRecovery]}remains responsible for reimbursing costs advanced{[else]}will not be required to reimburse costs advanced{[end if]}.{[end if]}
{[end if]}

# 4. Billing and Payment

{[if FeeType = "Contingency"]}
Because this is a contingency engagement, you will not receive monthly fee invoices. We will provide a statement of costs periodically and a full accounting at the time of any distribution.
{[else]}
The Firm will send itemized invoices {[BillingFrequency|default:"monthly"|lower]}. Invoices are due within {[PaymentDays|default:"30"]} days of the invoice date. {[if LateInterestRate > 0]}Balances unpaid after that date accrue interest at {[LateInterestRate]}% per annum.{[end if]} Questions about an invoice should be raised within thirty (30) days of receipt.
{[end if]}

{[if count(AdditionalClients) > 0]}
# 5. Joint Representation and Conflict Waiver

{[# Only rendered when there is more than one client. ]}
The Firm has been asked to represent {[Client.FullName]} and {[list AdditionalClients]}{[FullName]}{[_punc]}{[end list]} jointly. Joint representation carries risks: the Clients' interests may diverge, and information one Client shares with the Firm cannot be kept confidential from the other Clients. If an actual conflict arises that cannot be resolved, the Firm may be required to withdraw from representing some or all of the Clients.

By signing below, each Client (a) confirms that they have been advised of these risks, (b) consents to the joint representation, (c) agrees that there will be no attorney-client privilege between the Clients with respect to the Matter, and (d) acknowledges the right to consult independent counsel regarding this waiver.
{[end if]}

# {[if count(AdditionalClients) > 0]}6{[else]}5{[end if]}. Termination

The Client may terminate this engagement at any time by written notice. The Firm may withdraw as permitted by the applicable rules of professional conduct{[if IsLitigation]}, subject to court approval where required{[end if]}. Upon termination, the Client remains responsible for fees and costs incurred through the date of termination{[if FeeType = "Contingency"]} on a quantum meruit basis, payable only from any eventual recovery{[end if]}.

# {[if count(AdditionalClients) > 0]}7{[else]}6{[end if]}. File Retention

At the conclusion of the Matter, the Firm will return original documents on request and will retain the file for {[FileRetentionYears|default:"7"]} years, after which it may be destroyed without further notice.

{[# --- State-specific notices --- ]}
{[if Firm.State = "California"]}
# State Notice — California

{[if not Firm.HasMalpracticeInsurance]}
**Notice regarding professional liability insurance.** Pursuant to California Rule of Professional Conduct 1.4.2, the Firm informs you that it does not maintain professional liability insurance.
{[end if]}
This agreement is governed by California Business and Professions Code sections 6147 and 6148. {[if FeeType = "Contingency"]}The contingency rate stated above is not set by law and is negotiable between attorney and client.{[end if]}
{[else if Firm.State = "New York"]}
# State Notice — New York

{[if FeeType != "Contingency"]}
In the event of a fee dispute, you may have the right to arbitration under Part 137 of the Rules of the Chief Administrator of the Courts. A Statement of Client's Rights and Responsibilities is enclosed as required by 22 NYCRR Part 1210.
{[else]}
This contingency arrangement is subject to 22 NYCRR 1215 and, if applicable, the sliding-scale limits of Judiciary Law § 474-a for personal injury matters.
{[end if]}
{[else]}
This agreement is governed by the laws and rules of professional conduct of the State of {[Firm.State]}.
{[end if]}

We look forward to working with you. Please sign below and return a copy to confirm your agreement to these terms.

Very truly yours,

**{[Firm.Name]}**

By: ______________________________
{[ResponsibleAttorney.Name]}{[if ResponsibleAttorney.BarNumber]}, {[Firm.State]} Bar No. {[ResponsibleAttorney.BarNumber]}{[end if]}
{[ResponsibleAttorney.Title|default:"Attorney at Law"]}
{[ResponsibleAttorney.Email]}

---

>center **AGREED AND ACCEPTED**

{[if Client.IsEntity]}
**{[Client.FullName|upper]}**

By: ______________________________
Name: {[Client.ContactName]}
Title: {[Client.ContactTitle|default:"Authorized Representative"]}
Date: ____________
{[else]}
______________________________
{[Client.FullName]}
Date: ____________
{[end if]}
{[list AdditionalClients]}

______________________________
{[FullName]}
Date: ____________
{[end list]}
`;

export const sampleAnswers = {
  Firm: {
    Name: 'Hartwell & Okafor LLP',
    Address: { Street: '1200 Market Street, Suite 900', City: 'San Francisco', State: 'CA', Zip: '94102' },
    Phone: '(415) 555-0142',
    State: 'California',
    HasMalpracticeInsurance: true,
  },
  ResponsibleAttorney: { Name: 'Priya Okafor', Title: 'Partner', BarNumber: '287431', Email: 'pokafor@hartwellokafor.example' },
  LetterDate: '2026-08-24',
  Client: {
    FullName: 'Meridian Coffee Roasters, Inc.',
    IsEntity: true,
    ContactName: 'Daniel Foss',
    ContactTitle: 'Chief Executive Officer',
    Salutation: '',
    Address: { Street: '48 Bluxome Street', City: 'San Francisco', State: 'CA', Zip: '94107' },
  },
  AdditionalClients: [{ FullName: 'Daniel Foss' }],
  MatterName: 'Meridian v. Pacific Bean Supply Co.',
  MatterDescription: 'Claims arising from Pacific Bean Supply Co.\'s failure to deliver conforming green coffee under the Supply Agreement dated January 12, 2025.',
  IsLitigation: true,
  LitigationRole: 'Plaintiff',
  Court: 'Superior Court of California, County of San Francisco',
  FeeType: 'Hourly',
  HourlyRate: 525,
  ParalegalRate: 195,
  FlatFee: 7500,
  FlatFeeEarnedOnReceipt: false,
  ContingencyPercent: 33,
  ContingencyPercentTrial: 40,
  ClientOwesCostsIfNoRecovery: false,
  Retainer: 15000,
  ReplenishRetainer: true,
  RetainerFloor: 5000,
  CostApprovalThreshold: 2500,
  BillingFrequency: 'Monthly',
  PaymentDays: 30,
  LateInterestRate: 8,
  FileRetentionYears: 7,
};

export default { id, name, description, category, text, sampleAnswers };
