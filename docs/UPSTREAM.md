# For the jarenjs team — the line between the suite and Tangle

Tangle AI is the suite's downstream dogfood: a strict-TypeScript application
that consumes `@jarenjs/*` and nothing else at runtime, runs both repositories'
workflow (a committed roadmap of wants, gitignored campaigns, measurement before
capability), and publishes its losses. This document is the standing statement,
from Tangle's side, of **who owns what**, **what Tangle asks the suite to
implement** — each ask with the evidence that earned it — **what Tangle
deliberately does not ask**, and **what Tangle hands back**. It exists so the
separation of concerns is read the same way in both checkouts and re-argued in
neither. [`BOUNDARY.md`](BOUNDARY.md) is the rule and its dated audit; this is the
conversation across the line.

## The rule, once

A thing belongs in `@jarenjs/*` only if **all four** hold:

1. **Generic** — meaningful to a host that has never heard of Tangle.
2. **Zero-dependency** — implementable inside the suite's constitution, with
   anything heavier injected through a seam.
3. **Deterministically testable** without a network.
4. **The suite itself has a consumer and a test for it** — the suite never grows
   API for one external consumer its own tests do not exercise.

Everything else — provider wires that are not OpenAI-compatible, databases,
schedulers, servers, UI, paper-specific pipelines, and any policy whose
justification is a paper rather than a measurement the suite publishes — is
Tangle's, and stays Tangle's even when it would be convenient below.

**The loop.** Tangle builds against today's seams and works around what is
missing. When the same workaround appears a *second* time, Tangle writes the
minimal seam proposal — the contract, a jarenjs-internal consumer, its test —
and the suite lands it on its own merits. **A seam ask is closed when Tangle
deletes code**, never when the suite adds it.

## The line, concern by concern

| Concern | Below the line — the suite (contract, seam, kernel) | Above the line — Tangle (policy, infrastructure) |
|---|---|---|
| Chat completions | `createChatClient`: the OpenAI-compatible wire, retry, streaming, budgets | which provider, which model, the thinking control per run |
| Embeddings | the `{ embed, model, dims }` seam, `createEmbeddingClient`, the deterministic `createHashEmbedder`, `probeEmbeddings`, `@jarenjs/core/vector` | the desktop's embed setting; the **measured** width of the offline default (64 — the width with margin on every pipeline threshold) |
| Vector identity | `sameIdentity` — two absent identities are NOT the same space | every comparison Tangle makes is identity-gated; skips are reported, never hidden |
| Durable memory | the ledger: four record kinds, evidence mandatory, the 4-method storage seam, `recall({ near })` | `@tangleai/memory` units — the same fields plus confidence, supersession, provenance; `toLedgerMemory` is the one door, test-pinned in both directions |
| Memory hygiene | *nothing, on purpose* — the suite refuses an evictor or de-duplicator before the number that says it helps | novelty gate, crystallizer, contradiction judge, outcome learning — and the LoCoMo instrument that scores them |
| LLM judgment | `createStructuredOutput`, gates, repair loop | the verdict schemas and messages (contradiction, the category-5 judge, the temporal window) |
| Self-refinement | RFC 6902 patch over ledger state, four gates, rollback | future loops PROPOSE through those gates, never write directly |
| Orchestration | `@jarenjs/flow` DAG/FSM compile, checkpoints, durable sessions | the memory-policy dag document; future patterns as flow documents |
| Time | `@jarenjs/core/series`: intervals, `asOfJoin`, `createIntervalIndex`, the `(series, at)` plan | the temporal lane: validity as `[at, supersededAt)`, the model proposes a window and the kernel decides |
| Persistence | `@jarenjs/db`: `openStore`, typed collections, `derive: 'vector'`, live queries | the store model, the SQLite file, stage-then-activate replacement, the run log |
| Documents | `@jarenjs/core/chunk` (characters, lines, separators), `@jarenjs/md` | fetch with an address policy, HTML/Markdown/PDF extraction, chunkers with an element and heading model, versioned corpora — and the three third-party dependencies that lane takes, recorded as an exemption |
| Benchmark method | the oracle/random gates, a keyless ceiling beside every live number, `readAiEnv`'s stated-skip contract, budget accounts — copied as a *method* from unpublished scripts | the LoCoMo loader, census, scorer at parity, report schemas, the live runs and their numbers |
| Search, scheduling, servers, UI | — (the suite declares scheduling "the host's") | SearxNG, the consolidation cadence, the desktop and its binary, the pages site |

## What Tangle asks the suite to implement

Ordered by how much evidence each has. Every ask names where Tangle's
workaround lives today and what Tangle deletes when the seam lands.

