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
change for this update. See the [integration audit](../../docs/JARENJS_INTEGRATION.md)
for ownership, compatibility and available mechanisms.

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
