---
"@tangleai/os": minor
---

The desktop and its assistant read a host's background work. `createKernel({ jobs })` takes a host's `JobQueue`; without one, every call answers `OS0190`. `kernel.jobQueue()` gives the person's own Jobs app the queue itself. The kernel's contract `tangle_os_jobs` gives the assistant and granted modules `jobs.counts`, `jobs.page`, `jobs.get` and `jobs.schedules` under the same grants as every other contract, each call in the ledger. A job's payload never reaches them.

The assistant changes nothing itself. `jobs.suggest` (cancel, requeue or remove a schedule, with a reason) files the desktop's own proposal `job.change` in the person's inbox. The desktop carries it out once when the person accepts, and only if the job's state, or the schedule, has not changed since it was suggested; otherwise the proposal stays pending with `OS0112`.

The Pages desktop sets the job host's address in Settings, Background work, with the same local-network handling as Web access. The Tangle desktop app serves its own store's queue at `/api/job-queue` to the pages the web reader admits.
