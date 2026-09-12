# Outcome adapter kit

`@tangleai/outcomes` records decisions, independently resolved outcomes, scores,
projections, proposals, evaluations and explicit approvals. Hosts invoke these
stages; the package installs no worker, scheduler or domain integration.

Start with `node examples/outcomes.ts` in the repository. It runs both reference
adapters without keys or network access. `node examples/outcomes.ts --db
/tmp/outcomes.sqlite` uses the store adapter; repeating the command returns the
same immutable ids with zero new writes or resolver calls. It stages a root and
child in each domain, checks both, promotes both, then separately approves a
rollback to the root. Times, request keys and fixtures are fixed for replay.

## Register a domain and evidence authority

An `OutcomeAdapter` supplies four closed JSON schemas (input, decision output,
resolution and artifact), a schema/scorer revision identity, a static payload,
a pure `interpret(input, payload)`, a pure `score(output, resolution)`, and
semantic `validatePayload`. Optional normalization runs before artifact hashing.
Schema digests and the complete adapter identity are checked at construction.
Register immutable adapters; do not change their functions behind a revision.
No submitted scorer program or submitted success/eligibility flag runs as code.

The reference factories live at `@tangleai/outcomes/adapters/direction-delta`
and `@tangleai/outcomes/adapters/exact-match`; their schemas have corresponding
`./schemas/…` exports. Direction/delta requires finite `predicted` and `actual`
numbers: equal sign and absolute error strictly below 0.05 is success; equal
sign outside that tolerance is partial; different sign is failure. Zero has the
nonnegative sign. Missing values never become zero. An offset artifact interprets
`{base}` as `{predicted: base + offset}`, refusing non-finite results.
Exact match compares case-sensitive labels. Its artifact has a fallback label
and up to 16 unique prefix rules; the longest Unicode-code-point prefix wins.
Normalization gives a stable rule ordering. No fuzzy match or label coercion
changes a verdict. Utility is always success 1, partial 0.5, failure 0.

Inject a trusted `EvidenceResolver` with a revision and `resolve(reference,
scope)`. Wire commands carry only `{sourceId,digest}`. The resolver returns the
retained `Source`: source id, decision id, scope id, subject, issuer, observed
time, payload and digest. The digest is the canonical revision of all those
fields except `digest`. Verify origin in your resolver before returning it.
The service checks the requested digest, decision/scope/subject binding,
chronology and domain schema and retains the exact snapshot. Decision evidence
must name that decision; held-out and reconciliation evidence uses
`decisionId:null`. A hash proves byte agreement, not external truth or authority.
Arrival may be late; observed time must still follow decision time. One accepted
resolution per decision is immutable in v1; source corrections need a separate
future policy. At most 16 references and 32,768 combined snapshot bytes are read.

## Bind the host before handling JSON

Construct `createOutcomeService({store, scope, adapters, resolver,
authorizeMemoryIds, ...})`. The closed scope is `{namespace,domain,subject}`.
Every operation compares its `scopeId` with that host binding, including reads
and replay. An id alone grants no access. `authorizeMemoryIds` returns an allowed
boolean and immutable authorization revision for the sorted unique citations.
Keep namespace-to-memory access enforcement in this host callback.

Omitting `principal` denies both approval and reconciliation:

```ts
const service = await createOutcomeService({
  store, scope, adapters: [adapter], resolver,
  authorizeMemoryIds: async ids => ({
    allowed: ids.every(id => authorizedIds.has(id)),
    authorizationId,
  }),
});
const handlers = createOutcomeHandlers({
  resolveHost: () => ({ service, allowScope: id => id === service.scopeId }),
});
```

