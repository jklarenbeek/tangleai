# Tabular extraction

Answer one question about one small table and return the answer alone.

## When to use

The task names exactly one file under `inputs/`. Read that file, compute the
answer from its rows, and reply with the bare value — no sentence, no units,
no restatement of the question.

## Reading the table

- The first line of a CSV file is the header; it is never a data row.
- A Markdown table's first row is the header and its second row is the
  alignment rule; neither is data.
- Match a column by its header name, not by position.
- Compare identifiers case-insensitively and answer with the lower-case form.

## Answer format

- A count is a bare integer.
- A name is the identifier exactly as the table spells it, lower-cased.
- A decimal uses a period separator and no thousands separator.

See [CSV conventions](references/csv-conventions.md) for the field rules this
directory relies on.
