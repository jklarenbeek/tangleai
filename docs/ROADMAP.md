# 📅 Tangle Roadmap

The current substrate is [JarenJS 0.91.4](JARENJS_INTEGRATION.md): atomic
ledger storage, retention options, verified DAG checkpoints, bounded history
reads, scheduled document transport and supervised Node SQLite execution are
available. Native relational migrations and revision-aware collection drag are
upstream mechanisms for future consumers, with host policy still required. Paired
bootstrap and permutation tests, rank fusion, a named-process executor,
asynchronous guarded validation, a line-anchored text-edit compiler, safe-read
provider capture/replay and the wider finance indicator and risk family are
published for the entries below to consume rather than rebuild. The open policies below
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

- [ ] **Count missing ranked memories.** *Wanted:* a ledger recall whose
  `skipped` count includes a record deleted between the rank adapter's selection
  and the ledger read. *Constraint:* `recall({ near })` currently drops that
  missing record without counting it. The isolated deletion probe reproduces
  this accounting gap; it is outside research lesson activation. *Closes on:* a
  counted `missing` value and a reproduction test that uses the same ranked
  corpus and deletes the selected record before the ledger reads it.

- [ ] **Embedding width against a variable-dimension semantic embedder.**
  *Wanted:* test whether the offline width decision transfers to semantic
  retrieval and answers. *Constraint:* the [registered policy result](LOCOMO_POLICY.md)
  selected 512 dimensions using lexical hash evidence recall; its live tier held
  `baai/bge-m3` fixed at 1024 dimensions and did not vary width. The local width
  knob does not parameterize that model. *Closes on:* an explicitly registered
  width comparison using a provider that supports variable dimensions, with
  held-out answer F1, evidence recall, latency and token/call cost beside each
  width. Existing policy and lexical-width identities remain the baselines.
- [ ] **Consolidation live qualification and host adoption.** The opt-in
  deterministic, supported semantic and combined tiers now preserve immutable
  evidence, stage callbacks durably and expose host-driven count/time/manual
  operations. See the [API guide](../packages/memory/docs/CONSOLIDATION.md) and
  [registered ablations](CONSOLIDATE_BENCHMARK.md). Native Jaren lexical routing
  and scripted combined routing improve exact-source recall on the fixed LoCoMo
  corpus; artifact-only routes also have measured losses. Those diagnostics do
  not establish live answer quality or the token/call cost of synthesis.
  *Closes on:* a separately authorized, registered paired reader/judge comparison
  on fixed development/confirmation partitions: answer-quality 95% bootstrap
  lower bound above zero, no category delta below -0.05, token ratio at most 1.1
  and physical-request ratio at most 1.0, followed by an explicit host/default
  decision. Until eligible evidence exists, live quality/cost is unmeasured and
  the default stays off. Hosts own actual provider budgets, cadence and lifecycle;
  no desktop timer or automatic pipeline integration is shipped. Historical
  predecessor policies are not a blanket commitment to port all 22 modules.
- [ ] **Atomic contradiction resolution.** The current resolver supersedes a
  loser before storing a synthesized resolution. A persistence failure can leave
  that operation partially applied. Qualify a shared atomic mutation contract
  with rollback, concurrent winner and replay tests before exposing transactional
  guarantees; consolidation uses its own immutable batch activation.
- [ ] **Experiential learning, live.** *Wanted:* an authorized training and
  evaluation run over a registered domain, a configuration adapter component
  that includes the learned artifact reference in the run identity, and a local
  process training backend composed over the shipped guarded experiment runner.
  *Constraint:* the HTTP seam and keyless lifecycle do not establish parameter
  learning; inference-only providers remain labelled as such. The current
  [CGT claim](CGT_BENCHMARK.md) is `not-run`, scripted ties do not pass a strict
  improvement gate, and missing retention evidence cannot be treated as a win.
  New live domains and controls must be registered before observations arrive.
  *Closes on:* the authorized artifact's held-out interval beating both frozen
  retrieval and rule-text controls, all registered retention/security/resource
  gates and a live rollback drill, with losses, exclusions and cost published
  even when the claim fails; the adapter component and local backend each pass
  the same identity, receipt, resume and bounded-execution contracts.

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
- [ ] **Live place extraction and placement proposals.** The sourced
  [place API](../packages/memory/docs/PLACE.md) computes cited joins, movement
  and bounded nearby answers; its [fixture measurement](PLACE_BENCHMARK.md)
  grounds 174/197 audited mentions and passes all 124 questions on memory and
  Node/Bun SQLite. The registered sparse candidate sweep meets its target on
  both runtimes, so an additional spatial index is not indicated by that row.
  What remains is extraction of locative mentions and supported placement
  proposals through the existing structured seam, with `@tangleai/jaren/spatial`
  gates and the `@tangleai/jaren/geo-tools` toolbox for authored queries.
  Live quality and cost are unmeasured. A model cannot invent coordinates,
  validity, sources or distance; ambiguity and ungrounded proposals stay counted.
  Close on independently scored held-out extraction and placement, with coverage,
  refusals, losses and full retrieval cost beside the quality result and unchanged
  canonical LoCoMo controls. No fixture result is a LoCoMo spatial score.

