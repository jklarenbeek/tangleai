# @tangleai/mas

The durable typed multi-agent runtime core: one closed workflow IR, its
pure validator and compiler over JarenJS, and the store-neutral runtime
contracts persistence implements.

## What is here

- **The canonical IR.** `schemas/mas-workflow.schema.json` owns
  `MasWorkflowVersion`: a strict, immutable, content-addressed document
  with six invocation kinds (`agent`, `task`, `graph`, `loop`, `switch`,
  `interaction`), typed entry/exit ports, ordered message edges with
  declared aggregation, hierarchical state pull/push mappings, nested
  caps, and pinned registry/CONFIG references. The TypeScript in
  `src/contracts.gen.ts` is generated from the schemas by
  `@jarenjs/emit`; no hand-written interface mirrors them.
- **Identities.** Every revision is RFC 8785 `canonicalSha256` over an
  explicit credential-free payload. A workflow's `versionId` excludes
  `versionId`, `provenance` and `compile`, so a declarative and an
  imperative authoring of the same semantics hash identically. A clock,
  observation, result, cost or secret has no representable member.
- **The layered validator.** `validateMasWorkflow(workflow, snapshot,
  catalog)` returns `{ valid: true, value } | { valid: false, issues }`
  with stable `TMAS1xxx` codes and exact JSON Pointers, gate by gate:
  closed shape, identity, references/ports/wires, reachability and
  acyclicity, switch scope/default, loop bounds, registry/CONFIG/tool
  capability requests, state scope, budgets. Content failure never
  throws.
- **Registry snapshots.** `createMasRegistrySnapshot` validates and
  deep-freezes capability *data* — roles with content-addressed
  instructions, handler contracts, schema-checked tools, adapters,
  templates and embedded subgraph workflows. Sections are sets: the
  canonical document orders each by id. Functions and credentials are
  host-side and bind only after a snapshot validates.
- **Partition and lowering.** `planMasWorkflow` cuts the graph into
  ordered regions (D4): acyclic regions become `jaren-dag` documents
  written through `@jarenjs/linq/flow` with every invocation task
  checkpointed; switch/loop/interaction control becomes `jaren-fsm`
  documents. Every emitted document compiles through `compileDag` /
  `compileFsm` before a plan exists; a suite refusal is adapted to
  `TMAS1011` retaining the Jaren cause as data. The plan and its
  `executableRevision` are deterministic and deeply frozen.
- **The imperative pen.** `defineMasWorkflow` plus per-kind invocation
  helpers emit the same canonical IR the declarative loader accepts —
  never a second executable shape.
- **Runtime value contracts.** `schemas/mas-runtime.schema.json` fixes
  the run/attempt/message/state-revision/interaction/trace-artifact
  shapes persistence stores; `validateRuntimeRecord` is the write gate,
  and absence is always an explicit state (`retained`, `redacted`,
  `truncated`, `expired`, `not-configured`, `not-run`).

## Template and host binding boundaries

Template bindings authorize specific semantic fields, including agent roles,
profiles and representation adapters, tool subsets, existing numeric cap leaves,
and boolean constants in declared switch guards. A binding cannot replace nodes,
edges, schemas or registry pins, disguise a cap as a role field, overlap another
binding target, add tools or increase a cap. The same validation runs when a
template enters a registry and when it is instantiated. Optional absent
parameters leave the source unchanged, including when all bindings are absent.

Runtime compilation checks the id and version of each host message adapter
against the pinned snapshot and validates capabilities of referenced child graphs.
It captures the selected renderer, so later replacement of a map entry or adapter
descriptor cannot change a compiled run. Renderer closure behavior remains the
trusted host's responsibility.

## Executing a workflow

The host composes three shipped layers (the consumer smoke in
`scripts/mas-consumer-smoke.ts` is the runnable version of this outline):

