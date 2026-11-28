# @tangleai/ops

## 0.75.2

### Patch Changes

- Updated dependencies
  - @tangleai/os@0.75.2

## 0.75.1

### Patch Changes

- Updated dependencies
  - @tangleai/os@0.75.1

## 0.75.0

### Patch Changes

- Updated dependencies
  - @tangleai/os@0.75.0

## 0.74.0

### Minor Changes

- c21713a: A product runs its background work in its own process, on its own store. `productJobs` from `@tangleai/ops/product` starts the operations runtime on a product's store, which is where the product enqueues jobs inside its own transactions and fences its pushes. It serves the store's queue through the `job_queue` contract at the product's own address, `/<scope>/api/job-queue`. A suite's server module calls it in `start` and answers requests with its `handle`, and the host's authorization by path then guards each product's jobs with that product's rights.

  A desktop shows several products through `combinedJobQueue` from `@tangleai/os/jobs`. Every call goes to the scope it names, a call without one is refused `OS0194` when there are several, and `scopes()` lists them for a picker. Measured in one process: two products with a job kind of the same name never answer for each other. One product failing five times left the other running every second, with its largest gap 1,006 ms. A single-send job in each is called once when its runtime is replaced inside a lease. The packed packages start `productJobs` under Node and Bun.

  The Tangle desktop app takes several host modules (`--ops a.ts,b.ts`), each in its own supervised worker with its own store, under the scope the module exports or its file's name. One module behaves as before.
- 632315c: `@tangleai/ops/simulate` shows what a job registry will do. `simulateRegistry` runs the registry over 1 to 31 days on its own in-memory store with its own clock: every handler is a recorder, so no operation, page task or host code is ever called, and every history event is marked simulated. The clock moves only while no attempt is in flight. It answers per day and job: the runs, those completed, retried, given up and not repeated (a failed single-send), those a budget skipped, and the runs a clock change moved or repeated. With a failure rate the failures are decided by a seed, so the same seed gives the same answer. The simulation assumes the host is up the whole time, so a lateness window, which only skips runs after downtime, never applies. `registryFromHost` rebuilds a registry from what the `job_queue` contract answers (the registered jobs and their schedules), and `ruleText` writes a stored rule back as RFC 5545 text. Measured: 30 days of a seven-job registry across the spring clock change reproduce the parity counts per day exactly (18,729 runs in about 12 s in Node).

  Jobs takes a `simulate` option and then offers "What will happen" under the schedules. The person chooses 1, 7 or 30 days and a failure rate of 0, 5 or 20 %. The answer is a table of runs per job and day, with retries, given-up and not-repeated jobs and clock-change marks, and a note that nothing ran. The Pages desktop runs it in a worker of its own (`os-ops-sim-worker.js`) that is started for one answer and then ended. A week of the Pages registry, 10,087 runs, takes about 9 s in Chromium and 32 s in Firefox. The browser twin's own store holds nothing of a simulation.

### Patch Changes

