---
"@tangleai/ops": patch
---

The browser runtime recovers a damaged store. Once, in Firefox under heavy load, a reload cut a write and left the twin's SQLite file unreadable (`SQLITE_CORRUPT: database disk image is malformed`), and the twin could not start until the person cleared the site's data. A store that will not open because its file is damaged (SQLite's CORRUPT or NOTADB) is now removed and opened fresh. The jobs come back from the registry, and only the history before then is lost. The heartbeat carries `recovered` with the time, and the Jobs app says it on the runtime's line. Any other failure to open is still reported, not repaired.
