# 📅 Tangle Roadmap

The current substrate is [JarenJS 0.87.0](JARENJS_INTEGRATION.md): atomic
ledger storage, retention options, verified DAG checkpoints, bounded history
reads, scheduled document transport and supervised Node SQLite execution are
available. Native relational migrations and revision-aware collection drag are
upstream mechanisms for future consumers, with host policy still required. The open policies below
still require their own corpus and quality measurements.

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
[`LOCOMO_REFRESH.md`](LOCOMO_REFRESH.md) the refreshed paid F1 beside it, for Tangle and for
every rival over one corpus, one scorer and one sample — and Tangle loses to every
rival that answered the whole sample, which is the number most of this file exists
to move. Before authoring anything below, read [`BOUNDARY.md`](BOUNDARY.md)
§"What the suite already has": the expensive mistake here is not putting a
capability on the wrong side of the boundary, it is building one the boundary
already has.

The [bounded-agent instrument](BOUNDED_AGENT_BENCHMARK.md) now separates full
input coverage, program execution and nonempty cited answers. Remaining work is
answer quality and corpus-scale retrieval under budgets that cannot scan the
whole input; it must be measured against this recorded policy and its same-question
direct-answer comparisons rather than against the earlier empty-answer count.

## Memory policies

- [ ] **Embedding width against a variable-dimension semantic embedder.**
  *Wanted:* test whether the offline width decision transfers to semantic
  retrieval and answers. *Constraint:* the [registered policy result](LOCOMO_POLICY.md)
  selected 512 dimensions using lexical hash evidence recall; its live tier held
  `baai/bge-m3` fixed at 1024 dimensions and did not vary width. The local width
  knob does not parameterize that model. *Closes on:* an explicitly registered
  width comparison using a provider that supports variable dimensions, with
  held-out answer F1, evidence recall, latency and token/call cost beside each
  width. Existing policy and lexical-width identities remain the baselines.
- [ ] **Consolidation tiers** (LightMem / SimpleMem / StructMem). *Wanted:*
  sleep-time consolidation as a Tangle-scheduled pass — STM buffer, topic
  segmentation, cross-event synthesis behind a purpose-specific injected judge — where memflow's 22 memory modules either earn their port or
  stay unported. *Constraint:* the suite's own history compaction plus ledger
  archiving IS a consolidation tier (a dropped round is content-addressed into a
  slot and reachable through `recall`, never destroyed), and jarenjs measured its
  ceiling honestly: ledger recall recovers archived values, while compressed
  late-fact contexts lose pairwise determinacy. Uncompressed contexts, the
  front-fact ledger at 20,000 characters and compiled full-corpus programs retain
  that relation. A summary alone does not establish that every value survived.
  A tier that only compresses buys a curve already plotted; what must be justified
  is the part compaction provably cannot do. Failures must be counted values — the
  predecessor's tiers silently dropped memories on persistence and embedding
  failure. `excerpt`/`truncate`/`sizeOf` from `@jarenjs/core/chunk` are the text
  primitives; the buffer never needs its own. *Salvage:*
  `docs/attic/memflow-modules/{lightmem,simplemem,structmem}.md` — every default
  (sensory 512, STM 2048, StructMem's 10-entries-or-60 s trigger, LightMem's
  buffer > 50 % → gate-else-passthrough routing, the newer-timestamp update queue)
  and the pure-logic candidates (TopicSegmenter B1∩B2, SemanticSynthesis's
  union-find, PreCompression's order-preserving heuristic, StructuredIndex TF
  keywords). *Closes on:* LoCoMo delta against the measured-policy baseline; token
  cost of the sleep pass.
- [ ] **Atomic contradiction resolution.** The current resolver supersedes a
  loser before storing a synthesized resolution. A persistence failure can leave
  that operation partially applied. Qualify a shared atomic mutation contract
  with rollback, concurrent winner and replay tests before exposing transactional
  guarantees; consolidation uses its own immutable batch activation.
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

