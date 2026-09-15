---
"@tangleai/store": patch
---

Move the store onto the Jaren 0.90.6 registry foundation and source pin. The
underlying native store now retries a classified busy failure of its idempotent
open sequence, yielding between bounded attempts so a competing opener can
finish, and closes capture's first-open transaction before the collection cores
are constructed. Bun connections drain their native statements on close. Tangle
reads these through the existing `openStore` seam: no Tangle API changes, and
the synchronous live-query engine the memory store depends on is retained
rather than traded for the new asynchronous worker, pool and process hosts.
Every keyless benchmark document is requalified against the new foundation; the
executable identity a run records moves with the installed suite version, so
checkpoints written under the previous foundation are refused rather than
silently resumed.
