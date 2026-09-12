# Migrated Jaren AI instruments

Received from Jaren commit `3491513e164dc30e429c84e709bd738841f4df16`. Existing dates, costs, failures and provider measurements describe those historical runs. Current keyless runs are recorded separately.

## Historical context strategies

The same original corpus and budget expose both the needle and pairwise losses.

<!--fact:horizon.campaign-->
| configuration | needle | pairwise | what it cost the request |
| --- | --- | --- | --- |
| compaction alone (budget 6000) | 17.5% | 0.0% | 5781 chars |
| + a ledger (same budget) | 100.0% via recall | 0.0% | 5739 chars |
| + the environment and a program | 100.0% | 100.0% | 937 chars, against a 17719-char corpus |
<!--/fact-->

## long-horizon.js — agent context retention

What `createAgent`'s `historyBudget` compaction keeps, and what it destroys.
The measurement drives the **real agent** through N tool rounds against a
recording stub client, then asks whether the fact needed to answer is present
in the request the client receives.

Two tasks, because they scale differently:

- **needle** (linear) — the question asks for one record's value. Answerable
  if that one round survives, and it degrades gracefully with the budget. This
  is the task compaction is designed for.
- **pairwise** (quadratic) — the question is a relation over *every* pair
  ("which two records have the closest values"). It needs all N facts at once,
  which makes it all-or-nothing: with one value missing the answer is not
  determined by what is visible, because an absent record could be closer to a
  visible one than the visible best pair is to each other.

Two numbers for each, and both are published:

- **ceiling** — model-free and deterministic: is the fact needed to answer
  present in the request at all? It needs no key, costs nothing and cannot
  flake, which makes it the tier CI runs and the right way to state a
  structural claim.
- **actual** — what a real model scores over the same contexts. The **gap** is
  the interesting quantity: a large gap means the information was there and the
  model failed to use it, which is a prompt problem rather than a context
  problem. Publishing only one of the two would let a later change claim a win
  it did not earn.

The two ceilings are **not the same kind of number**, and the run says so
rather than letting a reader assume:

- the **needle** ceiling is a hard upper bound — a value that is not in the
  context cannot be read out of it. Its *actual* is a `JAREN_AI_TRIALS`-sample
  estimate, though, so at three trials it carries a wide error bar and the
  hit count is printed beside every percentage;
- the **pairwise** ceiling is **determinacy**: does the context determine the
  answer at all? A model can still name the true closest pair out of a subset
  that happens to contain it, so a pairwise actual may legitimately land above
  its own ceiling. The model-free `pair survived` column reports exactly when
  that was available, and the run prints every above-ceiling row with the
  reason attached.

And two payload shapes, because the shape changes the answer. The built-in
synopsis excerpts the **first 60 characters** of a dropped tool result, so a
fact at the front usually rides out inside that excerpt and a fact behind the
padding does not. Both run; the table labels them `front` and `late`, and
`late` is the realistic one. Reporting only `front` would flatter the package,
which is why neither shape may be dropped.

```bash
node benchmark/long-horizon.js                    # the ceilings; no key needed
npm run benchmark:long-horizon                    # the same, with .env loaded
node --env-file-if-exists=.env benchmark/long-horizon.js --live
node benchmark/long-horizon.js --live --trials 1 --budgets 6000 --verbose
```

The live tier is **opt-in and never mandatory**: with no key the ceilings still
print and the run says the live tier was skipped and why, then exits 0. Its
configuration comes from the environment through one helper
([`lib/env.js`](./lib/env.js) — the only live-model environment reader in the
workspace), loaded by Node itself with `--env-file-if-exists=.env`; there is no
dotenv dependency and there must never be one. See [`.env.example`](../.env.example)
for the variables and the spend guards (`JAREN_AI_MAX_CALLS`,
`JAREN_AI_MAX_CONCURRENCY`, `JAREN_AI_TRIALS`), which are hard ceilings rather
than hints. The model id is printed beside the numbers, so a published result
can never be misattributed, and the key itself is never logged.

