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
