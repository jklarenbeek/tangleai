---
"@tangleai/ops": minor
"@tangleai/os": patch
---

`@tangleai/ops/browser` runs the operations runtime in a browser, in a dedicated worker of the page and never in the page itself. Every tab starts one with `startTwin`. The workers queue on one Web Lock, and the worker holding it owns the store: SQLite on OPFS, else an IndexedDB snapshot, else memory. A handle the previous owner still holds is waited for, never read as missing. The owner runs the registry and serves the `job_queue` contract on a BroadcastChannel that every tab reads through `browserJobQueue`.

A job whose handler is `{ contract: 'desktop', operation }` calls the owner's own page. The page serves its tasks under `desktopTaskContract`, and each call receives the job it runs for. A runtime contract client with `invokeJob` is given the job's id, attempt and kind. A page ends its worker on the document's `freeze` event and on `pagehide`, because a frozen tab keeps its lock (measured), and starts a new one when it resumes. `forgetBrowserOps` deletes the runtime's OPFS pool and IndexedDB snapshot.

Measured in Chromium and Firefox over 10 reloads, 20 closes of the owner's tab, 100 concurrent requests from two tabs and a frozen owner: no single-send task was called twice and no answer crossed. Every takeover kept the same OPFS store, with a median of 141 to 217 ms, and the frozen owner in Chromium handed over in 216 ms.

`@tangleai/os/jobs` adds `OS0195`, meaning the background runtime is starting or changing tabs. `jobs.health` now says where a browser runtime keeps its store and which tab owns it.
