# JarenJS integration

Tangle consumes **Jaren 0.91.2**, tag `v0.91.2`, source commit
`74036c063c5a4efa8c41aa878713d405223cc464`. Upstream `main`, the tag and all 23
consumed npm latest releases agreed when checked on 2026-09-16. The submodule is the source
reference; runtime imports resolve to the 23 published npm packages. All 116
direct dependency references are exact pins. The lock records registry URLs and
integrities; the [registry receipt](integration/jaren-0.91.2-registry.json) checks
all 23 downloaded archives against it. [The consumer gate](CONSUMER_GATE.md)
describes these checks as a reusable pattern for other suite consumers. This receipt does not claim a source
rebuild comparison. Installed packages are neither patched nor source-linked.

```sh
npm ci --ignore-scripts
git submodule update --init vendor/jarenjs
npm run jaren:check
npm run check
npm run store:supervised:smoke
npm run store:migration:smoke
```

The source pin, direct references, lock and installed versions are checked
together. Source initialization is optional for package consumers and Pages;
the repository gitlink is always checked. Do not recursively initialize
upstream benchmark datasets for an application build.

## Consolidation ownership

The opt-in [consolidation API](../packages/memory/docs/CONSOLIDATION.md) reuses
existing public Jaren foundations: `core/search` owns lexical postings and
scoring, `core/schedule` owns admission/drain, `contract/local` owns validated
operation dispatch, and canonical JSON, validation, emission, vector/chunk
primitives and database transactions retain their suite owners. These surfaces
were available before 0.87.0; consolidation does not attribute them to that
release's database changes. Tangle owns evidence identity, complete-batch
activation, claim support policy, callback reservations and host trigger
eligibility. The frozen standard-BM25 comparison lives only in the benchmark;
production lexical routing delegates to `compileLexical`.

## Changes since 0.90.6 and current adoption

