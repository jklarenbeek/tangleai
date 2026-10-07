# The boundary: Jaren foundations, Tangle mechanisms and host policies

Jaren supplies generic engines, contracts and complete editors. Tangle owns
model interaction, context, agents and the applications built around them.
The migration moved ownership without changing persisted schemas or request,
cache, ranking, budget and provider policies.

## The rule

Keep generic validation, guarded mutation, contract projection, typed document
capture and Studio/Data/Flow editing in Jaren. Jaren has no Tangle dependency.
Models, context and agents are reusable Tangle mechanisms with injected host
services; they never import the higher-level core/config/memory/pipeline/store
or MAS/outcomes policy packages. Jaren-specific AI authors live in `@tangleai/jaren`
and use public Jaren operations. Tangle document pens live in `@tangleai/linq`,
with one `/program` pen today; they produce immutable JSON through Jaren
authoring primitives and import no execution engines. The existing applications and policy packages
continue to own databases, scheduling, configuration and product decisions.

Require a concrete consumer, deterministic tests and a documented dependency
argument for a new seam. Reuse the shipped compiler or component before adding
an implementation. Model proposals validate and publish through the same
revision checks as manual edits; hosts retain execution and lifecycle ownership.

## How the line runs today

| Concern | Mechanism / foundation owner | Tangle side (policy/infra) |
|---|---|---|
| chat completions | `@tangleai/models` `createChatClient` (OpenAI-compatible wire, retry, streaming, effective-request replay key and injected cache seam) | configuration and the SQLite replay adapter |
| embeddings | `@tangleai/models/embed`: the `{ embed, model, dims }` seam, `createEmbeddingClient` (OpenAI-compatible wire, reply reassembly, per-text partial replay), `createHashEmbedder`, `probeEmbeddings`; kernels in `@jarenjs/core/vector` | configuration, the SQLite replay adapter, and the measured WIDTH of the offline default (`createOfflineEmbedder`, 512 lexical dimensions — owned by `@tangleai/memory/policy`, consumed by `packages/pipeline/src/standins.ts`) |
| durable memory | `@tangleai/context` ledger: 4 kinds, evidence-mandatory, 4-method storage seam (+ optional `rank`); a memory carries `embedding` + `embeddedBy` as a pair | `@tangleai/memory` store of full units (the same pair, plus confidence, supersession, provenance) |
| memory hygiene | *(none — ROADMAP names the missing measurement)* | novelty gate, crystallizer, contradiction resolution, outcome learning |
| retrieval ranking | ledger `recall({ near })`: cosine through the embedder seam, refused without it, refused across identities, skips reported; over `@jarenjs/db`, `derive: 'vector'` + the k-nearest plan | `recallByEmbedding` — the same rule over Tangle's own units (supersession-aware), and the pairwise comparisons inside the policies; `rankDocumentChunks` is the sole document semantic ranker, with active-version and parent expansion policy above it |
| graph retrieval | Jaren vector kernels, bounded entity includes, closed schemas and structured-output repair | `@tangleai/lightrag`: immutable claims and active canonical projections, name/theme folding, co-reference policy, fixed-root one-hop expansion, keyword planning and the metered grounded answer engine; `@tangleai/store` commits document and graph heads together |
| governed intent planning | Models owns structured-output repair; GMPL owns prompt artifacts and the clarification pattern; MAS owns interaction waits, replay and shared budget accounting | `@tangleai/grounding` owns rules-first triage, curated field questions, verbatim host-response projection, closed-vocabulary fact gates and profile query expansion. Its SQLite adapter drives the existing MAS queue; intent-only clarification is an opt-in deterministic terminal projection, not another executor. |
| composed grounded sessions | Native MAS node lifecycle, revision-bound agent components, GMPL interactions and the Jaren SQLite job worker | `@tangleai/grounding` composes rules, planning, local/web evidence, conflict interpretation and validated claim ledgers in one workflow. Desktop reads retained identities and presents seven commands/reads through the existing contract dispatcher; no separate runtime, polling loop or subscription. |
| LLM judgment | `@tangleai/models` `createStructuredOutput` + gates + repair loop | the contradiction judge (verdict schema + messages live in `@tangleai/memory/contradiction`) |
| self-refinement | `@jarenjs/core/guarded` generic guarded refinement and `@jarenjs/json/patch`; `@tangleai/agents` `createRefiner` specializes RFC-6902 mutation for the context ledger | Consumers include context evidence, agent ledger refinement, outcome artifacts, T2SKILL directory commits, repository patch/strategy refinement, HERA integration, cited forecast guidance and research program/lesson refinement. Tangle owns domain evidence, validation and policy; Jaren owns the guarded engine |
| SQLite execution and physical schemas | `@jarenjs/db` driver ownership, process supervision, settlement, backups, relational expressions and guarded table migrations | `openTangleDb` consumes injected drivers; Tangle owns durable outcome/MAS receipts, schema migration decisions and retry policy. No local SQL or process engine |
| evidenced outcomes | Jaren validation, canonical hashing, schema emission, contract local/HTTP bindings and database transactions; Tangle model/configuration/budget seams | `@tangleai/outcomes` owns immutable lifecycle records, domain gates, host authority, replay and version/revision CAS; `@tangleai/store` owns atomic persistence and memory projection. The forecast harness adapter consumes this lifecycle for immutable resolutions, prediction scores and checked promotion. Artifact versions are not memory units |
| forecasting state | Jaren validation, canonical identities, guarded refinement and as-of series join; `@tangleai/outcomes` remains the checked promotion owner | `@tangleai/forecast` owns question scopes, checkpoint order, provisional visibility, atomic stage receipts and manually admitted checkpoint/resolution MAS workflows. It composes the existing agent, structured-output and three-skill ledger owners for execution, notes and bounded question-local feedback; `@tangleai/store` supplies SQLite transactions and the existing MAS queue/worker. Static execution, provisional revision, independently scored outcome promotion and committed-stage recovery are measured on the scripted tier. The outcome adapter permits pure asynchronous canonical digest lookup; no forecast command writes outcome heads or projects memory confidence. |
| orchestration | `@jarenjs/flow` FSM/DAG compile + checkpoints + snapshot/resume; `@jarenjs/linq/flow` by-code pen (`defineDag`/`defineFsm`); `@jarenjs/db` durable jobs with per-job flow checkpoint rows and atomic complete-and-prune; `@tangleai/models`, `@tangleai/context` and `@tangleai/agents` for model, context and tool-loop mechanisms | `@tangleai/mas`: the canonical MAS workflow IR, `TMAS` refusal vocabulary, nine semantic gates, region partition/lowering policy, transactional node lifecycle, namespaced segment checkpoints and the resume outbox reconciler; `@tangleai/gmpl` supplies immutable domain/role/schema/prompt artifacts and six pattern recipes, materialized into that same IR without another executor |
| frozen query groups | `@jarenjs/core` cosine similarity and bounded concurrent mapping; the models structured-output repair loop; GMPL prompt rendering; MAS workflow validation, execution and shared budget accounting | `@tangleai/hera`: deterministic MMR experience selection with task-specific utility weights, invocation-graph role/tool/snapshot admission, task-first ranking, immutable control receipts and prepared candidate budget shares; these are application policies over the existing MAS executor |
| experience learning | the same structured-output repair, GMPL rendering, generated schema validation and outcomes head fence | `@tangleai/hera`: mixed-group credit admission, empirical application counts, source-backed consolidation, immutable provenance and atomic library/snapshot transitions; a host policy admits contradictions and cannot replace evaluator outcomes |
| role prompt evolution | `@jarenjs/core/guarded`, Jaren JSON Patch and the outcomes head fence; the existing structured-output and MAS owners | `@tangleai/hera`: failure-credit buffers, one-role whole-topology comparisons, source-backed prompt-block gates, measured activation and archived-version rollback; operational receipts retain rejected-trial cost |
| topology learning and diagnostics | the existing structured-output repair, MAS validation/execution, outcomes head fence and `@jarenjs/core/stats` mean | `@tangleai/hera`: versioned persistent-failure policy, registered-role interventions, same-group measured acceptance, snapshot topology hints and one pure role/DAG metrics module; no second executor or general graph framework |
| orchestration evidence review | Jaren closed-schema contracts, local/HTTP dispatch, JSON Patch, JSLT/Mermaid and MAS plan projection | `@tangleai/hera/contract`: fourteen scoped reads, provenance joins, historical prompt differences and projections of retained execution plans; no transport, event bus or learning command |
| pattern content | `@jarenjs/josl` TOML parsing, `@jarenjs/json/jtlt` rendering, canonical hashing/validation and `@jarenjs/core/stats` statistics; MAS specialization, planning and execution | `@tangleai/gmpl` owns role visibility, evidence/finding retention, thresholds, bounded round/turn policy and pure revision-bound answer projectors. Host providers, stores and domain evidence remain injected |
| scheduling | `@jarenjs/core/schedule` bounded, fair, per-scope admission and drain | Document HTTP admission and consolidation runners use the suite scheduler; Tangle owns explicit manual/count/time eligibility, persisted cooldown/arrival, capacity and default-disabled policy |
| experiential consolidation | Native canonical identity, validation/emission, JTLT, `createDagJobRunner`, checkpoints, scheduler, attempt budget, guarded refiner and contract dispatch; outcomes head CAS and configuration/run identity | `@tangleai/experiential` owns experience trust, dataset lineage, training specifications and receipt checks, evaluation gates, deployment/pin/retention policy and redacted read operations. Its injected training backend seam has no native parameter-training equivalent in the pinned Jaren 0.91.4; the host supplies the trainer and inference binding. SQLite transactions and durable jobs remain native. Scripted conformance is not a live learning claim. |
| consolidation activation and operations | `@jarenjs/json/canonical`, `@jarenjs/validate`, `@jarenjs/emit`, `@jarenjs/db` transactions/CAS and `@jarenjs/contract/local` dispatch | Core owns closed evidence/operation schemas; memory owns immutable occurrence/artifact identities, complete-batch activation, supported claims, durable dispatch accounting and explicit unknown-outcome resolution; store adapts the shared protocol to Jaren SQLite |
| consolidation lexical routing | `@jarenjs/core/search`: `compileLexical`, bounded postings/index/search and compatibility scoring, `reciprocalRankFusion` with code point id ties | one adapter in `@tangleai/core/lexical` owns NFKC word normalization, input-order lexical ties and one fusion vote per id per lane; consolidation preserves code-point ties through compatibility names, governed retrieval uses first appearance; source selection and exact-evidence expansion remain domain policy; frozen BM25 reference is benchmark-only |
| web search | — | `@tangleai/search` (SearxNG) + `compose/searxng` |
| configuration identity | `PROVIDERS`/`resolveEndpoint` (the only endpoint authority), probes, clients, budget/structured-output/toolbox, the replay cache keyed by the effective request; `applyMergePatch`, `canonicalSha256`, `compileJsonQuery`, `$query` validation, `jaren-emit` types, `deepFreeze`/`cloneJson`, `sameIdentity`, `diffContracts` | `@tangleai/config`: the profile registry, pure resolution, TCFG refusal vocabulary and the run-identity envelope; the host adapter projecting either the generated request or a NAMED profile, binding write-only secret slots, and deciding — as host policy, by provider and never by slot spelling — which registry slot this host can call configured; the identity repository beside runs/chats — a run identity is never a replay key (see CONFIGURATION.md) |

