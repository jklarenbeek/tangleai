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

Everything else — provider-specific wires outside the suite's published
adapters, host databases, schedulers, paper-specific pipelines, servers and UI
— is Tangle's.

## How the line runs today

| Concern | @jarenjs/ai side (contract) | Tangle side (policy/infra) |
|---|---|---|
| chat completions | `createChatClient` (OpenAI-compatible wire, retry, streaming, effective-request replay key and injected cache seam) | configuration and the SQLite replay adapter |
| embeddings | `@jarenjs/ai/embed`: the `{ embed, model, dims }` seam, `createEmbeddingClient` (OpenAI-compatible wire, reply reassembly, per-text partial replay), `createHashEmbedder`, `probeEmbeddings`; kernels in `@jarenjs/core/vector` | configuration, the SQLite replay adapter, and the measured WIDTH of the offline default (`createOfflineEmbedder`, 64 — see `packages/pipeline/src/standins.ts`) |
| durable memory | ledger: 4 kinds, evidence-mandatory, 4-method storage seam (+ optional `rank`); a memory carries `embedding` + `embeddedBy` as a pair | `@tangleai/memory` store of full units (the same pair, plus confidence, supersession, provenance) |
| memory hygiene | *(none — ROADMAP names the missing measurement)* | novelty gate, crystallizer, contradiction resolution, outcome learning |
| retrieval ranking | ledger `recall({ near })`: cosine through the embedder seam, refused without it, refused across identities, skips reported; over `@jarenjs/db`, `derive: 'vector'` + the k-nearest plan | `recallByEmbedding` — the same rule over Tangle's own units (supersession-aware), and the pairwise comparisons inside the policies |
| LLM judgment | `createStructuredOutput` + gates + repair loop | the contradiction judge (verdict schema + messages live in `@tangleai/memory/contradiction`) |
| self-refinement | RFC-6902 patch over ledger state, 4 gates, rollback | future: skill loop and harness evolution PROPOSE through those gates (roadmap: the skill loop, outcome-grounded decisions) |
| orchestration | `@jarenjs/flow` FSM/DAG compile + checkpoints + snapshot/resume; `@jarenjs/linq/flow` by-code pen (`defineDag`/`defineFsm`); `@jarenjs/db` durable jobs with per-job flow checkpoint rows and atomic complete-and-prune; `@jarenjs/ai` agent/toolbox/structured-output/budget/ledger/environment | `@tangleai/mas`: the canonical MAS workflow IR, `TMAS` refusal vocabulary, nine semantic gates, region partition/lowering policy, transactional node lifecycle, namespaced segment checkpoints and the resume outbox reconciler; GMPL patterns as flow documents stay future work |
| scheduling | `@jarenjs/core/schedule` bounded, fair, per-scope admission and drain | Document HTTP admission uses the suite scheduler; consolidation cadence remains a Tangle policy (roadmap: consolidation tiers) |
| web search | — | `@tangleai/search` (SearxNG) + `compose/searxng` |
| configuration identity | `PROVIDERS`/`resolveEndpoint` (the only endpoint authority), probes, clients, budget/structured-output/toolbox, the replay cache keyed by the effective request; `applyMergePatch`, `canonicalSha256`, `compileJsonQuery`, `$query` validation, `jaren-emit` types, `deepFreeze`/`cloneJson`, `sameIdentity`, `diffContracts` | `@tangleai/config`: the profile registry, pure resolution, TCFG refusal vocabulary and the run-identity envelope; the host adapter binding write-only secret slots; the identity repository beside runs/chats — a run identity is never a replay key (see CONFIGURATION.md) |

## What the suite already has — read before building

Current audit: [JarenJS 0.83.3 integration](JARENJS_INTEGRATION.md), 2026-09-11.
The following baseline records the 0.56.0 adoption; the current audit supersedes
its availability claims and documents the newer runtime seams.

