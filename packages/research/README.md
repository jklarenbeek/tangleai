# @tangleai/research

Closed research records, content-addressed artifacts and atomic lifecycle storage.
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
state or a reused MAS path/ordinal refuses `TRSH1004`. Cumulative spend cannot
exceed the project's budget. `collectUnreferenced(projectId, before)` reports
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
Native subgraphs host three bounded loops: refinement uses `attemptCap`, pivot
uses `pivotCap`, and quality review uses `reviewCap`. A requested repetition at
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
who reviewed the artifacts. The initial scripted host supports approve, Stop
and bounded quality rejection to write. Edit, guide and targeted rejection
requests refuse until their guarded capabilities are bound.

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
