# @tangleai/store

Tangle AI persistence — the MemoryStore contract over SQLite via @jarenjs/db, plus the run/event log the DAG surface reads

Install with `npm install @tangleai/store`. The npm distribution provides ESM JavaScript, TypeScript declarations, and the documented package subpaths for Node 24 and Bun 1.4 or newer.

See the [Tangle documentation](https://github.com/jklarenbeek/tangleai#readme) for architecture, examples, and runtime requirements. All public Tangle packages use one coordinated version.

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
