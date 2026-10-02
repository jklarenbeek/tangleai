---
"@tangleai/store": patch
---

Index MAS trace collections by run so durable workflow commits do not scan
unrelated historical traces. Existing databases require an explicitly reviewed
native model migration; trace records, queued jobs and replay semantics are
preserved.