- [ ] **Temporal quality and scale qualification.** The explicit temporal API is
  implemented: occurrence-preserving sources, exact cited claims, independent
  observation/knowledge/validity axes, immutable memory/SQLite projections,
  scoped numeric candidate indexes, bounded structured proposals, semantic-pool
  retrieval, refusal/fallback accounting and deterministic cited calendar answers.
  [The API guide](../packages/memory/docs/TEMPORAL.md) defines its supported
  semantics. Jaren owns dates, intervals, locales, validation and persistence;
  structured models belong to `@tangleai/models`. Legacy `MemoryUnit.at` and
  `supersededAt` are not event validity. Numeric mirrors use distinct names.

  [Strict conformance](TEMPORAL_BENCHMARK.md) runs 46 independent cases on memory,
  Node SQLite and Bun SQLite. [LongMemEval](LONGMEMEVAL_BENCHMARK.md) supplies
  question and session timestamps; both provided-history and strict-as-of views
  retain all 500 questions, including 44 with future gold sessions. Full source
  roundtrips pass on all three backends; they use empty claims and are not QA
  measurements. LoCoMo supplies session dates but no question anchors, and its
  temporal category is not always the lowest local score. Its canonical reports
  retain their original scorer, denominators and bytes.

  *Still open:* held-out live QA gains and comparable deployment costs. The
  [registered matrix](TEMPORAL_EVALUATION.md) keeps model-dependent rows explicitly
  unmeasured, reports the strict-cutoff evidence ceiling loss, and leaves the
  shipped lane opt-in/off. A default change requires a positive paired 95% lower
  bound on LongMemEval provided-history temporal accuracy, lower bounds at least
  -0.05 for each other LME type and LoCoMo category 1–4, zero strict violations,
  and the registered cold/amortized/warm-p95 plus absolute cost gates. Missing
  evidence cannot pass. Scripted or oracle gains do not establish production gain.

  General retrieval still validates a snapshot and ranks its semantic candidates
  in memory. The 10,000-claim native-seek receipt does not qualify million-token
  deployment scale. Further work includes bounded projection loading, host-owned
  named-zone data, ambiguous seasons/date conventions and richer uncertain event
  periods; unsupported inputs currently refuse. BEAM, RealMem and HaluMem remain
  researched future options, not implemented adapters. No resampling, timeline
  UI or spatial inference is implied by the temporal API.
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

- [ ] **MAS head revision fencing.** `packages/store/src/mas-store.ts`
  `activateHead` stores a revision but currently compares only the expected active
  version. Inspect and reproduce A→B→A with an old activation token, then bind
  workflow/template activation to both version and revision with compatibility
  tests. This is a source-level concern, not a reported production incident.
  Outcome heads already use both fields; this task concerns the separate MAS API.

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
  *Salvage:* `docs/attic/memflow-modules/evolution.md` — the artifact shape
  (`applicableWhen` / `doPatterns` / `dontPatterns`, `sourceTraceCount`, version)
  and knobs (k 5, maxSkillsPerCluster 3, inject topK 5 / minSimilarity 0.4).
  *Closes on:* repeat-task success with skills on vs off on a held-out set; skill
  count stays bounded; the loss published if the mechanism does not beat the
  retrieval baseline.
- [ ] **Real-domain outcome quality and policy.** The generic evidenced lifecycle,
  checked artifact promotion/rollback and adapter kit now ship in
  `@tangleai/outcomes` ([capability](../packages/outcomes/README.md),
  [scripted evidence](OUTCOME_BENCHMARK.md)). Measure domain-owned candidates on
  replayable independent real outcomes, with frozen held-out gates, paired
  quality, coverage, harms and costs. Scripted numeric/label fixtures establish
  mechanism behavior only. Source-correction semantics, learned gate/retention
  policy, automatic promotion and consumer review UI remain unimplemented and
  need separate registered comparisons and host authority decisions.
- [ ] **Harness evolution for forecasting (Milkyway).** *Wanted:* the domain loop
  that consumes the shipped outcome lifecycle — an unresolved forecasting question run at
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

