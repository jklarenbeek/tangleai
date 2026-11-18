---
"@tangleai/models": patch
"@tangleai/context": patch
"@tangleai/agents": patch
"@tangleai/linq": patch
"@tangleai/jaren": patch
"@tangleai/assistant": patch
"@tangleai/os": patch
"@tangleai/core": patch
"@tangleai/config": patch
"@tangleai/mas": patch
"@tangleai/documents": patch
"@tangleai/memory": patch
"@tangleai/search": patch
"@tangleai/pipeline": patch
"@tangleai/outcomes": patch
"@tangleai/trace2skill": patch
"@tangleai/evolve": patch
"@tangleai/gmpl": patch
"@tangleai/hera": patch
"@tangleai/forecast": patch
"@tangleai/grounding": patch
"@tangleai/lightrag": patch
"@tangleai/trading": patch
"@tangleai/research": patch
"@tangleai/experiential": patch
"@tangleai/store": patch
---

A desktop loads Jaren's port transport when its first framed window opens instead of with the desktop. The shell waits for it before it hands a frame its ports, and a failed fetch fails that window, whose Retry fetches again. The kernel's `serveModule` and `connectProvider` stay synchronous for any other caller: until the transport arrives, what reaches a served port is held and handed over in order, and a client's calls wait for it. How much this saves depends on the host's bundler: with esbuild splitting chunks, a desktop of in-page modules loads about 25 KB less minified code up front (6 KB gzipped) and the 28 KB port chunk only with a framed window; a bundle built without splitting keeps it inline. `applyTheme` and `applyLocale` live in their own file, so the shell no longer imports the joining side.
