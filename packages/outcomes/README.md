# @tangleai/outcomes

Immutable evidenced decisions, deterministic scores, atomic memory projection,
and explicitly approved domain artifacts. The host supplies scope, adapters,
evidence resolver and authority. The package discovers no credentials and runs
no scheduler.

## Public lifecycle

`await createOutcomeService(options)` returns `create`, `resolve`, `score`,
`project`, `reflect`, `evaluate`, `approve`, `promote`, `rollback`, `reconcile`,
`inspect`, `history` and `injectChecked`. Methods accept unknown JSON and return
`{ok:true,value,replayed,writes}` or `{ok:false,issues:[{code,path,detail,retryable}]}`.
Mutation envelopes carry `scopeId`, `artifactKey`, `requestKey`, normalized UTC
`at`, and operation-specific `input`. Reads omit requestKey and at. Closed
schemas and generated TypeScript contracts are exported at `./schemas/outcomes`
and `./contracts`.

- `create` records a pending decision, its exact input/output, cutoff and decision
  times, adapter/configuration revisions, cited memories and used artifact id or
  explicit static baseline. It returns `decisionId`.
- `resolve` accepts evidence references. A trusted resolver supplies immutable
  source bytes bound to decision id, scope, subject, issuer and observation time.
  Their digests and timestamps are checked before a bounded snapshot is retained.
  One resolution is accepted per decision; arrival lateness never rewrites the
  observed time. It returns `resolutionId`.
- `score` executes the pinned pure adapter and commits a score plus an authorized
  projection intent. It returns `scoreId` and `projectionIntentId`.
- `project` atomically applies confidence to sorted unique citations and writes a
  terminal receipt. It returns `projectionReceiptId`, `applied`, `missing` and
  `changedMemoryWrites`. Missing memories remain terminal skips; clamped unchanged
  confidence is processed but not written. Fact timestamps and every other field
  are preserved.
- `reflect` stages a root (`mode:create`) or a child of the captured checked head
  (`mode:evolve`). Roots supply a full payload; children use add/remove/replace/
  test JSON Patch over the payload alone. Jaren's guarded refiner and patch engine
  prepare detached candidates. Schema-valid candidates rejected by later semantic
  or churn gates remain inspectable; oversized malformed outputs retain bounded
  diagnostics. No-op children create no payload version.
- `evaluate` obtains a host-registered held-out slot only after reserving it.
  Candidate and paired baseline use identical cases and the registered scorer.
  Eligibility requires complete coverage, strict positive mean utility, no domain
  regression, valid bounds and registered call/cost limits. Case ids and content
  cannot overlap training or previously consumed holdouts. Returns `evaluationId`,
  `eligible`, `issues` and `caseReportId`.
- `approve` needs the construction-time host principal's approval capability.
  It binds action, candidate, evaluation, policy and the exact expected head.
  Request JSON cannot grant authority. `promote` consumes that approval and CASes
  both head version and revision. `rollback` requires a new action-specific
  approval for a previously checked and active version. Both return
  `activationEventId` and `head`; every real transition increments revision.
- `injectChecked` verifies the exact scope/artifact head and returns its payload,
  version, evaluation, activation and head references. It writes nothing. A
  missing head is OUTC1004, and corrupt provenance is refused.

A scope is the closed `{namespace,domain,subject}` object; `scopeIdOf` computes its
canonical SHA-256 identity. Artifact keys are explicit host choices. Changing
an established lineage's schema or bounds requires a new artifact key. Retained
versions and audit records are immutable, including inactive and rolled-back
versions.

## Durability and replay

`createMemoryOutcomeStore()` owns reference persistence and its `memories` view.
`@tangleai/store`'s `createOutcomeStore(db)` owns the same records and the existing
memories collection in one immediate Jaren transaction on Node or Bun SQLite.
`createOutcomeStoreAdapter` is a trusted atomic persistence extension, not a wire
write API. An unrelated ordinary MemoryStore cannot provide atomic receipts.