A live call that fails or runs past its deadline is counted, reported in full
(the listing is capped, the count is not) and leaves its row's `actual` **null**
rather than a guess. The live tier **streams**, and that is a measured decision
rather than a default: unstreamed, this benchmark lost 13 of 72 calls to a
300-second deadline, all on the tightest budgets — which reads convincingly like
a model thinking harder about a compacted context, and is not. The identical
request answered in 2.9 seconds streamed after hanging past 300 seconds
unstreamed. The deadline is now only a backstop.

Two measurement decisions worth knowing about:

- **The live tier replays the gathering and asks one question.** The forty tool
  rounds are produced by the same deterministic stub the ceiling uses; the model
  is then asked a single question over exactly the context that was scored. That
  isolates the quantity the ceiling bounds — given this context, can the model
  answer? — and costs one call per trial instead of forty.
- **Values are globally unique six-digit integers.** Unique so presence is
  testable with a plain `includes` and no proximity window; six digits so every
  record serializes to the same byte length whatever the seed, since compaction
  cuts at byte-counted round boundaries.

The probe has its own self-tests in `test/ai/benchmark-probe.test.js`, and they
are not decoration: two probe bugs (searching the *stringified* transcript,
where a tool result's quotes are escaped; and a proximity regex, where the
padding separates an id from its value) each read 0/40 on **every** row
including the uncapped control. The control reading 40/40 in both payload
shapes is what tells those apart from a real finding.

The generated file is `packages/website/public/benchmarks/long-horizon.json`
(`npm run benchmark:generate` writes it, and the Benchmarks page renders it).
A keyless regeneration republishes it with empty `actual` columns and the skip
reason in its own metadata, rather than keeping numbers it did not measure.

## retrieval.js — did the right memory reach the prompt

`@jarenjs/ai`'s `recall()` is tag match and recency by default, and ranks by
meaning only through an injected embedder (`recall({ near })`, refused without
the seam). This is the instrument both stand on — built before the ranker, so
the ranker could be measured rather than assumed. Over a seeded ledger corpus
with gold labels it scores, per policy, whether the right memory reached the
prompt — recall@1/5/10 (a gold memory in the top k), MRR (the reciprocal rank of
the best-ranked gold memory) and the latency of one recall call — against an
oracle ceiling. Five rows, at two corpus sizes:

- **oracle** — the gold ids first. The 1.000 row that proves the scorer, and the
  first thing the run asserts, before it prints anything;
- **random** — a seeded draw, asserted to sit inside its analytic band (k/n,
  adjusted for questions with more than one gold memory);
- **recency** — the newest k, which is what `recall()` answers with no tags;
- **tag+recency** — the default: the question's words that are corpus tags,
  fed to the real `ledger.recall({ tags, limit })` over a real ledger loaded
  through `addMemory`. Nothing is simulated; the row scores the shipped code path;
- **near** — the ranked path: `ledger.recall({ near: question, limit })` over the
  SAME ledger, swept through `embedMissing()` with the deterministic reference
  embedder (`createHashEmbedder`, hashed character trigrams, 64 dims). The
  embedder is **lexical, not semantic** — two texts score high when they share
  letters — so this row is a *mechanism* score: the sweep, the identity check,
  the cosine rank, the tie-break and the limit work end to end over the shipped
  code path, and the same-words distractors are exactly what a lexical signal
  cannot tell apart. It is published whichever way it falls against the default,
  and it says nothing about what an embedding model would do.

Every row runs over the swept ledger — the ledger a host that adopted the seam
has — so the tag rows' latency includes carrying a 64-float vector per record
through the in-memory adapter's JSON copy; the scores are unchanged by it.

