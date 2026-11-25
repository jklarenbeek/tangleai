---
"@tangleai/ops": minor
"@tangleai/os": minor
---

A product runs its background work in its own process, on its own store. `productJobs` from `@tangleai/ops/product` starts the operations runtime on a product's store, which is where the product enqueues jobs inside its own transactions and fences its pushes. It serves the store's queue through the `job_queue` contract at the product's own address, `/<scope>/api/job-queue`. A suite's server module calls it in `start` and answers requests with its `handle`, and the host's authorization by path then guards each product's jobs with that product's rights.

A desktop shows several products through `combinedJobQueue` from `@tangleai/os/jobs`. Every call goes to the scope it names, a call without one is refused `OS0194` when there are several, and `scopes()` lists them for a picker. Measured in one process: two products with a job kind of the same name never answer for each other. One product failing five times left the other running every second, with its largest gap 1,006 ms. A single-send job in each is called once when its runtime is replaced inside a lease. The packed packages start `productJobs` under Node and Bun.

The Tangle desktop app takes several host modules (`--ops a.ts,b.ts`), each in its own supervised worker with its own store, under the scope the module exports or its file's name. One module behaves as before.
