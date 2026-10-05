# @tangleai/research

Verifiable research from scholarly discovery through frozen experiments,
independent analysis, claim-bound drafts and attributable human decisions.
Closed records, content-addressed artifacts and atomic lifecycle storage retain
failed attempts, negative results and every incurred call.
The public root performs no host I/O and works in browsers, Node and Bun. MAS
owns workflow execution; this package plans and stores its research projection.

```ts
import { createMemoryResearchStore, planProjectCreate, planStateTransition } from '@tangleai/research';

const store = createMemoryResearchStore();
const created = planProjectCreate({
  id: 'inertia-study', topic: 'clustering', domainProfile: 'computational',
  question: 'Does the candidate reduce inertia?', owner: 'researcher',
  mode: 'gate-only', safetyClass: 'computational', status: 'CREATED',
  budget: { calls: 10, tokens: 10000, ms: 60000, physical: 10 },
  createdAt: '2026-10-03T00:00:00.000Z',
});
if (!created.valid) throw new Error(JSON.stringify(created.issues));
const saved = await store.createProject(created.value);
if (!saved.ok) throw new Error(JSON.stringify(saved.issue));
const discovery = planStateTransition(saved.value, 'DISCOVERY');
if (discovery.valid) await store.transition(discovery.value);
```

`researchSchema`, `researchSchemaOf(name)` and `validateResearchShape(name, input)`
use the same schema that generates the public types and validates benchmark
records. Validation returns `TRSH1001` with JSON Pointer paths. Finite JSON is
snapshotted before asynchronous work; store readers return detached clones.

`researchRevisionOf(json)` and `inputManifestHashOf(manifest)` use canonical
SHA-256. `researchArtifactIdOf(bytes)` hashes exactly the supplied byte view and
returns `art-<sha256>`. Paths, clocks and operational run ids do not enter a byte
identity. A stage attempt binds project, stage, ordinal and input-manifest hash.

`stageArtifact(bytes, descriptor)` stores bytes and an immutable admission with
its project, producing attempt, verification result and exact parent admissions.
The root parent is `{ artifactId: projectId, admissionId: null }`; every later
parent names both its byte address and its admission id. Identical bytes can have
different producers or verification results without overwriting provenance.
Verification is supplied by a verifier; storage checks bytes, identities and
references and does not evaluate scientific results.

`planStageCommit` binds a completed or refused attempt, its inputs, output
admissions, immutable record writes and next legal state. `commitStage` validates
the plan again and commits records, attempt, control state and RunLog projection
in one transaction. Only verified output admissions with a complete committed
ancestry can become reachable. A replay returns the recorded result and spend
without another projection frame. Conflicting results refuse `TRSH1002`; changed
state or a reused MAS path/ordinal refuses `TRSH1004`. Successful work cannot
exceed the project's budget. A terminal failed `TRSH1006` receipt retains actual
incurred overrun costs; it grants no further execution. `collectUnreferenced(projectId, before)` reports
uncommitted admissions from older ordinals of the named stage and deletes nothing.

`putRecord` stores immutable data by project, kind and id; identical puts replay
and conflicting content refuses. Project creation, artifact admissions, attempts
and amendments use their dedicated atomic operations. `planContractFreeze` /
`freezeContract` bind a contract and plan before any observation. The store checks
its own observation census, so a caller cannot hide results by supplying an empty
list. `planAmendment` / `amendContract` retain the old lineage and mark all affected
observations exploratory. Entering `EXECUTE` requires frozen hashes. Every control
change checks the complete expected state, including its monotonically increasing
revision; a loop returning to a previous status cannot reuse an old plan.

For SQLite, use `createResearchStore(db)` from `@tangleai/store`. Its five research
collections use the same admission policy as memory. Native RunLog creation,
frame allocation and terminal status join the caller's native transaction.
`researchRunLogId(db, projectId)` resolves the explicit association; MAS ids and
RunLog ids are separate. The adapter accepts an injected `now` and does not close
the caller's database. `createMemoryResearchPersistence` exposes snapshots and a
close method for hosts that need explicit ownership of the in-memory adapter.