- [ ] **Live quality of reusable multi-agent patterns.** Six GMPL families,
  schemas, immutable prompt artifacts and domain binding mechanisms execute
  through MAS. The remaining question is whether those patterns improve real
  answers over matched single-agent controls. *Constraint:* scripted protocol
  success and replay byte identity do not establish model-quality improvement;
  each pair must retain equal evidence, model/configuration, output/scorer,
  resources and human information access, with failed/waiting answers counted.
  The keyless [LoCoMo plan](GMPL_LOCOMO.md) freezes 64 seeded category 1–4
  questions and evidence slices and exposes a fail-closed wire replay seam.
  *Closes on:* a separately approved live comparison publishing paired answer
  quality, eligibility, original physical/token/latency costs and losses beside
  gains. HERA learning and trading/research domain applications remain separate.
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
- [ ] **Staged workflow authoring and its operator surface (the open half of
  MASFactory).** *Wanted:* natural-language workflow authoring as three
  durable, human-reviewed stages — a `RolePlan`, a `TopologyPlan` and a
  `SemanticPlan` — generated through `createStructuredOutput` with
  `composeChecks` compile gates, revised by text feedback or RFC 6902 direct
  edits over immutable design revisions, and emitting only the shipped
  canonical `MasWorkflowVersion`; plus the desktop surface the runtime
  deliberately did not touch — schema-aware IR forms, run-addressed trace
  subscriptions (the global `createLiveHub` latest-run slot is not run-safe;
  a surface must subscribe by run id over the store's committed records),
  Mermaid preview from the executable plan, and an interaction inbox for
  typed pause/resume. *Stands on:* the shipped `@tangleai/mas` runtime —
  its IR, validator, registries, lowering, durable store host, interactions
  and the weekly-report conformance fixture
  (`benchmark/results/mas-runtime-handoff.json` is the baseline every
  authoring treatment must consume and beat, not re-derive). *Constraint:*
  a model may propose executable policy only through the closed IR and its
  conformance instrument; capability catalogs stay CONFIG-resolved; nothing
  here re-opens the runtime's own claims. *Closes on:* a representative
  authoring-effectiveness measurement over registered intents — including
  the manual weekly-report baseline as the comparison floor — with
  failures, human-edit counts and costs published beside successes.

## Grounding and retrieval

- [ ] **The web discovery row, run live.** *Wanted:* the one unmeasured member
  of the grounding instrument — the dated SearxNG-discovered versus directly
  curated comparison over the six registered RFC 9110 questions, run against a
  real endpoint. Everything else shipped and is measured: the flat document
  baseline is a validated paired result
  (`docs/GROUNDING_BENCHMARK.md`, handoff
  `benchmark/results/grounding-handoff.json`), and the web instrument itself is
  proven — capture and replay are byte-identical with zero network calls, the
  selection rule is registered, and the current record is a stated not-run.
  *Constraint:* the row needs an operator-confirmed SearxNG endpoint
  (`compose/searxng/`) and its own separate authorization; it is a dated
  diagnostic and can never enter the flat gate's denominator. *Closes on:* one
  authorized `--web-live` run whose report replays byte-identically.
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
  never claims. The flat document-grounding baseline is now an immutable
  measured handoff (`benchmark/results/grounding-handoff.json` names the
  report/registration/source/config identities); a dual-retrieval treatment
  registers its own identity and must beat that exact row — it may not
  re-render a friendlier flat baseline. *Closes on:* a deterministic benchmark
  with ablations, costs, safety violations and losses under pinned identities.
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
  graph layer looked like and cost — `docs/attic/memflow-ARCHITECTURE.md` (the
  ~25-label data model) and `docs/attic/memflow-modules/graph.md`; the two ideas worth
  keeping are query-before-dedup incremental indexing and LLM-summarized
  community nodes as a high-level corpus. The flat row to beat is the immutable
  measured grounding handoff (`benchmark/results/grounding-handoff.json`); a
  graph treatment registers its own identity against that exact row rather
  than re-rendering a friendlier flat baseline. *Closes on:* flat, low-only,
  high-only, no-original and full-hybrid rows under one instrument, including
  losses — a recall-quality or latency number the document store cannot reach.

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
  skill loop and domain-specific outcome adapters are its prerequisites; the mutator may
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