- de5afe1: The browser runtime recovers a damaged store. Once, in Firefox under heavy load, a reload cut a write and left the twin's SQLite file unreadable (`SQLITE_CORRUPT: database disk image is malformed`), and the twin could not start until the person cleared the site's data. A store that will not open because its file is damaged (SQLite's CORRUPT or NOTADB) is now removed and opened fresh. The jobs come back from the registry, and only the history before then is lost. The heartbeat carries `recovered` with the time, and the Jobs app says it on the runtime's line. Any other failure to open is still reported, not repaired.
- Updated dependencies [6051715]
- Updated dependencies [c21713a]
- Updated dependencies [632315c]
  - @tangleai/os@0.74.0

## 0.73.0

### Patch Changes

- Updated dependencies [41c27ac]
  - @tangleai/os@0.73.0

## 0.72.0

### Patch Changes

- Updated dependencies [81c2c02]
  - @tangleai/os@0.72.0

## 0.71.0

### Minor Changes

- 397bdeb: `@tangleai/ops/supervisor` runs the operations runtime in a `worker_threads` worker with its own store. `superviseOps` starts the worker and reads it through the `job_queue` contract over a MessageChannel, so the person's cancel reaches the thread where the leases live. The worker entry calls `runOpsWorker`. A worker that exits or throws is restarted after a backoff of 1 s doubling to 60 s. One that does not answer its health call is restarted as hung, and one whose heartbeat is old is restarted only after two consecutive old readings, so a clock jump or a slow start is not taken for a death. While it starts the queue answers `OS0195`, which is now a declared answer of the contract. `stop()` drains the history first. Measured over ten deaths of the worker: each was running again within 0.3–1.3 s with no claim error, no single-send operation was called twice, and every lost single-send job is recorded as `not-repeated`. Start-up reconciles only the last `keepDays`, about 250 ms over 86,000 events. The browser runtime polls once a second instead of four times. The Tangle desktop app, started with `--ops <host module>` or `TANGLE_OPS_MODULE`, runs the module's registry in such a worker, with its own `ops.db` beside the desktop's database. Its `/api/job-queue` serves the runtime under scope `ops` and the desktop store's own queue under scope `desktop`.

### Patch Changes

- @tangleai/os@0.71.0

## 0.70.0

### Minor Changes

- 5c3dcd1: `@tangleai/ops/browser` runs the operations runtime in a browser, in a dedicated worker of the page and never in the page itself. Every tab starts one with `startTwin`. The workers queue on one Web Lock, and the worker holding it owns the store: SQLite on OPFS, else an IndexedDB snapshot, else memory. A handle the previous owner still holds is waited for, never read as missing. The owner runs the registry and serves the `job_queue` contract on a BroadcastChannel that every tab reads through `browserJobQueue`.

  A job whose handler is `{ contract: 'desktop', operation }` calls the owner's own page. The page serves its tasks under `desktopTaskContract`, and each call receives the job it runs for. A runtime contract client with `invokeJob` is given the job's id, attempt and kind. A page ends its worker on the document's `freeze` event and on `pagehide`, because a frozen tab keeps its lock (measured), and starts a new one when it resumes. `forgetBrowserOps` deletes the runtime's OPFS pool and IndexedDB snapshot.

  Measured in Chromium and Firefox over 10 reloads, 20 closes of the owner's tab, 100 concurrent requests from two tabs and a frozen owner: no single-send task was called twice and no answer crossed. Every takeover kept the same OPFS store, with a median of 141 to 217 ms, and the frozen owner in Chromium handed over in 216 ms.

  `@tangleai/os/jobs` adds `OS0195`, meaning the background runtime is starting or changing tabs. `jobs.health` now says where a browser runtime keeps its store and which tab owns it.

### Patch Changes

- Updated dependencies [5c3dcd1]
- Updated dependencies [27dca48]
  - @tangleai/os@0.70.0

## 0.69.1

### Patch Changes

- e396468: The runtime now records an attempt a takeover cut off inside its lease. Before, a crashed attempt was recorded as `lost`, and as `not-repeated` for a single-send job, only when a runtime started after the attempt's lease had run out. A standby that took over within the lease never recorded it at all. The runtime now checks the attempts of the last two hours on every heartbeat, so such an attempt is recorded once its lease runs out. A failed check is counted as `reconcileErrors` in `health()` instead of being dropped silently. Settled jobs and their history are now swept after `keepDays` (30 by default) with Jaren's own `sweep`; before, nothing removed settled jobs.
- @tangleai/os@0.69.1

## 0.69.0

### Minor Changes

- 5dd2c32: The `job_queue` contract shows what a host's runtime did. `jobs.events` answers the attempts it recorded, newest first: started, completed, failed, lost, cancelled, not repeated, and refused by a budget. They can be filtered by job, kind and time, and none carries a payload. `jobs.health` answers when each runtime last reported, with the host's own time. `jobs.registry` answers the jobs the host's registry declares: their titles, how safe each is to repeat, and their schedules. `jobs.run` runs a registered job once, and is refused while a job of that kind waits or runs.

  `jobQueueProvider(store, { runtime })` serves the four operations from a running `createOpsRuntime`, taking the runtime's leases for cancel. It answers empty without a runtime or a history, and refuses to remove a schedule the host's registry set (`OS0192`).

  The assistant's `tangle_os_jobs` reads the attempts, the heartbeats and the registry under its grants, and every message or error another system wrote reaches it framed as data, never instructions. With `jobs.suggest` and `action: 'run'` it can suggest running a registered job now. The suggestion waits in the inbox, and the job runs once when the person accepts.

### Patch Changes

- Updated dependencies [4b99ca4]
- Updated dependencies [5dd2c32]
  - @tangleai/os@0.69.0

## 0.68.0

### Minor Changes

- 1227c28: `@tangleai/ops` runs a host's background jobs. A job registry is a JSON document checked by `checkRegistry`, with every problem reported at its JSON Pointer. Each job declares how safe it is to repeat: `safe-read`, `provider-idempotent` or `single-send`. `createOpsRuntime` keeps the registry's schedules in the Jaren store, under ids `ops:<registry>:<kind>`, rewriting one only when the registry changed it and never touching another's. It runs every job in a Jaren worker, either as a contract operation or as a code handler. A `provider-idempotent` operation receives the job id as its idempotency key.

  A `single-send` job is fired through a small job that enqueues the real one by id with one attempt. Jaren dead-letters an attempt a crash cut off, and the person's requeue gives exactly one more. Measured under 40 kills: 47 pushes, 47 calls, none twice. All 23 lost pushes were recorded as `not-repeated` and called exactly once more after a requeue.

  Every attempt is kept in one collection of the host's store (`OPS_EVENTS_COLLECTIONS`). `started` is committed before the call, and each outcome follows with its duration. A crashed attempt is recorded as `lost` at the next start, and no event holds a payload. A job with `budget.runsPerDay` stops calling once the day's runs are spent. The runtime writes a heartbeat row, and `runNow` refuses while a job of that kind waits or runs.

### Patch Changes

- @tangleai/os@0.68.0

## 0.67.0

### Patch Changes

- Updated dependencies [e9859ce]
- Updated dependencies [c1fca28]
  - @tangleai/os@0.67.0

## 0.66.0

### Minor Changes

- 9496bb4: The desktop can read a host's background work. `@tangleai/os/jobs` defines the `job_queue` contract:
  - reads: how many jobs are in each state and how many wait per kind, a page of jobs by state and kind, one job with its attempts and last error, and every recurring schedule with its rule, zone, state, and next and last run;
  - steers: cancel, requeue and unschedule.

  A job's payload and result never cross the contract. Every call takes an optional `scope`. `httpJobQueue(baseUrl)` calls a host that serves the contract, and `unconfiguredJobQueue()` answers `OS0190`. The other refusals are `OS0191` (no such job or schedule), `OS0192` (its state forbids the call), `OS0193` (another process runs the job) and `OS0194` (a scope the host does not serve).

  The new package `@tangleai/ops` serves the contract over any Jaren store opened with `jobs`. Each call maps onto Jaren's own fenced operation: a running job is cancelled only with the lease the host's worker holds, so a job another process runs is refused rather than stolen.

### Patch Changes

- Updated dependencies [9496bb4]
  - @tangleai/os@0.66.0