Failures are values: pure plans return `{ valid: false, issues }`, store
operations return `{ ok: false, issue }`. `RESEARCH_ERRORS` defines `TRSH1001`–
`TRSH1010`; adapter failures retain the underlying code, path and detail.

`createResearchBinding(contract, options)` validates and recomputes a complete
CONFIG identity and pins prompt, tools, evaluator and stage reservation.
`prepareResearchWorkflow` returns the native workflow, immutable registry,
catalog, validated plan and Mermaid projection. `defineResearchWorkflow` is the
root authoring function; `createResearchRegistry` supplies its exact child
versions. Composition failures throw `ResearchFailure` with a typed `issue`.
Native subgraphs host bounded loops: refinement uses `attemptCap`, pivot
uses `pivotCap`, and design and quality review use `reviewCap`. A requested repetition at
its cap takes the registered Stop edge; native `TMAS2009` remains a failure.

Create the project before starting its MAS run, use the same project id as the
native run id, and construct the root input with `initialResearchFrame`.
`createResearchTaskHandlers(store, tools)` binds scripted stage bodies. The body
receives an immutable operation, stable idempotency key, signal and a reader
restricted to admitted input artifacts. The separately injected verifier checks
its result before any artifact becomes committed evidence. New work requires
its running MAS attempt. Handler replay checks the existing path's manifest
before executing and reconstructs the exact output frame from its receipt.
The native completion and research transaction are separate checkpoints; a
crash between them reuses research output without another execution or RunLog
frame. Precommit effects must honor the supplied idempotency key.

`inputManifestOf` is the sole workflow manifest builder. Its optional
`controlHash` binds root content, counters and the exact gate response alongside
artifact hashes; earlier manifests without this field retain their identities.
The recovery frame's content artifact has no self-reference. The returned frame
names that committed admission, which becomes an input to the next stage.

`createResearchHostBindings` assembles injected capabilities with no host I/O.
It checks the handler binding and native run identities even when MAS can replay
completed nodes without entering a handler. Each indefinite interaction stores
`gateResponseSchema(kind, reviewedManifestHash)` with the reviewed artifact hash
as a response const. The handler accepts only the actual durable response.
Scripted approvals identify themselves as scripted; a digest does not establish
who reviewed the artifacts. Hosts authenticate actors before constructing commands.

`createResearchCommands({ masStore, researchStore })` exposes read-only
`attach(runId)` and `execute(command)`. `researchStatus(trace)` is the corresponding
pure status projection. Each `HumanCommand` includes a unique `id`, interaction id,
expected revision, gate kind, exact reviewed-manifest hash, actor (`human` or
`scripted`), actor id and explicit RFC3339 `at`:

- `approve` carries a note and advances to the next registered stage.
- `reject` carries a reason and a target (`write`, `analyze` or `design`). The
  quality gate can revisit all three; the design gate can revisit design.
- `guide` carries text. Its next synthesis, design or writing attempt admits the
  exact guidance hash and exposes the text as a human request in its model input.
- `edit` names a reviewed artifact and admission, bounded JSON Patch and retry
  target. Design and writer proposals can be edited; observations, source evidence
  and committed records cannot. The guarded editor checks both read and write
  paths and synchronous schema validity. It creates a pending descendant with
  the old artifact as parent; the next attempt independently verifies its result.
  The designer and agent writer must preserve the exact edited proposal before
  independent verification. A template writer retains its fixed arrangement and
  refuses an edit that changes it. A design revision before any execution uses an
  explicit `beforeResults` amendment with no observations; after results exist,
  every affected observation remains marked exploratory under the new lineage.
- `stop` carries a reason. Native cancellation stores its attributable response
  atomically with the terminal run; retry reconciles the separate research
  `STOPPED` projection and intervention if that transaction was interrupted.

