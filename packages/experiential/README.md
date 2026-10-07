# @tangleai/experiential

Closed, credential-free records for experiences, assessments, datasets, training
runs, parameter artifacts and their approval lineage. Validation is synchronous,
returns coded issue values and gives callers a detached, frozen document.

`validateExperientialRecord(kind, value)` checks a record's shape. A valid shape
does not establish identity, provenance, eligibility or permission to activate.
The root import performs no I/O. Training and activation are experimental and
off; these contracts make no model-quality or learning claim.

Context consolidation in `@tangleai/memory/consolidation` produces external
evidence and context artifacts. Experiential consolidation prepares and evaluates
versioned parameter artifacts through an injected trainer. Neither compacted
text nor the fake backend's JSON bytes count as learned model parameters.

`sealExperientialRecord` snapshots and validates finite JSON, then derives its
address with the native canonical SHA-256 owner. `checkExperientialRecord`
rechecks that address on reads. Local observation timestamps and lifecycle state
do not change an input identity; an ordinary re-put must still match every
retained byte. Dataset identities include the exact assessment IDs so a later
review cannot rewrite the provenance of an existing dataset.

`createExperientialMemoryStore({ now })` and the store package's
`createExperientialDbStore(db, { now })` execute the same checks through one
atomic transaction seam. Explicit commands enforce the experience, training,
evaluation and artifact state edges. Activation and rollback require a matching
approval, evaluation and native outcome compare-and-swap head; the head and its
event publish with the artifact transitions. A replay returns the original
result without writes. An artifact can be active in one profile at a time;
rollback requires that profile's retained activation history. Published write
and activation counters exclude rolled-back transactions.

Evaluation registrations freeze the policy, dataset, baseline, evaluator,
question-set identity, sample count and expected deployment head before a run.
The synthetic persistence fixture supplies explicit recorded-value conformance
observations; it does not train a model, establish a scientific learning result
or authorize a production deployment.
Ordinary deployment admission registers an inactive base. Serving changes and
new inference pins use checked commands. The raw persistence adapter is a
trusted extension, not a public approval or evaluation authority.

`createExperientialDeployment` binds one named profile and scope to a registered
base artifact, the effective chat role's `{ provider, base, model }` digest, and
operational limits. Its stable address survives promotions. `revision` fences
every deployment change; `headRevision` records the active artifact head's
revision. A canary changes the deployment revision without moving that head.
Both fences use the native outcomes head comparison and preserve `OUTC1013`
as the cause of `TEXP1007`. Reads recheck the role digest, and stored serving
state must reproduce its transition event.

`planExperientialActivation` accepts `canary` and `activate` approvals bound to
the exact evaluation, head, deployment revision and canary fraction. Canary
admission requires an empty slot and an approved artifact. Full activation
archives the prior active artifact, clears the canary, and atomically publishes
the deployment, head and event. An old approval cannot survive an A→B→A
restore because the revision has advanced. Replaying an applied plan returns
its original result without changing newer state.

`canaryShareOf(deploymentId, runId)` maps the first 13 hex digits of the native
canonical hash to `[0, 1)`. `routesToCanary` uses a strict comparison with the
registered fraction and reads no clock or randomness. The fixed 10,000-run
conformance test routes exactly 2,469 at a 25% share and reproduces the complete
assignment digest on its second pass.

`resolveExperientialInference` consumes the native registry, profile request
and host manifest, the deployment and artifact inventory, a host capability,
run ID and observation time. Configuration refusals retain their `TCFG` causes.
A moved base profile, missing artifact, wrong serving state or incompatible
runtime refuses. The result keeps the base configuration identity beside an
artifact pin containing the served model and deployment revision. An
inference-only binding reports `capability.trainable: false` and serves a base
deployment with a null artifact ID; it cannot silently serve a learned one.

