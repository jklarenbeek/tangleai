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