`planHumanCommand(trace, command)` performs read-only admission. Changed review
hashes, stale revisions and competing responses refuse `TMAS2007`; identical
delivery replays by intervention id without another execution. Accepted actions
retain their stage, actor, viewed artifact ids, effect and timestamp. A note on
an approval is not substantive guidance. `interventionReport(trace)` and
`researchInterventionReport(records)` use the same action accounting; exports
carry the counts beside the complete records. Substantive corrections consume
the finite review allowance, and reaching a cap records the action before Stop.

Gate-only is the default topology. Experimental full-auto requires
`{ mode: 'full-auto', experimental: true }` on both the project and prepared
workflow. It replaces each gate interaction with a native task and records
`actor: 'full-auto'`; exported manifests disclose `experimental: true`. An
automatic response cannot be submitted to a human interaction. No mode infers
approval from time or silently switches during resume.

`overdueGates(trace, now, policy)` returns counted waiting gates using an explicit
RFC3339 instant. Pause preserves the wait. Stop resolves the native interaction
as expired and fails MAS with `TMAS2007`, without approval or a resume job.
`applyOverduePolicy` also reconciles the research STOPPED projection after an
interruption between the two stores' updates. That composition is retryable,
and does not claim a transaction spanning both adapters.

[`examples/research.ts`](../../examples/research.ts) runs the real MAS worker,
reopens SQLite after each approval and verifies zero provider spend. Queue,
worker, clock and database lifetimes belong to the executable host. Scripted
complete-path controls qualify durability; they do not establish scientific
quality or replace a retained scientific Stop decision.

`createInclusionCriteria` and `createQueryPlan` build immutable discovery inputs.
Pin `discoveryRevisionOf(options)` as the `scholarly-discovery` tool version
before preparing a workflow, then wrap its stage tools with
`createDiscoveryStageTools`. CREATE commits the query plan and criteria; DISCOVERY
reads their exact admitted artifacts before making any request. Its normalized
literature, screening decisions, candidates, acquisition results and receipt
commit together through the existing stage transaction. Related records share
an artifact so durable frames remain within their declared trace budget.

The three JSON scholarly adapters compile native provider descriptors. arXiv
uses the same injected executor and a bounded namespace-aware Atom reader.
Executors own attempts, scheduling, Retry-After and cancellation. Supply transport,
clock, sleep, randomness, request limits and metadata licence provenance in
`ResearchProviderHost`; credentials belong only to private host transport. Live
arXiv hosts must configure its documented request spacing. No adapter accesses
ambient fetch. SearxNG wraps the native search client and returns candidates;
snippets never become evidence cards.

`createReplayTransport` snapshots transcripts and uses the native
`providerReplayKey`, including method, exact URL query ordering, public headers,
body and explicit visibility scope. Its custom transport preserves non-success
status, headers and malformed response bodies, which the native success-only
cache deliberately does not retain. A miss returns a counted `TRSH1008` through
the adapter, with no network fallback. The receipt retains native pull observations
and raw-byte hashes even on incomplete or refused pulls. Partial rows are not
admitted as complete literature. Per-query counts distinguish HTTP successes,
failures, rate limits and admission refusals. Byte accounting spans retries and
concurrent queries; aborted capture cancels its body reader.

Canonical DOI, arXiv, OpenAlex and Semantic Scholar identities drive deduplication.
The arXiv version, update timestamp and primary category remain available. Metadata
fallbacks cannot merge conflicting or disjoint canonical works; receipts expose
accepted and refused fallback pairs. The scripted reviewer uses frozen title/date
and source criteria, with `keep`, `exclude` and `unresolved` decisions. It does not
assert relevance, novelty or claim support.

Acquisition receives a native document ingester/store and an exact retained-body
reader. It requests full source bodies and verifies their SHA-256 against the
native immutable version. Cards retain their excerpt, full-source artifact/hash,
version and element locator. `resolveEvidenceCard` checks all of those without
reading chunks, including after a newer version becomes active.
`toAdmittedArtifact` projects a card to the shared claim-evidence descriptor.
Hosts must bound actual document transfer through the native fetcher's limits and
aggregate byte callback as well as the frozen acquisition limits. Source failures
remain per-source `TRSH1008` records. A source licence is never inferred from the
fixture's MIT grant or a provider metadata licence.

