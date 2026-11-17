---
"@tangleai/models": minor
"@tangleai/context": minor
"@tangleai/agents": minor
"@tangleai/linq": minor
"@tangleai/jaren": minor
"@tangleai/assistant": minor
"@tangleai/os": minor
"@tangleai/core": minor
"@tangleai/config": minor
"@tangleai/mas": minor
"@tangleai/documents": minor
"@tangleai/memory": minor
"@tangleai/search": minor
"@tangleai/pipeline": minor
"@tangleai/outcomes": minor
"@tangleai/trace2skill": minor
"@tangleai/evolve": minor
"@tangleai/gmpl": minor
"@tangleai/hera": minor
"@tangleai/forecast": minor
"@tangleai/grounding": minor
"@tangleai/lightrag": minor
"@tangleai/trading": minor
"@tangleai/research": minor
"@tangleai/experiential": minor
"@tangleai/store": minor
---

The desktop keeps its state (the person's dock, the settings they set for applications, and the host's own preferences) as revisioned JSON documents in one store the host chooses: the browser (`webStorageStore`), its own server through the new `tangle_os_state` contract (`contractStore`), or the signed-in framed application (`createKernel({ state: { module } })`). It loads before anything in it can change, saves in the background one document at a time with retries, takes a document another device changed instead of overwriting it, and shows in the dock when it cannot load or save. `@tangleai/os/state-server` gives a server the `DESKTOP_STATE_MODEL` table for `@jarenjs/db` (SQLite or PostgreSQL), a compare-and-set repository interface and `serveDesktopState`, with the owner always taken from the server's session. The Pages desktop keeps its state in the browser; `createKernel({ settings })` still works.