Within a scope, an accepted request key binds the operation and complete canonical
input, including supplied time. Exact completed replay returns its original
business result with zero writes/calls. Changed input conflicts. A new key for a
completed unique stage is OUTC1007, with an inspectable refusal receipt where
storage is available. Known rollback is explicitly retryable. Resolution remains
committed if scoring or projection fails. Lost acknowledgements reread stable
receipts; unavailable recovery reports OUTC1017 rather than guessing.

## Reference adapters and limits

`./adapters/direction-delta` exports `createDirectionDeltaAdapter`: `{base}` plus
`{offset}` predicts a finite number. Same sign and absolute error strictly below
0.05 is success; same sign otherwise is partial; different sign is failure. Zero
is nonnegative. Missing, non-finite and string numbers are refused.

`./adapters/exact-match` exports `createExactMatchAdapter`: a token selects the
longest case-sensitive prefix, or fallbackLabel. At most 16 unique nonblank
prefixes are sorted by descending Unicode code-point length then code-point
order. Exact case-sensitive label equality is success; otherwise failure. Common
utility is success=1, partial=0.5, failure=0.

Default policy bounds are 10 retained payload versions per scope/artifact,
32,768 canonical UTF-8 payload bytes, 32 patch operations, 32 changed leaf paths
and 8,192 UTF-8 reflection bytes. Empty containers and removed leaves count in
churn. Capacity is reserved before a model dispatch; nothing silently evicts
ancestry or rollback targets. Audit history is append-only and unbounded. Other
input bounds are 16 evidence references/32,768 combined snapshot bytes, 128
training scores or held-out cases, and 262,144 bytes per held-out registration or
model proposal context. These are conservative defaults, not measured optima.

## Optional model proposals

`./proposer` exports `createStructuredOutcomeProposer` and
`outcomeProposalComponents`. Register the exact prompt/response-schema revisions,
then inject profile-resolution input, a role, fetch, clock, deadline factory and
any credential/cache explicitly. The shipped config resolver, structured-output
client, wire replay key and budget account supply one HTTP attempt, zero repairs,
one concurrent call and a maximum 120-second deadline. A registered finite output
ceiling of at most 8,192 tokens is required. Only training data, parent payload,
domain schema and bounds reach the proposer; evaluation labels and authority do
not. The ordinary package entry does not import this provider adapter.

Dispatch and returned output are durably recorded before staging. Completed
replay never calls the provider. Uncertain dispatch retains capacity and requires
host-authorized `reconcile` with trusted retained-output or no-dispatch evidence.
Reconciliation cannot approve or activate an artifact. Missing monetary usage is
reported as unknown; a report hash is not a signature or authority credential.

The [measured fixture](../../docs/OUTCOME_BENCHMARK.md) separates static decisions,
checked scripted candidates, failed guards and unresolved outcomes. Its scripted
improvement does not establish autonomous or real-domain learning.

## Operations and adapter kit

`createOutcomeContract` and `createOutcomeHandlers` expose all 13 operations
through Jaren local/HTTP bindings. Use `validateOutput:'always'`; durable replay
is owned by the outcome service. Principals omitted at construction cannot
approve or reconcile. Scope access is checked before reads and replay.
`inspect({id,includeLineage:true})` gives a bounded ancestry view; `history` pages
50 records by default, at most 200, with a fixed upper sequence per cursor.

See [the adapter kit](docs/ADAPTERS.md) for schemas, trust wiring, gates, errors,
recovery and downstream ownership. Run `npm run outcomes:smoke` in the repository
or `node examples/outcomes.ts --db /tmp/outcomes.sqlite` for the persistent
two-domain walkthrough. `./schemas/contract` is the generated v1 wire document;
`./contract` exports the compiled factory and handlers.

Reservations are audited before host work. Lost reservation acknowledgement
recovers an explicit retry; a trusted no-dispatch proof can reconcile a stranded
reservation and fences its prior attempt. Histories retain these attempts even
before a terminal operation receipt exists. The reference store is browser
importable; SQLite remains in the separate store package and providers require
explicit host injection.