The benchmark runs committed synthetic transcripts only. The separate
`benchmark/scripts/research-transcripts.ts` recorder requires explicit live-tier
approval and writes a new private capture; it never edits the fixture or applies
its licence to external content. Scholarly discovery does not qualify live API
availability or scientific support.

For model reasoning, pin `researchArtifacts.revision` as the prompt revision and
`researchReasoningRevisionOf(policy)` as the `research-reasoning` tool version.
Pass the same `ResearchReasoningPolicy` to `prepareResearchWorkflow` as `reasoning`
and to `createResearchReasoningTools(base, { project, policy, provider })`.
Supply `clientFor` to `createResearchHostBindings`. The installed catalog contains
nine compiled packs; `npm run research:artifacts -- --check` verifies their build.
Runtime imports never read prompt files from the filesystem.

The policy selects `single-agent` or `debate`, bounds visible cards and declares
the novelty query budget. Both modes execute in the existing MAS run. Native
agent nodes own the agent loop, toolbox, normalization, bounded repair and shared
budget. Debate embeds the ordinary parallel-analysis and structured-debate
patterns with Innovator, Pragmatist, Contrarian and a separate synthesizer.
Per-participant prompt overrides preserve equal variable and output contracts.

Preparation persists the exact input manifest before model dispatch. Pure tools
`read_cards`, `read_synthesis` and `propose_hypotheses` implement the readCards,
readSynthesis and proposeHypotheses operations using native MAS tool identifiers.
They require the current running invocation and its completed preparation; reads
stay inside committed inputs, and proposal validation writes nothing. One card
per source is selected by first element order, with source-id ordering and the
declared maximum. After literature approval, later frames carry the record
envelope and required source/dataset references. Original discovery artifacts,
their provenance and the full reviewed gate remain immutable and accessible.

Model proposals contain content, not authoritative ids or hashes.
`createResearchSynthesis`, `createResearchHypotheses` and `createResearchDesign`
independently check references and scientific registration constraints before
assigning content addresses. Final hypotheses require at least two distinct
alternatives with nulls, predictions, disconfirming observations, confounds and
declared baselines. Unknown cards refuse `TRSH1003`. Missing or infeasible design
metadata refuses `TRSH1009` at the offending pointer; unapproved input paths
refuse `TRSH1005`.

In model mode, the bootstrap contract bounds topology but does not become the
scientific preregistration at CREATE. The verified DESIGN commit atomically
activates the generated contract and plan, records artifacts and advances to
DESIGN_GATE with one revision. It checks the actual persisted observation census.
Later changes still require an amendment; an approval cannot rewrite frozen
content. Downstream stages refuse `TRSH1007` unless the host explicitly binds them
to generated-plan execution through `generatedStages`.

Stage cost comes from retained native agent attempts, including normalization,
repair and failed calls. Model replies and caller-supplied totals cannot supply
that authority. A native failure reconciles its prepared research attempt before
the native run transition. A failure between stages adds a terminal control
receipt against the last committed frame, preserving earlier model charges.
Reopening after either commit does not repeat model calls or charge them twice.
Trajectory artifacts retain the native agent records.

`executeResearchNovelty` derives queries from the hypothesis set and awaits the
host's `admitPlan` before any request. Reports retain attempted/completed query
coverage, canonical-identifier overlaps and the model's advisory rating.
`gating` is always false. Overlap is an identity observation, not a semantic
novelty judgment. The benchmark's model rows measure only through design review;
their scripted accounting is not live research quality or experiment completion.

`createResearchWorkspace` snapshots bounded byte views and builds one immutable
path inventory. Inputs, code and the evaluator are read-only; only `output/` is
writable. Paths cannot escape, collide or name hidden labels or secrets.
`buildExecutionManifest` binds those bytes to the frozen contract, plan,
condition, seed, parameters, evaluator, image digest, dependency identity and
finite resource limits. Hash mismatches refuse before any executor call.

