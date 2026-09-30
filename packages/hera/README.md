# @tangleai/hera

Contracts, compiled role prompts and durable learning state for evaluated
orchestration. The package exports eight role definitions and five control
artifacts compiled through GMPL. Importing its root performs no filesystem,
database or network work. Hosts supply storage, scope and write authority.

The current measurement is the [keyless orchestration instrument](../../docs/HERA_BENCHMARK.md).
Its analytic oracle and reference establish the fixture. Single-turn, fixed
MAS and query-specific frozen rows execute registered scripted responses, with
counted requests and zero learning writes. The experience-only row trains a
library and then evaluates held-out tasks against its final snapshot. Prompt-only
and combined experience/prompt rows run whole-topology paired trials and publish
a scripted held-out loss. The full topology-mutation row remains unimplemented.
Scripted quality measures fixture sensitivity, not model quality or a learning
improvement.

## Artifacts and identities

`heraArtifacts` is an immutable GMPL catalog. Use `createGmplCatalog` and
`renderGmplPrompt` from `@tangleai/gmpl` to validate and render it.
`createHeraAgents(catalog, {scope, profile, at})` creates the eight definitions
and their candidate prompt versions. `heraRegistryDocument` constructs the MAS
capability document; `heraConfigCatalog` names the host profile and limits.
Only the Retriever's immutable allowlist includes `hera-evidence`.

Prompt versions separate the unchanged role envelope from operational rules and
behavioral principles. `compileEffectivePrompt` combines those blocks after
checking the envelope revision. Role result schemas compose GMPL's existing
claim and finding contracts; there is one citation vocabulary.

Content hashes exclude lifecycle status and observation time. Those metadata
fields change only through fenced activation; a different immutable payload
cannot reuse an address. Snapshots retain exact experience-version ids beside
their library revision, so a later library cannot replace a frozen membership.

## Execution

`createHeraExecutor(host)` binds explicit CONFIG profiles, model clients, an
embedder, evidence provider, evaluator, clocks and the existing MAS segment
worker. `examples/hera.ts` demonstrates a keyless SQLite host and replay after
reopening. The package itself creates no database, client or worker.

`createHeraFixedTemplate` pins the host registry and profile in one caps-only
MAS template. Its six agent invocations include two parallel retrievers of the
same role. `prepareHeraScaffold` also builds the single-turn comparison with
the same limits. Host caps can only lower registered limits. The generated
candidate learning cap is separate from this authored comparison scaffold.

The candidate key includes task, snapshot, group, candidate and configuration
revision within the store scope. Completed and failed trajectories replay with
zero additional model requests; changing the bound payload refuses. Resume uses
the original persisted evidence slice and frozen prompt membership.

Document and memory evidence providers delegate ranking to their native recall
functions. Model and tool identities, exact evidence digests and corpus pins
are checked before dispatch. Only the Retriever receives `hera-evidence`.
Unsupported citations remain counted values, and the versioned evaluator
decides their score effect. The answer also retains a validated claim envelope.
Unlabelled inference has null score and success; it cannot enter learning.

Trajectories retain per-attempt transcripts, tool results, evidence addresses,
reported token parts, missing-usage counts and estimated token charges. Model,
normalization and repair requests all count. Failures retain their invocation
and MAS cause; uncertain effects remain orphaned and are never blindly retried.

## Storage and authority

`createMemoryHeraStore({scope})` and `createHeraStore(db, {scope})` from
`@tangleai/store` implement the same contract. Database rows use scoped physical
keys, allowing the same role name in different scopes. The generated schema is
the write gate for both adapters.

Read with `getAgent`, `getPromptVersion`, the other named getters, `readHead`,
`listExperiences`, `listPromptVersions`, `listTrajectories` and `listSnapshots`.
Queries default to 1,000 records and accept an explicit limit up to 10,000.

Writes take `{scope, mode}` authority. Learning records can be written only in
`learn`; `evaluate` and `infer` may persist operational trajectories but refuse
learning writes with `THERA1004`. `assertTaskSplit(task, mode)` also refuses a
held-out or unlabelled task offered to learning. The task adapter owns its split;
a model cannot grant itself write authority.

