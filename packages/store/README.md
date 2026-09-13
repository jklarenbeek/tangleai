# @tangleai/store

Tangle AI persistence — the MemoryStore contract over SQLite via @jarenjs/db, plus the run/event log the DAG surface reads

Install with `npm install @tangleai/store`. The npm distribution provides ESM JavaScript, TypeScript declarations, and the documented package subpaths for Node 24 and Bun 1.4 or newer.

See the [Tangle documentation](https://github.com/jklarenbeek/tangleai#readme) for architecture, examples, and runtime requirements. All public Tangle packages use one coordinated version.

## Execution hosts and backups

`openTangleDb` accepts the published Jaren `OpenStoreOptions`, with an optional
driver. Its default selects the synchronous Node or Bun SQLite driver. Injected
drivers use the same Store, transactions, memory, outcome and MAS adapters.

Jaren 0.86.0 adds `nodeProcessDriver` from `@jarenjs/db/node-process`. Retain the
opened owner and pass it through a driver adapter to `openTangleDb`; supervise
ordinary store/service calls with `owner.supervise`. The
[runnable Node example](../../examples/supervised-store.ts) exercises both outcome
domains, waits for owner exit, reopens and proves zero-effect replay:

```sh
npm run store:supervised:smoke
node examples/supervised-store.ts --db /tmp/supervised-outcomes.sqlite
```

Share one process driver per host ownership domain. A response deadline fences
the owner; `settled()` separately reports OS exit and replacement eligibility.
Reopen and inspect durable receipts before retrying an uncertain write. No
automatic replay or restart is added. This host has no synchronous/live-query
surface; importing it on Bun works, while opening refuses with `JD0003`.

`db.backupTo(path)` retains the ordinary Jaren maintenance contract, including
atomic destination replacement. Node uses online backup; Bun uses disk-backed
VACUUM INTO without materializing the database in JavaScript. A Bun copy remains
synchronous native work, without incremental native cancellation. Tests restore
WAL-backed outcome receipts on both runtimes and verify zero-effect replay.

Native physical schemas and migrations remain direct Jaren operations; this
package does not convert existing collections or grant raw SQL callers outcome
service authority. Jaren 0.87.0 provides `planSchemaChange` and
`applySchemaChange` through `@jarenjs/db/relational`, plus column references and
native JSON type inspection. A host can extend `TANGLE_DB_MODEL` for `openStore`
and pass the resulting Store to these adapters. Schema operations require an
available synchronous connection; their source-bound plans do not replace a
host's durable migration receipt. The current Tangle model needs no schema
change for the foundation update. See the [integration audit](../../docs/JARENJS_INTEGRATION.md)
for ownership, compatibility and available mechanisms.

## Reviewed host migrations

Jaren 0.89.0 provides a complete migration lifecycle over an existing native
connection. Use `planPhysicalMigration` and `@jarenjs/linq/migration` directly;
Tangle's adapters keep using the same Store. The
[disposable example](../../examples/physical-migration.ts) runs with
`npm run store:migration:smoke` on Node, or `bun examples/physical-migration.ts`.
It previews a populated synthetic shadow, applies a saved guarded table plan,
checks the receipt after reopening, and preserves exact original memories and
activated consolidation records. It never opens an existing application path.

An application must persist and review its complete plan, retain every applied
migration in order, quiesce Store/worker users before DDL, and reopen with the
new model afterward. Enable foreign keys explicitly on raw connections. Jaren's
`migrate({ connection }, chain, options)` borrows that handle; it does not close
it. Saved per-step mappings describe the row shape at each transform/assertion.
The complete physical target records every table/index/trigger/view in its owned
scope. Repeated startup validates it and refuses drift, even with no pending work.
Do not replace guarded table steps with their printed SQL or grant raw migration
access through outcome/MAS service contracts. Shadow fixtures are separately
owned synthetic inputs, not user-row snapshots embedded in a shared plan.

## Temporal projections

`createTemporalDbStore(db)` implements `@tangleai/memory/temporal`'s transactional
protocol through Jaren immediate transactions. `TANGLE_DB_MODEL` adds
`temporal_occurrences`, `temporal_claims`, `temporal_heads` and
`temporal_operations`. Projection envelopes share the claim collection with an
explicit record kind. Existing databases acquire these collections through the
Jaren model owner; the legacy memory schema and timestamps keep their meanings.

Sources, claims and projections are immutable. Activation compares head version
and revision, then stores the new head and completion receipt atomically.
Same-key replay after reopening writes zero records; failures leave the previous
projection active. Unknown provider effects remain uncertain and cannot be
automatically retried. Raw database writes are trusted-host administration.

Numeric mirrors have distinct names: `observedAtEpochMs`, `knownAtEpochMs`,
`validFromEpochMs` and `validUntilEpochMs`. Unknown bounds have no invented numeric
sentinel. `inspectTemporalSeek` exposes scoped observed-range and claim-as-of
candidate queries with actual Jaren `explain`/`stats` and possible truncation.
`selectTemporalDbAsOf` probes one extra candidate, refuses incomplete coverage,
and refines validity/conflicts before selecting evidence. An expired latest row
cannot hide an earlier valid assertion. The 10,000-claim native benchmark
also reports the companion scoped unknown-bound probe: numeric seeks alone
cannot establish absence of unknown-time evidence. This probe's plan and stats
are returned as `uncertaintyCheck`; candidate-seek timings exclude that refinement.
The benchmark
qualifies these simple seeks on Node and Bun; general semantic retrieval still
validates and ranks a snapshot in memory. Native seek evidence does not qualify
million-token scale or the entire query as SQL execution.

`legacyTemporalProjection` from memory and `backfillTemporalBatch` from store offer
explicit backfill. The database variant stages bounded batches with a durable
cursor before atomic activation. It preserves legacy text, IDs, embeddings,
timestamps and supersession; claims begin with unknown validity and report
`unrecoverableHistory: true` because overwritten occurrences cannot be recovered.
No backfill runs automatically. See the
[public temporal guide](https://github.com/jklarenbeek/tangleai/blob/main/packages/memory/docs/TEMPORAL.md)
and [SQLite example](https://github.com/jklarenbeek/tangleai/blob/main/examples/temporal.ts).

## Atomic outcome storage

`createOutcomeStore(db)` implements `@tangleai/outcomes`' atomic owner over Jaren
immediate transactions, with `outcome_records`, `outcome_keys`, `outcome_heads`
and `outcome_operations` alongside the existing `memories` collection. Immutable
records carry per-scope sequence values. Head activation compares version and
revision; projection changes current memory confidence and its terminal receipt
in the same transaction. Its `memories` property is that same owner's memory
view, not a separately attached store.

```ts
import { openTangleDb, createOutcomeStore } from '@tangleai/store';
const db = await openTangleDb({ path: '/tmp/outcomes.sqlite' });
const store = createOutcomeStore(db);
// Pass store to createOutcomeService with the host's scope, adapters and resolver.
// Close db when the host is finished.
```

Node and Bun use the installed Jaren SQLite drivers. Tests cover independent
handles, rollback faults, abrupt process exit, reopening, and zero-effect
completed replay. A driver busy refusal can require an explicit retry after
contention. Unknown external completion remains uncertain until host
reconciliation; SQLite does not make remote effects transactional. A reservation
is audited before external work, and no-dispatch reconciliation fences the old
worker. Do not combine this receipt store with unrelated nontransactional memory
and claim atomic projection.

History filtering and pagination execute as indexed scope/sequence SQL queries
with LIMIT. That bounds returned records; it is not a driver-wide CPU or scan
budget. The service caps ancestry traversal and detects corrupt immutable bytes.
Raw database writes remain trusted-host administration, outside supported API
authority guarantees. See [the outcome kit](../outcomes/docs/ADAPTERS.md) and the
[measured replay](../../docs/OUTCOME_BENCHMARK.md).


## Consolidation evidence

`createConsolidationDbStore(db)` and `createConsolidationDbPersistence(db)` use
Jaren transactions for immutable source/artifact records, pending buffers and
operation receipts. The four additive collections preserve ordinary memories;
Node and Bun share the [memory contract](../memory/docs/CONSOLIDATION.md).
Sources remain stored after activation, and identical completed passes write
nothing after close/reopen. Snapshot reads validate a whole scope; this is not
a claim of bounded historical storage or large-corpus query latency.

Reservation/CAS records each dispatch before a host callback. Known returned
results and prepared artifacts survive reopen; activation stores the complete
artifact set, pending-buffer update and receipt in one transaction. Unknown
external outcomes remain held until explicit stopped-host resolution. The store
never invokes a provider or retries work. Host runners persist pending arrival
and successful completion for count/time/manual eligibility; close a runner and
await its active work before closing its database.