Pin `researchExecutionRevisionOf(policy)` as the `research-execution` tool
version, pass that same policy as `execution` to `prepareResearchWorkflow`,
and wrap stage tools with `createResearchExecutionTools`. Supply the store,
executor, independent evaluators, hidden labels and immutable evaluator bytes.
Dataset artifacts must already belong to the committed input manifest. Native
bounded seed/condition loops checkpoint each experiment before the branch's
atomic commit. A failed or cancelled branch retains completed observations,
the failed run, output artifacts and incurred spend. Resume consumes existing
native receipts instead of repeating completed seeds. Reasoning and execution workflows carry
compact frame references between tasks; the package expands only their exact
committed checkpoint bytes before checking input scope.

`ResearchExecutor` exposes Evolve's frozen executor manifest plus typed research
receipts. `createFixtureExecutor(programs, { now })` invokes only explicitly
registered trusted pure functions with feature bytes, seed, parameters and a
signal. It refuses authored code. Its resource checks describe trusted fixture
conformance and do not provide operating-system isolation. Receipts explicitly
set `isolation.verified` to false. `createRemoteResearchExecutor` uses injected
fetch, clock and sleep to make a bounded native single-send request to the
optional [private runner](../../apps/research-runner/README.md). The package
does not import or start that host. Missing engine capability is a counted value;
lost post-dispatch responses remain unresolved and never automatically retry.

Every receipt retains bounded stdout/stderr, output-file hashes, exact manifest
identity, exit status, stop reason and available resource measurements.
`researchExecutionResult` builds the receipt; `validateResearchExecutionResult`
independently rebuilds it from the retained bytes. Canonical raw output belongs
at `output/raw.json`; invalid output still belongs in a failed execution's file
inventory. Measured wall time is retained precisely, while charged milliseconds
round up to the integral spend contract. Unmeasured CPU/RSS values remain null.

`createEvaluationRegistry` is the metric admission owner. An injected evaluator
receives raw outputs and hidden labels outside the experiment. Its id/version
must match the manifest, and every finite metric and unit must match the frozen
contract. Program-supplied metrics are refused. `registerObservations` recomputes
both provenance signatures and actual values; a valid digest alone cannot admit
a fabricated number. Repeated branches have distinct observation ids while
retaining the specified eight-field provenance signature.

An `authored` execution policy declares at most eight immutable `.mjs` slots and
a total of 64 KiB. One native author agent uses the same MAS run and shared budget
through `read-plan`, `read-workspace` and `write-code`. Slots are single-assignment;
byte limits include UTF-8 encoding, and conflicting retries cannot accumulate
new code artifacts. The model cannot read the evaluator or hidden labels. Static
source checks are reported defense in depth. Only the injected container executor
runs authored candidates; a host can route registered baseline program ids to
its trusted fixture executor. When reasoning is enabled, explicitly bind each
implemented downstream stage through `generatedStages`; absent analysis, decision
or writing capabilities continue to fail closed.

`createResearchAnalysis` admits only the exact frozen contract, plan, execution
manifests, run receipts and independently registered observations of a branch.
It separates execution success, metric movement, paired evidence, practical
significance and hypothesis support. Aggregates use native sample statistics;
the paired interval function is injected and its point estimate is checked
independently. Missing statistics stay null. All declared seeds must complete,
with at least two pairs and the declared minimum, before support is possible.
Saturated results remain `not-supported`; a one-seed equality does not establish
statistical equivalence. Amended observations remain visibly exploratory.

Freeze `analysisPolicy` and `branchSelectionRule` in the research contract
before execution. The former declares seed batches, settled program-failure
recovery, confound handling and any named seed-variation checks. Zero variance
alone is not a defect. The latter is `single` or `best-of-n`, with a candidate
cap and `preregistered-metric` or `lowest-variance` selector. The existing
`selectionRule` retains its original seed-opportunity meaning. Selection keeps
all candidate lineages and their costs, including failed repairs.