Named `putAgent`, `putPromptVersion` and the other puts are immutable: identical
bytes are a no-op and conflicting bytes return `THERA1002`. Stage prompt and
snapshot candidates before activation. `planPromptActivation`,
`planSnapshotActivation` and `planLibraryActivation` produce plans for
`transitionHead`. Every transition delegates to the existing outcome head fence,
comparing both version and revision. An A → B → A sequence cannot revive an old
token. Lost fences return `THERA1006`.

`transaction(authority, async view => ...)` groups domain writes and transitions.
A refusal or exception rolls back the entire transaction, even when the callback
catches a content refusal. Unexpected host errors propagate. `counters()` reports
committed learning writes and refused write attempts for measurement.

## Frozen query groups

`createHeraGroupRunner(host).run({task, snapshot, mode, groupIndex, budget,
groupConcurrency})` profiles the query, selects the pinned experience library,
proposes `snapshot.config.groupSize` plans, and executes the valid distinct
candidates through the same MAS executor. The host additionally supplies
`controlClientFor(profile, identity, stage)`; it resolves the same CONFIG model
and decoder as the roles. The authored plan-generation artifact has separate
closed profile and plan output phases. Neither receives gold or split metadata.

`selectExperiences` uses snapshot weights, profile cosine similarity, empirical
utility, insight-vector novelty and repeated-selection penalties. Ties use
ascending immutable ids. Experience records retain `insightEmbedding` under
their profile's embedding identity. Frozen membership remains usable after
later versions archive it; selection writes no counters.

`validateHeraTopology` checks invocation identities, frozen prompts, tool grants,
experience application, acyclicity, one concluding terminal and structural
caps. `toMasWorkflow` lowers valid plans with ordered fan-in. Structured output
may repair a proposal once. Invalid survivors retain their raw proposal and
issues; duplicate proposals spend generation calls but never execute twice.

The group caps also bound profiling and proposal generation. After control
spend, candidates receive equal integer shares of the remaining budget, lowered
again to CONFIG and runtime limits. Calls, charged tokens and elapsed time are
retained separately from structural ceilings. Token reservations retain the
shared runtime's possible final-call overshoot; reported provider parts,
estimated charges and requests with unknown usage remain separate measurements.
The prepared group and its shares are persisted before any candidate executes;
restarting cannot change a workflow identity by recalculating elapsed time.

`hera_operations` stores immutable dispatch and response receipts for control
requests and profile embeddings. A completed receipt replays at zero new spend.
A dispatch without a response is explicitly uncertain (`THERA1007`) and is
never automatically purchased again. Remote embedding requests have their own
count and unknown usage; the injected builtin embedder performs no provider
request. Failed candidate executions remain counted group values.

Groups retain task-first ranking, null-score inference candidates and their
mixed-outcome gate. Evaluator score precedes provider tokens and then id; this
is an evaluated selection, not an oracle available to unlabelled inference.
`evaluate` and `infer` write only execution evidence. Group `learn` requires a
training task with a declared evaluator and label or outcome address. The group
runner retains execution evidence; the learner below commits learning updates.

## Experience learning

`createHeraLearner(host).run(request)` accepts the same group request in `learn`
mode. Enable `snapshot.config.flags.experience` to update the library. Reflection
runs only for a same-query group containing an evaluated success and failure.
`validateSemanticAdvantage` checks every cited trajectory, step and failed
invocation; the shared structured-output owner permits one repair. Prompt views
retain identifiers and visibly truncate large invocation payloads. Stored profile
and insight vectors are used by selection and excluded from control prompts.

`recordApplications` creates immutable versions from explicit topology
applications: each evaluated application increments use count and each success
increments success count. Offering increments selection exposure once per
evaluated group and cannot increase utility. Utility is the success/use ratio,
zero before any use. All-success and all-failure groups still update these
counters, but create no advantage or content-consolidation proposal.