- [ ] **MAS head revision fencing.** `packages/store/src/mas-store.ts`
  `activateHead` stores a revision but currently compares only the expected active
  version. Inspect and reproduce A→B→A with an old activation token, then bind
  workflow/template activation to both version and revision with compatibility
  tests. This is a source-level concern, not a reported production incident.
  Outcome heads already use both fields; this task concerns the separate MAS API.

## Learning from outcomes and traces

- [ ] **The skill loop, live.** *Wanted:* the evolved skill directory measured
  where it would be used. `@tangleai/trace2skill` ships the mechanism — frozen-skill
  labeled rollouts, independent asymmetric analysts, evaluator-proven error
  diagnosis, prevalence-aware hierarchical merge, one guarded application,
  held-out comparison and a revision-fenced head — and every number it publishes
  comes from a Tangle-authored scripted fixture, so what is proven is that the
  instrument separates the conditions the corpus registers, not that a model
  learns anything. *Stands on:* `SkillBundle`, the anchored directory-patch
  compiler, `composeSkillSystem`/`skillReadTool` (no retrieval index at test
  time), the five versioned prompt packs, `createGuardedRefiner`, the outcomes
  head planner, and the frozen credential-free live plan the instrument already
  prints — the door exists and nothing is behind it. *Constraint — three
  different unmeasured things:* live quality needs a real domain adapter and an
  authorized spend, and neither is a default; cross-model and out-of-distribution
  transfer are evidence tiers, not permissions, and the instrument publishes both
  rows as `not-run` because it builds no second executor identity and registers a
  single domain; and the support threshold that decides when recurrence is
  evidence is a configured number the corpus never varied, so nothing here says
  what it should be. A claim of transfer while those rows are `not-run` is
  marketing. *Closes on:* the same deepening and creation tables over a real
  adapter with an authorized live tier, losses beside wins; a `cross-model` row
  that ran under a second executor identity and an `ood` row that ran under a
  second adapter; and a learned support threshold beating the configured one on
  held-out results, with the regression count beside it.
- [ ] **Real-domain outcome quality and policy.** The generic evidenced lifecycle,
  checked artifact promotion/rollback and adapter kit now ship in
  `@tangleai/outcomes` ([capability](../packages/outcomes/README.md),
  [scripted evidence](OUTCOME_BENCHMARK.md)). Measure domain-owned candidates on
  replayable independent real outcomes, with frozen held-out gates, paired
  quality, coverage, harms and costs. Scripted numeric/label fixtures establish
  mechanism behavior only. Source-correction semantics, learned gate/retention
  policy, automatic promotion and consumer review UI remain unimplemented and
  need separate registered comparisons and host authority decisions.
- [ ] **Live forecasting quality and benchmark parity (Milkyway).** *Wanted:*
  a prospective controlled comparison on a real forecasting domain with actual
  provider spend and independently scored outcomes. The shipped scripted
  mechanism has not demonstrated its registered claim against the scaffold.
  *Constraint:* future candidate predictions need fresh, metered held-out replay;
  immutable executed decision bags cannot be backfilled. Official FutureX and
  FutureWorld slices require their own protocols, licensing and scorers, not
  the repository's fictional choice/numeric oracle. Conflicting resolution
  evidence currently marks a question `disputed`; original scores stay intact
  and no correction rescoring or dependent-head revocation policy is defined.
  *Closes on:* a registered live comparison publishing paired uncertainty,
  costs, failures and losses; official scorer parity on the named slices; and
  an evidenced, idempotent correction/revocation protocol with recovery tests.
- [ ] **Trading quality and operations on licensed evidence (TradingAgents).**
  *Wanted:* live model evaluation on a named, licensed historical replay corpus,
  followed by an operator surface and guarded shadow execution. *Constraint:*
  the shipped synthetic workflow and ablations establish execution behavior only.
  The paper profile records no decided corpus; its live plan has zero eligible
  requests. Selecting a corpus must pin publication-time snapshots, redistribution
  terms and the exact runtime manifest before implementing a paid replay plan.
  *Closes on:* matched historical baselines and ablations, explicitly authorized
  cache-aware model execution with per-role usage, costs, failures and losses,
  independently reproduced quality results, and restart-safe shadow operations.
  ADX, CCI, VWAP, volume ratio and KDJ already use the shipped Jaren kernels.

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
  gains. Trading/research domain applications remain separate.