Pin `researchAnalysisRevisionOf(policy)` under `research-analysis`, pass the
same policy as `analysis` to `prepareResearchWorkflow`, and wrap the execution
tools with `createResearchAnalysisTools(base, { researchStore, policy, statistic })`.
The policy names distinct analyst and reviewer identities and a pinned statistic.
ANALYZE independently recomputes admitted records. DECIDE embeds the native GMPL
peer-review pattern in the same MAS run. Reviewers see compact scientific
projections bound to immutable record digests; complete provenance stays in the
records. Their model calls, disagreements and incomplete reviews remain retained.
An unresolved critical finding prevents Proceed.

`planResearchDecision` produces the sole Proceed/Refine/Pivot/Stop decision.
Continuation reservations cover the next execution, analysis and review path;
remaining grants and attempt, candidate and pivot caps produce explicit Stop.
Replication schedules only missing frozen seeds through the existing executor
and checkpoints. It preserves the hypothesis, evaluator, dataset and exact
authored code without calling the author again. Repairs retain a parent and
expose their admitted diagnosis and previous code to a new bounded author.
`read-previous-code` returns at most 2,048 characters per call from a named
parent file, with an explicit continuation offset.
Unsafe or unsettled executions remain terminal failures.

A result-driven Pivot must choose a distinct admitted hypothesis. Its next
verified design activates a new contract and plan with an Amendment in the
same transaction as the design receipt. All previous observations remain
available and marked exploratory; failed transactions expose no partial lineage.
The [research instrument](../../docs/RESEARCH_BENCHMARK.md) publishes matched
replication costs, persistent-fault repair losses and honest negative decisions.

`buildClaimLedger` binds exact admitted card quotations and registered means to
the shared context claim envelope. Every result claim and every strict section
is critical. `writeResearchDraft` arranges those sentences in six fixed sections;
it cannot add facts, omit claims or mint evidence. Tables come directly from
observation rows through `renderMetricTable`. An open unresolved claim keeps its
visible marker. Strict unresolved claims refuse the draft.

`verifyResearchDraft` checks canonical citation identity and raw hashes, exact
card quotation and its field's permitted strength, then the full registered
numeric mapping, unit, condition, seeds, aggregate and sample count. It delegates
envelope references and critical-claim enforcement to `validateClaimEvidence`.
These checks establish bounded support, not general semantic entailment.

Pin `researchWritingRevisionOf(policy)` as `research-writing`, pass the same
policy as `writing` to `prepareResearchWorkflow`, and wrap the analysis tools
with `createResearchWritingTools`. Agent writing uses a read-only context and
an empty toolbox inside the existing MAS run. Views reference repeated source
records once and refuse overflow; they never silently truncate. Deterministic
verification precedes the native GMPL peer-review and red-team controllers.
Independent role and prompt identities accompany each review; critical findings,
disagreements, refused outputs and every incurred model call remain retained.
Incomplete or rejected review stops before the quality gate. Atomic recovery
reuses the committed negative result without repeating model calls.

`renderMarkdownBundle` produces seven files, including the immutable manifest
and eight evidence-backed disclosures. `rerunBundle(manifest)` re-derives every
file byte from embedded records; the outer receipt hashes `manifest.json` too.
Exports distinguish supported research drafts, stopped-run audits and
retrieval-only controls. A Stop is never relabelled as successful research.
`renderLatexBundle` emits escaped TeX and BibTeX without host I/O. The benchmark's
separate bounded compiler records compilation, missing-tool skips or refusals;
compilation is not a research quality gate.

The [instrument](../../docs/RESEARCH_BENCHMARK.md) measures eight registered rows
on three authored computational topics, with matched scripted gate-only and
experimental full-auto operation. Both modes retain the original inconclusive
and negative decisions. A separate positive control reaches writer, independent
review and all three gates. These tiers qualify implementation and accounting;
they do not establish live research quality, actual human-review efficacy or
paper parity. Cross-run lessons, a second domain and the research operations UI
remain outside this core package. The
[query handoff](../../queries/research/core-baseline.json) retains fixture/report
identities, all eight rows, public record names, costs and those limits.
