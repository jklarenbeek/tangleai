# CSV conventions

## Quoting

A field wrapped in double quotes may contain a comma; the quotes are not part
of the value. Strip them before comparing or parsing.

## Missing values

An empty field is missing, not zero. A row with a missing value in the column
under question is skipped and the skip is stated.

## Ordering

Row order carries no meaning. Sort explicitly whenever the question asks for a
first, last, highest or lowest row.

## Ties

When two rows tie on the quantity a question ranks, answer with the identifier
that sorts first.
