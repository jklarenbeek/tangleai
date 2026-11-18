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

A contradiction is resolved as one operation: `MemoryStore` gains an optional atomic `mutate({ put, delete })` (the in-memory store has it), which `resolveContradictions` uses to write the superseded loser and its synthesized resolution together; on a store without it the resolution is written first and taken back if the loser cannot be written. A loser already superseded, by the same winner in a replayed pass or by another in a concurrent one, is counted as an application skip and never written again, so a replay no longer stores a second resolution.
