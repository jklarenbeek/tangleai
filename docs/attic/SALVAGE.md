# Salvage manifest

What was carried into this repo from the two predecessors, and where the rest
still lives. Both source trees remain on disk untouched; nothing else was
copied, everything else is a PORT (rewritten in this repo's idiom) or left
behind on purpose.

## From memflow (`/home/joham/projects/jp/memflow`, private prototype)

Copied as-is:
- `docs/refs/` → `docs/refs/` — 18 paper PDFs + S2Chunker notes
- `docs/PAPERS.md` → `docs/attic/memflow-PAPERS.md` (superseded by `docs/PAPERS.md`)
- `src/prompts/**` → `prompts/` — 14 TOML prompt packs (data for TODO 04–07)

Ported (rewritten as strict TypeScript, tests added):
- `src/utils/similarity.ts` → `@tangleai/core/similarity`
- `src/utils/clustering.ts` → `@tangleai/core/clustering` (RNG now injected)
- `src/utils/tokens.ts` → `@tangleai/core/tokens`
- `src/core/types.ts` MemoryUnit (+ jarenjs ledger alignment) → `@tangleai/core/schemas/memory`
- `src/modules/memory/NoveltyGateModule.ts` → `@tangleai/memory/novelty`
- `src/modules/memory/CrystallizerModule.ts` → `@tangleai/memory/crystallize` (plan/apply split; Cypher → store contract)
- `src/modules/memory/ContradictionModule.ts` → `@tangleai/memory/contradiction` (LLM behind an injected judge; regex-JSON → verdict schema)
- `src/modules/memory/OutcomeLearnerModule.ts` → `@tangleai/memory/outcome`
- `src/providers/EmbeddingProvider.ts` + `OpenRouterEmbeddings.ts` (the idea) → `@tangleai/providers/embeddings` (LangChain dropped, wires direct)

Left behind, with intent recorded in TODO.md:
- WorkflowEngine/WorkflowContext/ModuleRegistry/StateStore — replaced by `@jarenjs/flow` + `@jarenjs/ai` (the whole point of the rewrite)
- the remaining ~70 modules (SimpleMem/LightMem/StructMem pipelines, HERA, evolution layer, GMPL runtime) — each earns its port through a TODO order and a measurement
- MemgraphClient, server, MCP/ACP, desktop app, trading domain — infrastructure to be rebuilt if and when an order needs it
- `PLAN_LOCOMO_INTEGRATION.md` §0 research corrections — carried as prose into TODO order 02

## From the old tangleai (`/home/joham/projects/jp/tangleai-old`, Perplexica fork)

Copied as-is:
- `compose/searxng/` → `compose/searxng/` (settings.yml with format=json, limiter, favicons)
- `LICENSE` → `docs/attic/tangleai-old-LICENSE` (MIT, ItzCrazyKns + jklarenbeek)

Ported:
- `apps/scraper/src/utils/searxng.ts` → `@tangleai/search/searxng` — LangChain
  Document wrapper, xxhash ids, per-result HEAD probes and module-level config
  dropped; what remains is query-in/results-out with coded errors

Left behind:
- the Next.js frontend, backend agents, focus-mode prompt chains, scraper
  service, docker profiles — the search PRODUCT is not this repo's goal;
  TODO 08 (search grounding) and TODO 11 (surfaces) say when to look again
