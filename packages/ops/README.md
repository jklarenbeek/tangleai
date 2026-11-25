# @tangleai/ops

Tangle AI operations — the background work a host runs and the desktop shows. A host writes a **job registry**
(a JSON document: each job's kind, title, what it calls, how safe it is to repeat, its schedule, attempts, budget and
owner); the **runtime** keeps the registry's schedules in a Jaren store and runs every job in a Jaren worker in the
host's background process; every attempt is kept as **history** in one collection of the host's store; the store's
queue and schedules are served to the desktop through the `job_queue` contract (`@tangleai/os/jobs`).

```js
import { checkRegistry, createOpsRuntime, OPS_EVENTS_COLLECTIONS, jobQueueProvider } from '@tangleai/ops';

const store = await openStore({ $model: '0.1', collections: { ...mine, ...OPS_EVENTS_COLLECTIONS } },
  { driver: nodeDriver(), path: 'app.db', runtime, jobs: { schedules: jobSchedules() } });
const checked = checkRegistry(registryDocument);            // every problem with its JSON Pointer
const ops = createOpsRuntime({ store, registry: checked.registry, contracts: { stock: stockClient } });
await ops.start();                                           // in a worker thread or child process, never the UI
const provider = jobQueueProvider(store, { leases: ops.leases });
```

- **How safe a job is to repeat** is declared per job (`safe-read`, `provider-idempotent`, `single-send`). A
  `provider-idempotent` operation receives the job id as its idempotency key. A `single-send` job gets one attempt and
  no catch-up: a schedule fires a small job that enqueues the real one by id, so Jaren itself dead-letters an attempt a
  crash cut off, the history records `not-repeated`, and the person's requeue gives exactly one more attempt.
- **History:** `started` is committed before the operation is called (so "never sent" and "maybe sent" stay apart),
  each outcome after it with its duration; an attempt whose process died is recorded as `lost` (and `not-repeated` for a
  single-send job) at the next start, or within one heartbeat once its lease runs out when another runtime took over
  inside the lease. Settled jobs and their history are swept after `keepDays` (30). No event carries a payload or a result.
- **Budgets:** a job with `budget.runsPerDay` stops calling once the day's runs are spent.
- **Heartbeat:** the runtime writes one row with its stats every 30 s; a watcher outside it judges it.

Measured (`benchmark/ops-guard.ts`, 40 kills of the runtime's process, 20 of them during a push's operation):
47 single-send pushes were called 47 times — **0 twice**; 23 were lost
and dead-lettered, each with `not-repeated` (23 of 23); after the person's requeue each was called exactly once
more (23 of 23, 0 more than once). Safe-read pulls repeated after a kill 20 times, as they may.

## In a browser

`@tangleai/ops/browser` runs the same runtime where there is no server. Each tab starts a dedicated worker
(`startTwin`); the workers queue on one Web Lock, and the one holding it owns the store (SQLite on OPFS, else an
IndexedDB snapshot, else memory — a handle the previous owner still holds is waited for, never read as missing),
runs the registry, and serves the `job_queue` contract on a BroadcastChannel every tab reads (`browserJobQueue`; no
answer yet is `OS0195`, starting). A job `{ contract: 'desktop', operation }` calls the owner's own page, which serves
its tasks with `desktopTaskContract` and receives the job with each call. A page ends its worker on the document's
`freeze` and on `pagehide` — a frozen tab keeps its lock, measured — and starts a new one when it resumes.
`forgetBrowserOps` deletes the pool and the snapshot.

Measured (`.e2e/migration/ops-twin.spec.mjs`, a single-send page task and a safe read each firing every second,
Chromium 1248 / Firefox 1532, ordinary hosting): 10 reloads — 28 / 27 single-send tasks, each called once; 20 closes
of the owner's tab with another tab waiting — taken over 20 of 20, p50 217 / 141 ms, max 279 / 197 ms, every time on
the same `opfs-sahpool` store, no task called twice; 100 concurrent requests from two tabs on one channel — none
crossed; a frozen owner (Chromium) handed over in 216 ms once its page saw `freeze` (the DevTools freeze command does
not fire that event; the spec fires it). WebKit and a long-hidden tab are not measured.

Install with `npm install @tangleai/ops`. The npm distribution provides ESM JavaScript, TypeScript declarations, and the documented package subpaths for Node 24 and Bun 1.4 or newer.

See the [Tangle documentation](https://github.com/jklarenbeek/tangleai#readme) for architecture, examples, and runtime requirements. All public Tangle packages use one coordinated version.
