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

## In a host's background thread

`@tangleai/ops/supervisor` runs the runtime in a `worker_threads` worker with its own store, never in the host's main
thread. `superviseOps({ workerUrl, workerData })` starts the worker and reads it through the `job_queue` contract
over a MessageChannel, so the person's steering reaches the thread where the leases live; the worker entry calls
`runOpsWorker({ storePath, registry, handlers?, contracts? })`. A worker that exits or throws is started again after a
backoff (1 s doubling to 60 s, reset after five quiet minutes); one that does not answer its health call is hung and
restarted; one whose heartbeat is older than `staleAfterMs` (90 s) is restarted only after two consecutive old readings,
so a sleep or a slow start is not a death. While a worker starts the queue answers `OS0195`. `stop()` drains the history
before the thread ends. The Tangle desktop app runs one when started with `--ops <host module>`.

Measured (`test/ops/supervisor.test.ts`): ten deaths of the worker — five terminations while a single-send push was in its
operation, five uncaught throws in a handler — were each followed by a running worker within 0.3–1.3 s, every one opening
the same store with 0 claim errors; 13 single-send pushes were called 13 times (none twice) and all 11 lost single-send
jobs carry `not-repeated`. Starting over a history of 86,000 events takes about 250 ms (start-up reconciles only the
last `keepDays`).

## A product's background work

A product runs its jobs where it runs: in its own server process, on its own store, because it enqueues jobs inside
its own transactions and fences its pushes with its own effect stores. A suite's server module starts them in its
`start(context)` and answers its requests with their `handle`:

```js
import { productJobs } from '@tangleai/ops/product';

async start(context) {
  const store = await openProductStore(context);   // the product's own store, with OPS_EVENTS_COLLECTIONS and jobSchedules()
  const jobs = productJobs({ scope: 'my-product', title: { en: 'My product' }, store, registry, handlers });
  await jobs.start();
  return {
    handle: (req, res) => jobs.handle(req, res) || productRoutes(req, res),
    close: () => jobs.stop(),
  };
}
```

The product's queue answers at `/<scope>/api/job-queue` only, so the host's authorization by path guards each
product's jobs — reads and steers alike — with that product's rights. The work runs on the product's worker loop, off
the request path; it shares the product's process, so a native crash of the product takes its jobs with it. A desktop
shows several products in one Jobs app through `combinedJobQueue` (`@tangleai/os/jobs`), one `httpJobQueue` per
product's address; every call then names its product's scope.

The Tangle desktop app is its own host: `--ops a.ts,b.ts` runs each host module (`{ registry, handlers?, contracts?,
scope?, title? }`, top level free of side effects) in its own supervised worker with its own store, each under its scope.

Install with `npm install @tangleai/ops`. The npm distribution provides ESM JavaScript, TypeScript declarations, and the documented package subpaths for Node 24 and Bun 1.4 or newer.

See the [Tangle documentation](https://github.com/jklarenbeek/tangleai#readme) for architecture, examples, and runtime requirements. All public Tangle packages use one coordinated version.
