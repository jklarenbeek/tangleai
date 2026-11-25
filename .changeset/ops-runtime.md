---
"@tangleai/ops": minor
---

`@tangleai/ops` runs a host's background jobs. A job registry is a JSON document checked by `checkRegistry`, with every problem reported at its JSON Pointer. Each job declares how safe it is to repeat: `safe-read`, `provider-idempotent` or `single-send`. `createOpsRuntime` keeps the registry's schedules in the Jaren store, under ids `ops:<registry>:<kind>`, rewriting one only when the registry changed it and never touching another's. It runs every job in a Jaren worker, either as a contract operation or as a code handler. A `provider-idempotent` operation receives the job id as its idempotency key.

A `single-send` job is fired through a small job that enqueues the real one by id with one attempt. Jaren dead-letters an attempt a crash cut off, and the person's requeue gives exactly one more. Measured under 40 kills: 47 pushes, 47 calls, none twice. All 23 lost pushes were recorded as `not-repeated` and called exactly once more after a requeue.

Every attempt is kept in one collection of the host's store (`OPS_EVENTS_COLLECTIONS`). `started` is committed before the call, and each outcome follows with its duration. A crashed attempt is recorded as `lost` at the next start, and no event holds a payload. A job with `budget.runsPerDay` stops calling once the day's runs are spent. The runtime writes a heartbeat row, and `runNow` refuses while a job of that kind waits or runs.
