---
"@tangleai/ops": patch
---

The runtime now records an attempt a takeover cut off inside its lease. Before, a crashed attempt was recorded as `lost`, and as `not-repeated` for a single-send job, only when a runtime started after the attempt's lease had run out. A standby that took over within the lease never recorded it at all. The runtime now checks the attempts of the last two hours on every heartbeat, so such an attempt is recorded once its lease runs out. A failed check is counted as `reconcileErrors` in `health()` instead of being dropped silently. Settled jobs and their history are now swept after `keepDays` (30 by default) with Jaren's own `sweep`; before, nothing removed settled jobs.
