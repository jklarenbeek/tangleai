# Work order — the template, then a real one

A work order is the unit a fresh session executes: self-contained, so a
session holding only [`../BOOTSTRAP.md`](../BOOTSTRAP.md), the campaign
router, this file and the repository can do the work without conversation
context. Campaigns keep orders as gitignored `TODO_<PROGRAM>_NN.md` files
next to their router (`../CONVENTIONS.md` §3); the sections below are
required in this order, and the acceptance checklist **is** the definition of
done — nothing more, nothing less. An order that exists to move a number
names that number in its checklist; an order is closed by its measurement,
not by its merge.

## The template

```markdown
# TODO_<PROGRAM>_NN — <title>

Router: `TODO_<PROGRAM>.md`. **Binding: D<n>, D<m>.** **Depends on <orders>.**

Read first: <the specific files, with the functions and line references
that matter, whose conventions the new code must match; restate any
context the executor cannot infer — including the row of
`docs/BOUNDARY.md` §"What the suite already has" this order consumes>.

Salvage: <where in `docs/attic/` the tuned knowledge for this order lives —
thresholds, specs, seed data — or "none">.

## Goal

<One or two sentences: the observable end state, not the activity.>

## Design

<The intended shape of the change: module boundaries, data shapes, error
surfaces, edge rules, and the reasoning behind any non-obvious choice.
Decisions made here are made — an executor extends them, it does not
relitigate them. Where the order carries a diagnosis (a bug's root cause,
failures sharing one fix), put it here in full with the concrete input and
the expected-vs-actual output.>

## Files

<The files to create or modify, with one clause each on what changes.>

## Steps

1. <Ordered, verifiable steps, each small enough to test; `npm run check`
   between batches so a regression is attributable. Step 0 is
   "re-measure" whenever an earlier order moved this order's target.>
2. …

## Acceptance checklist

- [ ] <Behavioral assertions, each independently checkable — exact test
      names, exact outputs, exact error codes.>
- [ ] <The measurement: the number this order exists to move, the
      instrument that produces it, and the committed document it is
      published in — with the loss beside the win if there is one.>
- [ ] Full gate green — `npm run check` (`../CONVENTIONS.md` §2), with the
      test count and typecheck result in the record, plus whatever this
      order names (`npm run skeleton`, an instrument, the e2e).
- [ ] Session record written (`TODO_<PROGRAM>_NN_RECORD.md`); router
      ledger updated.
- [ ] Reviewed green work committed locally on `main` under the single-line
      conventions; commit hash recorded in the record and ledger. Version
      preparation, release closeout, tag and push wait for full campaign completion.
```

## A real one, reconstructed

The order below is the scorer-parity step of the LoCoMo instrument, written
after the fact from the work as it shipped (commit `e471807`) so that the
shape has a real example against this repository. It was NOT executed from
this text by a fresh session — the first order that is replaces it, together
with the record it produces ([`session-record.md`](session-record.md)).