`store.pin` rechecks the current deployment and deterministic assignment in one
transaction. It refuses a second pin for a run ID, including across scopes,
and refuses a stale deployment revision. Promotion and rollback leave retained
pins unchanged. `startExperientialInference` composes the host's native identity
repository and run log: persist the identity, obtain the run ID, persist the
pin, then construct `binding.clientFor(pin, identity)`. The binding uses
`pin.servedModel`. A refused identity or pin never reaches client construction.
The host owns call execution and final run settlement, including failures after
a run has been created.

`planExperientialRollback` requires the exact prior active or archived artifact,
its retained passing evaluation, an approval bound to the current revisions,
and the same nonempty reason carried by that approval. The transaction restores
that artifact, archives the failed artifact, and retains every record. A
deployment without a prior approved artifact has no such rollback target.
`await planAutomaticRollback(deployment, observedWindow)` first verifies the
registered deployment identity. An incomplete window returns no advice; an
exact window returns a rollback intent only strictly above a registered
failure-rate or p95 limit. The intent grants no authority: the host must retain
an appropriate policy approval before applying the checked rollback plan.

The [keyless walkthrough](../../examples/experiential.ts) runs with
`node examples/experiential.ts` or `node examples/experiential.ts --sqlite`.
It uses the native job runner, fake JSON artifacts and explicitly synthetic
recorded-value conformance observations, then pins 1,000 synthetic run IDs,
promotes a canary and restores its approved synthetic predecessor. These
observations are separate from CGT's measured ties and failed gates; the example
does not establish learning or scientific approval. No desktop setting or
configuration schema is changed by these APIs.

`resolveExperientialLineage(store, artifactId)` follows retained artifacts,
training inputs, datasets, pinned assessments and selected experiences through
their source references and producing identity IDs. A broken retained link is
`TEXP1004` with its path. External reference bytes are explicitly
`not-resolved`: a digest reference alone does not prove that its source bytes or
configuration record were fetched and checked.

`planExperientialSelection` consumes a hashed closed policy, content-addressed
experiences and assessments, and explicit host-resolved sources, producers and
selection approvals. It is a pure asynchronous plan; it performs no requests or
storage writes. Each refused experience retains one stable exclusion reason.
An operator or policy principal must approve the exact assessment, experience
and policy. Deployment approvals and model-authored inclusion labels confer no
selection authority. The host supplies these trusted views after authorization;
they must never be copied from a model response as assertions of authority.

Raw retrieved material and inherited taint remain visible. An independent
verified outcome must support the same content and come from a distinct
producer before it can qualify a lesson. Private or cross-scope evidence stays
excluded. Changing prose, relabelling a source or removing its producer binding
cannot grant trust. Negative outcomes remain observed outcomes; the selector
does not silently impose a positive-reward threshold.

`planExperientialDataset` deduplicates through the selection plan, preserves the
original episode and duplicate relationships, assigns compositional holdout
groups first, and draws validation and replay groups with the native seeded
random owner. Removing a duplicate cannot sever its episode relationships.
Datasets retain the exact grouping experience and assessment IDs, selection
authority, concepts, external evaluation references and count census. Store
admission rechecks the manifest, approval and family partitioning. Historical
structural records can still be inspected; newly admitted datasets require the
complete evidence and grouping bindings.

External novel and retention questions are evaluation references, never
invented observed experiences or training examples. The CGT adapter reads only
the requested observed sessions and keeps withheld question identities and
digests separately. It does not approve its own output for selection.

`renderExperientialExamples` runs the pinned native JTLT stylesheet only after
the dataset's splits are frozen. It checks the selected content digests and
renders only the exact train and validation members to closed message/answer
objects. Substituted text is literal data and is never compiled again. Template,
tokenizer and chat-template revisions bind the manifest; changing a template
changes the dataset identity without drawing new splits. These mechanisms make
no training, transfer or model-quality claim.

