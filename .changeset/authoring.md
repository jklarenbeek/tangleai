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

`@tangleai/os/authoring` is the model-free half of the assistant writing an application: `authoringCrib()` (the grammar rules, Jaren's own operator names, each compiled by a test, and a working to-do list), `gateAuthoredApp` (lint, compile, first frame: what to send back for repair), `checkAuthoredApp` with probes that use an application as a person would (a field or button found by its label, placeholder or text), and `authoredManifest`, a document module that asks for nothing. A new instrument, `benchmark/authoring.ts`, measures how often a plain request becomes an application that works when a person uses it: 22 of 24 with Claude Haiku 5.5 (docs/AUTHORING_BENCHMARK.md).
