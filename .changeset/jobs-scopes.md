---
"@tangleai/os": minor
---

The desktop follows the background work of every product a host runs. A `JobQueue` may answer `scopes()` with the products it serves (`JobScope`: a scope and its title per language); a queue without it is one unnamed product, and every call site works with both. Every call to a queue with several products names its scope, since such a queue refuses a call without one (`OS0194`).

Jobs shows one product at a time. With more than one, the header offers a product choice and a quiet row above the states gives each product's failed and waiting counts; choosing one reloads the app for that product. With one product nothing changes.

`watchJobs` looks at every product in turn, so a job given up in the second product reaches the inbox as well as one in the first. Item ids carry the scope (`job-failed-<scope>-<job>`, `runtime-silent-<scope>-<runtime>`), a dismissal is remembered per product and job, and the inbox items name the product. A product the person may not read, or one whose host does not answer, is skipped quietly while the others are still watched.

The kernel's `tangle_os_jobs` tool gains the read `jobs.scopes`, every read takes an optional `scope`, and a suggested change or a failed-job item carries the scope and the product's title, so accepting it acts in that product. The Calendar shows each product's upcoming runs, titled with the product's name when there is more than one, and exports them together.
