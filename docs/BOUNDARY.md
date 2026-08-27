# The boundary: @jarenjs/ai below, Tangle above

Tangle AI is a downstream application of the jarenjs suite. This document is the
rule for deciding, for any new capability, which side of the line it lives on —
written down so the decision is made once, not re-argued per feature.

## The rule

**@jarenjs/ai gets contracts and seams. Tangle gets policies and infrastructure.**

A thing belongs in @jarenjs/ai only if ALL of these hold:

1. It is generic — meaningful to a host that has never heard of Tangle.
2. It is zero-dependency — implementable inside jarenjs's two-dependency
   constitution (`@jarenjs/core`, `@jarenjs/validate`), with anything heavier
   injected through a seam.
3. It is testable without network, deterministically.
4. jarenjs itself has a consumer and a test for it — the suite never grows API
   for one external consumer that its own tests don't exercise.

Everything else — provider wires, databases, schedulers, paper-specific
pipelines, servers, UI — is Tangle's.

## How the line runs today

| Concern | @jarenjs/ai side (contract) | Tangle side (policy/infra) |
|---|---|---|
| chat completions | `createChatClient` (OpenAI-compatible wire, retry, streaming) | configuration only |
| embeddings | `@jarenjs/ai/embed`: the `{ embed, model, dims }` seam, `createEmbeddingClient` (the OpenAI-compatible `/embeddings` wire over the chat client's provider set, replies reassembled by index), `createHashEmbedder` (deterministic reference), `probeEmbeddings`; kernels in `@jarenjs/core/vector` | configuration (the desktop's embed setting), and the measured WIDTH of the offline default (`createOfflineEmbedder`, 256 — see `packages/pipeline/src/standins.ts`) |
| durable memory | ledger: 4 kinds, evidence-mandatory, 4-method storage seam (+ optional `rank`); a memory carries `embedding` + `embeddedBy` as a pair | `@tangleai/memory` store of full units (the same pair, plus confidence, supersession, provenance) |
| memory hygiene | *(none — ROADMAP names the missing measurement)* | novelty gate, crystallizer, contradiction resolution, outcome learning |
| retrieval ranking | ledger `recall({ near })`: cosine through the embedder seam, refused without it, refused across identities, skips reported; over `@jarenjs/db`, `derive: 'vector'` + the k-nearest plan | `recallByEmbedding` — the same rule over Tangle's own units (supersession-aware), and the pairwise comparisons inside the policies |
| LLM judgment | `createStructuredOutput` + gates + repair loop | the contradiction judge (verdict schema + messages live in `@tangleai/memory/contradiction`) |
| self-refinement | RFC-6902 patch over ledger state, 4 gates, rollback | future: skill loop and harness evolution PROPOSE through those gates (TODO 05/06) |
| orchestration | `@jarenjs/flow` FSM/DAG compile + durable sessions | future: GMPL patterns as flow documents (TODO 07) |
| scheduling | declared "the host's" by jarenjs | Tangle IS the host — consolidation cadence is Tangle's (TODO 04) |
| web search | — | `@tangleai/search` (SearxNG) + `compose/searxng` |

## What the suite already has — read before building (audited 2026-08-26, v0.49.2)

The rule above decides where a NEW capability goes. This section answers the
prior question — *does it already exist below?* — because the expensive mistake
in a downstream repo is not putting something on the wrong side of the line, it
is building something the line already has. Audited against the sibling
checkout at `@jarenjs/*` 0.49.2, one row per thing an open order would
otherwise write.

**Use it — do not write it again.**

