# @tangleai/experiential

Closed, credential-free records for experiences, assessments, datasets, training
runs, parameter artifacts and their approval lineage. Validation is synchronous,
returns coded issue values and gives callers a detached, frozen document.

`validateExperientialRecord(kind, value)` checks a record's shape. A valid shape
does not establish identity, provenance, eligibility or permission to activate.
The root import performs no I/O. Training and activation are experimental and
off; these contracts make no model-quality or learning claim.

`sealExperientialRecord` snapshots and validates finite JSON, then derives its
address with the native canonical SHA-256 owner. `checkExperientialRecord`
rechecks that address on reads. Local observation timestamps and lifecycle state
do not change an input identity; an ordinary re-put must still match every
retained byte. Dataset identities include the exact assessment IDs so a later
review cannot rewrite the provenance of an existing dataset.

`createExperientialMemoryStore({ now })` and the store package's
`createExperientialDbStore(db, { now })` execute the same checks through one
atomic transaction seam. Explicit transition plans enforce the experience,
training and artifact state edges. Activation and rollback require a matching
approval, evaluation and native outcome compare-and-swap head; the head and its
event publish with the artifact transitions. A replay returns the original
result without writes. An artifact can be active in one profile at a time;
rollback requires that profile's retained activation history. Published write
and activation counters exclude rolled-back transactions.

The evaluation records are contract shells at this boundary. The synthetic
persistence fixture uses those shells to test transactions; it does not train a
model, establish a scientific gate result or authorize a production deployment.
Ordinary deployment and inference-pin admission currently supports registered
base models only. The raw persistence adapter is a trusted extension, not a
public approval or evaluation authority.

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
