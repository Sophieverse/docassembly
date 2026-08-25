/**
 * Tutorial sample — teaches the template syntax in a few lines.
 */
import { parse, analyze, createModel } from '../engine/index.js';

export const id = 'tutorial';
export const name = 'Tutorial: Template Syntax in 30 Lines';
export const description = 'A tiny walkthrough of @annotations, fields, if/else, lists with _punc, and filters. Start here.';
export const category = 'Tutorial';

export const text = `{[# ANNOTATIONS live in comments and shape the questionnaire without leaving the template.
   One "@key Path: value" per line: label names a question, help adds a hint, options turns
   a text field into a pick-list, type/required override inference, min/max bound numbers
   and dates, and validate adds a rule written "expr :: message" where "value" is the answer. ]}
{[# @label Client.FullName: Client's full legal name
@label Client.IsEntity: Is the client a business entity (not an individual)?
@label Client.EntityType: Type of entity (e.g., Delaware corporation)
@help Client.EntityType: Leave blank to print "business entity".
@required Client.EntityType: false
@label Client.IsMarried: Is the client married?
@label Client.Gender: Client's pronouns
@options Client.Gender: Male | Female | Nonbinary
@label SigningDate: Date of this letter
@label Children: Client's children
@label Children[].Name: Child's name
@label Children[].DOB: Child's date of birth
@validate Children[].DOB: value <= today() :: A date of birth cannot be in the future
@label Fee: Fee
@type Fee: currency
@min Fee: 0
@label Attorney.Name: Attorney's name ]}
>title Welcome, {[Client.FullName]}
{[# A COMMENT starts with a hash; it is a drafter note and never appears in the output.]}
{[# A FIELD merges a value: ]}
This letter was prepared on {[SigningDate|format:"long"]} for {[Client.FullName|upper]}.
{[# IF / ELSE IF / ELSE chooses one branch. Put block tags on their own lines.]}
{[if Client.IsEntity]}
{[Client.FullName]} is {[Client.EntityType|default:"business entity"|article]} {[Client.EntityType|default:"business entity"]}.
{[else if Client.IsMarried]}
{[Client.FullName]} is an individual who is married.
{[else]}
{[Client.FullName]} is an individual who is not married.
{[end if]}
{[# A LIST repeats its body for each item. _punc adds ", " / ", and " / "." automatically.]}
{[# Guard a list with count() so an empty list never leaves "children: ." behind.]}
{[if count(Children) > 0]}
The client has {[count(Children)|pluralize:"child","children"]}: {[list Children]}{[Name]} (age {[yearsBetween(DOB, today())]}){[_punc]}{[end list]}.
{[# _index, _first and _last are also available inside a list:]}
{[list Children]}
{[_index]}. {[Name]}{[if _last]} (youngest listed){[end if]}
{[end list]}
{[else]}
The client has no children.
{[end if]}
{[# FILTERS transform values with a pipe. |dollars writes money in words; |words spells out a whole number.]}
Fee: {[Fee|currency]} ({[Fee|dollars]}). Number of children in words: {[count(Children)|words]}.
Sincerely, {[Attorney.Name|title]}
{[# Inline if is fine WITHIN a sentence. Keep the leading space INSIDE the if so nothing is left behind: ]}
P.S. {[Client.FullName]} is entitled to {[Client.Gender|pronoun:"possessiveadj"]} own copy{[if count(Children) > 0]} and one for each child{[end if]}.
`;

export const sampleAnswers = {
  Client: { FullName: 'Jordan Rivera', IsEntity: false, IsMarried: true, Gender: 'Nonbinary', EntityType: '' },
  SigningDate: '2026-08-24',
  Children: [
    { Name: 'Maya Rivera', DOB: '2012-03-14' },
    { Name: 'Leo Rivera', DOB: '2016-11-02' },
  ],
  Fee: 1250.5,
  Attorney: { Name: 'alex chen' },
};

/**
 * The questionnaire model is built from the template itself: every label, help text,
 * option list and rule above comes from the @annotations, so the template is the
 * single source of truth. (Other samples ship a hand-written `model` instead.)
 */
export const model = createModel(analyze(parse(text)));

export default { id, name, description, category, text, sampleAnswers, model };
