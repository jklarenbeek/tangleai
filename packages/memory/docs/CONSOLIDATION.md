# Immutable consolidation storage

`@tangleai/memory/consolidation` stores exact source occurrences, immutable
artifacts, pending buffers and pass receipts. It is an explicit API: importing
it starts no work. The artifact store does not alter ordinary memory records.

```ts
import {
  createConsolidationSource, createConsolidationArtifact,
  createConsolidationMemoryStore, consolidationHash,
} from '@tangleai/memory/consolidation';

const store = createConsolidationMemoryStore();
const source = await createConsolidationSource({
  scope: 'project', key: 'conversation-1/turn-3', sequence: 2,
  snapshot: {
    id: 'memory-17', text: 'Sam meets Alex in Paris.',
    evidence: 'Conversation 1, turn 3', tags: ['travel'],
    kind: 'event', at: '2023-05-08T13:56:00Z',
  },
});
if (source.status === 'refused') throw new Error(source.detail);
const admission = await store.enqueue([source.value], { maxPending: 100 });
if (admission.status === 'refused') throw new Error(admission.detail);
const recipeHash = await consolidationHash({ method: 'host-extractive-v1' });
const artifact = await createConsolidationArtifact({
  scope: 'project', tier: 'deterministic', recipeHash,
  text: source.value.snapshot.text, sourceIds: [source.value.id], keywords: ['paris'],
});
if (artifact.status === 'refused') throw new Error(artifact.detail);
const receipt = await store.apply({
  scope: 'project', key: 'explicit-pass',
  expectedGeneration: admission.value.buffer.generation,
  sourceIds: [source.value.id], recipeHash,
  artifacts: [artifact.value], completedAt: 1000,
});
```

The recipe hash binds the actual recipe and parameters to the artifact. Production completion times are
injected epoch milliseconds. Sources keep the original memory timestamp;
consolidation does not infer when a fact became valid.

## Evidence and identity

A source hashes its scope, occurrence key, sequence and complete MemoryUnit
snapshot using Jaren canonical JSON and SHA-256. Two occurrences with equal
text remain distinct. Redelivery under the same occurrence key must match the
whole snapshot and sequence. The snapshot uses the existing memory schema,
including its evidence requirement and embedding identity pair. Nonfinite or
wrong-width vectors are refused. Returned values cannot mutate stored records.

An artifact hashes its scope, tier, recipe, text, ordered source references,
keywords and optional fresh embedding. Activation requires all selected sources
to be pending in the same scope. Artifact references must resolve to validated
source snapshots and cover the whole selected batch. Text or recipe changes
produce a different identity; an existing artifact is never overwritten.

These are provenance and transaction guarantees. A host-provided artifact can
still contain an unsupported statement: schema-valid source references do not
prove entailment. The low-level storage API trusts the caller's content judgment.
It does not invoke a model, verifier or embedder.

## Atomicity and replay

`enqueue(sources, { maxPending })` admits one scope's whole delivery or refuses
it. Capacity never drops an older source. Duplicate delivery admits and writes
zero. Successful activation writes artifacts, the buffer and the receipt in
one transaction, removes only the selected pending IDs, and retains all source
snapshots. Any persistence failure rolls back that entire transaction.

A buffer's `revision` advances on admission or activation; `generation` advances
only on activation. Additional evidence can enter the queue while an immutable
batch is prepared. An intervening activation invalidates a captured generation.
Competing adapters cannot both commit the same generation. Revision exhaustion
is a refusal, and completion time cannot regress behind the last activation.

A completed key is bound to its inputs and artifacts. Replaying that same pass
returns its receipt with `replayed: true`, zero writes, zero logical calls and
zero embedding items; the buffer revision is unchanged. Changing a completed
key's content is an identity conflict. The receipt's embedding-item count denotes
prepared artifact vectors; storage itself never calls an embedder.

## Durable operation records

`reserve`, `operation` and `update` expose an explicit operation ledger for a
host's fallible preparation. Reservation binds scope, key, source IDs, captured
generation, recipe, request hash and logical-call ceiling. Updates use revision
CAS. A new dispatch requires every previous result to be durably completed.
Completed steps and terminal operations are immutable. An unknown dispatch
cannot return to dispatched, and uncompleted steps prevent activation.

These primitives do not retry callbacks or determine whether a stopped host's
external request completed. The host must resolve uncertainty before preparing
another result. Arbitrary callbacks have logical-call counts; those counts do
not establish physical HTTP requests, model tokens or monetary cost.

## Persistence and bounds

For SQLite, pass `openTangleDb()` to `createConsolidationDbStore` from
`@tangleai/store` or `@tangleai/store/consolidation-store`. Both Node and Bun use
Jaren's transaction and driver owners. Additive collections preserve ordinary
memories. Close the database after outstanding operations finish.

`createConsolidationStoreAdapter` accepts a transactional persistence seam.
`createConsolidationMemoryPersistence` provides cloned export/import state and
uses Jaren's bounded scheduler for serialization. Its `close()` waits for admitted work and refuses queued or new work.
The default memory store needs no timers or external resources.

Pending capacity bounds source count, not total historical bytes. Source
snapshots and artifacts are retained; `snapshot(scope)` validates and reads the
whole scope. This API makes no large-corpus latency or bounded historical-storage
claim. A host controls input/output character limits when preparing artifacts.

Failures are returned as `status: 'refused'` with a reason and detail, including
invalid evidence, identity conflict, capacity, stale generation, persistence,
invalid operation, clock skew and exhausted revision. Inspect these outcomes;
failed admission or activation must not be counted as successful consolidation.

The [benchmark guide](../../../docs/CONSOLIDATE_BENCHMARK.md) records matched
source-delivery controls and actual storage qualification. Live synthesis quality
and cost remain unmeasured; no consolidation tier is enabled by default.
