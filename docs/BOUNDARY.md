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
| embeddings | *(none, deliberately)* | `@tangleai/providers` `createEmbeddingClient` (Ollama + OpenAI wires) |
| durable memory | ledger: 4 kinds, evidence-mandatory, 4-method storage seam | `@tangleai/memory` store of full units (vectors, confidence, supersession) |
| memory hygiene | *(none — ROADMAP names the missing measurement)* | novelty gate, crystallizer, contradiction resolution, outcome learning |
| retrieval ranking | ledger recall = tag + recency; a `where` needs the injected `compileQuery` | `rankByEmbedding` — the injectable ranker a host brings |
| LLM judgment | `createStructuredOutput` + gates + repair loop | the contradiction judge (verdict schema + messages live in `@tangleai/memory/contradiction`) |
| self-refinement | RFC-6902 patch over ledger state, 4 gates, rollback | future: skill loop and harness evolution PROPOSE through those gates (TODO 05/06) |
| orchestration | `@jarenjs/flow` FSM/DAG compile + durable sessions | future: GMPL patterns as flow documents (TODO 07) |
| scheduling | declared "the host's" by jarenjs | Tangle IS the host — consolidation cadence is Tangle's (TODO 04) |
| web search | — | `@tangleai/search` (SearxNG) + `compose/searxng` |

## The one load-bearing contract

`toLedgerMemory()` in `@tangleai/core/schemas/memory` projects a Tangle memory
unit onto the five fields a jarenjs ledger memory holds (`id`, `text`,
`evidence`, `tags`, `at`). Tangle's schema is a strict superset under the same
field names, evidence stays mandatory, and `test/memory/ledger-mirror.test.ts`
pins that the projection is admissible to an UNMODIFIED `createLedger` and that
the ledger's own field-stripping agrees with the projection. If that test
breaks, the two projects have drifted at the seam that matters most.

## Changing @jarenjs/ai

Only from concrete friction, never speculatively. The loop:

1. Build the capability in Tangle against today's seams. Where a seam is
   missing, work around it locally and note the friction.
2. When the same workaround appears a second time, write the minimal seam
   proposal: the contract, a jarenjs-internal consumer, and its test.
3. Land it in jarenjs on its own merits (house discipline applies: measurement
   first, README argument, deps test). Tangle then deletes its workaround.

The first candidate is already visible: an injectable **ranker** seam on ledger
recall, which jarenjs's ROADMAP wants for its own reasons and
`rankByEmbedding` already implements on this side.

## What must never migrate down

Memgraph/graph drivers, embedding provider wires, SearxNG, TOML prompt packs,
schedulers, HTTP servers, desktop shells, and any policy whose justification is
a paper rather than a measurement jarenjs itself publishes.