Three upstream commits cover this update: bounded PostgreSQL Store parity with
portable backend hosts, opt-in Windows qualification, and settled recovery pool
clients. Source changes are in `@jarenjs/db` (PostgreSQL dialect, driver,
cursor, notifications, jobs, migration and replication; the dialect-neutral
`relational` module; the new `@jarenjs/db/async-live` subpath) and one addition
to `@jarenjs/core/async`. Every other consumed package advances its version and
dependency references only. The
[upstream comparison](https://github.com/jklarenbeek/jarenjs/compare/v0.90.6...v0.91.2)
and pinned submodule retain the exact implementation and tests.

| Surface | Tangle use and boundary |
|---|---|
| `createLatestDelivery` (`@jarenjs/core/async`) | **Adopted** by the desktop folder watcher: one pass at a time, the latest window retained behind it, observer failures isolated. It replaces the watcher's hand-rolled running/pending pump, and a window that closes during the start scan now runs right after it instead of waiting for the next filesystem event. The watcher keeps its own policy: debounce, overflow, admission refusals, the awaited in-flight pass on close, and a generation that drops a queued window when the folder is retargeted. |
| SQLite relational, jobs, live and migration refactors | Adopted transparently through the existing `openStore`, `db.jobs` and `planPhysicalMigration` seams. `sql`, `planRelational` and `relational` keep their public names; the typecheck, the store, memory, MAS and desktop suites and the physical-migration consumer pass unchanged. |
| PostgreSQL Store parity, `postgresNotifications`, backend hosts | **Evaluated, not adopted.** Tangle is a local-first application over SQLite (Node, Bun and the browser WASM driver); no Tangle deployment runs a PostgreSQL server. PostgreSQL offers no synchronous incremental live maintenance, which the memory store depends on. Recorded so a hosted deployment consumes this rather than writing a dialect. |
| `asyncLive()` (`@jarenjs/db/async-live`) | **Evaluated, not adopted.** Bounded resnapshot live maintenance for asynchronous connections, which needs durable capture and a lazy row iterator. Tangle's synchronous Node/Bun connections already maintain live queries incrementally, so switching would replace incremental patches with bounded re-reads without removing any Tangle code. |
| `physicalObjectKey` | Not consumed; the migration example uses the complete planned artifacts and never names physical objects by key. |

The generic capabilities Tangle still carries downstream (paired resampling,
rank fusion, text-edit compilation, asynchronous guarded validation, a process
executor, provider capture, a real snapshot event id, a single trailing newline
from `jaren-emit`) are not in this release; the downstream implementations and
workarounds stay in place.

## Changes from 0.89.0 to 0.90.6

Seven upstream commits cover this update. They add bounded host helpers and
asynchronous SQLite integration, fix startup contention and Windows recovery
checks, reuse bounded cleanup for shadow identity fixtures, stabilize native
cleanup and browser input qualification, enforce portable native fixture
cleanup, await child drainage in native qualification, and drain native Bun
statements on connection close. Only `contract`, `db`, `josl`, `view` and `app`
change source; `core`, `emit`, `flow`, `json`, `linq` and `validate` ship
identical sources under new versions. The
[upstream comparison](https://github.com/jklarenbeek/jarenjs/compare/v0.89.0...v0.90.6)
and pinned submodule retain the exact implementation and tests.

| Surface | Tangle use and boundary |
|---|---|
| `planPhysicalMigration`, borrowed `migrate`, `migrationStatus` | The [runnable host example](../examples/physical-migration.ts) extends `TANGLE_DB_MODEL` with an explicitly owned physical table. It previews a saved plan on a populated synthetic shadow, applies between closed Store lifetimes, reopens, and checks the durable migration receipt. Original memory and activated consolidation records remain exact. No production collection is converted automatically. |
| Guarded `table` steps and per-step model mappings | The example uses `@jarenjs/linq/migration` to compose a typed transform under its historical mapping, the complete `planTableMigration` artifact and a target assertion. `fromPlanned` retains the immutable physical header and native guards. A complete scoped target catches extra indexes at repeated startup; schema dispositions preserve the Tangle collection objects. |
| Migration failure and ownership handling | [Native consumers](../test/store/physical-migration.test.ts) qualify Node and Bun rollback after primary transform/table work, stale source refusal, changed history, target drift, same-file shadow refusal before fixture invocation, cancellation and truncated-plan refusal. The borrowed handle remains open. Raw connections explicitly enable foreign keys; the tests check restoration. This is application integration evidence, not a new power-loss or arbitrary-driver guarantee. |
| Markdown `pageBreak` | Assistant, desktop and Pages use the existing Jaren Markdown component. A standalone `<!-- pagebreak -->` becomes an accessible separator; Jaren's stylesheet supplies screen and print rules. Assistant tests retain code/inline marker behavior; browser qualification checks the native screen and print styles. Tangle adds no parser or page-break node. Text ingestion continues to preserve source Markdown; a marker does not create an inferred PDF page number. |
| Validator fixes | Existing schema/content boundaries inherit corrected dynamic string-length and object equality checks, reference siblings, and browser-safe base64 JSON decoding. The normal source, emitted-contract and browser gates exercise the installed validator; no local validator or schema weakening is added. |
| Flow, database and UI fixes | The dependency update carries Jaren's non-destructive provenance refusal, safe migration key preservation, SQLite ownership/cleanup fixes, collection/search interaction fixes, Forms rules, CSV and Mermaid roundtrip fixes. Tangle's MAS uses its own durable policy over Flow DAG checkpoints rather than `createDomainRun`; that upstream run-store fix is not represented as a new Tangle runtime. Existing consumers remain the qualification boundary. |
| Native open contention and capture ordering | Adopted transparently through the existing `openStore` seam. A classified busy failure of the idempotent open sequence is retried within the configured busy timeout, bounded at 32 attempts, yielding so a competing opener can finish; capture's first-open transaction closes before the collection cores are constructed; Bun connections drain native statements on close. Tangle adds no retry, scheduler or open policy of its own, and the elapsed-time admission window is Jaren's, not Tangle's logical clock. |
| Asynchronous worker, pool and process Stores | **Evaluated, not adopted.** These hosts declare `live` false and expose no sessions, selecting journal capture. Tangle's memory store reads through the synchronous live-query engine, so adopting them would trade a capability Tangle depends on for process isolation it does not need. The synchronous Node/Bun connections remain the ownership boundary for physical schema work. |
| `@jarenjs/contract/continuation-node` | **Evaluated, not adopted.** Bounded HMAC page-cursor envelopes with injected scope, query/order identity, key lookup and clock. No Tangle surface hands a paging cursor across a trust boundary: the desktop control plane is loopback-only and the store publishes no `page` seam to an untrusted client. Recorded so a surface that later crosses that boundary consumes this rather than inventing a signature. |
| Browser dialog, focus, route and file-token helpers | **Evaluated, not adopted.** `@jarenjs/view/helpers/{dialog,focus}` and `@jarenjs/app/{dialog,file-tokens,routes}` are new and additive; `createApp` and `formEventFields`, the surfaces the assistant component imports, are unchanged. Pages hand-wires three lines of hash routing into its own host contract, which `createHashRouteSubscription` would re-plumb rather than delete; its qualified browser proofs are not rewritten for a dependency update. |

Jaren owns migration history, checksums, immediate transactions, complete target
verification and shadow lifetime. The host owns the reviewed chain, table/data
policy, quiescence and the decision to apply it. A saved table plan must not be
flattened into an SQL loop. Synthetic fixture rows stay outside the saved plan.
A successful repeat performs no migration DDL/DML; it still validates the target.
Changed historical documents refuse instead of rewriting receipts. Physical
schema changes use synchronous Node/Bun connections; the process driver and
ordinary live Store callbacks are not substitutes for that ownership boundary.

The physical model-diff planner still refuses changed declarations it cannot
infer. Future physical outcome/MAS layouts require their own migration design
and replay/CAS qualification. No new AI editor migration authority, automatic
retry, scheduler, parser or SQL engine is introduced.

## Inherited native schema integration

The [0.87.0 release](https://github.com/jklarenbeek/jarenjs/releases/tag/v0.87.0)
is one commit after the qualified 0.86.0 source. Its implementation changes are
in `@jarenjs/db`: guarded native schema changes, column references, `json_type`
and bounded SQL-keyed mutation statement reuse. The other consumed packages
advance their versions and dependency references; they do not add new model,
agent, Flow, editor or pen implementations in this release.

| New surface | Application to Tangle |
|---|---|
| `planSchemaChange` / `applySchemaChange` | Hosts can plan ADD COLUMN, DROP INDEX, RENAME TABLE and DROP TABLE directly through `@jarenjs/db/relational`. The plans bind the current main schema and relevant settings, and refuse drift. The [native consumer](../test/store/native-foundation.test.ts) qualifies rollback, a transactionally recorded host migration receipt, reopening and preservation of Tangle evidence/settings. Tangle's current model uses document collections and needs no physical-column migration for this update. |
| Column `references` | Host-owned physical tables can declare a single-column foreign key in a table or additive column definition. Qualification proves an invalid reference fails without inserting a row and Tangle records remain unchanged. |
| Structural `sql.call('json_type', ...)` | Native inspection distinguishes missing paths, explicit JSON null and scalar/container types while preserving original text bytes. Qualification uses an adopted host entity beside the Tangle model. This does not replace JSON document-query semantics with SQLite semantics. |
| Mutation statement retention | Jaren's bounded cache keys prepared statements by emitted SQL and retains no prior payload documents, bindings, projections or output limits. Tangle adds no cache. The consumer exercises changing payloads, per-call projection and output-bound rollback while ordinary Tangle collection writes continue. No application RSS or throughput improvement is claimed: Tangle's production model has no physical entities, and Jaren documents a repeated-document compilation tradeoff. |

The native consumer opens a caller-owned extension of `TANGLE_DB_MODEL` with
`openStore` and uses the existing Tangle store adapters. Its host tables are
qualification fixtures, not a new production storage lane. Native schema work
requires an available synchronous Node/Bun SQLite connection and runs between
completed store operations. It is not supported by the asynchronous process
connection. A schema plan is not a durable migration receipt: the host owns
completion identity, transaction boundaries and any row-disposition policy.
Tangle does not expose destructive DDL through an AI editor or perform schema
changes automatically on a user's database.

Existing integrations retained from 0.86.0 are qualified against the new packages:

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

## Pattern content integration

`@tangleai/gmpl` consumes `parseToml` for all fourteen in-scope source packs and
`compileJtltStylesheet` for compiled, closed-variable rendering. Installed JSON
artifacts remove any runtime dependency on checkout prompts. Jaren canonical
hashing, validation and schema emission bind the immutable catalog, roles,
recipes and domain contracts. Delphi consumes Jaren mean, median and sample
standard deviation; confidence remains diagnostic. MAS owns lowering through
Jaren flow documents, durable queue/checkpoint composition and bounded admission
through `createScheduler`. Tangle adds the pattern policy, not another parser,
statistics engine, scheduler or executor.

The [pattern report](GMPL_BENCHMARK.md) measures all six families, fourteen packs,
288 primary scripted executions and seven diagnostic ablations. The public
consumer and packed qualification cover Node, Bun, strict declarations and the
pure browser API. Synthetic conformance is separate from the unmeasured live
LoCoMo quality criterion.

## Temporal integration

The explicit temporal API consumes published Jaren calendar/interval/vector
kernels, locale names, canonical JSON, validation and SQLite transactions/indexes.
Tangle core owns closed temporal schemas and emitted types; memory owns exact
source citations, knowledge/validity policy, bounded preparation, immutable
projections and cited answers. Structured provider clients remain in
`@tangleai/models`. Store adapts the shared protocol to the existing Jaren owner
with separately named numeric epoch mirrors. No Jaren source is copied or patched.

[Public usage](../packages/memory/docs/TEMPORAL.md),
[strict runtime evidence](TEMPORAL_BENCHMARK.md) and the
[LongMemEval comparison](TEMPORAL_EVALUATION.md) state the limits: observation
indexes are not validity, native candidate seeks are not full SQL semantic
retrieval, and keyless/source-only qualification is not a live QA gain. The
ordinary pipeline retains its selected default with temporal routing off.

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
also execute the native schema/entity consumer on Node and Bun, the process host on Node, the explicit unsupported-host refusal on
Bun, restored outcome replay on both runtimes, Data authoring, declaration checks
with `skipLibCheck: false`, and browser bundles. The lifecycle conformance run and
MAS smoke qualify the ordinary stores and durable workflow engine. The local
process test qualifies Linux/Node behavior; it is not a universal scheduling or
operating-system timing guarantee.

MAS executable identities include the installed Flow version. Existing
checkpoints from 0.89.0 or earlier must not silently resume as 0.90.6 executions; the identity
refusal is intentional. Resume with the matching historical execution environment
or an explicitly reviewed migration. The typed versioned-task overload bridge in
`packages/mas/src/jaren-flow.d.ts` and the LINQ coded-error constructor bridge in
`packages/linq/src/errors.ts` are still needed: neither upstream declaration was
changed in this release. No new declaration workaround is introduced. The native test fixture names only
the synchronous operations it observes on the intentionally opaque driver handle.

The [0.86.0](integration/jaren-0.86.0-registry.json),
[0.87.0](integration/jaren-0.87.0-registry.json) and
[0.89.0 registry receipts](integration/jaren-0.89.0-registry.json) remain
historical archive checks. Historical paid POLICY, QA and grounding reports retain their original bytes,
identities and selected defaults. Keyless replays test compatibility; they do not
establish new model quality. The [0.83.3 audit](jaren-integration-0.83.3.md),
[history measurements](JARENJS_BENCHMARK.md) and
[0.84.3 qualification](migrations/jaren-ai/qualification-0.84.3.json) retain their
original measured baselines. Exact vector ranking, selected memory policy and
embedding width require their own evidence before changing.