The rule above decides where a NEW capability goes. This section answers the
prior question — *does it already exist below?* — because the expensive mistake
in a downstream repo is not putting something on the wrong side of the line, it
is building something the line already has. Audited against the sibling
checkout and installed npm packages at `@jarenjs/*` 0.56.0, one row per thing an open roadmap entry would
otherwise write.

**Use it — do not write it again.**

| What an open entry needs | What the suite publishes | Where it lands |
|---|---|---|
| A question answered over a whole corpus that will not fit a request | `createEnvironment` (RFC-style slots; `digest`/`peek`/`chunk`/`grep`/`select`/`stat`/`read`, none of which return bulk content), `compileProgram` + `createProgramRunner` (the model authors a compile-gated program; `map` is the only step that calls a model), `createLongHorizonAgent` (depth default 1, cap 3, children scoped so no sibling is reachable, a child's failure is a value) | **Landed** — the `long-horizon` row of `benchmark/lib/locomo-qa.ts` (the program path at depth 0, under a per-question turn budget, the ceiling read from the sub-call requests). The LoCoMo baseline IS this, not a hand-built RAG loop. jarenjs measures it: needle 100 % / pairwise 100 % in a **937-char request against a 17 719-char corpus**, where compaction alone scores 17.5 % / 0 % while spending 5 781 chars. LoCoMo is that claim's first public corpus. |
| Cost, and a run that stops instead of overrunning | `createBudgetAccount`, `BUDGET_DIMENSIONS` (`turns`/`tokens`/`ms`), the agent's `budget` with `spent` seeded for resume, a named `stopReason`, and one account shared by a whole recursion tree | **Landed** — `benchmark/lib/locomo-qa.ts` meters every live call through one account; the temporal lane inherits it. The cost column is this, not `@tangleai/core/tokens`. The suite already prefers the provider's own `usage` and falls back to a 4-char estimate only when a token budget is set — `estimateTokens` stays a truncation helper and stops being a cost number. |
| A trajectory to cluster into skills | `createTrajectory` (sequenced entries, excerpted answers, `summary()` by kind/depth), `describeTrajectory` | The skill loop. |
| Skills as records, and getting them back into a prompt | `SKILL_SCHEMA`, `ledger.recallSkills({ near })`, the agent's `retrieval.skills` slot | The skill loop. |
| Self-modification that cannot go rogue | `createRefiner`: RFC 6902 patch → shape → semantics-on-a-copy → ledger legality → commit with snapshot rollback; the base system prompt is not in the patched document at all | The skill loop, outcome-grounded decisions, the evolution loop. |
| Structured output with a repair loop | `createStructuredOutput`, `unfence`, coded errors carrying a `docPath` into the offending document | The temporal lane (window extraction); landed as the answer path's category-5 judge. |
| Constrained decoding against a local model | `@jarenjs/josl/gbnf` — a character-level GBNF for the llama.cpp family, beside the hosted `json_schema` twins the query and JSLT grammars publish | Config profiles, if a local provider becomes a profile. |
| Reading memflow's TOML prompt packs | `parseToml` from `@jarenjs/josl` — passes the official toml-test 1.0.0 suite in strict mode, the only engine in its benchmark that does | Patterns as flow documents. Do not write a TOML reader. (The packs themselves stay Tangle's — see *What must never migrate down*; consuming the suite's parser is not migrating anything down.) |
| Tabular import/export of results | `parseCsv`, `stringifyCsv`, `sniffCsvDialect`, and a `repair: true` mode that logs every fix under a stable `CSV1xxx` code | The instruments; the policy matrix. |
| Catching a malformed dataset at the door | `@jarenjs/validate`, plus the `$query` keyword for cross-field assertions (sums, ordering, quantification) | **Landed** in the census — `locomo10.json` is validated on load against a committed schema, so the 444/446 missing-`answer` adversarial bug is a **schema-detected count in the report**, not a surprise in the scorer. |
| Keeping hand-written interfaces honest with their schemas | `emitTypeScript` (a function, not only the `jaren-emit` CLI) with `--check` failing CI when a schema moved and the type did not, verified cyclically against the validator over an instance corpus | Any instrument. Dev-only, so exempt under CONVENTIONS §1. Candidate replacement for the hand-maintained interface/schema drift tests in `@tangleai/core/schemas`. |
| A stable identity for a dataset or a report | `@jarenjs/json/canonical` (RFC 8785 canonical bytes) and the SHA-256-over-canonical pattern `contract.revision()` already uses; `hashContent` in `@jarenjs/core/string` (exact FNV-1a) for a cheap fingerprint | The instruments — the checksummed manifest the salvage plan asks for. |
| Replaying paid chat replies and embeddings | the `cache` seam on `createChatClient` and `createEmbeddingClient`: effective credential-free keys, replay marking, per-text partial embedding hits and malformed-entry refusal | **Landed at 0.56.0.** `benchmark/lib/wire-cache.ts` is now only the SQLite adapter/audit trail; the client wrappers and key construction are gone. |
| Repeatable random draws | `mulberry32`, `randomInt`, `shuffle`, `drawDistinct` from `@jarenjs/core/random` | **Landed at 0.56.0.** LoCoMo instruments import it directly; the local random module is gone. |
| Descriptive statistics with explicit quantile semantics | `mean`, sample `variance`, `stddev`, `median`, and required-method `quantile` from `@jarenjs/core/stats` | **Landed at 0.56.0.** `benchmark/lib/stats.ts` retains only null/report shaping over nearest-rank p50/p95. |
| Ordered bounded asynchronous work | `mapConcurrent` from `@jarenjs/core/async`, including abort/drain semantics | **Landed at 0.56.0.** The QA instrument imports it directly; the local clamping pool and redundant test are gone. |
| Running the eval as a document, and drawing it | `@jarenjs/flow` jaren-dag, and `@jarenjs/mermaid`'s `dag-to-flowchart` stylesheet | Already correct — `@tangleai/pipeline` uses both, and `packages/pipeline/src/mermaid.ts` derives the drawing from the executable document rather than hand-drawing it. |
| A benchmark run as an operation, live progress, and a CI gate on its shape | `@jarenjs/contract`: a `subscribe` operation streamed as a `@jarenjs/db` live query (SSE over http, frames over port, resumable by seq), `contract.revision()`, and `diffContracts --fail-on breaking` | The desktop's open ends (the benchmark reaching the surface). |
| Excerpting, truncating, sizing text | `excerpt`, `truncate`, `sizeOf`, `chunkText` in `@jarenjs/core/chunk` | Everywhere. Note the standing exception: this is NOT the document chunker — it has no element or heading model, which the document lane needs. |
| Time as an answerable structure | `@jarenjs/core/series` | The temporal lane. |
| Geography | `@jarenjs/core/geo`, `@jarenjs/ai/spatial` (the gates), `@jarenjs/ai/geo-tools` | The place lane. |

Consumed by the MAS runtime at 0.56.0 (audited again at close-out): the
flow pen (`defineDag`/`defineFsm`, captured guards/selectors,
`.checkpoint()`), `compileDag`'s concurrent readiness with edge-order
ports and shared abort, `compileFsm`'s document-order selection with
`snapshotFsm`/`resumeFsmSession` (the async Tangle host deliberately
does not use `createDurableFsmSession`'s synchronous store), the DB
durable jobs composition (idempotent caller-supplied ids, guarded
leases, `checkpointsFor` with atomic complete-and-prune), the whole
agent seam (`createAgent`, `createToolbox`, `createStructuredOutput`,
`createBudgetAccount`, `createLedger`, `createEnvironment`), RFC 6902
compile/diff (`compileJSONPatch`/`createJSONPatch`) for template
instantiation, and the Mermaid stylesheets (`dag-to-flowchart`,
`workflow-to-state`) for projection. None of these were built locally;
what Tangle owns above them is policy: the IR, the refusal vocabulary,
the semantic gates, the partition rules, the transactional completion
contract and the trace retention states.

**Build it here — the suite genuinely does not have it.** Written down so nobody
spends an afternoon looking:

- **Every string metric the LoCoMo scorer needs.** `normalizeAnswer`, a Porter
  stemmer, token-level F1, the comma-split multi-hop variant. `@jarenjs/core/text`
  is a *format-validation* toolbox — emails, hostnames, IPs, URIs/IRIs, UUIDs,
  punycode, I-Regexp — and there is no tokenizer, no stemmer and no
  string-similarity metric anywhere in the suite. Written once for the scorer, to the
  official evaluator's exact spelling, because parity with the published
  numbers is the entire point of porting rather than improving:
  `benchmark/lib/porter.ts` (NLTK's variant) and
  `benchmark/lib/locomo-parity.ts`, pinned by fixtures the official evaluator
  itself produced.
- **k-means.** Not in the suite. `@tangleai/core/clustering` is legitimately
  Tangle's, and its header already explains why it does not reach for
  `@jarenjs/core/vector` (the suite publishes similarities; k-means++ needs the
  squared distance itself).
- **The LoCoMo loader, preprocessor, scorer and report.** Paper-specific, so
  Tangle's by the rule at the top of this file.
- **The document-grounding claim/citation scorer.** The suite now publishes a
  generic claim/evidence envelope, consumed by the desktop reference gate. The material-claim
  oracle, the closed matching predicates, the six-state terminal citation
  classifier and the report shaping live in `benchmark/lib/grounding*.ts` and
  never under `packages/`. Everything around them is consumed, not rebuilt:
  `createStructuredOutput` (generation and the desktop's supplied-reference
  gate), `JarenValidator`/`$query` through the one report-validator factory,
  `jaren-emit` types, `canonicalSha256` identities, the client cache seam for
  replay, `createBudgetAccount`, `mapConcurrent`, `mean`/`stddev`/`quantile`,
  and `mulberry32`/`drawDistinct`. The generic reference checks use
  `validateClaimEvidence`; semantic support remains specific to the registered
  Tangle fixture and does not follow from a well-formed envelope.

**Copy the method, not the code.** jarenjs's benchmark scripts are not published
packages, so nothing below is importable — but each is a decision this repo
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
  retrieval problem or a prompt problem. This is how the recall instrument runs on every
  commit without a key, and it is a better sub-metric than F1 alone.
- `readAiEnv` and the `JAREN_AI_MAX_CALLS` spend guard: the live tier is never a
  test dependency, a missing key is a *stated skip* rather than a failure, and a
  run that would exceed the call ceiling is skipped up front with that reason
  instead of being half-spent. Copied as `benchmark/lib/ai-env.ts`
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

It first happened when the candidate this document named — an
injectable **ranker** seam on ledger recall — landed in jarenjs's vector
campaign (v0.44–v0.46, 2026-08-25), together with the embed wire, the
deterministic reference embedder, the vector kernels, the identity rule and
a vector column in `@jarenjs/db`. Tangle absorbed it on 2026-08-26: the
`@tangleai/providers` package, `@tangleai/core/similarity` and the pipeline's
own trigram embedder were retired against the released packages; what
stayed on this side is the policies, the identity-gated `recallByEmbedding`
over Tangle's own units, and the measured width of the offline embedder.

The loop closed again at v0.56.0 after the downstream audit identified four
repeated mechanics. Replay identity/partial hits, seeded random,
descriptive statistics and bounded ordered mapping landed with JarenJS
consumers and tests; Tangle then deleted its wrappers and duplicate arithmetic.

## What must never migrate down

Memgraph/graph drivers, embedding wires that are not OpenAI-compatible
(Tangle's one such wire, Ollama's native `/api/embed`, was retired rather than
migrated — Ollama speaks the OpenAI wire the suite already owns), SearxNG,
TOML prompt packs, schedulers, HTTP servers, desktop shells, and any policy
whose justification is a paper rather than a measurement jarenjs itself
publishes.
