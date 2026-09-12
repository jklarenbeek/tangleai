# JarenJS integration

Tangle consumes **Jaren 0.86.0**, tag `v0.86.0`, source commit
`ce489546f21a176a2574169b65b95f9dc15461f7`. Upstream `main`, the tag and npm's
latest release agreed when checked on 2026-09-12. The submodule is the source
reference; runtime imports resolve to the 23 published npm packages. All 99
direct dependency references are exact pins. The lock records registry URLs and
integrities; the [registry receipt](integration/jaren-0.86.0-registry.json) checks
all 23 downloaded archives against it. This receipt does not claim a source
rebuild comparison. Installed packages are neither patched nor source-linked.

```sh
npm ci --ignore-scripts
git submodule update --init vendor/jarenjs
npm run jaren:check
npm run check
npm run store:supervised:smoke
```

The source pin, direct references, lock and installed versions are checked
together. Source initialization is optional for package consumers and Pages;
the repository gitlink is always checked. Do not recursively initialize
upstream benchmark datasets for an application build.

## What changed and how Tangle uses it

The update spans two upstream commits: `5765fba5` introduces native relational
schema/query operations; `ce489546` introduces supervised SQLite processes and
collection drag interactions. Core model/context/agent ownership remains in
Tangle. The [migration handoff](JAREN_AI_MIGRATION.md) describes that boundary.

| Upstream surface | Tangle integration and limits |
|---|---|
| `@jarenjs/db/node-process` | The existing `openTangleDb({ driver })` seam accepts the actual process driver. The [supervised example](../examples/supervised-store.ts) retains its owner, supervises the ordinary outcome service, closes the store, waits for OS exit and explicitly reopens. Both reference domains retain exact audit identities and completed replay performs zero writes/source reads. Tangle adds no process protocol, timer engine or automatic retry. |
| Process admission, fencing and settlement | Store integration tests cover pre-abort, ordinary callback failure, same-file admission refusal, deadline invalidation, rollback of an acknowledged open transaction, stale-handle refusal and explicit reopening with integrity verification. Quarantine retains the owner's credit until exit. An uncertain commit still requires durable-receipt reconciliation. |
| Disk-backed Bun snapshots | The existing `db.backupTo(path)` now uses Jaren's VACUUM INTO path on Bun instead of a database-sized JavaScript image. Node retains its online backup. Tests snapshot a WAL database without checkpointing, reopen it, and replay both outcome domains with zero new effects; post-snapshot writes are absent and a cancelled replacement preserves the previous backup. |
| Expanded model schema and model pen | `createDataAdapter` consumes Jaren's authoring schema directly. Tests author physical column types, defaults, AUTOINCREMENT identity, collation, uniqueness and STRICT through `@jarenjs/linq/model`, then accept through the shared editor revision check. Acceptance changes buffers; it does not create or migrate a database. |
| Native relational expressions and exact mutations | `@jarenjs/db/relational` owns structural SQL, parameters, native NULL/aggregate/collation semantics, expression assignments, matched/changed reporting, conflict targets and byte values. Tangle has no hand-written SQL builder to replace. These operations require an explicitly owned synchronous SQLite connection; they are available for a future physical-table consumer. They do not bypass outcome or MAS service authority. |
| Guarded physical-table migrations | `defineTable`, `planTableMigration`, `applyTableMigration` and `withForeignKeysSuspended` own schema inspection, checked plans, rebuild/copy, indexes/triggers and foreign-key restoration. Existing Tangle collections retain their schema and transaction owner. A physical outcome/MAS layout would require a migration and measurement of equivalent replay, immutability and CAS behavior before adoption. |
| Lightweight database imports and `compileEntityModel` | `/query`, `/model`, `/entity` and `/relational` serve existing-connection consumers. Tangle currently needs the full Store for collections, jobs, transactions and maintenance; it does not separately normalize entities or maintain duplicate mapping caches. |
| LINQ provider iteration | A provider's optional `syncQuery` streams native synchronous cursors and closes them on early return. Existing Tangle history and outcome reads already use bounded database cursors/queries. There is no local provider materialization loop to remove. |
| Collection drag | `createDragInteraction`, `mountCollectionDrag` and `createDraggableCollectionWidget` provide stable-key/revision intent, bounded pending authority and owned pointer/keyboard lifecycle. Current desktop and Pages hosts have no row move/copy command or mounted collection drag consumer. A future collection editor should use these surfaces and add its own authoritative revision-checked operation. |

## Process host ownership

One process driver should be shared across one host ownership domain. Retain the
connection returned by its `open`, and pass a driver adapter returning that
connection to `openTangleDb`. The runnable example supplies finite busy and queue
timeouts and a 30-second supervised deadline for its full scripted walkthrough.
Store initialization is outside that walkthrough deadline; process startup has
Jaren's separate startup deadline. Host callbacks must remain bounded and drain
admitted work. No function is serialized into the child.

`owner.supervise(() => serviceOperation())` observes the response deadline;
`owner.settled()` observes OS process exit. `JD2097` fences the generation, and
later operations refuse with `JD2090`. A deadline is not evidence that a write
rolled back. Keep the owner quarantined until exit, close the invalid Store,
reopen and inspect durable receipts before any explicit retry. The example
preserves both operation and cleanup errors when both fail.

Process supervision requires Node 24 or newer. The entry imports under Bun,
but opening refuses with `JD0003`; the packaged consumer checks that refusal.
The ordinary runtime-picked synchronous Node/Bun drivers remain the defaults.
The desktop needs the synchronous/live Store capabilities that an asynchronous
process connection does not provide. Replacing that host would require a
subscription and lifecycle design, not only a driver switch.

Bun's native snapshot is synchronous SQLite work even though the outer backup
API is asynchronous. It has no incremental native cancellation or progress
promise. `snapshotDatabase` on a raw connection refuses an existing destination;
Store `backupTo` retains its separate atomic replacement contract. Neither path
claims page-identical archival copies or power-loss qualification.

## Compatibility and evidence

The full source gate exercises the actual installed foundation. Packed consumers
also execute the process host on Node, the explicit unsupported-host refusal on
Bun, restored outcome replay on both runtimes, Data authoring, declaration checks
with `skipLibCheck: false`, and browser bundles. The lifecycle conformance run and
MAS smoke qualify the ordinary stores and durable workflow engine. The local
process test qualifies Linux/Node behavior; it is not a universal scheduling or
operating-system timing guarantee.

MAS executable identities include the installed Flow version. Existing
checkpoints from 0.84.3 must not silently resume as 0.86.0 executions; the identity
refusal is intentional. Resume with the matching historical execution environment
or an explicitly reviewed migration. The typed versioned-task overload bridge in
`packages/mas/src/jaren-flow.d.ts` and the LINQ coded-error constructor bridge in
`packages/linq/src/errors.ts` are still needed: neither upstream declaration was
changed in this release. No new declaration workaround is introduced.

Historical paid POLICY, QA and grounding reports retain their original bytes,
identities and selected defaults. Keyless replays test compatibility; they do not
establish new model quality. The [0.83.3 audit](jaren-integration-0.83.3.md),
[history measurements](JARENJS_BENCHMARK.md) and
[0.84.3 qualification](migrations/jaren-ai/qualification-0.84.3.json) retain their
original measured baselines. Exact vector ranking, selected memory policy and
embedding width require their own evidence before changing.
