# Authoring — a plain request, an application that works

**22 of 24 plain requests became an application that works when a person
uses it (91.7%), with `anthropic/claude-haiku-5.5` through OpenRouter, three
trials of eight tasks, 28 requests in all, on 2026-11-18.**

The question is the one the desktop's assistant faces: a person asks in plain
words ("a bill splitter", "a word counter") and the assistant writes the
application as a Jaren document. Nothing in the request names state, actions
or elements; the author chooses all of it.

## How it is judged

- **The author** gets the desktop's crib (`authoringCrib()` from
  `@tangleai/os/authoring`: the grammar rules, Jaren's own operator names and
  one complete working to-do list) and repairs against the gate a desktop runs
  before it shows a document: the lint (no code written in strings, no
  object-shaped vnodes), the compile as Jaren runs it (an unknown operator is
  named with the nearest one) and a first frame with text. Up to two repairs,
  in JSON mode.
- **The judge** is the task's probes, which the author never sees. A probe
  boots the application fresh and uses it as a person would: it finds a field
  or a button by its words (its label, a `<label for>`, its placeholder,
  accessible name or text), types or presses, and checks the text any correct
  application shows (`27.5` each for a bill of 100 with 10% tip split four
  ways). It does not depend on any name the author chose.
- **The instrument checks itself, keyless.** Every task has a reference
  document a careful author would write, which passes all its probes, and the
  test suite proves it on every run; another task's working application fails
  them.

`node benchmark/authoring.ts` runs that keyless check;
`node --env-file-if-exists=.env benchmark/authoring.ts --live --trials 3`
spends, planned up front against `TANGLE_AI_MAX_CALLS` (at most 72 requests
for this table). The report is `benchmark/results/authoring-live.json`; tests
validate it and never regenerate it.

## The table

| task | the request, in short | works |
|---|---|---|
| bill | amount, tip and people → tip, total, each | 2 of 3 |
| templog | add readings → each, average, lowest, highest | 2 of 3 |
| contacts | five contacts, search by name or city, any case | 3 of 3 |
| counter | plus, minus, a step size, reset | 3 of 3 |
| distance | kilometres → miles, two decimals | 3 of 3 |
| shopping | add items, tick them off, how many are left | 3 of 3 |
| bmi | weight and height → BMI, one decimal | 3 of 3 |
| words | a text box → words and characters | 3 of 3 |

Both failures are the author's slips, not the grammar's: a bill splitter
passed an array to `$max` and failed when the person typed the number of
people, and a temperature log added every reading twice (six readings for
three, so the average was wrong). Every document of the 24 passed the gate.

## What changed on the way

- The first run (task file version 1) had 21 of 24: three shopping lists
  began with sample items, and counting them was judged wrong. The request
  now says the list starts empty (version 2); the judge did not change.
- Building the instrument fixed the crib it measures: it offered `$ceil`,
  `$lte`, `$gte` and `$length`, which are not Jaren's text and number
  operators (`$ceiling`; `$length` is a GeoJSON length). A test now compiles
  every operator the crib names.
- Measured 2026-11-14, with an interface written into every request and the
  same model: 29 of 33. Those numbers are not this table's: the tasks, the
  probes and the crib differ.

## What this does not show

The assistant's own conversation around the document is not measured: the
desktop's tools for it (checking a draft, proposing the application in the
inbox for the person to add) build on this gate and crib, and a person's
request in another language is not among the tasks.