- [ ] **Live orchestration quality and HERA extensions.** The eight-role
  executor, scoped experience and prompt learning, registered-role topology
  mutation, and fourteen-operation read contract ship with a scripted
  [ablation](HERA_BENCHMARK.md). Full held-out F1 is 0.6 versus the fixed
  scaffold's 0.8, with paired diagnostic interval [-0.6, 0.0]; this does not
  measure model quality. *Open:* a separately approved live comparison with
  matched identities and explicit budgets; a paper-parity dataset lane;
  mounting the package's review contract in the desktop's existing
  run-addressed surface; and model-invented roles under a new admission policy.
  *Closes on:* measured live held-out improvement with the paired interval
  excluding zero, complete cost/violation accounting and losses reported,
  followed by separate evidence for each additional capability.
- [ ] **Staged workflow authoring and its operator surface (the open half of
  MASFactory).** *Wanted:* natural-language workflow authoring as three
  durable, human-reviewed stages — a `RolePlan`, a `TopologyPlan` and a
  `SemanticPlan` — generated through `createStructuredOutput` with
  `composeChecks` compile gates, revised by text feedback or RFC 6902 direct
  edits over immutable design revisions, and emitting only the shipped
  canonical `MasWorkflowVersion`; plus the desktop surface the runtime
  deliberately did not touch — schema-aware IR forms, trace subscriptions
  addressed by run id over the store's committed records (the desktop's
  persisted frame stream is the shipped shape to consume, not to rebuild),
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
- [ ] **Live qualification of governed dual retrieval (PriHA / DRAG).** The
  [scripted mechanism and ablations](PRIHA_BENCHMARK.md) ship, but the full
  treatment does not pass its paired improvement gate. Measure live quality and
  cost under a new exact-plan spend approval, preserving the immutable flat
  handoff and all failed/abstained cases. The fictional fixture and the separate
  historical paid question set must not be represented as matched pairs.
  Healthcare use additionally requires a governed PHR corpus, consent and
  privacy controls, and domain-expert review; no clinical readiness is inferred
  from mechanism parity. Reconsider `createDbSearch` only if a registered local
  latency row fails. The existing desktop run-addressed streams still need a
  grounding-specific event projection if session updates are to stream instead
  of being explicitly refreshed. *Closes on:* dated paired live evidence,
  reviewed domain/privacy gates, measured search scale and a resumable session
  event projection with exact accounting.
- [ ] **Graph retrieval qualification.** The claims, canonical projections,
  incremental admission, dual-level retrieval and grounded answer engine ship;
  the [measurement](LIGHTRAG_BENCHMARK.md) publishes their keyless ablations,
  losses and operational SQLite ladder. Open work is the paid paired
  supported-claim F1 gate against the regenerated immutable flat control, within
  the registered cost/p95 limits, and separately licensed UltraDomain parity.
  A Memgraph or Neo4j investigation is conditional on the ladder recording
  `scale-row-registered`; architecture resemblance cannot open it or change a
  default. Conservative model-dependent call bounds must fit an explicitly
  approved live plan before provider work can start.
  The [registered native-vector comparison](VECTOR_SCALE.md) passes complete
  retrieval parity at 100, 1,000 and 10,000 chunks, but its 10,000-chunk native
  hybrid p95 is 3112.47 ms against the unchanged 250 ms target. Production
  retrieval therefore remains on the sweep. Column backfill, storage, reads and
  complete 128-dimensional staging costs are published with that failed latency
  gate; future graph performance work must preserve the same complete results.
  Large retained-source admission also remains memory intensive: the registered
  10,000-chunk command grants Node 8 GiB of old-space heap after default-heap
  exhaustion. Reducing retained-payload memory cost must preserve complete
  canonical validation, retained reactivation and atomic rollback, with peak RSS
  measured on the same corpus.

## Configuration and persistence