### 1. A replay cache seam on the chat and embedding clients — **ask**

**Evidence.** A live benchmark run buys the same `/embeddings` over a corpus
that does not change and the same `/chat/completions` over prompts that mostly
do not. Tangle wrote `benchmark/lib/wire-cache.ts` after one rate-limited run
cost a whole row of answers: every embedding and every completion a live tier
pays for is kept, keyed by the whole identity of what was asked, replays counted
and charged to no budget. The suite has the same cost on its own side —
`benchmark/retrieval.js --live` loads the corpus into a second ledger and embeds
it through `createEmbeddingClient` in batches of 128 on every run. That is the
second consumer; the workaround has appeared twice.

**The shape.** An injectable `{ get(key), put(key, value) }` seam on
`createChatClient` and `createEmbeddingClient`. The key is the canonical bytes
(`@jarenjs/json/canonical`, hashed) of everything the wire sends — provider,
base URL, model, messages, response format, thinking control, sampling knobs —
**except the credential, which is never part of the key**. A reply served from
the seam comes back marked `replayed` with the wall time of the call that
bought it, so an instrument prints fresh spend beside remembered answers, and
the budget account is charged only for wire calls. The seam is four conditions
clean: generic, dependency-free (the store behind it is injected), testable
with a map, consumed by the suite's own live tiers.

**What stays above the line.** The SQLite-backed store, the `--fresh` and
`--cache none` switches, the audit-trail rows that keep the text beside the
vector — Tangle's, over `@jarenjs/db`. **What Tangle deletes:** the keying,
replay-marking and budget-skipping logic in `wire-cache.ts`.

### 2. `@jarenjs/core/random` — a seeded generator — **ask**

**Evidence.** `mulberry32` is written out three times inside the suite's own
benchmark scripts (`benchmark/vector.js`, `benchmark/lib/horizon.js`,
`benchmark/lib/retrieval.js`) and a fourth time in Tangle
(`benchmark/lib/random.ts`); `@tangleai/core/clustering` injects a generator
rather than owning one, which is the right shape and needs a published one to
inject. Condition 4 is already met three times over.

**The shape.** `createRandom(seed)` returning the generator plus the two draws
every seeded corpus makes — an integer in a range and a shuffle — with the
reference sequence pinned. **What Tangle deletes:** `random.ts`.

### 3. Quantiles in `@jarenjs/core/math` — **ask**

**Evidence.** `median` and `percentile` exist in the suite as JSLT functions in
`@jarenjs/json`'s stats pack — callable from a stylesheet, not from JavaScript —
and again, unpublished, in `benchmark/lib/measure.js` as p50/p95. Tangle's
`benchmark/lib/stats.ts` is the third copy. `@jarenjs/core/math` is the
graphics/numeric kernel and has no quantile.

**The shape.** `quantile(sorted, p)` and `median`, nearest-rank on the sorted
sample, the rule *stated* — the seven competing definitions disagree on the
eleven-reading samples a benchmark row actually has. The JSLT pack and the
harness both consume it. **What Tangle deletes:** `stats.ts`.

### 4. What a `derive: 'vector'` column does when `dims` moves — **question**

