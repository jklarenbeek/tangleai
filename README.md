# Tangle AI

Self-improving memory and retrieval for agents, built on the
[jarenjs](https://github.com/jklarenbeek/jarenjs) suite as the foundational
layer.

Tangle is the second life of two earlier projects: **memflow** (a
self-improving RAG / lifelong-memory workflow engine that proved the designs
and sank under its own infrastructure) and the original **tangleai**
(a Perplexica fork, from which the SearxNG search layer survives). The
rebuild keeps the ideas, replaces the plumbing: workflow engine → 
`@jarenjs/flow`, Zod → `@jarenjs/validate`, LangChain → `@jarenjs/ai`
seams, and every policy now lands with a test — and, per the campaign
rule, no self-evolving capability ships before the instrument that can
call it an improvement.

The codebase is **TypeScript-only with no build step**: Node 24's native
type stripping runs `.ts` directly (tests and workspace packages included),
and `tsc --noEmit` under `strict` is the type gate. That inversion of the
jarenjs house style is deliberate — this repo doubles as the standing test
of jarenjs's published types under a strict TS consumer; findings live in
[JARENASK.md](JARENASK.md).

## What runs today

```sh
npm install
npm run check      # strict typecheck + 69 tests, no network
npm run skeleton   # the whole loop, end to end, offline
```

The skeleton ingests evidenced observations and runs them through the
policy chain — novelty gate → contradiction resolution → crystallization →
outcome learning → embedding-ranked recall — then mirrors the surviving
memories into an unmodified `@jarenjs/ai` ledger, where a plain jarenjs
agent can recall them by tag:

```
ingest: 5 admitted, 1 filtered as near-verbatim repeats
contradiction: judged 2 similar pairs, resolved 1
crystallize: examined 5, merged 1
outcome: "Deploys must run the full gate before shipping" boosted to confidence 0.65
recall for: "what is the current api rate limit?"
  0.676  [fact] The API rate limit is 500 requests per minute  (evidence: gateway config v2)
answer (grounded): The API rate limit is 500 requests per minute — per gateway config v2
ledger mirror: 3 live memories admitted to a @jarenjs/ai ledger
```

## Packages

| package | what it is |
|---|---|
| `@tangleai/core` | coded errors, similarity strategies, zero-dep k-means, token heuristics, and the memory-unit JSON Schema (a strict superset of the jarenjs ledger memory — evidence stays mandatory) |
| `@tangleai/memory` | the policy layer over an injected store: novelty gating, plan/apply crystallization, judge-injected contradiction resolution, ground-truth outcome learning, `rankByEmbedding` |
| `@tangleai/providers` | embedding client for Ollama-native and OpenAI-compatible wires (chat stays on `@jarenjs/ai`) |
| `@tangleai/search` | zero-dependency SearxNG JSON client; `compose/searxng/` holds the docker settings |

## Where things stand

- [TODO.md](TODO.md) — the campaign; next order is the LoCoMo benchmark,
  which gates all further policy work
- [docs/BOUNDARY.md](docs/BOUNDARY.md) — what belongs in `@jarenjs/ai`
  versus here, and the one test-pinned contract between them
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the loop, the two
  load-bearing ordering rules, the house style
- [docs/PAPERS.md](docs/PAPERS.md) — the research this implements, with
  per-paper status; PDFs archived in [docs/refs/](docs/refs/)
- `prompts/` — memflow's TOML prompt packs, carried as data for orders 04–07

## Provenance

memflow (private prototype, 2026) supplied the memory-policy designs and the
paper corpus. The original tangleai was a fork of
[Perplexica](https://github.com/ItzCrazyKns/Perplexica) (MIT); the SearxNG
client here descends from that code. License: MIT.
