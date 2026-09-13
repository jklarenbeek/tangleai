---
"@tangleai/memory": patch
"@tangleai/store": patch
---

Keep SQLite verification scratch owned by the Node parent until each tested runtime exits, preserving close/reopen checks and failing persistent cleanup errors.