`TrainingBackend` is the injected asynchronous capability, submission, inspection,
cancellation and materialization seam. Its closed `TrainingSpec` binds the exact
dataset manifest, base artifact and checksum, method, hyperparameters, seed,
precision, tokenizer, chat template and resource ceilings. `trainingSpecDigest`
hashes a detached validated snapshot. `checkTrainingCapabilities` refuses an
inference-only service or a method, base or artifact kind it did not advertise.
Capability transport failures must remain failures, not inferred capability
answers. A backend receives no store or activation authority.

`verifyArtifactReceipt` checks the receipt against that exact spec and backend
job, the host's configured inference provider and endpoint, and its byte bound.
The host supplies a bounded byte reader and enforces its allowed artifact
origins; this package never selects a network destination or supplies credentials.
The verifier independently hashes the exact returned bytes and checks their
size. A mismatch or unreadable artifact is `TEXP1008`; backend error text is not
copied into a refusal. The returned verification describes retained artifact
bytes and ancestry, and establishes no quality or activation claim.

`createFakeTrainingBackend` supplies deterministic conformance jobs. Inspection
advances through the configured state steps; failure, cancellation and checksum
corruption remain explicit outcomes. Its artifact is canonical
`tangle-fake-adapter/1` JSON, not trained weights. The injected clock is the only
clock it reads. Identical concurrent submissions retain one provider job.

`planExperientialTraining` binds a managed run to its complete specification,
dataset, base, backend and inference runtime. The specification digest is its
job idempotency key. Managed runs retain a closed progress record with dispatch
reservations, consumed poll credits, observations, receipt verification and
artifact identity. `store.training` rederives each declared command against a
fresh progress revision inside its transaction. Generic lifecycle transitions
cannot complete managed training, and ordinary artifact admission cannot
substitute another receipt for the artifact registered by that run.

`EXPERIENTIAL_TRAINING_DAG` declares seven versioned checkpoint nodes:
select, render, submit, poll, materialize, verify and register.
`createExperientialTrainingTasks` injects the store, backend, clock, randomness,
sleep, host budgets, example resolver and bounded byte reader. Selection
rechecks capabilities and ancestry. Rendering rechecks the retained dataset,
example content and pinned JTLT stylesheet. Preparation time counts toward the
wall budget; record, byte, poll and reported spend limits remain explicit.
Unknown spend fails a configured monetary ceiling.

`@tangleai/store/experiential-jobs` exports `enqueueExperientialTraining` and
`createExperientialTrainingRunner`. The latter composes the native DAG job
runner, with the current worker lease checked in each domain transaction.
Hosts explicitly start and stop the returned worker. A nonterminal inspection
uses the injected native backoff calculation and sleep, then yields to another
native job attempt. Each inspection reserves one durable credit before
dispatch. Restarting or increasing worker retries cannot replenish those
credits. Native checkpoint identity refuses changed workflow, input or task
versions before loading prior node values.

Submission is reserved before calling the backend. An interrupted or ambiguous
submission is retained as reserved or unknown; a later attempt cannot submit
again. Without an injected `reconcileSubmission` lookup, the native worker
pauses that job as cancelled while the training run retains its uncertainty.
After the host supplies that lookup, an explicit native job requeue can resume
the original submission. A lookup must never create a provider job.

Receipt verification recomputes the bytes independently. Only a result produced
by that verifier can authorize the durable verification command; copying or
inventing a verification-shaped object confers no authority. Registration
atomically stages the verified artifact and completes its run. Cancellation
first records a local terminal state, then requests backend cancellation and
reports a refused or unknown remote result separately. A late response from a
cancelled or superseded attempt cannot stage an artifact. No pipeline command
activates an artifact or establishes a model-quality improvement.

The HTTP training backend speaks the [committed service protocol](docs/TRAINING_SERVICE.md)
over injected fetch, clock and credentials. It retains fixed submission keys,
counts transport failures, honors server backoff and independently verifies
bounded artifact downloads. Inference-only providers refuse before submission;
unknown cost does not satisfy a finite budget. Native contracts, retry arithmetic
and the shared document response reader own the transport primitives. The host
owns its trainer, durable service ledger, network policy and inference endpoint.
The CGT `--live --train` command renders a frozen, credential-free plan with zero
requests; live training and learned quality remain unmeasured.