```markdown
# TODO_LOCOMO_03 — the scorer, at parity with the published evaluator

Router: `TODO_LOCOMO.md`. **Binding: D2 (parity over improvement), D5
(no clock in any report).** **Depends on 01 (the census, which fixes the
category numbering and the 1,540 scorable questions).**

Read first: `benchmark/locomo/task_eval/evaluation.py` (`normalize_answer`,
`f1_score`, `f1` — the multi-hop variant that splits on `,` first — and
the category-3 cut at the first `;`); `benchmark/lib/recall.ts` (the
recall scorer's style: pure functions, fixtures under `test/fixtures/`,
one `describe` per function); `test/benchmark/locomo-recall.test.ts`
(the pinned-fixture convention to match). The suite has no tokenizer,
stemmer or string-similarity metric — `docs/BOUNDARY.md` §"Build it
here" — so this order writes them once, in `benchmark/lib/`.

Salvage: `docs/attic/memflow-PLAN_LOCOMO_INTEGRATION.md` §3 (the
category table and the evaluator's known asymmetries); nothing else —
memflow never reached the scorer.

## Goal

An F1 in this repo is the official evaluator's F1 to ten decimals on
every answer in the release, so a published number is comparable to the
paper's and to every system that used the same script.

## Design

Port `task_eval/evaluation.py` to the letter, not to the idea:
`normalizeAnswer` in the official order (commas, lower-case, punctuation,
then the articles `a|an|the|and`, then whitespace — so `the-cat` keeps its
article); `f1` over NLTK-stemmed multisets; the multi-hop variant that
splits the RAW strings on `,` before normalizing; category 3 truth cut at
its first `;`; integer answers coerced with `String()` (the census found
six); category 5 excluded from scoring (444 of 446 carry no `answer`).

The stemmer is **NLTK's `PORTER_EXTENSIONS` variant**, the official
default, not the 1980 paper — ported branch for branch over CODE POINTS so
an astral character is one consonant here as it is in Python. Three
Python primitives are reproduced rather than approximated, each pinned by
a fixture: `regex`'s `\b` (`[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}‌‍]`
— a JavaScript `\b` is ASCII even under `u`), `str.split()` (29 explicit
whitespace characters), `str.lower()` (28 code points where
`toLowerCase()` disagrees; none in the release). `np.mean` is reproduced
down to pairwise summation so a nineteen-part answer agrees to the bit.

Parity is proven by fixtures the official evaluator PRODUCED, never by
reading it: a Python script loads `evaluation.py` verbatim (stubbing
`bert_score`, which the module imports at the top and only its own
BERTScore path calls) and writes expected values for Tangle-authored
text, for the release's whole answer vocabulary as a word list, and for
every dataset answer scored against itself and against its gold turns.
The dataset-derived rows redistribute LoCoMo, so they are written to the
gitignored `test-output/` and the test skips with a stated reason when
they are absent.

## Files

- `benchmark/lib/porter.ts` — the stemmer, NLTK variant, code points.
- `benchmark/lib/locomo-parity.ts` — `normalizeAnswer`, `f1`, the
  multi-hop and category-3 rules, `mean` with pairwise summation.
- `benchmark/scripts/locomo-parity-fixtures.py` — runs the official
  evaluator to produce every fixture; records its interpreter and
  library versions in the output.
- `test/fixtures/locomo-parity.json`,
  `test/fixtures/locomo-parity-vocabulary.json` — committed fixtures
  (Tangle-authored text; the vocabulary as a word list, not the text).
- `test/benchmark/locomo-parity.test.ts` — every fixture row reproduced;
  the edge cases named below pinned without a fixture.
- `package.json` — `benchmark:locomo:parity` runs the fixture script.

## Steps

1. Read the four files above; list every branch of `normalize_answer`,
   `f1_score` and the stemmer in the order the Python executes them.
2. Port the stemmer; run the vocabulary fixture until every stem matches.
3. Port `normalizeAnswer` and `f1`; run the Tangle-authored fixture.
4. Generate the dataset-derived rows; run them; investigate every
   mismatch as a port error first and a Python primitive second.
5. Pin the edge cases: empty prediction → 0, integer answer, `;` truth,
   comma multi-hop. `npm run check`.

## Acceptance checklist

- [ ] Every committed fixture row reproduces at ten decimals; every stem
      exactly; the dataset-derived rows likewise when present.
- [ ] The measurement: the released answer, scored as its own prediction,
      reaches exactly 1.000 in categories 1–4 once category 3 is cut as the
      evaluator cuts it, and the verbatim asymmetry (11 category-3
      answers that cannot match themselves uncut) is published as a
      number, not fixed.
- [ ] `test/benchmark/locomo-parity.test.ts` skips with a stated reason,
      never fails, when `test-output/` is absent.
- [ ] Exactly one stemmer and one normalizer exist in the repo, grep-proven.
- [ ] Full gate green — `npm run check`, test count in the record.
- [ ] Session record written (`TODO_LOCOMO_03_RECORD.md`); router ledger
      updated.
```
