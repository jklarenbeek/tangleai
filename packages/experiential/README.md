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
