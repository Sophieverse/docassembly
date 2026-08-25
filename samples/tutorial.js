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
{[Client.FullName]} is a {[Client.EntityType|default:"business entity"]}.
{[else if Client.IsMarried]}
{[Client.FullName]} is an individual who is married.
{[else]}
{[Client.FullName]} is an individual who is not married.
{[end if]}
{[# A LIST repeats its body for each item. _punc adds ", " / ", and " / "." automatically.]}
The client has {[count(Children)|pluralize:"child","children"]}: {[list Children]}{[Name]} (age {[yearsBetween(DOB, today())]}){[_punc]}{[end list]}.
{[# _index, _first and _last are also available inside a list:]}
{[list Children]}
{[_index]}. {[Name]}{[if _last]} (youngest listed){[end if]}
{[end list]}
{[# FILTERS transform values with a pipe:]}
Fee: {[Fee|currency]} ({[Fee|dollars]}). Fee in words: {[Fee|words]} dollars.
Sincerely, {[Attorney.Name|title]}
{[# Inline if is fine WITHIN a sentence: ]}
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

export default { id, name, description, category, text, sampleAnswers };
