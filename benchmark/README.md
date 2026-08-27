# The measurement workspace

Every number this repository publishes is produced by an instrument in this
folder, and every instrument names the command that reproduces it. Nothing
here is needed to *use* Tangle — it is needed to *believe* it.

The shape is jarenjs's benchmark workspace, re-derived for this repo: upstream
suites arrive as git submodules, tools are plain scripts run from the
repository root, and a shared `lib/` holds the few primitives the suite below
us does not publish.

## Why this is a workspace of its own

`package.json` here is private and separate on purpose. CONVENTIONS §1 binds
the shipped packages to `@jarenjs/*` and `@tangleai/*` only — but a benchmark
earns its credibility by measuring against **rivals**, and a rival is a
third-party dependency. Keeping them in this workspace is how a comparison
against another memory system can ever be run without a single new dependency
entering the packages a user installs. jarenjs does exactly this: turf,
sqlite-vec, ajv, XState and a dozen others live in its benchmark workspace and
nowhere else.

## Contents

| Instrument | What it answers | Command |
|---|---|---|
| [`locomo-census.ts`](./locomo-census.ts) | What is actually in the LoCoMo release — categories, ground truth, parseable timestamps, and how many evidence ids resolve | `npm run benchmark:locomo:census` |
| [`scripts/locomo-parity-fixtures.py`](./scripts/locomo-parity-fixtures.py) | The parity oracle: loads the official `task_eval/evaluation.py` verbatim (`bert_score` stubbed) and RUNS it over a hand-authored table and over the release's vocabulary, writing `test/fixtures/locomo-parity*.json` — the rows the TypeScript scorer must reproduce at ten decimals. Needs Python with `nltk`, `regex`, `numpy` | `npm run benchmark:locomo:parity` |
| [`locomo-recall.ts`](./locomo-recall.ts) | The keyless ceiling: evidence recall@{5,10,20} per category over the 1,540 scorable questions, for the pipeline with its policies off and on, beside a recency baseline and the two gate rows — with the ingest census of what each policy did. Report: [`results/locomo-recall.json`](./results/locomo-recall.json), rendered as [`docs/LOCOMO_RECALL.md`](../docs/LOCOMO_RECALL.md) | `npm run benchmark:locomo:recall` (`--json`, `--md`, `--samples`, `--dims`, `--seed`, `--novelty`, `--contradiction`, `--crystallize`) |
| [`locomo-qa.ts`](./locomo-qa.ts) | The answer path, and the baselines that make it mean something: one table, one scorer, one sample — the whole conversation in the request (the paper's headline baseline), retrieval over raw dialog turns (the pipeline with every policy inert), retrieval over the release's own `observation` and `session_summary` corpora ingested as evidence-carrying memories, the suite's `createLongHorizonAgent` over `createEnvironment`, and Tangle — each with the evidence-recall ceiling at k beside the official F1 of a real model's answers, the cost (`createBudgetAccount`, provider `usage`) and p50/p95 latency in the same row; citations checked against the prompt; category 5 through an LLM judge, apart; per-question results kept so rows are compared over the questions they all answered. The keyless tier (the scorer's gate, every model-free ceiling, a verbatim floor, the seeded sample) is the committed, byte-reproducible report [`results/locomo-qa.json`](./results/locomo-qa.json); `--live --rows …` answers a chosen subset of rows through the desktop's provider settings read from `.env` and MERGES the run into the dated [`results/locomo-qa-live.json`](./results/locomo-qa-live.json) — six rows do not fit one `TANGLE_AI_MAX_CALLS`, so the document records every run with its plan and spend, and refuses a run that would put a second model in the table. No key is a stated skip; a plan over the ceiling is skipped before the first request; what an earlier run bought under the same model is replayed from the wire cache (`lib/wire-cache.ts`) and counted as such. Rendered as [`docs/LOCOMO_BENCHMARK.md`](../docs/LOCOMO_BENCHMARK.md) | `npm run benchmark:locomo:qa` (`--live`, `--rows`, `--json`, `--live-json`, `--md`, `--k`, `--questions`, `--adversarial`, `--seed`, `--samples`, `--dims`, `--thinking`, `--horizon-questions`, `--horizon-depth`, `--horizon-turns`, `--horizon-subcalls`, `--call-timeout`, `--author-thinking`, `--cache`, `--fresh`) |

`lib/` holds what the suite does not publish and what therefore must exist
exactly once here:

| Module | Why it is not an import |
|---|---|
| [`lib/stats.ts`](./lib/stats.ts) | `@jarenjs/core/math` is the graphics/numeric kernel — no median, no percentile anywhere in a published package. This is the only place in the repo that computes a quantile. |
| [`lib/table.ts`](./lib/table.ts) | The Markdown table idiom `docs/DOCUMENT_BENCHMARK.md` already publishes, extracted so a second instrument does not invent a second format. |
| [`lib/args.ts`](./lib/args.ts) | An unknown flag is an error, not a silent default — a benchmark that ignored `--sizes` would publish the wrong row under the right name. |
| [`lib/locomo.ts`](./lib/locomo.ts) | Loading, validating and reading the LoCoMo release. Nothing is repaired here. |
| [`lib/locomo-corpus.ts`](./lib/locomo-corpus.ts) | Turns as Tangle observations: one memory per turn, `evidence` = `<sample_id>/<dia_id>`, `at` = the session instant. The `seq` a turn has inside its session lives here, not on the record — LoCoMo stamps sessions, not turns. Also the release's two derived corpora as inputs (an observation cites the dia_ids it was written from, a summary its whole session — counted, never repaired) and the transcript as units whose ids are the release's own turn ids, for the long-context row. |
| [`lib/recall.ts`](./lib/recall.ts) | The official `recall_acc`, the k-dependent oracle ceiling, and the hypergeometric band a seeded draw must land in. Fractional recall, unlike jarenjs's recall@k — so an oracle is not 1.000 at every k, and the gate knows why. |
| [`lib/random.ts`](./lib/random.ts) | mulberry32 and one distinct draw — the only random source an instrument may use. No published package has a seeded PRNG; `@tangleai/core`'s k-means injects one. |
| [`lib/locomo-recall.ts`](./lib/locomo-recall.ts) | The run itself, the gate, and the Markdown derived from the report. Importable, so the tests run it. |
| [`lib/porter.ts`](./lib/porter.ts) | The Porter stemmer as NLTK runs it (`NLTK_EXTENSIONS`, the official scorer's default) — ported branch for branch over code points, because there is no stemmer anywhere in `@jarenjs/*` and the paper's variant would differ on the third decimal of every F1. |
| [`lib/locomo-ingest.ts`](./lib/locomo-ingest.ts) | One conversation through the real pipeline — one store, one `pipeline.run` per session, the clock the last session instant, the census of what each policy did — shared by the recall and answer instruments so the policy matrix tunes one ingest, not two. |
| [`lib/ai-env.ts`](./lib/ai-env.ts) | The ONE reader of the live-model environment (`TANGLE_AI_*`, `OPENROUTER_AI_KEY`), jarenjs's `readAiEnv` method: a missing key is a stated skip, the key is never printed, the spend guards are ceilings. It resolves to the desktop's `ChatSettings`/`EmbedSettings`, so a benchmark builds its clients with the app's own factories. |
| [`lib/locomo-qa.ts`](./lib/locomo-qa.ts) | The answer path: the six rows, the grounded prompt and its `{ answer, citations }` schema, the citation check, the seeded stratified sample and the long-horizon row's seeded subset of it, the keyless and live runs, the long-horizon harness (a fresh environment per question, the agent's client metered, deadlined and probed for the ceiling), the category-5 judge, the merge of live runs, and the Markdown. |
| [`lib/wire-cache.ts`](./lib/wire-cache.ts) | Everything a live tier has paid for, kept: every embedding and every chat completion, in one SQLite file through `@jarenjs/db` (`benchmark/cache/wire.sqlite`, gitignored), keyed by the whole identity of what was asked — the embedder's model and the text's hash; the provider, base, model, messages, response format, thinking control and sampling knobs of a completion — and never by the credential, which is never stored. A run behind it plans only the embedding requests the cache cannot answer and REPLAYS the completions it remembers, each replay counted in the row and the run and charged to no budget, so filling a rate-limited row costs the missing answers rather than a run, and the policy matrix does not re-buy the corpus per cell. It stores as much as it can — the text beside its vector, the whole request and reply with the provider's usage and the call's wall time — which makes it the audit trail of every live call. `--fresh` ignores it (and still fills it); `--cache PATH` moves it, `--cache none` runs without it; `rm -rf benchmark/cache` starts over. |
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