`proposeConsolidation` offers the nearest `selectorCap` active versions by
profile similarity. Its repair loop and `applyConsolidationPlan` share one
admission gate. ADD starts at zero counts; MERGE archives parents and inherits
their exact sums while refusing overlapping ancestry; KEEP changes nothing.
PRUNE archives a lower-utility target only with a source-backed conflicting
sibling admitted by `host.consolidationPolicy`. This optional, versioned host
policy returns exact target and insight ids with a reason; its absence admits
no contradictions. A model cannot manufacture that authority.

The learner uses the original group's remaining calls, tokens and time unless
the request explicitly supplies `learningBudget`. This separate refinement
allowance is lowered to CONFIG caps and reported alongside rollout limits. Every reflection, consolidation and insight embedding has
a durable receipt. It persists its prepared proposal before committing the
advantage, utility versions, library membership and staged snapshot in one
transaction. `planHeraLibraryTransition` and `activateSnapshot` use both head
versions and revisions. A losing learner records `THERA1006` operationally and
commits no learning changes. Completed learning replays without new purchases,
including after SQLite reopen or later snapshot activation.

Learning stage operations are append-only. The returned group view composes
their ids with the original rollout group's ids; it does not rewrite completed
execution evidence. `topology.mutate` remains disabled; enabling its flag
currently refuses `THERA1008`. Refused training requests
record operational `refusedLearningWrites` counters, separate from the store's
counts of attempted forbidden writes. Evaluations pinned to old snapshots keep
reading their exact archived membership.

## Role prompt evolution

Enable `snapshot.config.flags.rope` to retain immutable failure-buffer versions
and run a bounded prompt trial. This also enables mixed-group reflection when
experience learning is disabled. Only evaluated failed invocations enter a
role's buffer; `failureBufferSize` drops the oldest entries. Snapshot
`failureBufferIds` pins their exact versions without changing immutable agents.

One newly credited role is selected per group in ascending role-id order.
The group index selects an enabled axis: `efficiency`, `thoroughness`,
`risk-sensitivity`, `error-correction`, or `heuristic-injection`. The structured
proposal must cite retained buffer trajectories for every operational rule and
behavioral principle. A second contrast phase cites the actual control and
replay trajectories while preserving the tested text and categories. Candidate
metadata keeps its original failure provenance and `proposalOperationId`; the
trial binds the measured replay back to that immutable candidate, avoiding a
circular content hash or invented future evidence id.

`runHeraPromptTrial` reuses a control only when its complete task, snapshot,
topology, model/decoder, evidence-provider and workflow limits match. Otherwise
it purchases a full control. `promptTrial` on the existing executor substitutes
exactly one role's retained candidate in the complete topology; other roles and
the frozen evidence slice remain pinned. The semantic execution key includes
the candidate, control and proposal receipt. Failed or incomplete evaluations
retain MAS run ids and costs without activating anything. Restart restores
proposal, contrast and whole-run charges without purchasing them again.

`integratePrompt` is one consumer of Jaren's guarded refiner and JSON Patch.
Only the operational and behavioral blocks can change. It checks source-backed
categories, rule/byte/operation bounds, normalized duplicates, registered
negation pairs, exact-negation conflicts, immutable tools and the byte-exact
role-instruction prefix. Activation requires a higher paired task score, or an
equal score with fewer known provider tokens. A model's claim of improvement
cannot authorize activation. The contradiction check is a declared lexical
policy, not an unmeasured semantic classifier.

Failure buffers, trial decisions, candidate versions, prompt heads, experience
changes and the next snapshot commit in one fenced transaction. Rejected
candidates remain inspectable. `rollbackPromptVersion` restores an archived
version and derives a new snapshot under the same version/revision fences;
old snapshots keep their original pins. No domain learning records are written
before the final transaction, so a competing loser retains only operational
evidence and purchases.

## Building and checking

`npm run emit:hera` composes the HERA definitions with GMPL's evidence schema and
emits the public contract and TypeScript declarations. `npm run hera:artifacts`
compiles thirteen TOML packs; both commands accept `--check`. Runtime consumers
read the resulting JSON. The single-trajectory reflection file is debugging
prose outside the catalog and has no learning authority.

`npm run test:hera` covers the schema, artifacts, registry, activation, modes and
instrument. The same lifecycle runs in memory, SQLite memory and a reopened
SQLite file; injected failures prove activation rollback.