GMPL's prompt-pack `meta.pattern` accepts a validated identifier so HERA can own
its role and control artifacts without adding a second parser or renderer. The
six-family GMPL recipe vocabulary remains closed. HERA's selector, invocation
pre-validator, consolidation provenance/conflict gate and structural metrics
belong here because they encode evaluated orchestration policy; the generic
validation, patching, statistics, rendering and execution mechanisms stay at
their existing owners.

## What the suite already has — read before building

The suite's entity includes are bounded one-hop relation loading. They do not
provide a k-hop graph policy. Tangle's graph lane uses those storage primitives,
the existing vector kernels and structured output; its fixed-root expansion,
claim provenance, active projections and answer policy remain Tangle-owned.

Current Jaren 0.91.4 adoption: [integration audit](JARENJS_INTEGRATION.md).
Trading uses native indicators and returns from `@jarenjs/core/finance` and
publication-time as-of operations from `@jarenjs/core/series`. ADX, CCI, VWAP,
volume ratio and KDJ are native re-exports. `@tangleai/trading` owns point-in-time
provider admission, explicit signal parameters, metric conventions, risk policy,
corporate settlement, accounting, domain artifacts and the backtest composition.
It introduces neither a second financial kernel nor a scheduler.

| Current trading need | Suite owner | Tangle owner |
|---|---|---|
| Indicators, returns and publication-time series | `@jarenjs/core/finance` and `@jarenjs/core/series`, including ADX, CCI, VWAP, volume ratio and KDJ | Provider admission, explicit parameters and conventions, evidence, hard risk limits, settlement and workflow composition |

