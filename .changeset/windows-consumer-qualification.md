---
"@tangleai/store": patch
---

Correct package ownership checks for native and escaped filesystem paths. Let the backup probe parent clean its temporary directory after the Node or Bun child exits, retaining every WAL snapshot, integrity, cancellation and zero-effect replay assertion and failing on persistent cleanup errors.
