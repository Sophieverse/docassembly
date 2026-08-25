# Research: what attorneys need from conditional document automation

**Bottom line:** one intake → whole matter packet; nested if/then plus lists, pronouns and numbering
without breaking Word; templates maintainable by non-programmers; real editable DOCX out; no vendor
lock-in on templates or client data. The most-cited failure of existing tools is Word template hygiene
(split runs breaking merge tags, unmaintainable IF-field chains), not the logic engine.

## Documents automated most, and the branching each needs
- **Engagement letters** — FeeType ∈ {hourly, flat, contingency, hybrid} → fee paragraph; Retainer > 0 →
  trust-deposit clause; >1 client → joint-representation waiver; litigation → costs/experts clause; state rules.
- **Estate planning** — married → spousal provisions + 30-day survivorship; children? any minor → guardian +
  minor's trust; prior-relationship children → separate-share language; per stirpes vs per capita residuary;
  multiple successor trustees → serial vs co-trustee; estate > exemption → tax provisions; pour-over will
  pulls trust name/date from the trust doc.
- **LLC operating agreements** — 2×2: single vs multi-member × member- vs manager-managed; tax election;
  member table must sum to 100%; entity members change signature blocks.
- **Leases** — commercial vs residential; pre-1978 lead paint; guarantor → guaranty exhibit; pets; utilities.
- **NDAs** — mutual vs one-way defined terms; term/survival; DTSA notice for employees; non-solicit toggle.
- **Demand letters** — claim type drives fact paragraphs; itemized damages summed; deadline = send date + N days.
- **Pleadings** — caption stored once at matter level and reused on every filing.

## Pain points with existing tools
Word run-splitting hides merge tags; Word IF fields don't scale; re-entering client data (top HotDocs
complaint); pricing/lock-in (HotDocs 5-user minimum, Woodpecker folded into MyCase, Lawyaw → Clio Draft);
setup time/abandonment; template drift across forked copies; numbering/cross-refs after clause removal; Mac support.

## Template design best practices
One gold-standard precedent per document; defined terms as variables; pronoun sets (incl. they/them);
paragraph-level tags on their own line so removed clauses leave no blank paragraphs; `comma_and_list`
joining; validation (shares sum to 100); consistent naming; matter-level reusable answer files; version
history; saved test answer sets (married w/ minors, single no children, three co-trustees).

## Practical wishes
One questionnaire → packet with conditional document inclusion; client/matter records reused across docs;
editable DOCX output; local/private data; templates stay readable text; usable by non-programmers.

Sources: Lawyerist, Attorney at Work, Legal Office Guru, Clio, ABA Journal, Affinity Consulting, Suffolk LIT
Lab, docassemble docs, docxtpl docs, Gavel, Legal GPS, ALAS worksheet, G2/GetApp HotDocs reviews.
