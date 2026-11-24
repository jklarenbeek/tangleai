# Authoring — a plain request, an application that works

**Through the desktop's assistant, 31 of 32 plain requests ended with an
application in the person's inbox that works when they use it: 15 of 16 in
English and 16 of 16 in Dutch (161 requests). The author alone, against the
desktop's gate, made 22 of 24 work (91.7%, 28 requests).** All runs used
`anthropic/claude-haiku-5.5` through OpenRouter over the same eight tasks: the
conversations on 2026-11-24, with the assistant's prompt asking for the formal
form of address, the author alone on 2026-11-18.

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

## Through the assistant's conversation

`--conversation` measures the assistant a person talks to: a headless desktop
kernel, the Pages assistant's own system prompt and the kernel's tools under
the same grants as the Pages desktop (`tangle_os_apps` among them), and one
turn with the person's request. The assistant reads the crib, checks its
drafts with its own probes and suggests the finished application; whatever
reached the inbox is judged with the task's hidden probes, exactly as the
author's documents are. A turn may take up to 8 tool rounds.

| task | English | Dutch |
|---|---|---|
| bill | 2 of 2 | 2 of 2 |
| templog | 2 of 2 | 2 of 2 |
| contacts | 2 of 2 | 2 of 2 |
| counter | 2 of 2 | 2 of 2 |
| distance | 2 of 2 | 2 of 2 |
| shopping | 2 of 2 | 2 of 2 |
| bmi | 1 of 2 | 2 of 2 |
| words | 2 of 2 | 2 of 2 |

Every conversation read the crib and checked its draft; every working one
suggested once, in 4 to 7 requests, after one check (20 of 31), two (7) or
three (4). The one failure is an English BMI calculator that checked its draft
six times and ran out of its 8 tool rounds before suggesting anything. The
Dutch applications are Dutch on screen ("Rekeningsplitser", "Gemiddelde: 15.2",
"Woorden: 3 Tekens: 13") and were found by their Dutch labels, and every Dutch
reply and application addresses the person formally (u, never je). The assistant's own check is what the bare
author lacks: it sees the screen after its probes before it suggests. Reports:
`benchmark/results/authoring-conversation-en.json` and `-nl.json` (task file
version 3). Token counts are not recorded for these runs: the agent's replies
stream, and the counting reads only whole JSON bodies.

## The author alone

### The table

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

- The first author run (task file version 1) had 21 of 24: three shopping lists
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

Eight tasks are small applications; a request that needs several screens,
data from another application or a file is not among them. One turn is
measured: a person who corrects the result in a second turn is not. Dutch is
the one other language measured, and the probes find Dutch labels only for
these tasks' words.
