# Architecture

Tangle AI rebuilds the memflow prototype's ideas on the jarenjs suite as the
foundational layer. memflow proved the designs and died of its own weight —
a bespoke workflow engine, a Zod type system, LangChain plumbing and a
Memgraph dependency it carried everywhere. Every one of those has a jarenjs
replacement that is smaller, tested, and already shipped; Tangle keeps only
what jarenjs does not do: memory policies, providers, search, and (to come)
the evolution loops. See [BOUNDARY.md](BOUNDARY.md) for the rule that keeps
it that way, and [PAPERS.md](PAPERS.md) for where each research idea stands.

## Packages

```
@tangleai/core        errors (TA-coded) · similarity strategies · k-means
                      (injected RNG) · token heuristics · memory-unit schema
                      (JSON Schema, superset of the jarenjs ledger memory)
@tangleai/memory      the policy layer, over an injected 4-method store:
                        novelty     — LightMem Tier-1 gate (batch-aware)
                        crystallize — plan/apply near-duplicate merge
                        contradiction — plan pairs / injected judge / supersede
                        outcome     — ground-truth confidence adjustment
                        retrieval   — rankByEmbedding (the injectable ranker)
@tangleai/providers   embedding client: Ollama native + OpenAI-compatible
                      wires, fetch injected, coded errors, order-verified
@tangleai/search      SearxNG JSON client (salvaged from the Perplexica fork)
```

Chat completions, structured output, tool use, the agent loop, budgets,
compaction, the durable ledger and gated self-refinement are NOT here —
they are `@jarenjs/ai`, consumed as a dependency.

## The loop (examples/skeleton.ts runs all of it offline)

```
observations (text + evidence + timestamp — or refused)
   │  createMemoryUnit: content-addressed id → re-ingestion is idempotent
   ▼
novelty gate         threshold HIGH (near-verbatim only)
   ▼
contradiction pass   similar pairs judged; older loser SUPERSEDED, never deleted
   ▼
crystallization      paraphrase merge; provenance in mergedFrom; skips superseded
   ▼
outcome learning     confidence moves on evidenced real-world reports only
   ▼
recall               rankByEmbedding (excludes superseded and un-embedded)
   │
   └─ mirror: live units → toLedgerMemory() → @jarenjs/ai createLedger,
      where a plain jarenjs agent recalls them by tag
```

Two ordering rules are load-bearing and test-pinned:

1. **Contradiction before crystallization.** A contradiction is by nature
   ~0.95-similar to what it contradicts ("limit is 100" / "limit is 500").
   Gate too eagerly, or merge first, and the correction is eaten as a
   duplicate. So the gate only filters near-verbatim repeats, and the judge
   runs before the merger.
2. **A resolution equal to the winner's text writes nothing.** Ids are
   content-addressed, so re-writing the winner's text as an un-embedded
   summary would overwrite the embedded fact under the same id. Only a
   genuinely synthesized resolution becomes a new record.

## Design style (inherited from jarenjs, on purpose — with one deliberate inversion)

- TypeScript-only, run WITHOUT a build step: Node 24's native type
  stripping executes `.ts` directly (workspace packages included, through
  symlinks), `tsc --noEmit` under `strict` + `erasableSyntaxOnly` is the
  type gate, `node --test` runs `.ts` test files as-is. The inversion is
  deliberate: jarenjs is JSDoc-JS, and this repo being strict TS makes it
  the standing compatibility test for jarenjs's generated `.d.ts` — see
  [JARENASK.md](JARENASK.md) for what that audit found.
- Policies are split plan/apply: the plan is a pure value you can assert on;
  only the applier touches the store.
- Every edge is injected: `fetch`, `now`, RNG, store, judge, validator.
  Nothing in `packages/` reaches for the network or the clock on its own.
- Errors are coded (`TA0001` caller / `TA0002` transport / `TA0003` payload);
  content-level problems are values, not throws.
- Every record is schema-validated at the store boundary; evidence is
  mandatory on memories AND on outcome reports.

## What is deliberately absent (see TODO.md)

The fitness signal (LoCoMo, TODO 02) comes before any further policy work —
memflow's core mistake was self-evolution with no external benchmark, and the
jarenjs suite's own history (recursive.js shipping unmeasured) says the same
thing. Servers, persistence beyond in-memory, graph indexing of `relations`,
and the GMPL multi-agent patterns all wait behind their orders.

## The surfaces (added 2026-08-24)

Two packages and two apps sit on top of the loop, jarenjs-suite-only:

- `@tangleai/store` — the same 4-method `MemoryStore` contract over SQLite
  (`@jarenjs/db` `openStore`; node:sqlite under Node, bun:sqlite in the
  compiled binary, picked at runtime), plus the run/event log. The pipeline
  test suite runs the identical scenario over both stores — the policies
  cannot tell them apart, which is the seam's proof.
- `@tangleai/pipeline` — the loop as a `jaren-dag` DOCUMENT. `@jarenjs/flow`
  executes it (per-node `onNode` records feed the run log and the live SSE
  stream); `@jarenjs/mermaid` projects the drawing FROM the document via the
  suite's own `dag-to-flowchart` stylesheet. The picture is the pipeline.
- `apps/desktop` — one `@jarenjs/contract` document is the whole API
  (`serveHttp` → `toNodeHandler` over node:http, which Bun also implements);
  the UI is a `@jarenjs/app` document rendered by `@jarenjs/view`, with
  charts/mermaid/markdown from their suite packages. `bun build --compile`
  produces a single self-contained executable (`npm run desktop:compile`).
  The UI is tested HEADLESS in node — the app document drives
  `openHttpClient` whose fetch is `toFetchHandler` over the real dispatcher —
  and end-to-end in a real browser (`.e2e/`, via the playwright distrobox).
- `apps/pages` — the GitHub Pages site; its demo executes the real pipeline
  document in the browser over the in-memory store.

Chat grounding: question → embed → `rankByEmbedding` over live memories →
citations; the model (optional, `@jarenjs/ai` `createChatClient`) answers
ONLY from those memories, and a missing or dead provider degrades to
grounded recall — cited memories, never invention.