The corpus ([`fixtures/retrieval-corpus.json`](./fixtures/retrieval-corpus.json),
written by `scripts/generate-retrieval-corpus.js`, seeded and byte-identical run
to run — a test proves it) is **synthetic**: <!--fact:retrieval.corpus-->240 facts over 20 topic vocabularies, 160 questions<!--/fact-->,
one gold memory per fact, and distractors built to defeat one cheap signal each —
the same tag with a different fact, and the same words with a different fact.
A quarter of the questions never name their topic, which is the honest failure
mode of any policy that starts from a tag; some questions have one gold memory
and some two or three, so recall@k is not trivially recall@1. The memory list is
a prefix design: the first 1 000 records are the small corpus and all 10 000 the
large one, so one question set scores both sizes.

What it measured, for the default, is that over <!--fact:retrieval.incumbent-->10,000 memories today's recall puts a gold memory in the top 10 for 1.3% of questions (recency alone 0.0%, a random draw 0.0%); at 1,000 memories the same policy reaches 17.5%<!--/fact-->.
The ranked path, through the reference embedder, reaches <!--fact:retrieval.ranked-->5.0% of questions at 10,000 memories through the hash-trigram-64 reference embedder (33.8% at 1,000), ahead of tag match and recency's 1.3%<!--/fact-->.
Read the rows as mechanism, not language: they say whether a POLICY can find the
right record among distractors, and nothing about whether any model understands
a question — no deterministic row involves one.

```bash
node benchmark/retrieval.js                         # both sizes, the table
npm run benchmark:retrieval                         # the same
node benchmark/retrieval.js --sizes 1000 --verbose  # one size, plus every question the incumbent missed
node benchmark/retrieval.js --output json --filepath out.json
```

`--live` adds a second ranked row, **near-live**: the corpus is loaded into a
second ledger (one ledger holds one vector identity — a mixture is refused),
swept through `createEmbeddingClient` against the provider
[`lib/env.js`](./lib/env.js) resolves and the `/embeddings` model in
`JAREN_AI_EMBED_MODEL`, and every question is embedded once. The model id prints
beside the row and lands in `meta.live`; the deterministic rows are exactly what
they are without the flag. The spend guard `JAREN_AI_MAX_CALLS` is honoured up
front — a size whose sweep plus questions would exceed it is skipped with that
reason, never half-spent — and a missing key or model is a stated skip, never a
failure. It is never a test dependency, and the tracked file is always generated
without it: this suite publishes no model-quality number as its own.

```bash
JAREN_AI_PROVIDER=ollama JAREN_AI_EMBED_MODEL=nomic-embed-text \
  node --env-file-if-exists=.env benchmark/retrieval.js --live --sizes 1000
```

The corpus and the scorer have their own tests in
`test/ai/retrieval-corpus.test.js`: the generator's two-run byte-identity and
its agreement with the committed fixture, the corpus invariants (every gold id
exists inside the smallest prefix; every fact is asked exactly once), the oracle
and random gates, and a kill-check that the gate refuses a broken oracle.

The generated file is `packages/website/public/benchmarks/retrieval.json`
(`npm run benchmark:generate` writes it, and the Benchmarks page renders it).

`--store=db` adds four **durable** rows beside the in-memory ones: the same
corpus written through a `@jarenjs/db` storage adapter
([`lib/ledger-db.js`](./lib/ledger-db.js), the recipe `packages/ai`'s README
publishes), scored by the same policies, with the ranked path measured twice —
once answered by the store's k-nearest plan over a packed vector column
(`via: 'adapter'`) and once by the ledger reading every record back
(`via: 'sweep'`). Their quality columns are **asserted equal** to the in-memory
rows' before anything prints: three executors of one ordering, and only the
latency column is allowed to move. The flag is a hand-run mode; the tracked file
is always generated without it.

```bash
node benchmark/retrieval.js --store=db              # both sizes, nine rows
```

## Labelled recall and repeated refinement