| What an open order needs | What the suite publishes | Where it lands |
|---|---|---|
| A question answered over a whole corpus that will not fit a request | `createEnvironment` (RFC-style slots; `digest`/`peek`/`chunk`/`grep`/`select`/`stat`/`read`, none of which return bulk content), `compileProgram` + `createProgramRunner` (the model authors a compile-gated program; `map` is the only step that calls a model), `createLongHorizonAgent` (depth default 1, cap 3, children scoped so no sibling is reachable, a child's failure is a value) | **02.** The LoCoMo baseline IS this, not a hand-built RAG loop. jarenjs measures it: needle 100 % / pairwise 100 % in a **937-char request against a 17 719-char corpus**, where compaction alone scores 17.5 % / 0 % while spending 5 781 chars. LoCoMo is that claim's first public corpus. |
| Cost, and a run that stops instead of overrunning | `createBudgetAccount`, `BUDGET_DIMENSIONS` (`turns`/`tokens`/`ms`), the agent's `budget` with `spent` seeded for resume, a named `stopReason`, and one account shared by a whole recursion tree | **16** (landed: `benchmark/lib/locomo-qa.ts` meters every live call through one account), **13.** The cost column is this, not `@tangleai/core/tokens`. The suite already prefers the provider's own `usage` and falls back to a 4-char estimate only when a token budget is set — `estimateTokens` stays a truncation helper and stops being a cost number. |
| A trajectory to cluster into skills | `createTrajectory` (sequenced entries, excerpted answers, `summary()` by kind/depth), `describeTrajectory` | **05.** |
| Skills as records, and getting them back into a prompt | `SKILL_SCHEMA`, `ledger.recallSkills({ near })`, the agent's `retrieval.skills` slot | **05** (already named in the order). |
| Self-modification that cannot go rogue | `createRefiner`: RFC 6902 patch → shape → semantics-on-a-copy → ledger legality → commit with snapshot rollback; the base system prompt is not in the patched document at all | **05, 06, 12** (already named). |
| Structured output with a repair loop | `createStructuredOutput`, `unfence`, coded errors carrying a `docPath` into the offending document | **13** (window extraction), **02** (the cat-5 judge). |
| Constrained decoding against a local model | `@jarenjs/josl/gbnf` — a character-level GBNF for the llama.cpp family, beside the hosted `json_schema` twins the query and JSLT grammars publish | **09**, if a local provider becomes a profile. |
| Reading memflow's TOML prompt packs | `parseToml` from `@jarenjs/josl` — passes the official toml-test 1.0.0 suite in strict mode, the only engine in its benchmark that does | **07.** Do not write a TOML reader. (The packs themselves stay Tangle's — see *What must never migrate down*; consuming the suite's parser is not migrating anything down.) |
| Tabular import/export of results | `parseCsv`, `stringifyCsv`, `sniffCsvDialect`, and a `repair: true` mode that logs every fix under a stable `CSV1xxx` code | **02, 03.** |
| Catching a malformed dataset at the door | `@jarenjs/validate`, plus the `$query` keyword for cross-field assertions (sums, ordering, quantification) | **02.** Validate `locomo10.json` on load against a committed schema: the 444/446 missing-`answer` adversarial bug becomes a **schema-detected count in the report**, not a surprise in the scorer. |
| Keeping hand-written interfaces honest with their schemas | `emitTypeScript` (a function, not only the `jaren-emit` CLI) with `--check` failing CI when a schema moved and the type did not, verified cyclically against the validator over an instance corpus | **02+.** Dev-only, so exempt under CONVENTIONS §1. Candidate replacement for the hand-maintained interface/schema drift tests in `@tangleai/core/schemas`. |
| A stable identity for a dataset or a report | `@jarenjs/json/canonical` (RFC 8785 canonical bytes) and the SHA-256-over-canonical pattern `contract.revision()` already uses; `hashContent` in `@jarenjs/core/string` (exact FNV-1a) for a cheap fingerprint | **02.** The checksummed `manifest.json` the plan asks for. |
| Running the eval as a document, and drawing it | `@jarenjs/flow` jaren-dag, and `@jarenjs/mermaid`'s `dag-to-flowchart` stylesheet | Already correct — `@tangleai/pipeline` uses both, and `packages/pipeline/src/mermaid.ts` derives the drawing from the executable document rather than hand-drawing it. |
| A benchmark run as an operation, live progress, and a CI gate on its shape | `@jarenjs/contract`: a `subscribe` operation streamed as a `@jarenjs/db` live query (SSE over http, frames over port, resumable by seq), `contract.revision()`, and `diffContracts --fail-on breaking` | **11.** |
| Excerpting, truncating, sizing text | `excerpt`, `truncate`, `sizeOf`, `chunkText` in `@jarenjs/core/chunk` | Everywhere. Note the standing exception: this is NOT the document chunker — 08a recorded why (no element or heading model). |
| Time as an answerable structure | `@jarenjs/core/series` | **13.** |
| Geography | `@jarenjs/core/geo`, `@jarenjs/ai/spatial` (the gates), `@jarenjs/ai/geo-tools` | **14.** |

**Build it here — the suite genuinely does not have it.** Written down so nobody
spends an afternoon looking:

- **Every string metric the LoCoMo scorer needs.** `normalizeAnswer`, a Porter
  stemmer, token-level F1, the comma-split multi-hop variant. `@jarenjs/core/text`
  is a *format-validation* toolbox — emails, hostnames, IPs, URIs/IRIs, UUIDs,
  punycode, I-Regexp — and there is no tokenizer, no stemmer and no
  string-similarity metric anywhere in the suite. Written on order 15, to the
  official evaluator's exact spelling, because parity with the published
  numbers is the entire point of porting rather than improving:
  `benchmark/lib/porter.ts` (NLTK's variant) and
  `benchmark/lib/locomo-parity.ts`, pinned by fixtures the official evaluator
  itself produced.
- **Descriptive statistics.** No median, no percentile. `@jarenjs/core/math` is
  the graphics/numeric kernel (int32/float64, vectors, `mat4`, root finders,
  `geoMean`); the p50/p95 helpers exist only in jarenjs's unpublished
  `benchmark/lib/measure.js`. A few lines, written once here
  (`benchmark/lib/stats.ts`, 02a).
- **A seeded PRNG.** Published by no package; jarenjs keeps its seeds inside
  the benchmark harness. `@tangleai/core/clustering` already injects one, which
  is the right shape. Written once, on 02: `benchmark/lib/random.ts`
  (mulberry32 — the generator jarenjs's seeded corpora use).
- **k-means.** Not in the suite. `@tangleai/core/clustering` is legitimately
  Tangle's, and its header already explains why it does not reach for
  `@jarenjs/core/vector` (the suite publishes similarities; k-means++ needs the
  squared distance itself).
- **The LoCoMo loader, preprocessor, scorer and report.** Paper-specific, so
  Tangle's by the rule at the top of this file.

**Copy the method, not the code.** jarenjs's benchmark scripts are not published
packages, so nothing below is importable — but each is a decision this campaign
would otherwise have to learn the hard way:

- `benchmark/retrieval.js` scores recall@{1,5,10}, MRR and latency per policy,
  and **gates the scorer before any number prints**: an `oracle` row must be
  exactly 1.000 at every k, and a seeded `random` row must land inside its
  analytic band, or the run exits 1 with the row named. The oracle row is what
  catches a corpus whose gold ids do not exist — which is precisely the risk in
  LoCoMo's evidence dialog ids, some of which are parenthesized.
- `benchmark/long-horizon.js` publishes a **model-free ceiling beside the actual
  score**. The ceiling asks only "was the fact needed to answer present in the
  request at all" — no key, no cost, no flake, so it is the tier CI runs — and
  the GAP between it and a real model's score says whether a failure is a
  retrieval problem or a prompt problem. This is how order 02 runs on every
  commit without a key, and it is a better sub-metric than F1 alone.
- `readAiEnv` and the `JAREN_AI_MAX_CALLS` spend guard: the live tier is never a
  test dependency, a missing key is a *stated skip* rather than a failure, and a
  run that would exceed the call ceiling is skipped up front with that reason
  instead of being half-spent. Copied on order 16 as `benchmark/lib/ai-env.ts`
  (`TANGLE_AI_*`), resolving to the desktop's own settings shape so the
  benchmark's clients are the app's.

## The one load-bearing contract

`toLedgerMemory()` in `@tangleai/core/schemas/memory` projects a Tangle memory
unit onto what a jarenjs ledger memory holds: the five fields (`id`, `text`,
`evidence`, `tags`, `at`) and, when present, the embedding pair (`embedding`
+ `embeddedBy`). Tangle's schema is a strict superset under the same field
names, evidence stays mandatory, the pair is both-or-neither on both sides,
and `test/memory/ledger-mirror.test.ts` pins that the projection is
admissible to an UNMODIFIED `createLedger`, recallable there by tag AND by
meaning through the same embedder, stored verbatim — and that a full Tangle
unit is REFUSED (since 0.44 the ledger refuses unknown members rather than
dropping them, so the projection is the only door). The record types are
pinned to each other at compile time too. If that test breaks, the two
projects have drifted at the seam that matters most.

## Changing @jarenjs/ai

Only from concrete friction, never speculatively. The loop:

1. Build the capability in Tangle against today's seams. Where a seam is
   missing, work around it locally and note the friction.
2. When the same workaround appears a second time, write the minimal seam
   proposal: the contract, a jarenjs-internal consumer, and its test.
3. Land it in jarenjs on its own merits (house discipline applies: measurement
   first, README argument, deps test). Tangle then deletes its workaround.

It has happened once. The first candidate this document named — an
injectable **ranker** seam on ledger recall — landed in jarenjs's vector
campaign (v0.44–v0.46, 2026-08-25), together with the embed wire, the
deterministic reference embedder, the vector kernels, the identity rule and
a vector column in `@jarenjs/db`. Tangle absorbed it on 2026-08-26: the
`@tangleai/providers` package, `@tangleai/core/similarity` and the pipeline's
own trigram embedder were retired against the released packages; what
stayed on this side is the policies, the identity-gated `recallByEmbedding`
over Tangle's own units, and the measured width of the offline embedder.

## What must never migrate down

Memgraph/graph drivers, embedding wires that are not OpenAI-compatible
(Tangle's one such wire, Ollama's native `/api/embed`, was retired rather than
migrated — Ollama speaks the OpenAI wire the suite already owns), SearxNG,
TOML prompt packs, schedulers, HTTP servers, desktop shells, and any policy
whose justification is a paper rather than a measurement jarenjs itself
publishes.