- [ ] **Memory, document and ledger vector adoption.** *Wanted:* `recallByEmbedding` and
  `recallDocumentChunks` over `@jarenjs/db`'s `derive: 'vector'` column and its
  k-nearest plan instead of `list()` plus a cosine sweep. *Constraint:* `dims` is
  the column's identity and the embedder is a runtime SETTING — declaring the
  column makes the model a function of the settled embedder and changing the
  embedder a migration; and at LoCoMo's sizes the sweep does not cost (a 689-turn
  conversation ingests and answers 150 questions in about two seconds). The
  document lane has a second sweep with a worse constant — every chunk of every
  active version, and activation scanning all elements and chunks to clean the
  superseded one — and a document corpus grows faster than curated memory, so it
  may reach its own native-column trigger. The graph-specific capability and
  [scale instrument](VECTOR_SCALE.md) do not qualify these other corpora.
  *Closes on:* a registered measurement showing their sweep costs at Tangle's
  sizes, complete retrieval parity, settled identity migrations, and a measured
  complete-call improvement with build, storage and write costs included.

## Surfaces

- [ ] **Flat chat accounting and citation targets.** Degradation events are
  recorded, but generation retains only the final provider usage rather than
  complete repair and failed-call spend, and cited neighbour chunks are remapped
  to ranked candidates. The graph answer engine's complete attempt accounting
  and exact named chunk targets are the reference for a separately measured
  correction; the immutable flat control must remain reproducible.

- [ ] **The desktop's open ends.** Streamed chat, run-addressed resumable
  subscriptions, the watched folder, evidenced outcome feedback, the instrument
  as an operation whose report is kept by identity, the breaking-change gate on
  the surface's shape and named profile selection all shipped; what they do is
  described in [ARCHITECTURE.md](ARCHITECTURE.md) §"The operator control plane"
  and [CONFIGURATION.md](CONFIGURATION.md). *Wanted:* the two ends still open.
  (1) **macOS and Windows verification of the compiled desktop.** The WebView
  lifecycle and the compiled document path are Linux x64 facts; the other
  platforms are unverified, not known broken, and the documentation names them
  as unverified rather than ticking them. (2) **A report tier that may spend.**
  The runner registers keyless instruments only, and a run supplying a budget is
  refused before any child starts — the seam is declared with no spend path
  behind it. A tier that may call a paid provider needs its own authorization,
  its own ceiling and its own evidence before it exists.
  *Constraint — the content rule:* every surface shows only what a run actually
  did; no benchmark claim reaches a surface before the matrix above has put a
  number behind it. *Closes on:* n/a — surface work, held to the content rule.

## The loop that runs the workflows

- [ ] **Repository evolution beyond the registered fixture.** *Wanted:* evaluate
  live model-authored proposals under an explicitly authorized model, attempt and
  token plan; run experiments against the Tangle checkout; qualify Jaren as a
  second target; and promote ranked selection only when independent measurement
  earns it. The isolated, gated and measured lifecycle, immutable surface,
  durable MAS execution and four-policy ablation have shipped
  ([workflow/EVOLVE.md](workflow/EVOLVE.md),
  [EVOLVE_SELECTION.md](EVOLVE_SELECTION.md)). The current result is inconclusive
  and selection remains unranked. *Constraint:* proposals never edit the tests,
  gate or registration; protected refs remain untouched; live spend and outcome
  promotion each require their own explicit authority. *Closes on:* reproducible
  target-specific measurements with all failures and costs counted, a stated
  selection improvement over both controls under the registered refusal checks,
  and independently approved promotion. Fixture success alone closes none of
  these target or live-model claims.
- [ ] **Experiment cleanup recovery after the terminal transition.** *Wanted:*
  a durable cleanup receipt that distinguishes a recorded decision from completed
  workspace removal. `settleExperiment` currently wins its compare-and-swap
  before removing the worktree; a crash in that interval leaves a terminal
  experiment and a workspace for operator inspection. A returned cleanup failure
  is explicit, but a later reconciler skips the terminal experiment. *Constraint:*
  recovery must not delete a recreated workspace or reapply a completed effect.
  *Closes on:* crash tests at both sides of removal converge through a fenced
  cleanup receipt, while stale settlement and recreated-workspace tests still
  refuse. Until then, terminal status alone is not evidence of cleanup.
- [ ] **Research learning under live, comparable evidence.** *Wanted:* a
  reproducible held-out lesson gain and measured human-review efficacy across
  the shipped domains. *Constraint:* the [scripted matrix](RESEARCH_BENCHMARK.md)
  retains tied lesson intervals, native approval refusals and incomparable
  debate, repair, full-auto and cross-domain pairs. Writeback stays
  `experimental-off`, decay stays `none`, and full-auto remains experimental.
  *Closes on:* a newly authorized live paired run with identical inputs,
  identities, prompts and budgets, disjoint validation, complete costs and
  published losses that passes every registered gate. A positive gate alone
  does not authorize a default change. ARC-Bench remains unadopted until a
  licensed, checksummed slice and its independent evaluator are admitted;
  adapter availability establishes no external parity.
