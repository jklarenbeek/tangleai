# @tangleai/ops

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
