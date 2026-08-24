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

Copied as-is in the second sweep (2026-08-24, after realizing the prompts came
over but the tuned knowledge around them had not — thresholds, topologies,
scorer, registries live in these, nowhere else):
- `PLAN_LOCOMO_INTEGRATION.md` → `docs/attic/memflow-PLAN_LOCOMO_INTEGRATION.md` —
  the FULL LoCoMo plan (TODO 02 had carried only its §0 corrections): the
  official scorer port (normalizeAnswer, token-F1 with Porter stemming,
  multiHopF1), per-category eval-mode routing, the benchmark report JSON
  schema that TODO 06 depends on, the capability-profile design TODO 09
  names, the 20% evolution-holdout rule, the CC BY-NC 4.0 constraint.
  NOTE: neither plan contains a dataset URL — order 02 must source
  `locomo10.json` (Snap Research, ACL 2024) independently.
- `docs/ARCHITECTURE.md` → `docs/attic/memflow-ARCHITECTURE.md` — the halves
  that matter: Key Algorithmic Behaviors, the Memgraph data model (order 10),
  the prompt-pack directory map (decoder ring for `prompts/`), the evolution
  graph schema (`:Skill`, `:PredictionHarness`, `:VERSION_OF` — order 06)
- `docs/GMPL_TUTORIAL.md` → `docs/attic/memflow-GMPL_TUTORIAL.md` — the TOML
  prompt-pack format spec (`[meta]/[system]/[user]`, `{{var}}`, `{{#if}}`)
  and the worked domain-adapter example (order 07)
- `docs/modules/*.md` → `docs/attic/memflow-modules/` — the per-module design
  docs; every tuned default for orders 03–08 lives here (novelty 0.75,
  synthesis 0.82, relation 0.7, sensory buffer 512, StructMem
  10-entries-or-60s trigger, S2 affinity formula + the line-grouping trick
  that keeps the O(n³) eigensolver tractable, HERA reward weights,
  Milkyway's four harness modes)
- `src/workflows/**` → `docs/attic/memflow-workflows/` — 33 topology JSONs:
  the wiring layer for the prompt packs (stage ids map 1:1 onto `prompts/`
  directories), with conditional edges, SubWorkflow composition, and the
  hand-tuned constants (hybrid weights 0.5/0.3/0.2, delphi std_dev 0.2,
  consensus 0.7). Raw material for order 07's flow documents.
- `src/config/*.toml` → `docs/attic/memflow-config/` — the capability-tag →
  per-provider model registries (dims, seqlen, cost); seed data for order 09
  (model IDs are dated, the shape and numbers are the value)
- `src/gmpl/{types,RoleRegistry,PatternRegistry}.ts` → `docs/attic/memflow-gmpl/`
  — the pattern/role/domain contracts order 07 says to port as JSON Schema,
  PLUS the 11 built-in roles and 6 pattern definitions that instantiate them
- `src/tests/helpers/mocks.ts` → `docs/attic/memflow-test-mocks.ts` —
  deterministic sin-based fake embeddings, round-robin fake LLM with
  char-streaming; starting point for order 02's offline harness tests
  (attic `.ts` files are outside tsconfig `include`; they are data, not code)

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
- `IMRPOVE.md` (v1 of the LoCoMo plan, superseded by the copied v2) — its four
  unique ideas are folded into the TODO orders: dataset `manifest.json` with
  checksum/splits + a pluggable BenchmarkDataset registry (02), concrete
  distilled-skill examples (05), GMPL-critiques-the-benchmark synergy (07)
- `FOLLOWUP.md` (memflow product audit) — one lesson carried into TODO 04:
  memflow's consolidation modules silently dropped memories on
  persistence/embedding failure (17 bare `catch {}` sites); the tiers need a
  counted, observable failure path from day one

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
