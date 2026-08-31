# 📅 Tangle Roadmap

This is the single roadmap for the repository: what Tangle wants to have and
does not yet.

**It lists only what is still open.** When something ships, its knowledge moves
into the document a reader would actually reach for — the package `README`,
[`ARCHITECTURE.md`](ARCHITECTURE.md), [`BOUNDARY.md`](BOUNDARY.md), the
benchmark document that carries its number — and the entry leaves this file.
The record of *when* something shipped is the git history; what a shipped thing
*does* is its documentation's job. Nothing here is a status ledger, an order or
a "next" marker: a campaign is what the operator makes of an entry, in
gitignored scratch, under [`workflow/CAMPAIGN.md`](workflow/CAMPAIGN.md), and
when it closes it retires or narrows the entry it served.

Each entry states what we want, the constraint that makes it hard, what already
exists to stand on, and the measurement that would close it. An entry that no
longer matches the code is a bug in this file — delete it or fix it.

**The standing rule, learned twice** (once by the predecessor's self-evolving
tiers, once by the suite's recursive agent): **no self-evolving capability ships
before the instrument that can call it an improvement.** The instrument exists.
[`LOCOMO_RECALL.md`](LOCOMO_RECALL.md) is the keyless evidence-recall ceiling and
[`LOCOMO_BENCHMARK.md`](LOCOMO_BENCHMARK.md) the F1 beside it, for Tangle and for
every rival over one corpus, one scorer and one sample — and Tangle loses to every
rival that answered the whole sample, which is the number most of this file exists
to move. Before authoring anything below, read [`BOUNDARY.md`](BOUNDARY.md)
§"What the suite already has": the expensive mistake here is not putting a
capability on the wrong side of the boundary, it is building one the boundary
already has.

## Memory policies

- [ ] **Memory policies, measured.** *Wanted:* the LoCoMo matrix over the policy
  knobs that already exist — novelty threshold, crystallize threshold,
  contradiction on/off, ranker k / minScore, embedder width — with a real
  embedding client behind the same seam (`createEmbeddingClient` from
  `@jarenjs/ai/embed`, the desktop's embed setting), wins AND losses published,
  and every policy that does not move the number demoted to opt-in. *Constraint:*
  the first row of this matrix is a loss. With the lexical embedder the shipped
  defaults cost evidence recall at k = 20 and the ingest census names the
  culprits — the gate's filtered turns, the judge's numeric-contrast
  supersessions, the crystallizer's merges — and in the live table the policies
  leave most prompts byte-identical to the inert pipeline's and score lower on the
  ones they change, at the same ceiling ([`LOCOMO_BENCHMARK.md`](LOCOMO_BENCHMARK.md)).
  The instrument's knobs are `--novelty`, `--contradiction`, `--crystallize` and
  `--dims`; a real embedder behind them is the one thing it lacks. The offline
  width was measured for threshold margin over the skeleton corpus, not for
  retrieval, and one probe (128 dims on one conversation) moved recall
  substantially — the width is a cell of this matrix, not a constant. *Salvage:*
  memflow's tuned starting values are in `attic/memflow-modules/` (novelty 0.75,
  synthesis 0.82, relation 0.7). *Closes on:* LoCoMo F1 and evidence recall per
  policy, cost (tokens, calls) beside each.
- [ ] **Consolidation tiers** (LightMem / SimpleMem / StructMem). *Wanted:*
  sleep-time consolidation as a Tangle-scheduled pass — STM buffer, topic
  segmentation, cross-event synthesis behind the same injected-judge seam as
  contradiction — where memflow's 22 memory modules either earn their port or
  stay unported. *Constraint:* the suite's own history compaction plus ledger
  archiving IS a consolidation tier (a dropped round is content-addressed into a
  slot and reachable through `recall`, never destroyed), and jarenjs measured its
  ceiling honestly: needle 17.5 % → 100 %, pairwise **0 % at every budget**,
  because a relation over every fact cannot be summarized into a smaller context.
  A tier that only compresses buys a curve already plotted; what must be justified
  is the part compaction provably cannot do. Failures must be counted values — the
  predecessor's tiers silently dropped memories on persistence and embedding
  failure. `excerpt`/`truncate`/`sizeOf` from `@jarenjs/core/chunk` are the text
  primitives; the buffer never needs its own. *Salvage:*
  `attic/memflow-modules/{lightmem,simplemem,structmem}.md` — every default
  (sensory 512, STM 2048, StructMem's 10-entries-or-60 s trigger, LightMem's
  buffer > 50 % → gate-else-passthrough routing, the newer-timestamp update queue)
  and the pure-logic candidates (TopicSegmenter B1∩B2, SemanticSynthesis's
  union-find, PreCompression's order-preserving heuristic, StructuredIndex TF
  keywords). *Closes on:* LoCoMo delta against the measured-policy baseline; token
  cost of the sleep pass.
- [ ] **Experiential memory beyond the memo.** *Wanted:* the co-existence
  architecture the "memo, not true memory" argument asks for — keep the fast
  episodic half Tangle already has (evidenced records, supersession,
  crystallization, outcome-moved confidence) and add an asynchronous parametric
  consolidation channel: a reviewed, versioned dataset of post-deployment
  experiences with full lineage; an injected training backend that produces a
  checksummed persistent parameter artifact while the base stays immutable;
  held-out compositional evaluation that never retrieves its own training
  examples; canary, atomic activation, per-run pinning and exact rollback.
  *Constraint:* nothing in Tangle changes model parameters today — every
  operation changes records or the context presented to a model — and an
  inference-only provider must be reported as such, never as a learned
  transition. This is a position paper with a theorem, not a specification, so
  the entry operationalizes the builder requirements, not the paper line by line.
  *Closes on:* a held-out compositional metric the artifact beats against frozen
  retrieval and distilled rule text in context, with regressions, exclusions and
  compute cost published — including a negative result.

## Time and place

- [ ] **The temporal lane: time as an answerable structure.** *Wanted:* LoCoMo
  category 2 (temporal) is where every published memory system scores worst, for
  a structural reason — a cosine ranker has no way to express *when*. Tangle gets
  one. *Stands on:* `@jarenjs/core/series` at the pinned version — the half-open
  interval algebra (`containsInstant`, `overlapsInterval`, `mergeIntervals`,
  `subtractIntervals`, `gapsWithin`, `coverageOf`, `findSlots`),
  `createIntervalIndex`, `asOfJoin`, five query operators with LINQ parity, a
  `(series, at)` database plan with `explain().series`, and the calendar names in
  eleven locale packs — plain data throughout, so it crosses the store boundary
  unchanged. The seam was exercised against the tree when this was written:
  session date → instant → validity interval → `containsInstant`, and a backward
  `asOfJoin` from a May anchor over April/June facts returns the April one with its
  `distance` and the record's own members intact. *Decisions already taken, so a
  campaign need not re-litigate them:*
  - a memory's validity is the half-open interval `[at, supersededAt)` and Tangle
    already stores both ends — a superseded record answers for the window it was
    true in instead of vanishing; no `supersededAt` runs to the query's own upper
    bound, never a sentinel instant;
  - the model proposes a window, the kernel decides membership: "last summer"
    resolves through `@jarenjs/ai/structured` against a closed
    `{ start, end } | null` schema anchored on the ASKING session's instant, never
    `Date.now()`; a refused or `null` window falls back to unscoped recall and is
    COUNTED;
  - `asOfJoin` is the retrieval primitive cosine cannot fake — left the anchor
    event's instant, right the candidate fact series from the identity-gated
    ranked recall, `direction: 'backward'`, unmatched rows kept as `right: null`;
    meaning first, then time, both counts reported;
  - `createIntervalIndex` over session spans, built once per conversation at
    ingest; no linear scan of spans in the hot path;
  - `memories` declares `{ name: 'by_series_at', path: ['$.series', '$.at'] }`
    with `at` the epoch mirror of the RFC 3339 field (the string is the record's
    contract, the number the index's); the test asserts
    `explain().series.index !== null` AND that the in-memory store answers
    identically, and records `stats().series.diverted`;
  - elapsed time is computed, never generated — subtraction over instants,
    rendered by the locale pack, with each recalled memory's offset from the
    asking session in the prompt;
  - no clock anywhere in the lane; the gate is byte-identical reports;
  - `resampleSeries`/`rollingSeries`/`downsampleSeries` answer questions LoCoMo
    does not ask and stay out of the retrieval path (`downsampleSeries` may feed a
    timeline surface, sampling metadata visible — a SHOW, not a claim).
  *Salvage:* the recall report schema is extended, not forked — a `temporal`
  block beside `qa` with window counts (proposed / refused / fallback), as-of
  match and miss counts, index mode from `explain()`, added calls. *Closes on:*
  category-2 F1, lane on vs off, over the same corpus and embedder — categories
  1/3/4 and overall published beside it as non-regression evidence, category-2
  evidence-recall@k as the retrieval sub-metric, cost (extra calls, p50/p95 ms) in
  the same table. A lane that moves category 2 and costs category 1 is a loss and
  is published as one.
- [ ] **The place lane: spatial, and honest about what it cannot score.**
  *Wanted:* `@jarenjs/core/geo` and `@jarenjs/ai`'s spatial profile have sat unused
  inside the pin since the suite's geo campaign; LoCoMo's personas move, and
  "where was she living when she started the job" is a spatiotemporal as-of join
  the temporal lane makes expressible. Test whether grounding place mentions buys
  retrieval quality that meaning-plus-time alone does not. *Constraint:* **LoCoMo
  has no spatial category** — nothing in the benchmark scores geography, and a
  claim that a spatial feature "improved LoCoMo" would be a category-1/3 side
  effect wearing a borrowed name. So this lane is measured on its own committed
  fixture set and must additionally not move the LoCoMo number. *Decisions already
  taken:* positions come from a committed gazetteer fixture (the place names the
  ten conversations mention, each with a WGS 84 `[lon, lat]`, a source and a
  confidence) or the work stops — a guessed coordinate is a fabricated memory and
  the evidence rule outranks the feature; a placed memory is a memory with a
  GeoJSON member (RFC 7946), no geometry type, no CRS wrapper; the suite's two
  spatial refusals are adopted as written — geodesic metres (`$distance`,
  `$area`), and a geohash prefix is bucketing, never proximity
  (`geohashNeighbours`, nine cells) — with `spatialGates` on every LLM-authored
  spatial query and a refusal a counted value; the spatiotemporal join
  (`asOfJoin` over a persona's positions, `$distance` between matches) is the
  actual claim, the only thing a vector ranker structurally cannot do; the
  database side is `derive: 'bbox'` or nothing, `physical: 'rtree'` only if a
  measurement asks. *Salvage:* none — memflow never had geography; the prior art
  is `@jarenjs/ai/spatial`'s `SPATIAL_OPERATORS` table. *Closes on:* place-grounded
  recall against the temporal-lane baseline on the fixture set, with the
  gazetteer's coverage (mentions grounded / total) beside it; a hard
  non-regression gate on LoCoMo categories 1–4; the `spatialGates` refusal counts
  as a correctness result.

## Learning from outcomes and traces

- [ ] **The skill loop.** *Wanted:* close the loop the suite names as open work —
  trajectories → lessons → skills stored as `SKILL_SCHEMA` records → back into a
  prompt — with every write PROPOSED through the suite's refine gates (RFC 6902,
  evidence-mandatory), never direct. *Stands on:* `createTrajectory` and
  `describeTrajectory` (the trajectory is published; do not invent a trace
  record), `SKILL_SCHEMA`, `ledger.recallSkills({ near })`, the agent's
  `retrieval.skills` slot, `createRefiner`. *Constraint — the design on file is
  the wrong algorithm:* the salvaged prompt packs under `prompts/trace2skill/` and
  the k-means-cluster-then-retrieve shape reproduce the paper's *retrieval-memory
  baseline*, not its method. Trace2Skill assigns one frozen-skill trajectory to
  each independent analyst, merges every trajectory-local patch hierarchically
  and prevalence-aware into ONE skill directory, and uses that directory directly
  with no retrieval index at test time; error diagnosis is evaluator-proven, and
  a held-out comparison decides. Which of the two Tangle builds is the fork a
  campaign puts to the operator first. k-means, if it stays, is Tangle's
  (`@tangleai/core/clustering` records why it does not reach for
  `@jarenjs/core/vector`; it takes an options object, so a positional port of
  memflow's `kMeans(vectors, k, maxIterations)` silently ignores `maxIterations`).
  *Salvage:* `attic/memflow-modules/evolution.md` — the artifact shape
  (`applicableWhen` / `doPatterns` / `dontPatterns`, `sourceTraceCount`, version)
  and knobs (k 5, maxSkillsPerCluster 3, inject topK 5 / minSimilarity 0.4).
  *Closes on:* repeat-task success with skills on vs off on a held-out set; skill
  count stays bounded; the loss published if the mechanism does not beat the
  retrieval baseline.
- [ ] **Outcome-grounded decisions, two-phase.** *Wanted:* pending decision →
  resolved against a real-world outcome → reflection, generalizing
  `@tangleai/memory/outcome`, with versioned harnesses as memory records under
  `VERSION_OF`-style relations. *Constraint:* `applyOutcome` moves confidence on
  cited memories after a host supplies a report; it does not represent an
  unresolved question, revisit it at ordered checkpoints, or promote anything.
  *Salvage:* the four-mode harness state machine (Create / Evolve / Retrospective
  / Inject-validated-only, maxVersions 10) in `attic/memflow-modules/evolution.md`;
  the graph it wrote (`:PredictionHarness`, `:VERSION_OF`) in
  `attic/memflow-ARCHITECTURE.md`; the outcome-evaluator rule (direction and
  |Δ| < 0.05 → success / partial / failure) in `attic/memflow-GMPL_TUTORIAL.md` §3.
  *Closes on:* decision quality over rounds on a replayable domain, in the
  benchmark report's format.
- [ ] **Harness evolution for forecasting (Milkyway).** *Wanted:* the domain loop
  the entry above generalizes toward — an unresolved forecasting question run at
  two or more ordered checkpoints under version-pinned prompts and tools, each
  with a cutoff-audited evidence set, prediction, raw trace, a six-part local note,
  spend and stop reason; from checkpoint two, source-backed internal feedback and a
  small provisional update to the factor / evidence / uncertainty procedure,
  invisible outside its question until resolution; resolution scoring every
  checkpoint through a declared adapter; a retrospective check that validates,
  refines or rejects the provisional guidance and atomically promotes exactly one
  checked harness to the next related question — and not to an unrelated one, and
  not after a failed retrospective. *Constraint:* a repeated chat over changing
  documents is not this, and `applyOutcome` alone is not a retrospective check.
  *Closes on:* a controlled ablation with costs, published including a loss.
- [ ] **A trading domain (TradingAgents), if it earns its fixture.** *Wanted:*
  analyst team → debate → trader → risk → fund manager as a flow document over
  point-in-time market data, a portfolio, a broker simulator and a replay
  boundary, with every report, turn and decision citing artifacts visible to its
  role at its time. *Constraint:* nothing of it exists — the five prompt files
  under `prompts/trading/` and the attic topology are design salvage with no
  loader, tests, budgets or cutoff enforcement, and the attic workflow assigns
  the risk prompt to its news analyst. A crash, an invalid model output, a
  missing provider or an exhausted budget must be unable to create or duplicate
  a fill. Real-money execution, claims of profitability and autonomous strategy
  evolution stay out. *Closes on:* a frozen-input fixture benchmark whose report
  publishes costs, failures, losing assets and eligibility beside returns, and
  states the parity tier honestly.

## Multi-agent patterns

- [ ] **GMPL patterns as flow documents.** *Wanted:* debate, peer review, red
  team, delphi as `@jarenjs/flow` DAG/FSM DOCUMENTS plus role schemas, executed by
  the suite's agent under budget accounts; the pattern / role / domain contracts
  as JSON Schema. *Stands on:* `parseToml` from `@jarenjs/josl` reads the packs —
  it passes the official toml-test 1.0.0 suite in strict mode; writing a TOML
  reader here would be the single most avoidable rewrite in the repo. The packs
  themselves stay Tangle's (BOUNDARY: what must never migrate down). *Salvage:*
  `attic/memflow-gmpl/` (types, the 11 roles, 6 pattern definitions),
  `attic/memflow-modules/gmpl.md` (every default and the prompt-pack → module
  map), `attic/memflow-workflows/sub/patterns/` (six topology JSONs whose stage
  ids map 1:1 onto `prompts/`), `attic/memflow-GMPL_TUTORIAL.md` (the pack format:
  `[meta]/[system]/[user]`, `{{var}}`, `{{#if}}`), HERA's reward weights and
  merge-don't-overwrite rule in `attic/memflow-modules/hera.md`. *Closes on:*
  pattern-vs-single-agent answer quality on the LoCoMo sample, cost beside it.
- [ ] **Experience-guided orchestration and prompt evolution (HERA).** *Wanted:*
  an eight-role pool executing a validated query-specific serial/parallel
  topology under frozen, pinned models, prompts, tools, corpus and budgets;
  same-query candidate groups persisting per-agent trajectories, real task scores
  and named failures; profile / insight / utility experience whose utility comes
  from explicit applied-experience outcomes, not model opinion, with a bounded,
  versioned, source-backed ADD/MERGE/PRUNE/KEEP; failure credit pointing at
  invocation evidence; whole-run prompt-variant evaluation that keeps operational
  rules apart from behavioral principles and activates only a paired improvement;
  validated topology mutations accepted only after evaluation; learning,
  evaluation and inference isolated by immutable snapshots with a held-out split
  that performs zero learning writes. *Constraint:* a folder of role prompts is
  not a multi-agent runtime and a dynamic DAG is not experience-guided policy
  improvement; three of the loop's parts are self-evolving writes and are
  hard-gated on an instrument and a published fixed-topology baseline that must
  exist first. *Closes on:* the controlled ablation, topology metrics and costs
  published, including a loss if the mechanism does not beat its scaffold.
- [ ] **A graph-centric multi-agent framework (MASFactory).** *Wanted:* a
  canonical workflow IR with typed agent / task / graph / loop / switch /
  interaction nodes, message / control / state semantics, templates and composed
  graphs; every authoring path — hand-written, intent-compiled through staged,
  human-reviewed "vibe graphing", or edited in the desktop — emitting the same IR
  and lowering through the same validated DAG/FSM runtime; paid and effectful work
  budgeted, checkpointed, idempotent and resumable; the desktop previewing and
  editing IR and tracing nodes, messages, state and spend. *Stands on:*
  `@jarenjs/flow` (concurrent acyclic dataflow, cyclic FSM control, opt-in node
  checkpointing and durable sessions — stronger than the paper's own system,
  which names checkpoint/resume as a limitation) and `@jarenjs/ai` (bounded tool
  agents, structured output, budgets, guarded repair). *Constraint:* the only
  Tangle flow today is the fixed memory-policy DAG and the Loom is a read-only
  view of it; the GMPL patterns and a HERA executor must reuse this framework
  rather than grow parallel topology engines. *Closes on:* conformance and
  authoring reports with failures, costs, human edits and capability differences
  published beside successes.

## Grounding and retrieval

- [ ] **Search grounding, measured.** *Wanted:* to know whether grounding makes
  answers better. *Stands on:* the document lane is delivered — fetch → extract →
  chunk → embed → versioned corpus → cited recall in `@tangleai/documents`,
  SearxNG result selection wired to bounded multi-document ingestion
  (`compose/searxng/` carries the docker settings), and the desktop chatting over
  document chunks and curated memories as two explicit lanes. Nobody has measured
  it. *Constraint:* memflow's web search was Tavily and its search agent a stub
  that never ran, so the fusion path was never measured anywhere; SearxNG
  grounding is net-new. *Salvage:* `attic/memflow-modules/{retrieval,priha}.md`
  carry the fusion starting points (vector / graph / keyword 0.5 / 0.3 / 0.2,
  localWeight 0.6, authorityBoost 1.3) and the citation model;
  `attic/memflow-modules/chunking.md` is the S2 spec the paper does not give.
  *Closes on:* answer groundedness (citations resolve) on the LoCoMo sample, or a
  fixed question set derived the same way.
- [ ] **Dual retrieval for grounded assistants (PriHA / DRAG).** *Wanted:* a
  turn classified and either paused for bounded clarification or turned into a
  version-pinned, intent-oriented atomic query plan; every atomic query through
  semantic AND keyword local retrieval plus a safelisted, bounded web lane
  (crawled, content-hashed, time-stamped, policy-admitted, replayable — snippets
  and inaccessible links are not evidence); child hits expanded to true parent
  chunks and reranked with full provenance; reconciliation that records authority
  and freshness conflicts and resolves, qualifies or refuses per profile; every
  material claim linked to the evidence actually used, every visible citation
  resolving, unused candidates trace-only. *Constraint:* two context lanes in one
  prompt are not dual retrieval, a SearxNG screen is not a web-search agent, and an
  HTTP `Last-Modified` is not authority. The five files under `prompts/priha/` are
  seeds no source imports. Healthcare deployment is a separate gate this entry
  never claims. *Closes on:* a deterministic benchmark with ablations, costs,
  safety violations and losses under pinned identities.
- [ ] **The graph question, and LightRAG's answer to it.** *Wanted:* to decide
  graph indexing of `relations` only when a real query needs a traversal —
  document-shaped relations have no ceiling until then, and Memgraph / a neo4j
  driver are allowed on Tangle's side of the boundary only if they buy a measured
  capability. The strongest candidate for that capability is LightRAG's
  mechanism: entities and relationships extracted and profiled from chunks into
  a canonical graph with document-version and chunk provenance; entity names and
  relation themes embedded and indexed separately; a query split into low-level
  (entity) and high-level (theme) keywords under a pinned prompt identity;
  low, high and hybrid retrieval with deterministic one-hop expansion; a context
  bundle with explicit entity, relationship and original-chunk sections inside a
  recorded budget; incremental update that touches only affected contributions
  and promotes atomically. *Constraint:* `MemoryUnit.relations` is an optional
  document-shaped field nothing extracts, indexes or traverses, and the desktop's
  two lanes are not LightRAG's two levels. *Salvage:* what the predecessor's
  graph layer looked like and cost — `attic/memflow-ARCHITECTURE.md` (the
  ~25-label data model) and `attic/memflow-modules/graph.md`; the two ideas worth
  keeping are query-before-dedup incremental indexing and LLM-summarized
  community nodes as a high-level corpus. *Closes on:* flat, low-only, high-only,
  no-original and full-hybrid rows under one instrument, including losses — a
  recall-quality or latency number the document store cannot reach.

## Configuration and persistence

- [ ] **Desktop profile selection.** *Wanted:* the desktop selecting a NAMED
  registry profile (`config/profiles.json` — shipped, resolved and inspected
  read-only via [CONFIGURATION.md](CONFIGURATION.md)) instead of always running
  the generated legacy projection of its settings: a settings control that
  requests a profile, surfaces the resolver's refusals as fixable issues, and
  never lets a named profile fall back to legacy or offline behavior. *Stands
  on:* `@tangleai/config`'s resolver and the desktop host adapter, both
  shipped; the read-only inspection operation showing what a selection would
  resolve to. *Closes on:* a desktop run row whose identity carries
  `requested.kind: "profile"`, produced from a control a user clicked, with a
  refused selection rendering its `TCFG` issues.
- [ ] **The vector column.** *Wanted:* `recallByEmbedding` and
  `recallDocumentChunks` over `@jarenjs/db`'s `derive: 'vector'` column and its
  k-nearest plan instead of `list()` plus a cosine sweep. *Constraint:* `dims` is
  the column's identity and the embedder is a runtime SETTING — declaring the
  column makes the model a function of the settled embedder and changing the
  embedder a migration; and at LoCoMo's sizes the sweep does not cost (a 689-turn
  conversation ingests and answers 150 questions in about two seconds). The
  document lane has a second sweep with a worse constant — every chunk of every
  active version, and activation scanning all elements and chunks to clean the
  superseded one — and a document corpus grows faster than curated memory, so it
  reaches the column first. *Closes on:* the instrument showing the sweep costs at
  Tangle's sizes; then pin `dims` in settings and declare the column.

## Surfaces

- [ ] **The desktop's open ends.** *Wanted:* chat streaming to the UI (`chat.send`
  is non-streaming), outcome feedback from the chat surface (thumbs →
  `applyOutcome`), a folder watcher (sync is manual), and the benchmark reaching
  the surface as a `@jarenjs/contract` operation with live progress as a
  `subscribe` operation streamed as a `@jarenjs/db` live query — a snapshot then
  `{ patch, seq }` emissions, SSE over http, resumable by seq — so no polling loop
  and no bespoke event channel is written; `contract.revision()` and
  `diffContracts --fail-on breaking` as the CI gate on the report's shape.
  *Constraint — the content rule:* every surface shows only what a run actually
  did; no benchmark claim reaches a surface before the matrix above has put a
  number behind it. *Closes on:* n/a — surface work, held to the content rule.

## The loop that runs the workflows

- [ ] **The evolution loop: workflows as evolvable DAGs.** *Wanted:* point the
  desktop workspace at a REPOSITORY and run experiments as dag runs — propose from
  strategy memory → git-worktree isolate → apply → gate by exit code → measure →
  commit-on-branch or abandon (the default) → record the outcome so `applyOutcome`
  moves the proposing strategy's confidence. Design, rails and the exists/missing
  table: [`workflow/EVOLVE.md`](workflow/EVOLVE.md). *Constraint:* this is the
  capability the standing rule was written for. The instrument exists now; the
  skill loop and outcome-grounded decisions are its prerequisites; the mutator may
  never touch tests, gates or CI; `master` is never a write target. *Closes on:*
  over N experiments on a fixed repo state, the strategy ledger's hit rate rises
  while gate-red and goalpost-refusal counts are fully accounted, and zero writes
  ever reach `master`.
- [ ] **Verifiable autonomous research.** *Wanted:* a topic taken through
  literature discovery, hypothesis formation, executable experiments, analysis,
  review and a draft — with every important claim traceable to literature or
  immutable experiment output: a typed, immutable research question and
  preregistered success contract before any result exists; replayable literature
  discovery with normalized source identity, screening records and evidence cards;
  falsifiable, evidence-linked hypotheses with nulls, confounds and baselines;
  generated code executing outside the desktop process under a pinned,
  resource-bounded, secret-free policy that cannot modify the evaluation harness
  or the metric registry; Proceed / Refine / Pivot / Stop decisions schema-valid,
  budgeted and resumable; every manuscript number resolving to a registered
  measurement and every citation to a support passage; human approvals durable,
  scoped, attributable and never inferred from a timeout; cross-run lessons
  source-backed, reversible and off by default until measured. *Constraint:* a
  SearxNG search followed by cited RAG is not autonomous research and a DAG event
  history is not resumability; the experiment executor must be the evolution
  loop's domain-general consumer or successor, not a parallel unsafe shell
  wrapper, and research lessons must use the skill loop's guarded records, not a
  second skill system. *Closes on:* fixed-pipeline, debate, self-healing,
  human-in-the-loop and lesson ablations publishing gains and losses under
  identical inputs and budgets.
