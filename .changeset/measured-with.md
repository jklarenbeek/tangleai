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

A benchmark report records the Tangle release it was measured with, and no longer has to equal the current one: the trading and trace2skill rebuilds take the committed report's suite, and their checks require only that the Jaren foundation is this one; CGT compares its runtime without the release. Every source-bound benchmark artifact is regenerated once under the identity that leaves Tangle's version strings out, so a version-only release now regenerates none.
