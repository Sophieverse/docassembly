/**
 * Tutorial sample — teaches the template syntax in a few lines.
 */
export const id = 'tutorial';
export const name = 'Tutorial: Template Syntax in 25 Lines';
export const description = 'A tiny walkthrough of fields, if/else, lists with _punc, and filters. Start here.';
export const category = 'Tutorial';

export const text = `>title Welcome, {[Client.FullName]}
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
 * Questionnaire overrides (labels, types, options, help) in the shape of
 * model.variables from engine/model.js. Merged over the inferred model.
 */
export const model = {
  variables: {
    'Client.FullName': { label: "Client's full legal name", type: 'text' },
    'Client.IsEntity': { label: 'Is the client a business entity (not an individual)?', type: 'boolean' },
    'Client.EntityType': { label: 'Type of entity (e.g., Delaware corporation)', type: 'text', help: 'Leave blank to print "business entity".' },
    'Client.IsMarried': { label: 'Is the client married?', type: 'boolean' },
    'Client.Gender': { label: "Client's pronouns", type: 'selection', options: ['Male', 'Female', 'Nonbinary'] },
    SigningDate: { label: 'Date of this letter', type: 'date' },
    Children: { label: "Client's children", type: 'list' },
    'Children[].Name': { label: "Child's name", type: 'text' },
    'Children[].DOB': { label: "Child's date of birth", type: 'date' },
    Fee: { label: 'Fee', type: 'currency' },
    'Attorney.Name': { label: "Attorney's name", type: 'text' },
  },
};

export default { id, name, description, category, text, sampleAnswers, model };
