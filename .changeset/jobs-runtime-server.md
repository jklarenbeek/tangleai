---
"@tangleai/os": minor
"@tangleai/ops": minor
---

The `job_queue` contract shows what a host's runtime did. `jobs.events` answers the attempts it recorded, newest first: started, completed, failed, lost, cancelled, not repeated, and refused by a budget. They can be filtered by job, kind and time, and none carries a payload. `jobs.health` answers when each runtime last reported, with the host's own time. `jobs.registry` answers the jobs the host's registry declares: their titles, how safe each is to repeat, and their schedules. `jobs.run` runs a registered job once, and is refused while a job of that kind waits or runs.

`jobQueueProvider(store, { runtime })` serves the four operations from a running `createOpsRuntime`, taking the runtime's leases for cancel. It answers empty without a runtime or a history, and refuses to remove a schedule the host's registry set (`OS0192`).

The assistant's `tangle_os_jobs` reads the attempts, the heartbeats and the registry under its grants, and every message or error another system wrote reaches it framed as data, never instructions. With `jobs.suggest` and `action: 'run'` it can suggest running a registered job now. The suggestion waits in the inbox, and the job runs once when the person accepts.
