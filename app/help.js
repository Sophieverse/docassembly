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
<p>Spellings <code>end if</code>, <code>endif</code>, <code>else if</code>, <code>elseif</code> and <code>elif</code> all work. A variable used by itself in an <code>if</code> becomes a Yes/No question. Questions inside a condition are only asked when the condition is true — that is the whole point.</p>
<p>Conditions can be expressions: <code>{[if count(Children) > 2 and Client.State = "CA"]}</code>, <code>{[if not Client.IsMarried]}</code>, <code>{[if Fee >= 5000 or Retainer]}</code>.</p>

<h2>Lists (repeating items)</h2>
<pre>{[list Children]}{[Name]}, born {[DOB|format:"long"]}{[_punc]}{[end list]}</pre>
<p>Inside a list, bare names refer to the current item (<code>Name</code> = the child's name); outer variables still work. Helpers: <code>{[_index]}</code> (1, 2, 3…), <code>{[_first]}</code> / <code>{[_last]}</code> (true/false), <code>{[_punc]}</code> (automatic ", " / ", and " / "."). Filter items: <code>{[list Children|filter: Age &lt; 18]}</code>.</p>
<p>List functions: <code>count(Children)</code>, <code>any(Children, Age &lt; 18)</code>, <code>sum(Invoices, Amount)</code>.</p>

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
<tr><td>ordinal / ordinalwords</td><td><code>{[Day|ordinal]}</code></td><td>3rd / third</td></tr>
<tr><td>format:"…"</td><td><code>{[Date|format:"long"]}</code></td><td>January 5, 2026 (also <code>short</code>, or tokens <code>MMMM d, yyyy</code>)</td></tr>
<tr><td>default:"…"</td><td><code>{[Title|default:"Agreement"]}</code></td><td>Fallback when empty</td></tr>
<tr><td>pluralize:"a","b"</td><td><code>{[count(Children)|pluralize:"child","children"]}</code></td><td>child / children</td></tr>
<tr><td>join:"and"</td><td><code>{[Parties|join:"and"]}</code></td><td>A, B, and C</td></tr>
<tr><td>possessive</td><td><code>{[Name|possessive]}</code></td><td>James's</td></tr>
<tr><td>pronoun:"subject|object|possessive"</td><td><code>{[Client.Gender|pronoun:"subject"]}</code></td><td>he / she / they</td></tr>
<tr><td>initials</td><td><code>{[Name|initials]}</code></td><td>J.D.</td></tr>
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
