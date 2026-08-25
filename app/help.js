/**
 * @module help
 * #/help — embedded language reference (does not depend on fetching engine/README.md).
 */
import { el, clear } from './components.js';

const REF = `
<h1>Template language reference</h1>
<p>Write your document as ordinary text. Anything between <code>{[</code> and <code>]}</code> is a field or an instruction; everything else is printed as-is. DocAssembly reads the template, finds every variable and condition, and builds the questionnaire for you.</p>

<h2>Fields</h2>
<table>
<tr><th>Write</th><th>Meaning</th></tr>
<tr><td><code>{[Client.FullName]}</code></td><td>Insert the answer. Dotted names group questions (everything under <em>Client</em> is asked together).</td></tr>
<tr><td><code>{[Fee|currency]}</code></td><td>Insert with a filter — here formatted as $1,234.00.</td></tr>
<tr><td><code>{[SigningDate|format:"MMMM d, yyyy"]}</code></td><td>Format a date: <em>January 5, 2026</em>.</td></tr>
<tr><td><code>{[Client.FullName|upper]}</code></td><td>Filters chain: <code>{[Name|trim|title]}</code>.</td></tr>
<tr><td><code>{[# reminder to drafter]}</code></td><td>Comment — never printed.</td></tr>
</table>

<h2>Conditions (if / then)</h2>
<pre>{[if Client.IsMarried]}
The Client is married to {[Spouse.FullName]}.
{[elseif Client.HasPartner]}
The Client has a domestic partner, {[Partner.FullName]}.
{[else]}
The Client is single.
{[end if]}</pre>
<p>Spellings <code>end if</code>, <code>endif</code>, <code>else if</code>, <code>elseif</code> and <code>elif</code> all work. A variable used by itself in an <code>if</code> becomes a Yes/No question (even if it is also printed as text — use <code>{[if not isEmpty(Court)]}</code> for optional text, or fix the type in the Variables tab). Questions inside a condition are only asked when the condition is true — that is the whole point.</p>
<p><strong>Blank lines.</strong> A block tag alone on a line is removed with its line, but blank lines around it are kept. Start an optional paragraph with the blank line <em>inside</em> the block (<code>{[if X]}</code>, blank line, paragraph, <code>{[end if]}</code>) so skipping it never leaves a double blank line. Inside a sentence, keep the leading space inside the tag: <code>due.{[if X]} Interest accrues.{[end if]}</code>.</p>
<p>Conditions can be expressions: <code>{[if count(Children) > 2 and Client.State = "CA"]}</code>, <code>{[if not Client.IsMarried]}</code>, <code>{[if Fee >= 5000 or Retainer]}</code>.</p>

<h2>Lists (repeating items)</h2>
<pre>{[list Children]}{[Name]}, born {[DOB|format:"long"]}{[_punc]}{[end list]}</pre>
<p>Inside a list, bare names refer to the current item (<code>Name</code> = the child's name); outer variables still work. Helpers: <code>{[_index]}</code> (1, 2, 3…), <code>{[_first]}</code> / <code>{[_last]}</code> (true/false), <code>{[_punc]}</code> (automatic ", " / ", and " / "."). Filter items: <code>{[list Children|filter: Age &lt; 18]}</code>.</p>
<p>List functions: <code>count(Children)</code>, <code>any(Children, Age &lt; 18)</code>, <code>sum(Invoices, Amount)</code>. Per-item tests also work as filters, including in conditions: <code>{[if Children|any: yearsBetween(DOB, today()) &lt; 18]}</code> decides whether a guardianship article is needed without asking an "Is minor?" question. Guard lists that may be empty: <code>{[if count(Children) &gt; 0]}…{[end if]}</code>, or an empty list prints "children: .".</p>

<h2>Expressions</h2>
<table>
<tr><th>Operators</th><td><code>and or not = != &lt; &lt;= &gt; &gt;= + - * /</code>, parentheses</td></tr>
<tr><th>Literals</th><td><code>"text"</code>, numbers, <code>true</code>, <code>false</code>, <code>null</code></td></tr>
<tr><th>Members</th><td><code>Client.Address.City</code></td></tr>
</table>

<h2>Filters</h2>
<table>
<tr><th>Filter</th><th>Example</th><th>Result</th></tr>
<tr><td>upper / lower / title / capitalize / trim</td><td><code>{[Name|title]}</code></td><td>Jane Doe</td></tr>
<tr><td>currency</td><td><code>{[Fee|currency]}</code></td><td>$2,500.00</td></tr>
<tr><td>number</td><td><code>{[Qty|number]}</code></td><td>1,250</td></tr>
<tr><td>words</td><td><code>{[Fee|words]}</code></td><td>two thousand five hundred</td></tr>
<tr><td>dollars / dollarsFull</td><td><code>{[Fee|dollars]}</code></td><td>Two Thousand Five Hundred and 00/100 Dollars · <code>dollarsFull</code> → Two Thousand Five Hundred Dollars ($2,500.00)</td></tr>
<tr><td>ordinal / ordinalwords</td><td><code>{[Day|ordinal]}</code></td><td>3rd / third</td></tr>
<tr><td>format:"…"</td><td><code>{[Date|format:"long"]}</code></td><td>January 5, 2026 (also <code>short</code>, <code>legal</code> → the 5th day of January, 2026, or tokens <code>MMMM D, YYYY</code>, <code>Do [day of] MMMM YYYY</code>; numbers: <code>format:"0,0.00"</code>; Yes/No: <code>format:"is":"is not"</code>)</td></tr>
<tr><td>default:"…"</td><td><code>{[Title|default:"Agreement"]}</code></td><td>Fallback when empty (0 is not empty — use <code>{[if Rent &gt; 0]}</code> for numbers)</td></tr>
<tr><td>pluralize:"a","b"</td><td><code>{[count(Children)|pluralize:"child","children"]}</code></td><td>1 child / 3 children (add <code>,true</code> to omit the number)</td></tr>
<tr><td>punc:"1, 2, and 3"</td><td><code>{[list Children|punc:"1, 2, and 3"]}{[Name]}{[end list]}</code></td><td>Maya, Leo, and Ann — separators inserted automatically (write the example with "or", ";", or a trailing "." to change them)</td></tr>
<tr><td>join:"and"</td><td><code>{[Parties|join:"and"]}</code></td><td>A, B, and C</td></tr>
<tr><td>possessive</td><td><code>{[Name|possessive]}</code></td><td>James' / Mary's</td></tr>
<tr><td>article</td><td><code>{[EntityType|article]} {[EntityType]}</code></td><td>an Oregon LLC / a Delaware corporation</td></tr>
<tr><td>pronoun:"subject|object|possessive|possessiveadj|reflexive"</td><td><code>{[Client.Gender|pronoun:"subject"]}</code></td><td>he / she / they (Gender = Male / Female / Nonbinary)</td></tr>
<tr><td>initials</td><td><code>{[Name|initials]}</code> / <code>{[Name|initials:"."]}</code></td><td>JD / J.D.</td></tr>
</table>

<h2>Document structure (markdown-style)</h2>
<table>
<tr><td><code># Title</code>, <code>## Heading</code>, <code>### Sub-heading</code></td><td>Headings</td></tr>
<tr><td><code>**bold**</code>, <code>*italic*</code>, <code>__underline__</code></td><td>Inline formatting</td></tr>
<tr><td><code>1. item</code> / <code>- item</code></td><td>Numbered / bulleted lists</td></tr>
<tr><td><code>|Cell|Cell|</code></td><td>Table rows</td></tr>
<tr><td><code>&gt;center Text</code>, <code>&gt;right Text</code></td><td>Alignment</td></tr>
<tr><td><code>---</code></td><td>Page break</td></tr>
</table>
<p>Templates imported from .docx keep their own Word styles.</p>

<h2>Variable types</h2>
<p>Types are inferred from how a variable is used, and can be changed in the editor's <strong>Variables</strong> tab: text, long text, number, currency, date, Yes/No, selection (one of a list), multi-select, object (group of fields), list (repeating group) and computed (a formula, never asked).</p>
<p>Inference: used alone in <code>if</code> → Yes/No · <code>|currency</code> → currency · <code>|format</code> or name ending in <em>Date</em>/<em>DOB</em> → date · <code>list X</code> / <code>count(X)</code> → list · <code>X.Y</code> → X is an object · otherwise text.</p>

<h2>Annotations (questionnaire settings inside the template)</h2>
<p>A comment line that starts with <code>@</code> sets a questionnaire property, so the template stays the single source of truth. Write <code>{[# @key Path: value]}</code>, one per line (a single comment may hold several lines). Paths use the model's form (<code>Client.FullName</code>, <code>Children[].DOB</code>). Settings made this way show a <em>from template</em> badge in the Variables tab; an edit there wins until you reset it. Use the <strong>@ Annotation</strong> toolbar button to insert one.</p>
<table>
<tr><th>Annotation</th><th>Example</th><th>Effect</th></tr>
<tr><td>@label</td><td><code>{[# @label Client.FullName: Client's full legal name]}</code></td><td>Question text</td></tr>
<tr><td>@help</td><td><code>{[# @help IsMarried: Legally married at signing]}</code></td><td>Hint under the question</td></tr>
<tr><td>@options</td><td><code>{[# @options FeeType: Hourly | Flat | Contingency]}</code></td><td>Pick-list; a text variable becomes a selection</td></tr>
<tr><td>@default</td><td><code>{[# @default Firm.State: California]}</code></td><td>Pre-filled answer (coerced to the type: <code>yes</code>, <code>1,500</code>, <code>a | b</code>)</td></tr>
<tr><td>@required / @optional</td><td><code>{[# @required Children[].DOB]}</code> · <code>{[# @optional Suffix]}</code></td><td>Required flag (<code>@required X: false</code> also works)</td></tr>
<tr><td>@type</td><td><code>{[# @type Retainer: currency]}</code></td><td>text, longtext, number, currency, date, boolean, selection, multiselect, email, phone, list, object, computed</td></tr>
<tr><td>@min / @max</td><td><code>{[# @min Retainer: 0]}</code> · <code>{[# @max LeaseStart: 2030-12-31]}</code></td><td>Inclusive bounds for numbers, currency and dates (ISO date)</td></tr>
<tr><td>@minLength / @maxLength</td><td><code>{[# @minLength Members: 2]}</code> · <code>{[# @maxLength Zip: 10]}</code></td><td>Characters for text; item count for lists and multi-selects</td></tr>
<tr><td>@pattern</td><td><code>{[# @pattern Client.Phone: ^\\d{3}-\\d{3}-\\d{4}$]}</code></td><td>Regular expression the answer must match (add <code>^</code>/<code>$</code> for a full match)</td></tr>
<tr><td>@validate</td><td><code>{[# @validate Members: sum(Members, "Percent") = 100 :: Percentages must total 100]}</code></td><td>Rule expression; <code>value</code> (or <code>this</code>) is the answer, all other answers are in scope; text after <code>::</code> is the error message</td></tr>
<tr><td>@message</td><td><code>{[# @message Zip: Use a 5-digit ZIP code]}</code></td><td>Custom error text for every failing rule on the variable</td></tr>
<tr><td>@formula</td><td><code>{[# @formula Children[].IsMinor: yearsBetween(DOB, today()) &lt; 18]}</code></td><td>Computed variable (never asked); item paths compute once per item</td></tr>
</table>
<p>Keys are case-insensitive. Mistakes (an unknown key, a bad regular expression, a non-integer length, an unknown type, an empty <code>@validate</code>) are listed under the editor as warnings with a line link — they never stop the document from generating.</p>

<h2>Make a Word template</h2>
<p>Instead of converting a document to text, you can keep your own Word file as the template: choose <strong>Import .docx → Keep as Word template</strong>. Every style, header, footer, numbering scheme, table and font is preserved, and only the <code>{[ ]}</code> tags are resolved. Editing happens in Word: change the tags there and click <strong>Replace Word file</strong> in the editor. Download the <strong>Example Word template</strong> from the Templates page to see one.</p>
<ul>
<li><strong>Fields</strong> go anywhere in running text, table cells, headers and footers: <code>Dear {[Client.FullName]},</code>. Filters and expressions work exactly as in text templates. Word may split a tag across formatting runs or add smart quotes — both are handled.</li>
<li><strong>Paragraph-level blocks.</strong> Put <code>{[if …]}</code>, <code>{[else]}</code>, <code>{[end if]}</code>, <code>{[list …]}</code> and <code>{[end list]}</code> on a line (paragraph) of their own to include, skip or repeat whole paragraphs. The marker paragraph itself disappears from the output. Inline <code>{[if X]}…{[end if]}</code> inside a sentence keeps working; a paragraph that renders to nothing is removed.</li>
<li><strong>Repeating table rows.</strong> Start the first cell of a row with <code>{[list Members]}</code> and end its last cell with <code>{[end list]}</code>: the row is repeated once per item with the item's fields (<code>{[FullName]}</code>, <code>{[Percent]}%</code>) filled in.</li>
<li><strong>Comments and annotations</strong> (<code>{[# …]}</code>, <code>{[# @label …]}</code>) work the same way; keep each tag inside a single paragraph.</li>
<li><strong>Preview.</strong> The editor's Preview tab shows a text preview of the tags; the generated document itself is your Word file with the tags filled, and the output page shows an approximation of it.</li>
</ul>

<h2>Records and packages</h2>
<p>Answers are stored as <strong>records</strong> (one per client or matter) and can be reused across templates. A <strong>package</strong> is an ordered set of templates that share one questionnaire; each template can carry an "include if" expression such as <code>Client.IsMarried</code>.</p>

<h2>Worked example</h2>
<pre># ENGAGEMENT LETTER

{[SigningDate|format:"MMMM d, yyyy"]}

Dear {[Client.FullName]},

Thank you for engaging {[FirmName]} to represent you in connection with {[MatterDescription]}.
{[if FeeType = "Hourly"]}
Our fees are billed at {[HourlyRate|currency]} per hour.
{[elseif FeeType = "Flat"]}
Our fee for this matter is a flat {[FlatFee|currency]}.
{[else]}
Fees will be set out in a separate schedule.
{[end if]}
{[if RequiresRetainer]}
A retainer of {[RetainerAmount|currency]} is due before work begins.
{[end if]}

Sincerely,

{[AttorneyName]}</pre>
<p>This produces questions for the signing date, client name, matter description, fee type (make it a <em>selection</em> with options Hourly / Flat / Other in the Variables tab), and — only when relevant — hourly rate, flat fee, and retainer amount.</p>
`;

export function renderHelp(main) {
  clear(main);
  main.appendChild(el('div.help.card', { html: REF }));
}

export { REF as helpHtml };