`planExperientialEvaluation` creates a detached registration and moves a staged
learned artifact to `evaluating`. The policy and dataset must already exist when
`store.startEvaluation(plan)` commits the registration and event atomically.
`reviseGatePolicy` uses the native guarded refiner to validate and publish a new
immutable policy; an existing registration keeps its original policy identity.

`evaluateExperientialGates` compares recorded observations only. Both registered
paired-bootstrap lower bounds must strictly exceed zero. All five rows, four
retention lanes, registered security fixtures and bounded operational values
are required. A missing, failed or unmeasured required value cannot pass. The
instrument owns statistical computation; the package never recalculates a
mean or bootstrap interval while deciding eligibility.

`createExperientialEvaluation` binds those observations to the registration,
fills missing required rows with explicit `not-run` results and seals the
decision. `recordExperientialEvaluation` checks the retained bindings, receipt
and decision and returns a pure result plan. `store.recordEvaluation(record)`
rechecks and atomically writes the evaluation, artifact state and event. Failed
gates remain retained as `rejected`, with `TEXP1010` issues. Passing records
yield `approved`; **approved is not active**. Generic record writes or artifact
transition plans cannot bypass these commands. A migration experiment may
compare different base identities but can never approve a candidate.

The [CGT report](../../docs/CGT_BENCHMARK.md) publishes five scripted candidate
evaluations. Its rule follower ties the perfect frozen rule control, and both
required LoCoMo chat regression lanes remain `not-run`. Every scripted candidate
therefore remains rejected. `benchmark:cgt -- --require gates --check` verifies
registered mechanism measurements and report reproduction; it makes no claim
of learned quality, trained weights or deployment approval. Fixture cost and
injected-clock observations are labelled separately from model performance.

`createExperientialRunner({ store, jobs, backend, recipe, policy, now, sleep })`
admits explicit `manual`, `count`, `time` and `outcome` ticks through the native
scheduler. The default policy is disabled and performs no persistence or queue
operation. Hosts bind `jobs.enqueue` to `enqueueExperientialTraining(db, plan)`
and explicitly run the native training worker. There is no import-time worker
or polling timer. `close()` drains active admission and rejects queued ticks.

The closed, hashed trigger policy bounds cadence, completion cooldown, daily
run and spend reservations, pending jobs and scheduler concurrency. Count ticks
require enough independently approved experiences; time ticks use retained
completion timing; outcome ticks name the exact approved independent source.
Manual ticks bypass count and time thresholds while retaining approval, cadence,
cooldown, budget and queue checks. Invalid or regressed clocks yield a counted
`clock-skew` with `TEXP1009`. `stats().byReason` separates every no-op reason.

Admission and cancellation are atomic domain transactions. A failed native
enqueue leaves a durable reservation: replaying its trigger resumes the same
job without another budget purchase. Cancelled or rebased reservations remain
counted if that enqueue fails; `enqueued` counts only successful queue bindings.
Daily run limits count retained reservations. Spend limits conservatively use
the larger reserved or reported cost; unknown spend cannot satisfy a finite
ceiling. Completed timing survives a runner restart. Replaying an admitted
trigger returns its original job and does not write another domain record.

A moved deployment head, including a changed revision after returning to the
same artifact, fences queued and preparing runs before submission. The policy
either cancels the stale run or reserves a new run against the actual active
parent. Durable events retain both actions. A trigger never approves a dataset,
writes an activation approval or moves a deployment head. Foreground memory
operations and document ingestion remain independent of a blocked trainer.

