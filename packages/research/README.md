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

Failures are values: pure operations return `{ valid: false, issues }`, store
operations return `{ ok: false, issue }`. `RESEARCH_ERRORS` defines `TRSH1001`–
`TRSH1010`; adapter failures retain the underlying code, path and detail.