```ts
import {
  createMasRegistrySnapshot, createMasConfigCatalog,
  defineMasWorkflow, validateMasWorkflow, planMasWorkflow,
  compileMasRuntime, projectMasPlan,
} from '@tangleai/mas';
import {
  openTangleDb, createMasStore, createMasSegmentWorker,
  enqueueMasSegment, ensurePendingMasSegments,
} from '@tangleai/store';

const snapshot = await createMasRegistrySnapshot(registryDocument);   // capability data
const catalog  = await createMasConfigCatalog(hostCatalog);           // CONFIG-resolved allowlists
const validated = await validateMasWorkflow(workflow, snapshot.value, catalog.value);
const plan      = await planMasWorkflow(validated.value);             // compile-proven regions

const db    = await openTangleDb({ path, jobs: true });
const store = createMasStore(db, { now });
const runtime = compileMasRuntime(validated.value, plan.value, snapshot.value, {
  store, taskHandlers, toolBindings, contextProviders, clientFor,     // host capabilities
  now, clock, deadlineFor,
});
const worker = createMasSegmentWorker(db, store, {
  executableRevisions: [plan.value.executableRevision],
  execute: (segment) => runtime.value.executeSegment(segment),
}).start();
await enqueueMasSegment(db, { runId, segment: 0, ...identities });    // idempotent derived id
// … a typed interaction pauses the run durably; later:
await store.respondInteraction(interactionId, response, revision, key);
await ensurePendingMasSegments(db, store);                            // idempotent resume outbox
```

## Run and attempt lifecycle

```text
run:        queued -> running -> completed
                        |   \-> failed
                        v
              waiting_for_input -> resume_pending -> queued (next segment)

attempt:    running -> completed | failed | aborted | uncertain
recovery:   checkpointed node -> restored (no provider/tool invocation)
            committed semantic key -> replayed (stored completion returned)
            uncertain external success -> operator resolution, never auto-repeat
```

## Recovery semantics, precisely

- **Replay before restore.** A node handler first asks the semantic store
  for its idempotency key (`<run>/<region>/<branch>/<iteration>/<node>`);
  a committed completion returns immediately with zero provider/tool
  calls, and the flow checkpoint then re-seeds it. A crash after the flow
  save restores through the suite without invoking the handler at all.
- **Claim epochs fence zombies.** Every segment claim bumps the run's
  claim seq; a worker whose lease expired cannot begin, commit or fail an
  attempt (`TMAS2005`).
- **Terminal outcomes complete the segment.** Whole-run completion,
  semantic workflow failure and a durable interaction wait each call the
  suite checkpoint `complete` exactly once — atomically recording the
  result, marking the job done and pruning that segment's rows. A crash
  between the terminal commit and the job completion reclaims and closes
  without re-executing a region.
- **Uncertainty is a value.** An effectful tool success whose durable
  outcome is unknown records `TMAS2006`; automatic resume refuses to
  repeat it until operator resolution.

## What is deliberately not here

- No I/O: no database, network, model client, environment variable or
  filesystem access. Hosts inject everything.
- No second scheduler or engine: acyclic execution is `compileDag`,
  dynamic control is `compileFsm`, embedded selection is Jaren Query —
  this package writes documents for them and never re-implements them.
- No natural-language workflow authoring, no paper benchmark parity
  claims, no GMPL role/pattern content, no HERA learning.

## Non-claims and limits

The runtime this package anchors executes **manually authored**
workflows. External effects are at-least-once with idempotency-key
guards (never claimed exactly-once); durable queues are same-machine
SQLite through `@jarenjs/db`; shared budgets bound token overshoot only
up to the suite's stated concurrent-call bound.

Durable interactions compose inside graph invocations, switch branches and loop
bodies. Interaction ids use the full invocation path, including iteration, while
root ids retain their existing form. A wait ends the segment after already started
sibling work settles; it holds no worker while awaiting the host. Reconciliation
selects the response reserved for the next segment. Reusing a response key with
different bytes refuses with `TMAS2007`. These semantics use checkpoint ABI
`tangle-mas/5`; earlier executable identities cannot resume under this runtime.

Runtime context limits apply to the combined content of every physical model
request, including normalization and repair. Token spend persists the shared
account's charge (provider totals when present, otherwise its estimate), while
usage fields retain the separately reported prompt/completion counts. Role/control commits checkpoint cumulative active time so reclaim cannot reset
committed elapsed work. Segment settlement is claim-fenced and preserves cumulative active elapsed time; waiting
for a human does not consume active time. Cooperative provider deadlines remain
the host's responsibility, and a late final result cannot pass an exhausted time
cap.

The SQLite adapter checks the UTF-8 size of the full retained public trace inside
completion, FSM, interaction creation and terminal-success transactions. A write
that exceeds `traceBytes` rolls back and fails with `TMAS2009`. Mandatory attempt,
failure and budget receipts may exceed the quota so incurred work is never hidden;
the quota is not a bound on SQLite pages, indexes, WAL or process memory. Already
admitted concurrent calls still settle and retain their failure costs.
