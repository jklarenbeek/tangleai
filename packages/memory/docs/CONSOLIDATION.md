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

## Deterministic previews and lexical routing

`planDeterministicConsolidation(sources, options)` validates exact snapshots,
orders them by sequence then occurrence key, and returns an immutable artifact
plan. Adjacent topic similarity uses Jaren cosine on equal, known embedding
identities; otherwise it uses local term frequencies. Low local minima define
contiguous boundaries; small segments join a neighbor without reordering evidence.
No vector averaging, model call or implicit source deletion occurs.

The default opt-in plan accepts at most 10 sources and 8000 UTF-16 input
characters, including serialized source identity, evidence, date and tags. Each
preview is at most 512 characters with at most eight keywords; the topic threshold
is 0.2 and minimum segment size is two. Options can change these explicit bounds.
Input overflow refuses the whole plan. Jaren excerpts receive a final length and
surrogate-boundary check. Original snapshots remain intact even when previews
are truncated. Total preview output is bounded by source count times the per-artifact
limit; retained source and reference storage is additional.

`applyDeterministicConsolidation(store, sources, { key, expectedGeneration,
completedAt, options })` applies that plan atomically. An identical original
request replays with zero writes and calls. The pure planner can also be used
without persistence; its recipe hash binds all parameters.

`createConsolidationLexicalIndex([{ id, text }], { limits })` consumes
`@jarenjs/core/search`'s public `compileLexical` owner. Host normalization supplies
NFKC-normalized, lowercase Unicode letter/number terms and unique query terms.
The registered `lexical-key/1` compatibility profile uses exact terms, OR matching,
no prefix/fuzzy expansion and input-order ties through the public comparator.
Its score uses k1=1.2, b=0.7, additive delta=0.5, unique-term document length and
the owner's query-quality multiplier. These are Jaren profile semantics, not
configurable BM25 parameters in Tangle. Public Jaren limits bound indexing/search;
`limits` may configure them explicitly. Default output is capped at 1000 hits.
Budget exhaustion throws rather than returning a partial ranking as complete.
The earlier k1=1.2,b=.75 BM25 experiment remains a benchmark-only reference.
`fuseConsolidationRanks(rankings, k=60)` provides optional reciprocal-rank fusion.
These functions return IDs: hosts must resolve the original source text and apply
the final answer-context budget. A preview's citations alone are not supplied
evidence. The generated benchmark separates raw lexical gains from artifact
routing and publishes confirmation losses as well as gains.

## Supported synthesis

`createConsolidationExecutor({ store, synthesizer, verifier, embedder?, bounds? })`
creates an explicit `execute(request)` and `resolve(request, resolution)` surface.
A request names the scope, pass key, exact source IDs, captured generation,
completion time and optional `tier: 'semantic' | 'combined'`. The default tier is
semantic. Constructing an executor invokes nothing; hosts choose when to execute.

The synthesizer has a stable `id` and `run({ instruction, sources }, { signal })`.
It returns either `{ status: 'ok', claims: [{ text, sourceIds }] }` or
`{ status: 'refused', detail }`. Each claim needs unique, nonempty references to
supplied evidence; the claim union must cover the entire selected batch. Foreign
references, missing coverage, malformed JSON shapes and text/count overflows
refuse before support verification or embedding. Each callback receives its own
copy of the exact evidence projection: ID, occurrence key, original text,
evidence, date and tags. Source vectors are not sent as evidence text.

The verifier also has a stable `id` and receives `{ instruction, sources, claims }`.
It returns `{ status: 'ok', supported: boolean[] }`, in claim order, or a refusal.
Every claim must be approved. This injected judgment is the semantic trust
boundary: shape and citation validation do not establish truth, and a verifier
that always approves provides no entailment assurance. Exact-quote fixtures in
the benchmark measure transport/provenance, not live cross-event reasoning.

An optional fresh embedder supplies `{ model, dims, embed(texts, { signal }) }` and
returns `{ model, dims, vectors }`. It runs only after all claims are approved.
There must be exactly one finite vector of the declared width for every claim,
with the requested model identity. Source vectors are never averaged or reused
for new text. Without this seam, artifacts carry no embedding. Combined mode
adds bounded deterministic previews to the approved claims; all artifacts and
all source removals from the pending buffer activate in one transaction.

The defaults are 10 sources, 8000 input characters per callback request, 8000
characters per structured response and aggregate artifact text, 2048 characters
per claim, 10 claims, three logical callbacks and 10 embedding items. Character
units are UTF-16 and include the rendered instruction/evidence/claim payload;
provider-specific wire framing is outside this contract. Combined previews add
at most one artifact per source beyond the claim bound. The whole-pass logical
ceiling must fund synthesis, support and optional embedding before reservation.
Input and output limits refuse instead of silently truncating semantic claims.

Seams return already structured JSON. A host using a chat provider should use
`@tangleai/models/structured` for wire/schema parsing and explicitly configure
its repair policy (for example `maxRepairs: 0`). The executor invokes each seam
at most once per durable step and implements no provider retry. An arbitrary
seam can itself make multiple HTTP requests; logical callback budgets do not
measure physical HTTP, model tokens, USD or provider latency. Stable seam IDs,
instructions, tier, embedding identity and bounds enter the recipe/pass identity.
Change an ID when changing its prompt, model or semantic policy.

## Recovery and accounting

A durable reservation precedes each callback. Completed responses are validated
and stored before the next dispatch. Preparation persists the full artifact set;
activation failure can resume that set after reopen without repeating synthesis,
support or embedding. A completed pass replays with zero receipt writes, calls
and embedding items. New keys cannot overlap active reservations: uncertain
work returns `unknown`, other active work returns `backpressure`. Deterministic
activation obeys this same exclusion. A disjoint activation that advances the
parent makes a prepared pass terminally stale, retaining its still-pending
sources and call history for an explicit later pass.

A throw after dispatch, or failure to persist a callback's returned result, is
`unknown`. Re-executing does not invoke that seam again. First stop the original
host work, then call `resolve` with `stopped: true`, the exact operation revision
and last step's request hash, plus either `result` or a terminal `failure`.
Resolution validates the same result/citation/embedding bounds and uses revision
CAS. The stopped assertion is host authority, not a process lease or proof that
an external provider stopped. Unknown work cannot expire into an automatic retry.
Invalid or stale resolutions have no effects. A known terminal failure can be
followed by a separately keyed deterministic pass; that remains a deterministic
result and never counts as successful semantic synthesis.

`execute` returns the ordinary success/refusal outcome plus `operationId` and
`accounting`. `reservedCalls` is the durable dispatch count, split exactly into
completed, refused, failed and unknown calls. A dispatched but unconfirmed step
counts as unknown; it may or may not have reached the provider. `invoked` counts
callbacks actually entered by this invocation. `embeddingItems` records items
reserved by a durable embedding step. These historical operation counters remain
visible on replay; the replay receipt and `invoked` report zero new effects.
Inspect the persisted operation to distinguish callback refusal from unsupported
content, malformed output, storage failure and uncertainty.

Cancellation prevents new dispatch and activation. An admitted callback is
awaited, including one that ignores its signal; a returned valid result is staged
before cancellation is reported. A thrown result remains unknown. The executor
creates no detached callback or background retry and claims no hard deadline for
an uncooperative injected function. Hosts retain resources until execution drains.