For a trusted review service, supply an immutable principal with `id`,
`authorityId` (a revision), `approve:true` and the explicitly granted
`reconcile` capability. Never derive those booleans from request JSON or model
text. HTTP hosts use their existing authentication to resolve `ctx.host` to a
service and `allowScope` policy. Local clients have no custom host context;
bind the host in the handler-factory closure. `OUTCOME_MODEL_OPERATIONS` excludes
approve and reconcile. A model's service must also omit those capabilities;
manually invoking their names then returns OUTC1012. Filtering a tool list alone
is not an authorization boundary.

`createOutcomeContract()` and `createOutcomeHandlers()` are exported from the
root and `./contract`. `./schemas/contract` exports the generated portable
contract. Each `outcomes.*` operation maps to one direct service method; wire
`outcomes.inject` maps to `injectChecked`. Use Jaren local/HTTP bindings with
`validateOutput:'always'`. Malformed input is JC2050 and broken handler/output
is JC2070; a valid domain refusal remains `{ok:false,issues:[…]}` with OUTC
codes. Transport idempotency is explicitly `none`. Durable request receipts,
not a local client's annotation, implement business replay.

## Stage and resolve a decision

Every mutation takes `{scopeId,artifactKey,requestKey,at,input}`; reads omit the
key and time. Times are normalized UTC strings with milliseconds. A request key
is unique across operations within a scope and binds the entire canonical
command, including time. Keep the same command to retry it. Completed exact
replay returns its original value with `replayed:true,writes:0`; changed command
bytes under that key fail OUTC1007. A new key repeating an already unique stage
also fails OUTC1007 and may append its first refusal receipt.

Call `create` with the decision-time input/output, pinned adapter and static
payload, decision/cutoff/expected-resolution times, configuration, citations and
`usedVersionId` (null for static). It returns `decisionId`. Checked decisions
must reproduce their output from the current checked version. Deliver independent
evidence to `resolve({decisionId,evidence,receivedAt})`; its `resolutionId`
feeds `score({resolutionId})`. Score returns `scoreId` and
`projectionIntentId`. It never resolves pending decisions or accepts a verdict.

`project({scoreId})` returns `projectionReceiptId`, `applied`, `missing` and
`changedMemoryWrites`. The same atomic owner must store memories and receipts:
use `createMemoryOutcomeStore()` or `@tangleai/store`'s `createOutcomeStore(db)`.
An unrelated four-method memory store cannot acquire this guarantee. Projection
reads current confidence, applies shared arithmetic once per unique authorized
id, and commits the memory changes and receipt together. It preserves fact time,
text, evidence, embeddings and supersession fields. Missing memories are terminal
counted skips; later restoration does not reapply a completed score. Empty
citations complete with zero memory writes. The old memory `applyOutcome` remains
a plain helper with its original duplicate and timestamp behavior.

## Create, evolve, check, approve and restore

`reflect` consumes prior independent `scoreIds`, a configuration and citations
to those scores. Create mode requires a full root payload, null parent and no
patch. Evolve requires the current checked parent, null payload and bounded JSON
Patch operations. Jaren guarded refinement and JSON Patch are the generic engines.
A no-op child returns a reflection with `versionId:null`. Valid but semantically
ineligible proposals remain inactive, inspectable versions with issues.

Defaults are 10 retained payload versions per scope/artifact, 32,768 canonical
UTF-8 payload bytes, 32 patch operations, 32 changed leaf paths (union of before
and after leaves, including array indices), and 8,192 reflection UTF-8 bytes.
Version capacity is reserved before a model call. All valid staged, rejected and
checked versions count; audit receipts have no total storage cap. Change policy
or schema under a new artifact key rather than silently resetting a lineage.
These are conservative registered bounds, not measured optimal values.

The default proposer is the caller's explicitly scripted payload. Optional
`createStructuredOutcomeProposer` at `./proposer` consumes a registered resolved
configuration, injected fetch/key/clock/deadline, existing structured output,
replay and budget seams. It requires one HTTP attempt, zero repair calls, one
concurrent call, bounded output and at most 120 seconds per host deadline.
Only prior training evidence and parent payload go to the model. The core reads
no credentials or environment. Monetary cost is null when unavailable, not zero.
Do not reuse another campaign's spend authorization.

