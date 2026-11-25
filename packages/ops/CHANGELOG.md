# @tangleai/ops

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