Tangle's `memories` collection does not declare the vector column, and the
blocker is not performance (at LoCoMo's sizes the sweep costs nothing). It is
identity: `dims` is the column's identity and the embedder is a runtime
*setting* — declaring the column makes the model a function of the settled
embedder, and changing the embedder a migration. Before Tangle pins `dims` in
settings and declares the column, it needs the store's answer written down:
when a document arrives whose `embeddedBy.dims` disagrees with the declared
column, does the store **refuse** (with which code), **rebuild**, or **version**
the column? Whichever it is, Tangle's vector-column roadmap entry waits on the
sentence, not on code.

### 5. Structural chunking over a block sequence — **candidate, condition 4 open**

`@jarenjs/core/chunk` cuts characters, lines and separators. The document lane
needed a heading model and page boxes, so Tangle wrote three chunkers of its
own. One of them — recursive, heading-aware, over a typed block sequence with a
depth per block — is generic and dependency-free; the S2 chunker (k-means over
an affinity matrix) is not and stays Tangle's. The open question is the
suite-internal consumer: `@jarenjs/md` already produces a heading tree, and the
site's assistant keeps a ledger it could chunk its own documents into. If that
consumer is real, this is an ask; if not, it stays a duplicate Tangle carries
knowingly.

## What Tangle deliberately does not ask

The separation holds only if the list of non-asks is as explicit as the asks.

- **`readAiEnv` and the spend guards.** The variable names are a host's; the
  *contract* (a missing key is a stated skip, a plan over the ceiling is refused
  before the first request, the key is never printed) is copied as a method.
  `benchmark/lib/ai-env.ts` resolves to the desktop's own settings shape, which
  is exactly why it cannot live below.
- **`estimateTokens`.** A 4-characters-per-token ceiling, kept as a truncation
  helper. The suite already prefers the provider's `usage` and falls back only
  under a token budget; a "better guess" would be the wrong fix.
- **k-means.** The suite publishes similarities; k-means++ needs the squared
  distance itself, and no suite package has a consumer. `@tangleai/core/clustering`
  records the reason in its header.
- **The LoCoMo loader, census, stemmer and scorer.** Paper-specific, to the
  letter of an evaluator whose parity fixtures redistribute a CC BY-NC dataset.
  The *method* — an oracle row that must reach its analytic ceiling, a seeded
  random row that must land in its band, a keyless ceiling beside every live
  number — was the suite's and is copied; the code is Tangle's.
- **The document fetcher, its address policy, `unpdf`, `linkedom`,
  `playwright-core`.** Infrastructure with third-party dependencies; the suite's
  zero-dependency constitution is the point, not an obstacle. The exemption is
  recorded in Tangle's README with what the suite cannot supply and why.
- **SearxNG, TOML prompt packs, graph drivers, schedulers, the server, the
  shells.** Named in `BOUNDARY.md` §"What must never migrate down"; still true.
- **Any policy a paper justifies.** The novelty gate, the crystallizer, the
  contradiction judge, the consolidation tiers to come — Tangle's, until a
  measurement the suite would publish as its own says otherwise, which the
  suite's memory-hygiene stance already anticipates.

## What Tangle hands back

The suite's roadmap has entries whose missing piece is a measurement *a host
must bring*. Tangle is that host.

- **Retrieval quality on real language.** The suite's retrieval instrument
  scores a synthetic corpus through a lexical reference embedder and says so.
  Tangle projects LoCoMo — ten conversations, 1,540 human-labelled questions —
  into an *unmodified* ledger through `toLedgerMemory` (the mirror test proves
  the projection is stored verbatim and recallable by meaning), and can run
  `recall({ near })` over it with a real embedder behind the same seam. The
  recall@k the suite cannot publish as its own, Tangle can, beside its ceiling.
- **Duplicate pressure, measured.** The suite refuses a de-duplicator before
  the number. Tangle's ingest census over the whole release (5,882 observations
  through the real pipeline) is that number: the gate filtered 6, the judge
  superseded 63 of 5,326 pairs judged, the crystallizer merged 339 — and it
  **cost** evidence recall (−0.9 points at k = 20 with the lexical embedder),
  while in the live table the policies left 47 of 64 prompts byte-identical to
  the inert pipeline's and scored lower on the 17 they changed. The
  measurement says what the suite's stance predicted: not yet. Both documents
  are committed and regenerate from a run.
- **The strict-TypeScript consumer report**, re-audited on every pin bump
  (`JARENASK.md`): three minor versions and a whole temporal
  campaign needed zero source changes here. One row of it is now stale in the
  suite's favour — see below.
- **Reasoning-tier data for the authoring-timeout question.** Tangle saw the
  same shape the suite's roadmap describes: a "flash" tier spending 800–5,000
  completion tokens and twenty seconds on a short phrase until
  `reasoning.effort: 'none'`, and one endpoint (`z-ai/glm-5.3-flash`) that
  answers HTTP 400 to both `effort: 'none'` and `enabled: false` — so the
  thinking control became an explicit, recorded, merge-guarded setting rather
  than a request parameter one hopes is honoured.

## The loop, on the record

It has closed twice.

1. **The vector campaign** (suite v0.44–v0.46). The first candidate BOUNDARY
   named — an injectable ranker on ledger recall — landed upstream together with
   the embed wire, the reference embedder, the kernels, the identity rule and a
   vector column. Tangle retired a whole package (`@tangleai/providers`), its own
   cosine, and its trigram embedder against the release.
2. **`sameIdentity`.** Tangle's TS report filed it as module-private in the
   ledger and restated it as `sameEmbeddedBy` (six call sites across memory and
   the document lane). At 0.49.2 it is exported from `@jarenjs/ai`, with the
   "two absent identities are not a shared space" case in its own doc comment.
   Closed on Tangle's side on 2026-08-27: the restatement, its export and its
   test deleted, `@tangleai/memory` and the document lane consuming the suite's
   export, and the report row repaired.

Two rules keep the record honest across both roadmaps: each names the other's
capabilities, never the other's scratch files or order numbers; and neither
publishes a number the other measured as its own — the suite publishes no
model's score, Tangle publishes its losses.
