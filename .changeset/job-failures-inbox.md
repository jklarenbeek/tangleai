---
"@tangleai/os": minor
---

Background work that needs a person now reaches them. `watchJobs({ kernel, queue, hours, remember })` reads a host's job queue once an interval (30 s by default). It files one inbox item per job that died, per single-send job a crash cut off (not repeated), per job on its third failed attempt, and per background runtime that stopped reporting for 90 s. An item is updated in place, never duplicated, and a runtime that reports again takes its item back. Before this, a failed job was noticed only when someone opened the place that lists them.

A failed job's item offers Run again, which requeues the job once and only if it still needs the person, otherwise answering `OS0112`. It also offers Dismiss, which does nothing, and Open Jobs. What the person decided is remembered (`remember`), so a dismissed failure is not filed again after a reload unless the job fails anew. A silent runtime's item offers Open Jobs and Dismiss. The other system's error text is quoted and marked as data, never instructions.

The item is filed at once, but its notice waits for the person's working hours. The notice is the item's `attention`, which rings the dock's mail button and adds "needs your attention" to its name. When the working hours are unknown, no notice is given. When a working period begins, every item still open is noticed again. The Pages desktop reads the working hours from the Calendar and starts the watcher over its job queue; Forget everything also removes what the watcher remembered. Every new sentence is in all eleven packs.