Current ownership: [migration handoff](JAREN_AI_MIGRATION.md).
The [0.83.3 integration audit](jaren-integration-0.83.3.md) retains its historical measurements.
The following historical baseline retains its original `@jarenjs/ai` names
and records the 0.56.0 adoption; the current audit supersedes
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
| One labeled trajectory as the evidence an analyst reads | `createAgent`'s `send()` result (`message`/`messages`/`steps`/`stopReason`), per-turn `hooks.onReasoning`, `createTrajectory` for orchestration entries, `describeTrajectory` for a bounded prompt view | **Landed** — `@tangleai/trace2skill` stores a `TaskRollout` envelope over the native result and analyses the stored rollout, never the lossy view. `createTrajectory` records the run's stage events and is not the task-local evidence. |
| A skill as a directory, used with no retrieval index | `SKILL_SCHEMA` is a closed flat record and `json/patch` is RFC 6902 over JSON; `compileTextEdits`/`applyTextEdits` in `@jarenjs/core/text/edits` compile whole-line anchored edits over one text with no heading or link interpretation | **Landed** — `@tangleai/trace2skill` owns `SkillBundle`, the anchored directory-patch compiler (its anchor, heading-section, overlap and link-group rules differ from the suite's; see the [integration audit](JARENJS_INTEGRATION.md)) and the format validator; `composeSkillSystem` + `skillReadTool` put the active directory into a request as data. A ledger skill record may be derived for display and carries no authority. The k-means-cluster-then-retrieve shape is the paper's retrieval baseline and survives only as the `retrieval-bank` ablation row. |
| Self-modification that cannot go rogue | `createGuardedRefiner` in `@jarenjs/core/guarded` (`read`/`validateProposal`/`apply`/`validateCandidate`/`planCommit`/`commit`; synchronous `prepare`, awaited `prepareAsync` and `commit`); `@tangleai/agents` `createRefiner` specializes the same idea for the context ledger's arrays | **Landed** — T2SKILL owns the directory compiler; research lessons consume it and the native guarded engine after separately recorded validation. Outcome artifacts, repository evolution and research refiners consume the same engine. The outcome head is the sole compare-and-swap owner for research lesson activation; lesson descendants are audit records. |
| An isolated worktree, and a child process that cannot outlive its deadline | `createProcessExecutor` in `@jarenjs/core/process-node`: named commands with absolute executables, no shell, whole-argv validation, realpath working-directory check, allow-listed environment, output caps, deadline and process-group ownership. No git vocabulary; `@jarenjs/flow`'s `createExternalEffects` fences an effect without knowing how to perform one | **Landed** — `@tangleai/evolve/host` owns the worktree lifecycle, the git allow-list of whole argument vectors, and `createProcessRunner`: one suite executor per declared root, the host's fixed environment values, PATH resolution of bare command names, and the `TEVO` refusal vocabulary. A repository experiment is Tangle's problem; running a named process within bounds is the suite's. |
| Durable repository experiments and strategy selection | Suite job leases, checkpoints and external effects; Tangle MAS interactions, ledger skill recall, structured output and outcome projection | **Landed** — `@tangleai/evolve` composes these owners into conditional workflow stages and a checkpointed effect worker. It owns repository authority and the four measured selection policies. The upstream need is reusable bounded processes and durable effects, already supplied; git worktrees and the mutator surface remain Tangle policy. The 72-experiment comparison is inconclusive and the default stays unranked. |
| Structured output with a repair loop | `createStructuredOutput`, `unfence`, coded errors carrying a `docPath` into the offending document | The temporal lane (window extraction); landed as the answer path's category-5 judge. |
| Constrained decoding against a local model | `@jarenjs/josl/gbnf` — a character-level GBNF for the llama.cpp family, beside the hosted `json_schema` twins the query and JSLT grammars publish | Config profiles, if a local provider becomes a profile. |
| Reading a TOML prompt pack | `parseToml` from `@jarenjs/josl` — passes the official toml-test 1.0.0 suite in strict mode, the only engine in its benchmark that does | **Landed** — the skill loop's five role packs are TOML compiled once into an immutable artifact whose revision IS the prompt version its keys name. Do not write a TOML reader. (The packs themselves stay Tangle's — see *What must never migrate down*; consuming the suite's parser is not migrating anything down.) |
| Tabular import/export of results | `parseCsv`, `stringifyCsv`, `sniffCsvDialect`, and a `repair: true` mode that logs every fix under a stable `CSV1xxx` code | The instruments; the policy matrix. |
| Catching a malformed dataset at the door | `@jarenjs/validate`, plus the `$query` keyword for cross-field assertions (sums, ordering, quantification) | **Landed** in the census — `locomo10.json` is validated on load against a committed schema, so the 444/446 missing-`answer` adversarial bug is a **schema-detected count in the report**, not a surprise in the scorer. |
| Keeping hand-written interfaces honest with their schemas | `emitTypeScript` (a function, not only the `jaren-emit` CLI) with `--check` failing CI when a schema moved and the type did not, verified cyclically against the validator over an instance corpus | Any instrument. Dev-only, so exempt under CONVENTIONS §1. Candidate replacement for the hand-maintained interface/schema drift tests in `@tangleai/core/schemas`. |
| A stable identity for a dataset or a report | `@jarenjs/json/canonical` (RFC 8785 canonical bytes) and the SHA-256-over-canonical pattern `contract.revision()` already uses; `hashContent` in `@jarenjs/core/string` (exact FNV-1a) for a cheap fingerprint | The instruments — the checksummed manifest the salvage plan asks for. |
| Replaying paid chat replies and embeddings | the `cache` seam on `createChatClient` and `createEmbeddingClient`: effective credential-free keys, replay marking, per-text partial embedding hits and malformed-entry refusal | **Landed at 0.56.0.** `benchmark/lib/wire-cache.ts` is now only the SQLite adapter/audit trail; the client wrappers and key construction are gone. |
| Paired confidence intervals and research comparisons | Native seeded random draws and nearest-rank statistics | `benchmark/lib/locomo-policy.ts` owns the shared `bootstrapInterval` resampling policy. Research owns matched row selection, units, identities, budgets, refusals and activation thresholds; there is no second bootstrap implementation. |
| Repeatable random draws | `mulberry32`, `randomInt`, `shuffle`, `drawDistinct` from `@jarenjs/core/random` | **Landed at 0.56.0.** LoCoMo instruments import it directly; the local random module is gone. |
| Descriptive statistics with explicit quantile semantics | `mean`, sample `variance`, `stddev`, `median`, and required-method `quantile` from `@jarenjs/core/stats` | **Landed at 0.56.0.** `benchmark/lib/stats.ts` retains only null/report shaping over nearest-rank p50/p95. |
| Ordered bounded asynchronous work | `mapConcurrent` from `@jarenjs/core/async`, including abort/drain semantics | **Landed at 0.56.0.** The QA instrument imports it directly; the local clamping pool and redundant test are gone. |
| Running the eval as a document, and drawing it | `@jarenjs/flow` jaren-dag, and `@jarenjs/mermaid`'s `dag-to-flowchart` stylesheet | Already correct — `@tangleai/pipeline` uses both, and `packages/pipeline/src/mermaid.ts` derives the drawing from the executable document rather than hand-drawing it. |
| A benchmark run as an operation, live progress, and a CI gate on its shape | `@jarenjs/contract`: a `subscribe` operation streamed as a `@jarenjs/db` live query (SSE over http, frames over port, resumable by seq), `contract.revision()`, and `diffContracts --fail-on breaking` | **Landed** — the desktop's run-addressed frame stream (`run_frames` in `@tangleai/store`, appended inside the transaction that allocates its seq) is what `runs.live`/`run.live` carry, and the frozen public projection plus the classified diff is the gate on the surface's shape. Tangle-owned above it: the frame kinds and their closed bodies, the instrument runner as a host-injected child process (the private measurement workspace is never imported), and the keyless-only registration rule. |
| Excerpting, truncating, sizing text | `excerpt`, `truncate`, `sizeOf`, `chunkText` in `@jarenjs/core/chunk` | Everywhere. Note the standing exception: this is NOT the document chunker — it has no element or heading model, which the document lane needs. |
| Time as an answerable structure | `@jarenjs/core/dates`, `@jarenjs/core/series`, `@jarenjs/locales`; Jaren SQLite transactions and scoped numeric indexes | Core owns closed temporal contracts; `@tangleai/memory/temporal` owns evidenced claims, explicit cutoffs, bounded semantic pools, refusal policy and cited answers. Models supplies structured proposals; store supplies the Jaren adapter. Observation timestamps never establish claim validity. See [the API guide](../packages/memory/docs/TEMPORAL.md). |
| Geography | `@jarenjs/core/geo`, `@jarenjs/core/series`; `@tangleai/jaren/spatial` and `@tangleai/jaren/geo-tools` own authoring gates and tools | `@tangleai/memory/place` owns sourced gazetteers, cited location assertions, semantic budgets and refusals; `@tangleai/store` owns immutable SQLite loads. Native as-of, validity and distance kernels compute answers. [Guide](../packages/memory/docs/PLACE.md). |

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

- **Scholarly metadata and arXiv Atom.** `@tangleai/research` owns normalized
  OpenAlex, Crossref, Semantic Scholar and arXiv records, identifier deduplication
  and one bounded namespace-aware Atom reader. The JSON adapters compile native
  `@jarenjs/contract/provider` descriptors; arXiv uses its executor. Native
  attempts, scheduling and request identity remain suite-owned. Broad web reuses
  `createSearxngClient`; source acquisition reuses the document ingester. Exact
  replay retains failure bodies and headers that the native success-only cache
  does not store. No provider response type is a research record.
- **Scientific claim verification and research exports.** `@tangleai/research`
  binds literature identity, exact source quotations and registered numeric
  observations to a draft. Its verifier applies the research contract's units,
  conditions, seeds, aggregates, rounding and strict-section policy. The shared
  `validateClaimEvidence` remains the envelope/reference validator, and native
  GMPL owns independent review cycles. `@jarenjs/md` owns Markdown syntax;
  research owns the finite bundle inventory, scientific provenance and disclosure
  policy. The package emits TeX text only; bounded process execution belongs to
  the benchmark host. Sentence-level gold and measurement stay in `benchmark/`.
- **Research evaluation and human authority.** Research owns evaluator registration,
  frozen comparisons, observation signatures, finite review policy and the typed
  command surface. Native MAS owns interaction CAS, cancellation, task execution
  and restart; `createGuardedRefiner`, JSON Patch and JSON Pointer own edit mechanics.
  Human proposals pass the existing deterministic verifiers and never mint measured
  observations. Native `pairedBootstrap` supplies the registered paired interval;
  `compileJsonQuery` executes the downstream research handoff verbatim.
- **A filesystem watcher.** The suite ships none, and it must not: watching a
  folder is host policy — a debounce, an overflow ceiling, a restart scan and
  a bounded admission are decisions about one application's corpus, not a
  contract. `apps/desktop/src/watch.ts` owns `node:fs`'s recursive watch and
  publishes what it observed as counts; a corpus package that reached for
  `node:fs` would stop being portable (verified against the suite 2026-09-13).
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

- `benchmark/retrieval.ts` scores recall@{1,5,10}, MRR and latency per policy,
  and **gates the scorer before any number prints**: an `oracle` row must be
  exactly 1.000 at every k, and a seeded `random` row must land inside its
  analytic band, or the run exits 1 with the row named. The oracle row is what
  catches a corpus whose gold ids do not exist — which is precisely the risk in
  LoCoMo's evidence dialog ids, some of which are parenthesized.
- `benchmark/long-horizon.ts` publishes a **model-free ceiling beside the actual
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

The policy instrument's paired bootstrap is Jaren's `pairedBootstrap`
(`@jarenjs/core/stats`), called from `benchmark/lib/locomo-policy.ts` over the
registered question pairs for the overall, category and acting-set intervals;
the grounding and consolidation instruments reuse that call. Tangle keeps only
the empty-set rule and the work bound. The temporal evaluation's
independent-group bootstrap is a different statistic and stays local.
The memory package owns the resulting policy values; config records a component
reference to that owner rather than copying its thresholds into profiles.

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

## Changing a shared foundation or mechanism

Use concrete friction to improve the package that owns the behavior. For a
generic Jaren foundation, the established loop remains:

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

The **mutator surface policy** belongs here too, and for a sharper reason than
the rest. It is the rule that decides which files a proposed change may not
touch — tests, gates, CI, generated artifacts, the registration that says what
success means — and it is compiled from the repository record rather than read
out of the tree being edited, so a change cannot move the goalposts that judge
it. A policy like that is only meaningful next to the instrument it protects.
Migrated down into a general-purpose suite it would become a configurable file
filter, which is the same mechanism with the argument removed.

Governed web retrieval composes the native agent/toolbox, one structured-output
repair owner, SearxNG and SafeStaticFetcher. Admission remains inside the fetcher
on each hop, including robots; the public replay adapter consumes core's exact
HTTP capture format. Static HTML/text extraction has one shared browser-safe
owner; the existing complete document extractor adds PDF support for Node/Bun.
Jaren's provider executor does support safe reads and successful-text replay.
It is not layered over the document fetcher here because scheduling, robots,
redirect admission and byte budgets already belong to that fetcher, and the
fixture requires exact redirects and unsuccessful HTTP responses too.

Grounded claim generation projects its draft into the context package's existing
claim envelope. That native validator proves referential integrity and admission,
not prose entailment. Tangle owns the profile's authority/time rules and answer
policy. The bounded repair consumer uses `createClaimRefiner` and Jaren's compiled
RFC 6902 patch applier; it owns no second validator, patch interpreter or prose
matcher. The benchmark's unchanged grounding scorer measures scripted semantic
support independently from the product's reference gate.

The governed session host also owns final evidence selection across both lanes:
`selectGroundingContext` uses the shared token estimator and retains unchanged
candidate records. The answer model checks the ceiling again before dispatch.
The configured user-fact vocabulary has one owner in grounding intent projection;
planning and final claim/caveat validation reuse it. Experimental lane/parent/rule
removals are explicit pinned host policies and never selected by model output.
The benchmark HTTP capture reuses the document fetcher's exported bounded response
reader before retaining live bodies; capture keys and response-byte identities
continue to use the existing core capture contract.
