# The measurement workspace

Every number this repository publishes is produced by an instrument in this
folder, and every instrument names the command that reproduces it. Nothing
here is needed to *use* Tangle — it is needed to *believe* it.

The shape is jarenjs's benchmark workspace, re-derived for this repo: upstream
suites arrive as git submodules, tools are plain scripts run from the
repository root, and a shared `lib/` holds host-specific instruments, report
shaping and adapters around the primitives the suite publishes.

## Why this is a workspace of its own

`package.json` here is private and separate on purpose. CONVENTIONS §1 binds
the shipped packages to `@jarenjs/*` and `@tangleai/*` only — but a benchmark
earns its credibility by measuring against **rivals**, and a rival is a
third-party dependency. Keeping them in this workspace is how a comparison
against another memory system can ever be run without a single new dependency
entering the packages a user installs. jarenjs does exactly this: turf,
sqlite-vec, ajv, XState and a dozen others live in its benchmark workspace and
nowhere else.

The [JarenJS integration comparison](../docs/JARENJS_BENCHMARK.md) records
Node/Bun history strategies; the [integration audit](../docs/JARENJS_INTEGRATION.md)
explains choices against the pinned upstream benchmarks. Reproduce it with
`npm run benchmark:jaren` (keyless).

## Contents

| Instrument | What it answers | Command |
|---|---|---|
| [`locomo-census.ts`](./locomo-census.ts) | What is actually in the LoCoMo release — categories, ground truth, parseable timestamps, and how many evidence ids resolve | `npm run benchmark:locomo:census` |
| [`scripts/locomo-parity-fixtures.py`](./scripts/locomo-parity-fixtures.py) | The parity oracle: loads the official `task_eval/evaluation.py` verbatim (`bert_score` stubbed) and RUNS it over a hand-authored table and over the release's vocabulary, writing `test/fixtures/locomo-parity*.json` — the rows the TypeScript scorer must reproduce at ten decimals. Needs Python with `nltk`, `regex`, `numpy` | `npm run benchmark:locomo:parity` |
| [`locomo-recall.ts`](./locomo-recall.ts) | The keyless ceiling: evidence recall@{5,10,20} per category over the 1,540 scorable questions, for the pipeline with its policies off and on, beside a recency baseline and the two gate rows — with the ingest census of what each policy did. Report: [`results/locomo-recall.json`](./results/locomo-recall.json), rendered as [`docs/LOCOMO_RECALL.md`](../docs/LOCOMO_RECALL.md) | `npm run benchmark:locomo:recall` (`--json`, `--md`, `--samples`, `--dims`, `--seed`, `--novelty`, `--contradiction`, `--crystallize`) |
| [`locomo-qa.ts`](./locomo-qa.ts) | The answer path, and the baselines that make it mean something: one table, one scorer, one sample — the whole conversation in the request (the paper's headline baseline), retrieval over raw dialog turns (the pipeline with every policy inert), retrieval over the release's own `observation` and `session_summary` corpora ingested as evidence-carrying memories, the suite's `createLongHorizonAgent` over `createEnvironment`, and Tangle — each with the evidence-recall ceiling at k beside the official F1 of a real model's answers, the cost (`createBudgetAccount`, provider `usage`) and p50/p95 latency in the same row; citations checked against the prompt; category 5 through an LLM judge, apart; per-question results kept so rows are compared over the questions they all answered. The keyless tier (the scorer's gate, every model-free ceiling, a verbatim floor, the seeded sample) is the committed, byte-reproducible report [`results/locomo-qa.json`](./results/locomo-qa.json); `--live --rows …` answers a chosen subset of rows through the desktop's provider settings read from `.env` and MERGES the run into the dated [`results/locomo-qa-live.json`](./results/locomo-qa-live.json) — six rows do not fit one `TANGLE_AI_MAX_CALLS`, so the document records every run with its plan and spend, and refuses a run that would put a second model in the table. No key is a stated skip; a plan over the ceiling is skipped before the first request; what an earlier run bought under the same model is replayed from the wire cache (`lib/wire-cache.ts`) and counted as such. Rendered as [`docs/LOCOMO_BENCHMARK.md`](../docs/LOCOMO_BENCHMARK.md) | `npm run benchmark:locomo:qa` (`--live`, `--rows`, `--json`, `--live-json`, `--md`, `--k`, `--questions`, `--adversarial`, `--seed`, `--samples`, `--dims`, `--thinking`, `--horizon-questions`, `--horizon-depth`, `--horizon-turns`, `--horizon-subcalls`, `--call-timeout`, `--author-thinking`, `--cache`, `--fresh`) |
| [`config-conformance.ts`](./config-conformance.ts) | The identity instrument: 44 registered equivalence/sensitivity/refusal/legacy cases measured against the tree — every case `holds`, `gap` (a defect published as one, never encoded as expected) or `pending` — plus the construction-path census (the one factory pair, the host inputs, the run producers, the artifacts and the desktop contract revision). Keyless, clock-free, byte-reproducible; the schema's `$query` refuses a report whose counts do not reconcile and its gate counters are literal zeros. Report: [`results/config-conformance.json`](./results/config-conformance.json) | `npm run benchmark:config` (`--out`, `--contract-fixture`) |
| [`grounding.ts`](./grounding.ts) | The document-grounding instrument: a Tangle-authored MIT fixture (8 sources, 16 questions, 24 expected material claims under `fixtures/grounding/` — the corpus, the closed matching predicates, the per-question supply trace and the scripted answers are all committed data), the one `{ claims, citations }` answer contract both scripted and live paths generate through `createStructuredOutput` (the schema object is the DESKTOP's — `apps/desktop/src/grounding.ts` — so the measured contract and the shipped one cannot drift), one-to-one predicate claim matching, and a citation state machine whose every visible citation ends in exactly one terminal outcome (`supporting`, `resolved-not-supporting`, `not-supplied`, `inactive-version`, `future-evidence`, `unknown-evidence`). The oracle must reach exact 1.000 ceilings before a table prints; every named bad answer must land on its intended terminal reason. The keyless tier is clock-free and byte-reproducible; `--live` prints a frozen credential-free dry plan (exact cache hits, maximum fresh calls, ceilings) and spends NOTHING — only `--live --authorize <plan-id>` executes exactly it, running the paired `no-documents` / `documents-retrieved` / `grounded-answer` rows over the fixture and a seeded 16-question LoCoMo slice, both built through the shipped ingester/chunker/store/retriever at the current defaults; a replay reproduces the identical report identity with zero wire calls, and the document carries the mechanical product decision its own schema recomputes. `--web-live --searx <base> --authorize-web <plan-id>` runs the optional dated SearxNG-vs-curated diagnostic through the HTTP capture; without an endpoint or authorization it records a schema-valid not-run. Reports: [`results/grounding.json`](./results/grounding.json) (keyless, committed), [`results/grounding-live.json`](./results/grounding-live.json) (the dated paid attempt), [`results/grounding-web-live.json`](./results/grounding-web-live.json) (the dated web record), rendered together as [`docs/GROUNDING_BENCHMARK.md`](../docs/GROUNDING_BENCHMARK.md) | `npm run benchmark:grounding` (`--json`, `--md`, `--live`, `--authorize`, `--fresh`, `--thinking`, `--cache`, `--live-json`, `--web-live`, `--searx`, `--authorize-web`, `--web-json`, `--http-capture`, `--fresh-http`) |
| [`grounding-query.ts`](./grounding-query.ts) | The committed [`queries/grounding/flat-baseline.json`](../queries/grounding/flat-baseline.json) FLWOR document executed verbatim with `compileJsonQuery` over the validated live and web reports: one immutable, clock-free handoff naming the report/registration/fixture/plan/source/config identities, the exact flat-row treatment values and question ids, every metric with its bounds, all four registered decision clauses and the product decision, and the separately labelled diagnostics. Two renders are byte-identical; a stale decision or modified query is refused. This handoff — not a prose copy of favorable metrics — is what a later retrieval treatment must beat. Report: [`results/grounding-handoff.json`](./results/grounding-handoff.json) | `npm run benchmark:grounding:handoff` (`--out`, `--live`, `--web`) |
| [`config-queries.ts`](./config-queries.ts) | The three committed `@jarenjs/json` FLWOR documents under [`queries/config/`](../queries/config/) executed verbatim with `compileJsonQuery` over validated inputs: the identity inventory of every artifact row, the same-request-across-hosts comparison that never collapses different effective identities, and the temporal-stack question over the answer artifacts. Report: [`results/config-queries.json`](./results/config-queries.json) | `npm run benchmark:config:queries` (`--out`) |

`lib/` holds Tangle's benchmark-specific work exactly once here:

| Module | Why it is not an import |
|---|---|
| [`lib/stats.ts`](./lib/stats.ts) | Report shaping over `@jarenjs/core/stats`: nearest-rank p50/p95 and `null` for an empty rendered cell. No local arithmetic. |
| [`lib/table.ts`](./lib/table.ts) | The Markdown table idiom `docs/DOCUMENT_BENCHMARK.md` already publishes, extracted so a second instrument does not invent a second format. |
| [`lib/args.ts`](./lib/args.ts) | An unknown flag is an error, not a silent default — a benchmark that ignored `--sizes` would publish the wrong row under the right name. |
| [`lib/locomo.ts`](./lib/locomo.ts) | Loading, validating and reading the LoCoMo release. Nothing is repaired here. |
| [`lib/locomo-corpus.ts`](./lib/locomo-corpus.ts) | Turns as Tangle observations: one memory per turn, `evidence` = `<sample_id>/<dia_id>`, `at` = the session instant. The `seq` a turn has inside its session lives here, not on the record — LoCoMo stamps sessions, not turns. Also the release's two derived corpora as inputs (an observation cites the dia_ids it was written from, a summary its whole session — counted, never repaired) and the transcript as units whose ids are the release's own turn ids, for the long-context row. |
| [`lib/recall.ts`](./lib/recall.ts) | The official `recall_acc`, the k-dependent oracle ceiling, and the hypergeometric band a seeded draw must land in. Fractional recall, unlike jarenjs's recall@k — so an oracle is not 1.000 at every k, and the gate knows why. |
| [`lib/locomo-recall.ts`](./lib/locomo-recall.ts) | The run itself, the gate, and the Markdown derived from the report. Importable, so the tests run it. |
| [`lib/porter.ts`](./lib/porter.ts) | The Porter stemmer as NLTK runs it (`NLTK_EXTENSIONS`, the official scorer's default) — ported branch for branch over code points, because there is no stemmer anywhere in `@jarenjs/*` and the paper's variant would differ on the third decimal of every F1. |
| [`lib/locomo-ingest.ts`](./lib/locomo-ingest.ts) | One conversation through the real pipeline — one store, one `pipeline.run` per session, the clock the last session instant, the census of what each policy did — shared by the recall and answer instruments so the policy matrix tunes one ingest, not two. |
| [`lib/ai-env.ts`](./lib/ai-env.ts) | The ONE reader of the live-model environment (`TANGLE_AI_*`, `OPENROUTER_AI_KEY`), jarenjs's `readAiEnv` method: a missing key is a stated skip, the key is never printed, the spend guards are ceilings. It resolves to the desktop's `ChatSettings`/`EmbedSettings`, so a benchmark builds its clients with the app's own factories. |
| [`lib/locomo-qa.ts`](./lib/locomo-qa.ts) | The answer path: the six rows, the grounded prompt and its `{ answer, citations }` schema, the citation check, the seeded stratified sample and the long-horizon row's seeded subset of it, the keyless and live runs, the long-horizon harness (a fresh environment per question, the agent's client metered, deadlined and probed for the ceiling), the category-5 judge, the merge of live runs, and the Markdown. |
| [`lib/wire-cache.ts`](./lib/wire-cache.ts) | The SQLite adapter/audit trail for the cache seam on JarenJS's chat and embedding clients. JarenJS constructs the complete effective credential-free key, owns partial hits and marks replays; Tangle stores the full key beside its SHA-256 id, packs vectors, exposes endpoint-aware embedding hits to the spend preflight, and retains pre-0.56 rows as audit-only legacy data. `--fresh` ignores reads while still filling; `--cache PATH` moves it; `--cache none` disables it. |
| [`lib/grounding-run.ts`](./lib/grounding-run.ts) | The paired baseline: fixture and seeded LoCoMo corpora built through the shipped ingester/chunker/store/retriever at the current defaults, the three registered rows (`no-documents`, `documents-retrieved`, `grounded-answer`) sharing every control but the evidence, the frozen credential-free dry plan whose exact `planId` an explicit `--authorize` must match, one budget account, the suite's structured output and bounded mapper, and the clock/cost-free live report identity a zero-spend replay reproduces. |
| [`lib/grounding-web.ts`](./lib/grounding-web.ts) | The optional captured web diagnostic: six fixed RFC 9110 questions, the registered first-3-distinct-normalized-URLs SearxNG selection (order kept, refusals named, snippets counted and never evidence), acquisition through `ingestMany` into a real store, the two answer rows, and the schema-valid `notRun` state a missing SearxNG or declined authorization records instead of failing CI. |
| [`lib/http-capture.ts`](./lib/http-capture.ts) | The benchmark-owned SQLite HTTP capture (`benchmark/cache/grounding-http.sqlite`, gitignored): exact response bytes/status/headers per credential-free request, byte SHA-256s, replay serving stored bytes with zero network calls, missing/malformed captures as named failures, and the body-free manifest reports carry. It never touches the JarenJS model replay key. |
| [`lib/grounding.ts`](./lib/grounding.ts) | The grounding fixture loader (hash-verified, schema-validated, quotes pinned to exactly one occurrence), the answer renderer that derives visible text from the claim ledger, the predicate matcher, the terminal citation classifier, the oracle gate and the keyless report/Markdown. Types are generated from `schemas/grounding.schema.json` by `jaren-emit`; identities are `canonicalSha256` over explicit payloads; the answer-F1 diagnostic reuses the official LoCoMo normalizer and token F1. The suite claim envelope owns generic reference integrity in the desktop gate; the fixture matching predicates and terminal support scorer remain Tangle-specific. |
| [`lib/locomo-parity.ts`](./lib/locomo-parity.ts) | `normalize_answer`, `f1_score`, the multi-hop `f1` and the category routing of `task_eval/evaluation.py`, to the letter — including the punctuation-before-articles order, `and` as an article, Python's `\b` and whitespace, and NumPy's pairwise mean. Category 5 answers a reason, never a number. |

`cache/` (gitignored, absent in a fresh clone) is the wire cache above — a pure
accelerator that may be deleted at any moment; nothing published depends on it,
and a run says in its report how much of it was replayed.

`schemas/` holds the committed contracts — the release as measured
(`locomo10.schema.json`) and every report an instrument writes
(`locomo-recall.schema.json`; `locomo-qa.schema.json` and
`locomo-qa-live.schema.json` extend it by `$ref` rather than forking it),
validated by `@jarenjs/validate` before a byte is written. `results/` holds
the committed reports; a test asserts each keyless report is exactly what
its command produces today, so a published number whose command no longer
reproduces it goes red. The one exception is stated: `locomo-qa-live.json`
is a dated record of a real model's run — validated, rendered and pinned to
the keyless sample by the tests, never regenerated by them.

## The submodules

| Path | Upstream | Licence |
|---|---|---|
| `locomo/` | [`snap-research/locomo`](https://github.com/snap-research/locomo) — the ACL 2024 benchmark, data and official evaluator | **CC BY-NC 4.0** |

```
git submodule update --init benchmark/locomo
```

A submodule rather than a vendored copy, for three reasons that are all
licence or honesty reasons:

- LoCoMo is **CC BY-NC 4.0** and this repository is MIT. A submodule is a
  pointer; nothing here redistributes the data.
- A submodule pins an exact upstream commit, so *which* LoCoMo produced a
  number is a hash in `.gitmodules` rather than a sentence in a README.
- The release ships `data/locomo10.json` in the repository itself, so there is
  no dataset URL to guess and no checksum to compare against a typed number.

**Every instrument degrades to a stated skip when its submodule is absent.**
A plain `git clone` does not fetch one, and a contributor who never runs a
benchmark should not meet a red gate. Pass `--require` to turn the skip into
an exit 1 where a run genuinely must have the data.

## The rules an instrument here follows

Inherited from jarenjs's harness, where each was learned by getting it wrong:

1. **A gate passes by exit code, never by grepping output.** Once, in jarenjs,
   a crashed linter was declared green because something printed the word
   "pass".
2. **Prove the scorer before printing a score.** An oracle row must be exactly
   right and a seeded random row must land inside its analytic band, or the run
   exits 1 naming the row. This is what catches a corpus whose gold ids do not
   exist — and LoCoMo has nine of those, which `locomo-census.ts` counts.
3. **Publish the ceiling beside the score.** A model-free ceiling — was the
   evidence in the request at all — is keyless, deterministic and cheap enough
   for CI. The gap between it and a real model's score is what says whether a
   miss was retrieval or prompting.
4. **A missing key is a stated skip, not a failure**, and a run that would
   exceed its call ceiling is skipped up front rather than half-spent.
5. **Losses are published beside wins.** A comparison that only reports
   victories is marketing, and this repo does not ship marketing.
6. **Nothing is repaired silently.** Malformed upstream data is counted and
   named. A benchmark that quietly fixes its own ground truth can no longer be
   compared with the published numbers.

## Attribution

LoCoMo — *Evaluating Very Long-Term Conversational Memory of LLM Agents*,
Maharana, Lee, Tulyakov, Bansal, Barbieri and Fang, ACL 2024
([arXiv:2402.17753](https://arxiv.org/abs/2402.17753)). Data and evaluation
code © Snap Inc., CC BY-NC 4.0.