Run `node examples/experiential.ts --tick` or
`bun examples/experiential.ts --tick` for a keyless SQLite walkthrough; use
`--database <path>` to retain its database. The fake worker completes one job.
The manual/count/time demonstration and its repeated cycle report one enqueue,
five replays and two no-ops, zero new jobs on replay, zero approvals and an
unchanged deployment head. The artifact remains staged. These are conformance
counts, not learning or latency measurements.

`sealExperientialRetentionPolicy` registers a reason, principal, evidence,
rollback window and holds. `planExperientialRetention` checks the complete
retained census and returns `keep` or `archive` decisions.
`store.retain(plan)` rechecks the current census and atomically publishes the
decision, archival state and audit event. A replay changes nothing. Deletion
is refused with `TEXP1012`; so is archival that touches serving or evaluation
lineage, an open rollback window, a hold on any alias of the episode, or sole
provenance for a checked rule. Archived experiences keep their identities and
source references, remain resolvable through artifact lineage, and are excluded
from future selection. Generic writes cannot bypass the retention command.

## Read-only inspection

`createExperientialOperations(store)` returns a frozen native local contract
client with `invoke`, `describe`, `contract` and asynchronous `close`. Every
operation reads one atomic `store.snapshot(scope)` over the retained tables;
lineage and history therefore come from the same transaction. The host must
authorize the requested scope before dispatch. Scope selection is not caller
authentication. Closing the client leaves the host's store and database open.

| Operation | Required input beyond `scope` | Result |
|---|---|---|
| `experiential.lineage` | `artifactId` | Artifact ancestry, runs, datasets, assessments, experiences and source references |
| `experiential.experiences` | `state` (a state or `null`) | Matching experiences and their assessments |
| `experiential.datasets` | — | Dataset manifests, split members and exclusion counts |
| `experiential.trainingruns` | — | Run state, budgets, accounting and separately retained log digests |
| `experiential.artifacts` | — | Checksums, ancestry, runtime and lifecycle state |
| `experiential.evaluations` | — | Registered controls, candidate metrics, intervals and gate failures |
| `experiential.deployments` | — | Deployments, active heads and canary/activation/rollback event history |
| `experiential.retention` | `preview` (`null` or `{ episodeIds, deploymentId, now, policy }`) | Recorded decisions and events, plus an optional pure plan or coded refusal |

The contract has no mutation or subscription operation. It checks closed inputs
before touching storage and bounds inspection to 4,096 rows per table. A refused
retention preview identifies the dependency and never archives an experience.
Host-applied lifecycle plans remain the only activation and rollback path.

```ts
const operations = createExperientialOperations(store);
try {
  const result = await operations.invoke('experiential.artifacts', { scope });
  if (result.ok && result.value.ok) console.log(result.value.value);
} finally {
  await operations.close();
}
```

Outputs are detached, frozen inspection views. The shared redactor omits
secret-shaped members, storage locations, free-form log and metrics references,
log bodies and event detail; runtime endpoint views remove user information,
query and fragment. Training log digests remain available without their raw
references. Native coded persistence failures retain their machine code in
`cause` through inspection, lineage, inference startup, artifact byte reads,
policy revision and job scheduling; raw diagnostic messages and locations
remain private. Wrapping a refusal retains its original
cause within the closed issue schema. These projections preserve retained
record IDs but are not complete
records and must not be submitted as write plans. Their shapes are derived from
the same closed record schema and published as
`@tangleai/experiential/schemas/contract`. `createExperientialContract` and
`createExperientialHandlers` support host-owned native dispatch.

## What the measurement establishes

The [CGT instrument](../../docs/CGT_BENCHMARK.md) publishes each registered
learning, retention, security, operations and rollback condition. Its scientific
claim is `not-run`: scripted candidates cannot satisfy an authorized live claim,
the perfect rule control leaves no positive improvement interval for a tie, and
required unrun retention lanes fail closed. The separate scripted rollback
receipt executes the native example with 32 pins; the installed Node and Bun
consumer walkthroughs retain the full 1,000-pin test. Fake artifacts and recorded
synthetic evaluation values establish lifecycle conformance, not learning.
