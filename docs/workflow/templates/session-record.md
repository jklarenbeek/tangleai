# Session record — the template, then a real one

A session record is written once, after the work is green, by the session
that executed a work order. It is the evidence: numbers, not adjectives —
test counts, the typecheck result, the instrument's figure the order's
acceptance names — plus what was decided, what was left, and what the next
session must know. Campaigns keep it as the gitignored
`TODO_<PROGRAM>_NN_RECORD.md` beside the order (`../CONVENTIONS.md` §3); the
router's status ledger is updated in the same session. The record is not the
commit message: the operator decides whether and when a commit happens, and
writes that message from the record when it does.

## The template

```markdown
# Session record — TODO_<PROGRAM>_NN <title> (<date>)

## Summary

<What shipped, in the past tense, three to six sentences. Lead with the
outcome; name the user-observable behavior or the number, not the diff.>

## Files

<Every file created/modified/deleted, one line each: path — what
changed and why it had to.>

## Decisions & divergences

<Choices the work order left open and how they were settled; every
divergence from the order's design with its reason. "None" is a valid,
meaningful entry. A conflict with a router D-number is recorded here
and NOT resolved unilaterally. Include the drop list: what was
investigated and found unfounded, one line each (what, why not), so
the next session does not repeat it.>

## Measurement

<The number the order exists to move, before and after, from the
instrument that produced it, and the committed document it now lives
in. The loss beside the win. "n/a — surface work, shows only what a run
did" is the only allowed substitute, and only when the order said so.>

## Test & gate output

<`npm run check` pasted as counts: the typecheck result, tests / pass /
fail / skipped; `npm run skeleton` when the order named it; each
instrument the order named with the figure it printed and whether the
committed document was regenerated; the e2e or the binary smoke when
the order touched a surface. Numbers, never "all green".>

## Open issues

<Anything discovered but deliberately not done: follow-up candidates,
latent bugs found in neighboring code, upstream friction for
`JARENASK.md`. Each with enough context that a future
session needs no archaeology.>

## Handoff

<Only when a next session depends on this one; otherwise "None".
Everything here must be actionable without this session's context:
the state of the program the router's ledger cannot carry ("order 03
landed but its acceptance item 3 is deferred into 05"); open follow-ups,
file-anchored (path, what is pending, why it waited — "must do next"
kept apart from "backlog"); contracts a later order must honor (a new
export, a report schema block another order extends, a setting whose
identity a migration would depend on); and the traps the next executor
cannot see coming (a test that goes red only when the submodule is
absent, a generated document that must be regenerated together with
its JSON, an invariant that breaks silently).>
```

## A real one, reconstructed

The record for the example order in [`work-order.md`](work-order.md),
written after the fact from the work as it shipped (commit `90af07c`) — not
by an executor at the time. The first order executed under this playbook
replaces both examples with the real pair.

```markdown
# Session record — TODO_LOCOMO_03 the scorer, at parity with the published evaluator (2026-08-27)

## Summary

The repo now scores a LoCoMo answer exactly as `task_eval/evaluation.py`
does: `benchmark/lib/porter.ts` and `benchmark/lib/locomo-parity.ts`
port `normalize_answer`, `f1_score` and the multi-hop `f1` branch for
branch, with the stemmer as the NLTK `PORTER_EXTENSIONS` variant over
code points. Parity is a fixture set the official evaluator itself
produced: 21 normalizations, 165 stems and 45 F1 rows of Tangle-authored
text committed, the release's whole 3,263-token answer vocabulary as a
word list committed, and 4,602 dataset-derived rows in the gitignored
`test-output/`. Every row reproduces at ten decimals; every stem exactly.
The released answer scores exactly 1.000 against itself in categories
1–4 once category 3 is cut as the evaluator cuts it, and 0.927 uncut —
the published asymmetry, kept as a number.

## Files

- `benchmark/lib/porter.ts` — the stemmer; NLTK variant; code points,
  not UTF-16 units, so an astral character is one consonant.
- `benchmark/lib/locomo-parity.ts` — `normalizeAnswer` in the official
  order; `f1` over stemmed multisets; comma multi-hop over RAW strings;
  category-3 cut; `String()` for the six integer answers; `mean` with
  NumPy's pairwise summation.
- `benchmark/scripts/locomo-parity-fixtures.py` — loads the official
  evaluator verbatim with `bert_score` stubbed; writes every fixture and
  records Python 3.14.7 / nltk 3.10.3 / regex 2026.7.19 / numpy 2.4.6.
- `test/fixtures/locomo-parity.json`,
  `test/fixtures/locomo-parity-vocabulary.json` — committed fixtures.
- `test/benchmark/locomo-parity.test.ts` — every fixture row; the four
  edge cases pinned without a fixture; stated skip when `test-output/`
  is absent.
- `package.json` — `benchmark:locomo:parity`.

## Decisions & divergences

- Three Python primitives were measured over every code point rather
  than approximated, because the first port disagreed on `\b`: `regex`'s
  word boundary is `[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}‌‍]`,
  `str.split()` is 29 explicit whitespace characters, `str.lower()`
  differs from `toLowerCase()` on 28 code points (none in the release).
- The dataset-derived rows are NOT committed: they redistribute LoCoMo
  (CC BY-NC 4.0 under an MIT repo). The test skips with the reason.
- Drop list: a "fix" for the 11 category-3 answers that cannot match
  themselves uncut — dropped, parity means reproducing the asymmetry;
  a JavaScript `\b` under the `u` flag — dropped, it is ASCII-only.

## Measurement

Released answer as its own prediction, categories 1–4: 1.000 / 1.000 /
1.000 / 1.000 with the category-3 cut; 0.927 overall without it. No
answer in the release normalizes to the empty string. Published in
`docs/LOCOMO_BENCHMARK.md` as the scorer's gate, which refuses to print
a row until it holds.

## Test & gate output

- `npm run typecheck` — strict, 0 errors.
- `npm test` — 214 tests, 214 pass, 0 fail (parity rows included; the
  4,602 dataset-derived rows present in `test-output/` on this host).
- `npm run benchmark:locomo:parity` — fixtures regenerated, byte-identical
  to the committed ones.

## Open issues

- The stemmer and normalizer are the only string metrics in the repo and
  are benchmark-only; if a product path ever needs a tokenizer, that is a
  boundary question for `docs/BOUNDARY.md`, not a copy.

## Handoff

The answer path (next order) must call `f1` with the RAW prediction and
truth — the comma split happens before normalization and a caller that
normalizes first silently changes multi-hop scores. The category-3 cut is
applied to the TRUTH only, never the prediction.
```