After freezing the candidate, the host's `evaluationSlot(slotId,versionId,scope)`
returns an independently registered `EvaluationSlot`. It binds candidate,
expected `{versionId,revision}`, training scores, evaluator and gate-policy
revisions, held-out cases/sources and request/cost ceilings. The service checks
these sources through the resolver and retains the registration before scoring.
Training and held-out ids and content digests must be disjoint. A candidate and
slot are each evaluated once; renamed/reused held-out content cannot become a
fresh slot. Registrations and proposal training are bounded to 128 cases/scores
and 262,144 canonical bytes.

`evaluate({versionId,slotId})` returns evaluation/case-report ids, eligibility and
issues. Eligibility requires complete nonempty paired coverage, no failures,
strictly positive mean utility over the registered baseline, no domain loss,
matching pinned revisions, semantic/size/churn gates and cost/request bounds.
Failed candidates remain visible. These fixture gates do not establish practical
improvement for your domain.

A trusted principal invokes `approve` with action, version/evaluation ids,
expected head pair and reason. Approval does not activate. `promote({approvalId})`
rereads all dependencies and compares both version and monotonic revision in one
transaction. The empty head is `{versionId:null,revision:0}`. Each real promotion
or rollback increments revision; replay does not. `injectChecked` validates the
full checked provenance and returns payload, head and version/evaluation/event
ids. It performs no learning or writes; absent heads return OUTC1004 so hosts
can explicitly use their static baseline.

Rollback requires a fresh action-specific approval for a previously checked and
active version in that artifact. Call `rollback({approvalId})`; all versions,
failed candidates and activation history survive. A→B→A changes revision and
invalidates approvals carrying A's old head pair. There is no unguarded setter.

## Inspect and recover

`inspect({id})` validates and returns the immutable typed record.
`includeLineage:true` returns `{record,lineage}` with at most maxVersions ancestors
for an artifact version; other kinds return an empty lineage. Missing records,
corrupt bytes/edges and cycles are refusals. Follow typed ids for other stages.
`history` defaults to 50 entries, caps page size at 200, and orders by per-scope
sequence then id. Its cursor binds scope/artifact/filter revision and fixed upper
sequence. Concurrent appends are outside subsequent pages of that snapshot.
Cursors are pagination state, not authorization credentials. SQLite applies
indexed scope/sequence predicates and SQL LIMIT; no whole collection is returned
for history. The reference in-memory implementation scans its finite maps.

Reservations append immutable audit events before external work. Lost reservation
acknowledgements are recovered without stranding the key. A trusted no-dispatch
proof can also reconcile an interrupted reservation and increments its attempt
generation to fence the old worker. Known rolled-back storage failures are explicitly retryable. Already committed
receipts recover lost acknowledgements. An external dispatch with unknown result
is OUTC1017 and cannot automatically redispatch. A host with reconciliation
capability supplies independent retained-output or no-dispatch proof binding
attempt id, attempt number, input digest and the recorded wire request digest.
Retained output resumes local staging; a proven no-dispatch result allows an
explicit retry. Reconciliation does not approve or activate a proposal. A
retryable or uncertain failure is not a completed result, and the service cannot
promise a durable diagnostic while its storage is unavailable.

## Consumer ownership

| Consumer | Downstream responsibility |
|---|---|
| Milkyway | Forecast checkpoints, note schema, observation feeds and source-correction policy |
| Trading | Realized return, fees, position/accounting identity and independent settlement evidence |
| Repository evolution | Patch sandbox, repository state, execution permissions and independent checks |
| Research | Evidence provenance, claim/state schema and resolution authority |
| Desktop | Input collection, authentication, principal mapping, review controls and UI |

None of these domain integrations ships in this kit. Reuse the lifecycle while
keeping their schemas, trusted sources and deployment policies in their hosts.