The labelled instrument accepts neutral JSONL: corpus rows `{id, text, title?}`,
queries `{id, text, noAnswer?}`, and qrels `{queryId, corpusId, relevance}`.
A manifest supplies `schemaVersion`, `id`, `datasetClass`, `source`, `license`,
`version`, and `files.{corpus,queries,qrels}.{path,sha256}`. See the entirely
[authored fixture](./fixtures/relevance-tiny/manifest.json). Duplicate ids,
duplicate/conflicting judgments, dangling qrels, missing positive judgments,
empty splits and checksum mismatches refuse before any provider call. An
explicit `noAnswer: true` distinguishes a known unanswerable query from an
unjudged one. No-answer abstention/false answers are reported separately;
SciFact's selected test split has no such queries.

The [SciFact recipe](./fixtures/scifact-source.json) pins the official
[BEIR archive](https://github.com/beir-cellar/beir) with a locally verified
SHA-256, records provenance and the [BEIR dataset card's license](https://huggingface.co/datasets/BeIR/scifact/blob/main/README.md),
and imports only the known archive members. `unzip` is required for this
optional import. Corpus text and cached vectors stay under ignored
`benchmark/cache/`; normal tests never download a dataset or call a provider.
The task is article retrieval for scientific claims, not judging claim truth.

```sh
node scripts/import-scifact.js benchmark/cache/recall-quality/scifact
EMBEDDING_MODEL=baai/bge-m3 node --env-file-if-exists=.env benchmark/retrieval.js \
  --dataset benchmark/cache/recall-quality/scifact/manifest.json --live --dims 1024 \
  --sizes 500,2000,5183 --ann --filepath benchmark/recall-quality-scifact-live.json
node benchmark/recall-quality.js --dataset benchmark/fixtures/relevance-tiny/manifest.json --ann
```

`--live` requires an explicit model and width; omitting it labels the embedder
`hash`, including when the dataset is real language. Hash and live rows never
share an embedding class. `EMBEDDING_MODEL` takes precedence over
`JAREN_AI_EMBED_MODEL`. The cache refuses changes to dataset, provider, model,
width, endpoint or text policy, verifies every stored vector hash and Float32
representation, and resumes completed batches. It batches by text count and
character budget, refuses silent truncation, uses one bounded attempt per
batch, and honors `JAREN_AI_MAX_CALLS`. Failed batches and available usage are
retained without provider error text or credentials. Missing reported cost is
unknown. A cache-only run still publishes the original paid usage.

The scorer uses macro fractional recall, MRR at the largest cutoff and graded
nDCG. The legacy synthetic instrument retains its historical hit-rate metric
called `recall@k`; its JSON explicitly names that definition. The labelled
runner times real ledger recall with precomputed query vectors. Corpus subsets
include every positive-qrel document followed by seeded distractors, so smaller
sizes are conditional stress tests, not alternative full-benchmark scores.
The tag baseline takes the first few longer words from each document; timestamps
are equal and ties break by id. These full policies are recorded in JSON.

Reference measurement: <!--fact:recall.reference-->baai/bge-m3 (1024 dimensions, openrouter, 2026-09-09): recall@10 0.783, MRR@10 0.608, nDCG@10 0.644 on 5183 SciFact documents and 300 test queries.<!--/fact-->

Embedding cost: <!--fact:recall.cost-->87 embedding requests, 0 failures, 1,952,135 reported tokens, and $0.01952135 reported cost for the SciFact vector cache. Cache-only scoring makes no embedding requests.<!--/fact-->

<!--fact:recall.quality-->

| documents | policy | recall@10 | MRR@10 | nDCG@10 | p95 ms |
|-----------|--------|-----------|--------|---------|--------|
| 500 | recency | 0.027 | 0.008 | 0.012 | 1.156 |
| 500 | tag+recency | 0.369 | 0.182 | 0.224 | 1.179 |
| 500 | exact | 0.904 | 0.802 | 0.824 | 3.616 |
| 500 | projection-0.1 | 0.632 | 0.602 | 0.604 | 5.727 |
| 500 | projection-0.5 | 0.872 | 0.776 | 0.798 | 26.869 |
| 2000 | recency | 0.007 | 0.001 | 0.002 | 4.519 |
| 2000 | tag+recency | 0.206 | 0.095 | 0.119 | 4.620 |
| 2000 | exact | 0.846 | 0.696 | 0.727 | 9.873 |
| 2000 | projection-0.1 | 0.611 | 0.555 | 0.563 | 22.999 |
| 2000 | projection-0.5 | 0.824 | 0.678 | 0.709 | 106.526 |
| 5183 | recency | 0.000 | 0.000 | 0.000 | 11.464 |
| 5183 | tag+recency | 0.138 | 0.047 | 0.067 | 11.832 |
| 5183 | exact | 0.783 | 0.608 | 0.644 | 23.356 |
| 5183 | projection-0.1 | 0.597 | 0.493 | 0.513 | 60.017 |
| 5183 | projection-0.5 | 0.760 | 0.589 | 0.623 | 324.474 |

<!--/fact-->

The [complete scorecard](./recall-quality-scifact-live.json) records environment,
seed, full input manifest, model identity, vector/text hashes, query ids, returned
document ids, costs and failures. It contains no corpus or query text. Re-running
with the same verified cache reproduces ranked ids and quality; timings vary.

The dependency-free sparse-projection contender lives only in benchmark code,
behind an injected index factory and the storage `rank` capability. Both paths
use identical storage and real ledger re-scoring. Returned candidate arrays are
validated; arbitrary scores cannot bypass the core cosine kernel. Each size
reports exact-top-k recall/MRR, relevance, build and update/delete costs, and
storage. Byte counts distinguish serialized documents, resident vector payload,
and extra index numeric/key payload; they exclude JavaScript object overhead.

<!--fact:recall.ann-->

| documents | candidates | exact-top-10 recall | index bytes | build ms | update p95 ms | delete ms | clears all bars |
|-----------|------------|---------------------|-------------|----------|---------------|-----------|-----------------|
| 500 | projection-0.1 | 0.450 | 80915 | 129.147 | 0.410 | 0.159 | no |
| 500 | projection-0.5 | 0.879 | 80915 | 131.003 | 0.358 | 0.112 | no |
| 2000 | projection-0.1 | 0.536 | 308384 | 561.437 | 0.549 | 0.115 | no |
| 2000 | projection-0.5 | 0.935 | 308384 | 527.670 | 0.352 | 0.124 | no |
| 5183 | projection-0.1 | 0.633 | 791048 | 1325.951 | 0.312 | 0.124 | no |
| 5183 | projection-0.5 | 0.953 | 791048 | 1416.886 | 0.365 | 0.234 | no |

<!--/fact-->

Index decision: <!--fact:recall.annDecision-->0/6 contender rows cleared all bars; retain exact. Required exact-top-10 recall ≥ 0.95, p95 speedup ≥ 2×, and a measured exact p95 ≥ 100 ms. The largest reference corpus contains 5183 documents; scale beyond it remains unmeasured.<!--/fact-->

The rejection is scoped to this contender and these vectors. It is not evidence
against every ANN algorithm. No production ANN dependency or default is added.

Repeated refinement uses [authored trajectories and labels](./fixtures/refinement-pressure.json)
and the real `createRefiner`, ledger validation, embedding sweep and SQLite
adapter. Each policy gets its own persistent ledger; every wave reopens that
same database. Choose a new run directory; a nonempty ledger refuses to prevent
accidental double counting. Live embeddings and optional `--live-proposals`
are separate: freely generated proposals remain explicitly unlabelled and do
not establish a policy's quality. The guarded-model contender uses scripted
extractive suggestions, not a claim of live-model merge reliability.

```sh
node benchmark/refinement-pressure.js --directory benchmark/cache/pressure-hash-run \
  --filepath benchmark/recall-quality-pressure-hash.json
EMBEDDING_MODEL=baai/bge-m3 node --env-file-if-exists=.env benchmark/refinement-pressure.js \
  --live --dims 1024 --directory benchmark/cache/pressure-live-run \
  --filepath benchmark/recall-quality-pressure-live.json
```

Evidence recall counts distinct labelled units within the returned records;
duplicates still consume retrieval positions. MRR uses the first relevant
record. Novel-evidence nDCG uses linear gain for newly reached evidence and the
optimal ordering available in that ledger. This pressure-specific metric is
separate from the standard graded SciFact metric. Snapshot bytes are reported
separately from active state. Every wave reports counts, retained conflicts and
complements, and relevance; all pair/class similarities are published.

<!--fact:recall.pressure-->

| vectors | policy | records | duplicates | state bytes | recall@10 | MRR@10 | novel-evidence nDCG@10 | conflict / complement retained | passes every wave |
|---------|--------|---------|------------|-------------|-----------|--------|------------------------|--------------------------------|-------------------|
| hash-trigram-64 | none | 78 | 60 | 85405 | 0.042 | 0.167 | 0.065 | 1.000 / 1.000 | no |
| hash-trigram-64 | normalized-text | 15 | 3 | 15694 | 0.375 | 0.306 | 0.337 | 0.500 / 0.500 | no |
| hash-trigram-64 | identical-evidence-merge | 12 | 0 | 13868 | 1.000 | 0.583 | 0.676 | 1.000 / 1.000 | yes |
| hash-trigram-64 | guarded-model-merge | 12 | 0 | 13868 | 1.000 | 0.583 | 0.676 | 1.000 / 1.000 | yes |
| hash-trigram-64 | similarity-only | 12 | 3 | 12436 | 0.250 | 0.306 | 0.332 | 0.000 / 0.500 | no |
| hash-trigram-64 | exact-evidence | 21 | 3 | 22073 | 0.833 | 0.528 | 0.573 | 1.000 / 1.000 | yes |
| hash-trigram-64 | runtime-exact-evidence | 21 | 3 | 22073 | 0.833 | 0.528 | 0.573 | 1.000 / 1.000 | yes |
| baai/bge-m3 | none | 78 | 60 | 1718130 | 0.667 | 1.000 | 0.736 | 1.000 / 1.000 | no |
| baai/bge-m3 | normalized-text | 15 | 3 | 330227 | 0.375 | 0.500 | 0.473 | 0.500 / 0.500 | no |
| baai/bge-m3 | identical-evidence-merge | 12 | 0 | 264977 | 1.000 | 1.000 | 0.862 | 1.000 / 1.000 | no |
| baai/bge-m3 | guarded-model-merge | 12 | 0 | 264977 | 1.000 | 1.000 | 0.862 | 1.000 / 1.000 | no |
| baai/bge-m3 | similarity-only | 11 | 0 | 242139 | 0.583 | 0.833 | 0.833 | 0.333 / 0.500 | no |
| baai/bge-m3 | exact-evidence | 21 | 3 | 462370 | 1.000 | 1.000 | 0.987 | 1.000 / 1.000 | yes |
| baai/bge-m3 | runtime-exact-evidence | 21 | 3 | 462370 | 1.000 | 1.000 | 0.987 | 1.000 / 1.000 | yes |

<!--/fact-->

Refinement result: <!--fact:recall.dedup-->After 12 labelled waves, opt-in exact-evidence suppression stores 21 records instead of 78; state bytes fall 73.1%. Evidence recall@10 is 1.000 versus 0.667, with all labelled conflict and complement units retained. Proposals are scripted; vectors are baai/bge-m3.<!--/fact-->

Only exact text/evidence/tag repeats passed every wave under both embedding
classes. Case-folding and similarity-only controls lose conflicts and independent
citations. Lossless merging passes the hash run but fails the live-vector
non-inferiority bar. The runtime row exercises the selected production option
and is checked against the independently proposed benchmark policy. The policy
remains opt-in because authored proposals do not establish a safe general default.


## Authored-program reliability instruments

The long-horizon entry point also runs independent, reproducible scorecards:

```sh
node benchmark/long-horizon.js --authoring --trials 1 --filepath benchmark/programmind-authoring-fixture.json
node benchmark/long-horizon.js --question-stream --filepath benchmark/programmind-reuse.json
node benchmark/long-horizon.js --hierarchical --filepath benchmark/programmind-depth-fixture.json
node --env-file-if-exists=.env benchmark/long-horizon.js --authoring --live --filepath benchmark/programmind-authoring-remeasured-live.json
node --env-file-if-exists=.env benchmark/long-horizon.js --hierarchical --live --filepath benchmark/programmind-depth-live.json
node --env-file-if-exists=.env benchmark/long-horizon.js --question-stream --live --filepath benchmark/programmind-reuse-live.json
```

Live runs use the primary and secondary model variables in `.env.example`. Authoring
also accepts `--profiles PATH`: a JSON array of named host routes with `provider`,
`model`, optional `baseUrl`, `keyEnv`, `providerVersion`, `deadlineMs`, and `sampling`.
Use environment variable names for keys. Content and credentials are excluded from
artifacts; unknown provider versions and unavailable timeout usage remain null.
The initial live authoring artifact retains the earlier prompt/budget configuration;
the remeasured artifact uses worked grammar examples and bounded reasoning requests.
Neither artifact is a claim about an entire model family.

Question-stream timings and tokens are explicit scripted costs. Ground truth is a
plan-family label; the sweep charges retrieval, rejected candidates, wrong execution
and fallback. The runtime scorecard uses the shipped session pipeline and an explicit
fixture suitability checker. Hierarchical fixtures contain original accepted/rejected
revision data and depth-neutral provenance. Scripted depth accuracy measures mechanics.
Live failures and provider token-limit violations remain in their own scorecard.

Profile artifacts and their source/seam hashes are generated by
`node scripts/generate-authoring-profiles.js`; `npm run docs:check` detects drift.
Published scorecard figures are derived in the AI README from these JSON artifacts.


## Ledger retention

`npm run benchmark:retention` regenerates `retention-result.json` from a seeded
conversation with addressed rounds, repeated evidenced progress, embedded
memories, skills and referential artifacts. `retention-result.schema.json` and
unit replay tests validate its shape, deterministic rows and exact byte totals.
Policies compare no eviction, oldest round, protected/unreferenced round, and
lossless goal checkpoints. Address resolution reports referenced and unreferenced
loss separately. Restart scoring checks preserved progress and retrieval after
reopening the adapter. Failed writes denote simulated impossible item budgets;
real quota failure is separately injected at the browser's atomic write boundary.

Policy measurements: <!--fact:ledger.retention-->On 48 seeded rounds, an eight-round oldest policy retains 16.7% of referenced addresses; protected eviction retains 100.0%, while retaining only 4.8% of unreferenced addresses. A lossless checkpoint reduces goal context from 14,841 to 4,216 characters. Impossible protected budgets are refused.<!--/fact-->

The quality bar preserves every referenced address, resumed evidence and recalled
memory on this corpus. It deliberately permits reported loss of unreferenced
rounds. Tombstones and reports have a real storage cost; production budget tests
include them and refuse if those bytes cannot fit. The active-goal policy retains
all evidence with a deduplicated dictionary and source-id table; unique evidence
can still require a visible refusal. Browser lifecycle tests attach observed
`navigator.storage.estimate()` metadata and serialized ledger bytes for each
engine. These origin estimates are not promises about localStorage quota.

`npm run benchmark:patch-decoding` uses scripted transport and asserts the exact
schema was placed on the wire. Add `-- --live` for a bounded comparison using the
existing AI environment contract. Both syntax variants are validated against the
full production schema after generation. The committed preparatory result is
excluded from schema-acceptance evidence because that early harness omitted the
schema; its usage remains recorded.

Provider comparison: <!--fact:ledger.decoding-->openrouter, google/gemini-3.7-flash: oneOf valid; if-then rejected-full-schema (2 calls, $0.00567000 reported cost). One trial per syntax is provider acceptance evidence, not proof of grammar enforcement. Two excluded preparatory calls cost $0.00293850 and remain recorded.<!--/fact-->
